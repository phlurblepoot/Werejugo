# Phase 3 — Map Editor Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 790-line `ItemEditor.tsx` god-component with a thin `VisitEditor` shell + per-kind Details forms + extracted hooks (`useVisitDraft`, `useCruiseLookup`), on a type-selector-on-top, **Details / Appearance** tabbed UX, reusing the existing style controls and Phase-2's `MediaUploader` — with full behavior parity.

**Architecture:** A new `frontend/src/components/visit-editor/` module. `useVisitDraft` is the single source of truth for the editable draft (geometry/payload assembly + validation). `useCruiseLookup` extracts the CruiseMapper orchestration. Each kind gets a small Details form; an `AppearanceTab` reuses `StylePicker`/`PinStyleControls`/`PathStyleControls`; a `VisitPhotos` wrapper composes `MediaUploader` plus existing-photo caption/delete and pre-save staging. The shell composes them and owns Save. No backend changes — saves go through the existing `api.createItem`/`updateItem`/media/links seam.

**Tech Stack:** React 18 + Vite, `@tanstack/react-query`, MapLibre (unchanged). Tests: Vitest + @testing-library/react (incl. `renderHook`) with `api` mocked. Reuses Phase-1/2 client methods and Phase-2 `MediaUploader`.

**Depends on:** Phase 2 (`MediaUploader`, generic `uploadMedia`/`createLink`). No new endpoints.

---

## Conventions (apply to every task)

- All commands run from `frontend/`.
- New files live in `frontend/src/components/visit-editor/`.
- The data model keeps the existing client `Item`/`Photo`/`Waypoint`/`Geometry` types (the editor module names its concept "visit" but uses the back-compat `Item` shape, exactly as `MapPage` does today).
- Component/hook tests mock `api`: `vi.mock("../../api/client", () => ({ API_URL: "", api: { ... } }))`. **Vitest hoists `vi.mock` above top-level `const`s** — define factory-referenced `vi.fn()`s with `vi.hoisted(() => ({...}))`.
- Reused **unchanged**: `StopBuilder`, `StylePicker`, `PinStyleControls` (`type PinShapeVals`), `PathStyleControls` (`type PathVals`), `PlaceSearch`, `Autocomplete`, `MediaThumb`, and `lib/style.ts` / `lib/geo.ts` helpers.
- Commit after each task with the message in its final step.

---

## File Structure

**New files (all under `frontend/src/components/visit-editor/`):**
- `useVisitDraft.ts` — draft model, `set`/`setKind`/`applyTheme`, `validate`, `buildPayload`.
- `useCruiseLookup.ts` — CruiseMapper orchestration + the pure `shiftIso`/`closestSailing` helpers.
- `PlaceForm.tsx` — place/food/custom: location (search / pick / EXIF).
- `FlightForm.tsx` — flight lookup → stops.
- `CruiseForm.tsx` — cruise UI driven by `useCruiseLookup`.
- `DriveForm.tsx` — ordered stops via `StopBuilder`.
- `AppearanceTab.tsx` — theme picker + style controls.
- `VisitPhotos.tsx` — existing photos (caption/delete) + adds (`MediaUploader`) + pre-save staging.
- `VisitEditor.tsx` — the shell.

**Modified files:**
- `frontend/src/pages/MapPage.tsx` — render `VisitEditor` instead of `ItemEditor`.

**Deleted files:**
- `frontend/src/components/ItemEditor.tsx`.

---

## Task 1: `useVisitDraft` — draft model, validation, payload

**Files:**
- Create: `frontend/src/components/visit-editor/useVisitDraft.ts`
- Test: `frontend/src/components/visit-editor/useVisitDraft.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/visit-editor/useVisitDraft.test.ts`:
```ts
import { renderHook, act } from "@testing-library/react";
import { expect, test } from "vitest";
import { useVisitDraft } from "./useVisitDraft";

test("buildPayload makes a Point for a place kind", () => {
  const { result } = renderHook(() => useVisitDraft(null));
  act(() => { result.current.setKind("food"); });
  act(() => { result.current.set({ title: "Joe's Pizza", point: [-74, 40.7], occurredOn: "2024-05-01" }); });
  const p = result.current.buildPayload();
  expect(p.kind).toBe("food");
  expect(p.title).toBe("Joe's Pizza");
  expect(p.geometry).toEqual({ type: "Point", coordinates: [-74, 40.7] });
  expect(p.waypoints).toEqual([]);
  expect(p.occurredOn).toBe("2024-05-01");
  expect((p.properties as any).pin).toBeDefined();
  expect((p.properties as any).path).toBeUndefined();
});

test("buildPayload makes a LineString for a drive from stops", () => {
  const { result } = renderHook(() => useVisitDraft(null));
  act(() => { result.current.setKind("drive"); });
  act(() => {
    result.current.set({
      title: "Road trip",
      stops: [
        { label: "A", kind: "origin", lng: 0, lat: 0, seq: 0 },
        { label: "B", kind: "destination", lng: 1, lat: 1, seq: 1 },
      ],
    });
  });
  const p = result.current.buildPayload();
  expect(p.geometry).toEqual({ type: "LineString", coordinates: [[0, 0], [1, 1]] });
  expect(p.waypoints).toHaveLength(2);
  expect((p.properties as any).path).toBeDefined();
});

test("validate flags missing title, then missing location", () => {
  const { result } = renderHook(() => useVisitDraft(null));
  expect(result.current.validate()).toEqual({ field: "title", message: expect.stringMatching(/title/i) });
  act(() => { result.current.set({ title: "X" }); });            // place kind, no point
  expect(result.current.validate()).toEqual({ field: "location", message: expect.stringMatching(/location|place/i) });
  act(() => { result.current.set({ point: [1, 2] }); });
  expect(result.current.validate()).toBeNull();
});

test("setKind refreshes color/icon defaults when no theme is set", () => {
  const { result } = renderHook(() => useVisitDraft(null));
  act(() => { result.current.setKind("food"); });
  expect(result.current.draft.color).toBe("#ea580c"); // KIND_DEFAULTS.food
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/visit-editor/useVisitDraft.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `useVisitDraft`**

Create `frontend/src/components/visit-editor/useVisitDraft.ts`:
```ts
import { useState } from "react";
import type {
  Geometry, Item, ItemKind, PathSettings, PathStyle, PinSettings, PinStyle, Waypoint,
} from "../../api/client";
import { buildRoutePath, type LngLat } from "../../lib/geo";
import { defaultColor, defaultIcon, defaultPinStyle, defaultPathStyle } from "../../lib/style";
import type { PinShapeVals } from "../PinStyleControls";
import type { PathVals } from "../PathStyleControls";

export const POINT_KINDS: ItemKind[] = ["place", "food", "custom"];

export interface VisitDraft {
  kind: ItemKind;
  title: string;
  notes: string;
  occurredOn: string;
  themeId: string | null;
  tripId: string | null;
  color: string;
  icon: string;
  pin: PinShapeVals;
  path: PathVals;
  point: [number, number] | null;
  stops: Waypoint[];
  routePath: number[][] | null;
  cruiseLine: string;
  ship: string;
  baseProperties: Record<string, unknown>;
}

export interface VisitError { field: "title" | "location"; message: string; }

function makeInitial(item: Item | null, kind: ItemKind, pin?: PinSettings, path?: PathSettings): VisitDraft {
  const props = (item?.properties ?? {}) as Record<string, unknown>;
  const initPin = (props.pin ?? {}) as PinStyle;
  const pinBase = defaultPinStyle(kind, pin);
  const initPath = (props.path ?? {}) as PathStyle;
  const pathBase = defaultPathStyle(kind, path);
  const pt = item?.geometry?.type === "Point" ? (item.geometry.coordinates as number[]) : null;
  return {
    kind,
    title: item?.title ?? "",
    notes: item?.notes ?? "",
    occurredOn: item?.occurredOn ?? "",
    themeId: item?.themeId ?? null,
    tripId: item?.tripId ?? null,
    color: item?.color ?? defaultColor(kind, pin),
    icon: item?.icon ?? defaultIcon(kind, pin),
    pin: {
      size: initPin.size ?? pinBase.size,
      shape: initPin.shape ?? pinBase.shape,
      borderWidth: initPin.borderWidth ?? pinBase.borderWidth,
      borderColor: initPin.borderColor ?? pinBase.borderColor,
    },
    path: {
      style: initPath.style ?? pathBase.style,
      color: initPath.color ?? pathBase.color,
      width: initPath.width ?? pathBase.width,
      imageUrl: initPath.imageUrl ?? pathBase.imageUrl,
    },
    point: pt ? [pt[0], pt[1]] : null,
    stops: item?.waypoints ?? [],
    routePath: item?.geometry?.type === "LineString" ? (item.geometry.coordinates as number[][]) : null,
    cruiseLine: (props.cruiseLine as string) ?? "",
    ship: (props.ship as string) ?? "",
    baseProperties: props,
  };
}

export function useVisitDraft(item: Item | null, pin?: PinSettings, path?: PathSettings) {
  const [draft, setDraft] = useState<VisitDraft>(() => makeInitial(item, item?.kind ?? "place", pin, path));

  const set = (patch: Partial<VisitDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function setKind(kind: ItemKind) {
    setDraft((d) => ({
      ...d,
      kind,
      color: d.themeId ? d.color : defaultColor(kind, pin),
      icon: d.themeId ? d.icon : defaultIcon(kind, pin),
      pin: defaultPinStyle(kind, pin),
      path: defaultPathStyle(kind, path),
    }));
  }

  function applyTheme(id: string | null, themes: { id: string; color: string; icon: string }[]) {
    setDraft((d) => {
      const t = themes.find((x) => x.id === id);
      return t ? { ...d, themeId: id, color: t.color, icon: t.icon } : { ...d, themeId: id };
    });
  }

  function validate(): VisitError | null {
    if (!draft.title.trim()) return { field: "title", message: "Please give it a title." };
    const isPoint = POINT_KINDS.includes(draft.kind);
    if (isPoint && !draft.point) {
      return { field: "location", message: "Pick a location on the map or search for a place." };
    }
    if (!isPoint && draft.stops.length < 2 && !(draft.routePath && draft.routePath.length >= 2)) {
      return { field: "location", message: "Add at least two stops to draw the route." };
    }
    return null;
  }

  function buildPayload(): Partial<Item> {
    const isPoint = POINT_KINDS.includes(draft.kind);
    let geometry: Geometry | null = null;
    let waypoints: Waypoint[] = [];
    if (isPoint) {
      geometry = draft.point ? { type: "Point", coordinates: draft.point } : null;
    } else {
      const coords = draft.stops.map((s) => [s.lng, s.lat] as LngLat);
      const line = draft.routePath && draft.routePath.length >= 2 ? draft.routePath : buildRoutePath(draft.kind, coords);
      if (line.length >= 2) geometry = { type: "LineString", coordinates: line };
      waypoints = draft.stops;
    }
    const properties: Record<string, unknown> = { ...draft.baseProperties };
    properties.pin = draft.pin;
    if (isPoint) delete properties.path;
    else properties.path = draft.path;
    if (draft.kind === "cruise") {
      if (draft.cruiseLine) properties.cruiseLine = draft.cruiseLine; else delete properties.cruiseLine;
      if (draft.ship) properties.ship = draft.ship; else delete properties.ship;
    }
    return {
      kind: draft.kind,
      title: draft.title.trim(),
      notes: draft.notes,
      themeId: draft.themeId,
      tripId: draft.tripId,
      color: draft.color,
      icon: draft.icon,
      occurredOn: draft.occurredOn || null,
      geometry,
      waypoints,
      properties,
    };
  }

  return { draft, set, setKind, applyTheme, validate, buildPayload };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/visit-editor/useVisitDraft.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visit-editor/useVisitDraft.ts frontend/src/components/visit-editor/useVisitDraft.test.ts
git commit -m "feat(visit-editor): useVisitDraft (draft model, validation, payload)"
```

---

## Task 2: `useCruiseLookup` — extract CruiseMapper orchestration

**Files:**
- Create: `frontend/src/components/visit-editor/useCruiseLookup.ts`
- Test: `frontend/src/components/visit-editor/useCruiseLookup.test.ts`

The pure helpers (`shiftIso`, `closestSailing`) are unit-tested; the hook wires them to `api` + the draft.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/visit-editor/useCruiseLookup.test.ts`:
```ts
import { expect, test } from "vitest";
import { shiftIso, closestSailing } from "./useCruiseLookup";

test("shiftIso moves a datetime by an offset", () => {
  expect(shiftIso("2024-06-01T00:00:00.000Z", 24 * 3600 * 1000)).toBe("2024-06-02T00:00:00.000Z");
  expect(shiftIso(null, 1000)).toBeNull();
  expect(shiftIso("2024-06-01T00:00:00.000Z", 0)).toBe("2024-06-01T00:00:00.000Z");
});

test("closestSailing picks the dated sailing nearest a target date", () => {
  const sailings = [
    { id: "a", dateISO: "2024-01-01", dateText: "", title: "", departurePort: "", price: "" },
    { id: "b", dateISO: "2024-06-15", dateText: "", title: "", departurePort: "", price: "" },
    { id: "c", dateISO: null, dateText: "", title: "", departurePort: "", price: "" },
  ];
  expect(closestSailing(sailings, "2024-06-10")?.id).toBe("b");
  expect(closestSailing(sailings, "")).toBeNull();
  expect(closestSailing([], "2024-06-10")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/visit-editor/useCruiseLookup.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `useCruiseLookup`**

Create `frontend/src/components/visit-editor/useCruiseLookup.ts`:
```ts
import { useState } from "react";
import { api, type CruiseFindResult, type CruiseSailing } from "../../api/client";
import type { VisitDraft } from "./useVisitDraft";

/** Shift an ISO datetime by a millisecond offset (realigns reused itineraries). */
export function shiftIso(iso: string | null, offsetMs: number): string | null {
  if (!iso || offsetMs === 0) return iso;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + offsetMs).toISOString();
}

/** The dated sailing nearest a target date (YYYY-MM-DD or ISO), or null. */
export function closestSailing(sailings: CruiseSailing[], occurredOn: string): CruiseSailing | null {
  const dated = sailings.filter((s) => s.dateISO);
  const target = occurredOn ? Date.parse(occurredOn) : NaN;
  if (!dated.length || Number.isNaN(target)) return null;
  return dated.reduce((best, s) =>
    Math.abs(Date.parse(s.dateISO!) - target) < Math.abs(Date.parse(best.dateISO!) - target) ? s : best,
  );
}

type Setter = (patch: Partial<VisitDraft>) => void;

export function useCruiseLookup(draft: VisitDraft, set: Setter) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CruiseFindResult | null>(null);
  const [shipUrl, setShipUrl] = useState<string | null>(null);
  const [lineConfirmed, setLineConfirmed] = useState<boolean>(!!draft.cruiseLine);
  const [shipConfirmed, setShipConfirmed] = useState<boolean>(!!draft.ship);
  const [reuse, setReuse] = useState(false);
  const [lookupImage, setLookupImage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pinBusy, setPinBusy] = useState(false);

  const onLineText = (t: string) => { set({ cruiseLine: t }); setLineConfirmed(false); setShipConfirmed(false); setShipUrl(null); };
  const onLinePick = (name: string) => { set({ cruiseLine: name }); setLineConfirmed(true); };
  const onShipText = (t: string) => { set({ ship: t }); setShipUrl(null); setShipConfirmed(false); };
  const onShipPick = (name: string, url: string) => { set({ ship: name }); setShipUrl(url); setShipConfirmed(true); };

  async function addPort(label: string, lng: number | null, lat: number | null) {
    if (lng != null && lat != null) { pushStop(label, lng, lat); return; }
    try {
      const p = await api.resolvePort(label);
      pushStop(p.label, p.lng, p.lat);
    } catch {
      setWarnings([`Couldn't locate "${label}" — try the search box below.`]);
    }
  }

  function pushStop(label: string, lng: number, lat: number) {
    const next = [...draft.stops, { label, kind: "stop" as const, lng, lat, seq: draft.stops.length }];
    set({
      routePath: null,
      stops: next.map((s, i) => ({
        ...s, seq: i, kind: i === 0 ? "origin" : i === next.length - 1 ? "destination" : "stop",
      })),
    });
  }

  async function find() {
    if (!draft.ship.trim()) { setWarnings(["Enter or pick a ship to search CruiseMapper."]); return; }
    setBusy(true);
    try {
      const res = await api.findCruise({
        line: draft.cruiseLine.trim() || undefined,
        ship: draft.ship.trim() || undefined,
        shipUrl: shipUrl || undefined,
      });
      setResult(res);
      setWarnings(res.warnings);
      setLookupImage(res.image ?? null);
      if (!reuse) {
        const closest = closestSailing(res.sailings, draft.occurredOn);
        if (closest) await pickSailing(closest);
      }
    } finally {
      setBusy(false);
    }
  }

  async function pickSailing(s: CruiseSailing) {
    if (!draft.title.trim()) set({ title: `${result?.shipName || draft.ship} — ${s.title}`.trim() });
    if (!reuse && s.dateISO) set({ occurredOn: s.dateISO });
    const offsetMs = reuse && draft.occurredOn && s.dateISO ? Date.parse(draft.occurredOn) - Date.parse(s.dateISO) : 0;
    if (!s.id) { if (s.departurePort) addPort(s.departurePort, null, null); return; }
    setBusy(true);
    try {
      const d = await api.getSailingDetail(s.id);
      if (d.ports.length) {
        set({
          stops: d.ports.map((p, i) => {
            const baseDepart = p.departAt ?? (p.dateISO ? `${p.dateISO}T00:00:00.000Z` : null);
            return {
              label: p.label, kind: p.kind, lng: p.lng, lat: p.lat, seq: i,
              arriveAt: shiftIso(p.arriveAt ?? null, offsetMs),
              departAt: shiftIso(baseDepart, offsetMs),
            };
          }),
          routePath: d.path && d.path.length >= 2 ? d.path : null,
        });
        if (d.warnings.length) setWarnings(d.warnings);
      } else {
        setWarnings(d.warnings.length ? d.warnings : ["Couldn't read that sailing's ports — add them manually below."]);
        if (s.departurePort) addPort(s.departurePort, null, null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function useImageAsPin(url: string) {
    setPinBusy(true);
    try {
      const r = await api.uploadFromUrl(url);
      set({ icon: r.thumbUrl || r.url });
    } catch {
      setWarnings(["Couldn't import that image as a pin."]);
    } finally {
      setPinBusy(false);
    }
  }

  return {
    busy, result, lineConfirmed, shipConfirmed, reuse, lookupImage, warnings, pinBusy,
    setReuse, onLineText, onLinePick, onShipText, onShipPick, find, pickSailing, addPort, useImageAsPin,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/visit-editor/useCruiseLookup.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visit-editor/useCruiseLookup.ts frontend/src/components/visit-editor/useCruiseLookup.test.ts
git commit -m "feat(visit-editor): useCruiseLookup (extracted CruiseMapper orchestration)"
```

---

## Task 3: `PlaceForm`

**Files:**
- Create: `frontend/src/components/visit-editor/PlaceForm.tsx`
- Test: `frontend/src/components/visit-editor/PlaceForm.test.tsx`

Ports `PointFields` from `ItemEditor`: location search, pick-on-map, EXIF-from-photo.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/visit-editor/PlaceForm.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const searchPlaces = vi.fn(async () => []);
vi.mock("../../api/client", () => ({ API_URL: "", api: { searchPlaces, readExif: vi.fn() } }));
import { PlaceForm } from "./PlaceForm";

test("shows the current coordinates and a pick button", () => {
  const onPick = vi.fn();
  render(
    <PlaceForm
      point={[-74, 40.7]}
      onSelect={() => {}}
      onPick={onPick}
      onPhotoLocation={() => {}}
    />,
  );
  expect(screen.getByText(/40\.7000, -74\.0000/)).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Pick on map/));
  expect(onPick).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/visit-editor/PlaceForm.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `PlaceForm`**

Create `frontend/src/components/visit-editor/PlaceForm.tsx`:
```tsx
import { useState } from "react";
import { api } from "../../api/client";
import { PlaceSearch } from "../PlaceSearch";

interface Props {
  point: [number, number] | null;
  onSelect: (lng: number, lat: number, label: string) => void;
  onPick: () => void;
  onPhotoLocation: (lat: number, lng: number, date: string | null) => void;
}

export function PlaceForm({ point, onSelect, onPick, onPhotoLocation }: Props) {
  const [exifMsg, setExifMsg] = useState<string | null>(null);

  async function fromPhoto(file: File) {
    setExifMsg("Reading photo…");
    try {
      const { lat, lng, date } = await api.readExif(file);
      if (lat != null && lng != null) { onPhotoLocation(lat, lng, date); setExifMsg("Placed from photo GPS ✓"); }
      else setExifMsg("No GPS found in that photo.");
    } catch {
      setExifMsg("Could not read that photo.");
    }
  }

  return (
    <div className="field">
      <label>Location</label>
      <PlaceSearch placeholder="Search a place or address…" search={api.searchPlaces} onSelect={(s) => onSelect(s.lng, s.lat, s.label)} />
      <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
        <button type="button" onClick={onPick}>📍 Pick on map</button>
        <label className="filebtn" style={{ margin: 0 }}>
          📷 From photo
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && fromPhoto(e.target.files[0])} />
        </label>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
        {exifMsg ?? (point ? `${point[1].toFixed(4)}, ${point[0].toFixed(4)}` : "No location set")}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/visit-editor/PlaceForm.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visit-editor/PlaceForm.tsx frontend/src/components/visit-editor/PlaceForm.test.tsx
git commit -m "feat(visit-editor): PlaceForm (location search/pick/EXIF)"
```

---

## Task 4: `FlightForm`

**Files:**
- Create: `frontend/src/components/visit-editor/FlightForm.tsx`
- Test: `frontend/src/components/visit-editor/FlightForm.test.tsx`

Ports `FlightFields`; reports a `LookupResult` to the shell.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/visit-editor/FlightForm.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { lookupFlight } = vi.hoisted(() => ({ lookupFlight: vi.fn(async () => ({ title: "JFK → CDG", waypoints: [], path: [], warnings: [] })) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { lookupFlight } }));
import { FlightForm } from "./FlightForm";

test("looks up airport codes and reports the result", async () => {
  const onResult = vi.fn();
  render(<FlightForm onResult={onResult} />);
  fireEvent.change(screen.getByPlaceholderText(/JFK, CDG/), { target: { value: "JFK, CDG" } });
  fireEvent.click(screen.getByText("Plot route"));
  await waitFor(() => expect(lookupFlight).toHaveBeenCalledWith({ codes: ["JFK", "CDG"] }));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ title: "JFK → CDG" })));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/visit-editor/FlightForm.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `FlightForm`**

Create `frontend/src/components/visit-editor/FlightForm.tsx`:
```tsx
import { useState } from "react";
import { api, type LookupResult } from "../../api/client";

export function FlightForm({ onResult }: { onResult: (r: LookupResult) => void }) {
  const [mode, setMode] = useState<"codes" | "number">("codes");
  const [codes, setCodes] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      if (mode === "codes") {
        const list = codes.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean);
        onResult(await api.lookupFlight({ codes: list }));
      } else {
        onResult(await api.lookupFlight({ flightNumber, date }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label>Flight route</label>
      <div className="tabs">
        <button type="button" className={mode === "codes" ? "active" : ""} onClick={() => setMode("codes")}>Airports</button>
        <button type="button" className={mode === "number" ? "active" : ""} onClick={() => setMode("number")}>Flight #</button>
      </div>
      {mode === "codes" ? (
        <input value={codes} onChange={(e) => setCodes(e.target.value.toUpperCase())} placeholder="JFK, CDG, FCO  (in order)" />
      ) : (
        <div className="row">
          <input value={flightNumber} onChange={(e) => setFlightNumber(e.target.value.toUpperCase())} placeholder="BA178" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}
      <button type="button" style={{ marginTop: 8 }} onClick={run} disabled={busy}>
        {busy ? "Looking up…" : "Plot route"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/visit-editor/FlightForm.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visit-editor/FlightForm.tsx frontend/src/components/visit-editor/FlightForm.test.tsx
git commit -m "feat(visit-editor): FlightForm (airport/flight-number lookup)"
```

---

## Task 5: `CruiseForm`

**Files:**
- Create: `frontend/src/components/visit-editor/CruiseForm.tsx`
- Test: `frontend/src/components/visit-editor/CruiseForm.test.tsx`

Presentational cruise UI driven by `useCruiseLookup` (ported from `CruiseFields`), plus its own warnings/lookup-image + image-as-pin, and the ports `StopBuilder`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/visit-editor/CruiseForm.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({
  API_URL: "",
  api: { searchCruiseLines: vi.fn(async () => []), searchCruiseShips: vi.fn(async () => []), searchPorts: vi.fn(async () => []) },
}));
import { CruiseForm } from "./CruiseForm";
import type { VisitDraft } from "./useVisitDraft";

const draft = { kind: "cruise", cruiseLine: "", ship: "", stops: [], occurredOn: "", title: "" } as unknown as VisitDraft;

test("renders the CruiseMapper finder and a stops builder", () => {
  render(<CruiseForm draft={draft} set={() => {}} />);
  expect(screen.getByText(/Find on CruiseMapper/)).toBeInTheDocument();
  expect(screen.getByText(/Ports of call/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/visit-editor/CruiseForm.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `CruiseForm`**

Create `frontend/src/components/visit-editor/CruiseForm.tsx`:
```tsx
import { api, type CruiseSailing } from "../../api/client";
import { Autocomplete } from "../Autocomplete";
import { StopBuilder } from "../StopBuilder";
import { useCruiseLookup } from "./useCruiseLookup";
import type { VisitDraft } from "./useVisitDraft";

interface Props {
  draft: VisitDraft;
  set: (patch: Partial<VisitDraft>) => void;
}

export function CruiseForm({ draft, set }: Props) {
  const c = useCruiseLookup(draft, set);

  return (
    <>
      <div className="field">
        <label>Find an itinerary (CruiseMapper)</label>
        <div className="row">
          <Autocomplete
            value={draft.cruiseLine}
            placeholder="Cruise line — start typing (e.g. Royal)"
            confirmed={c.lineConfirmed}
            search={api.searchCruiseLines}
            onText={c.onLineText}
            onPick={(item) => c.onLinePick(item.name)}
          />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <Autocomplete
            value={draft.ship}
            placeholder={draft.cruiseLine ? "Ship — start typing (e.g. Symphony)" : "Cruise line first, then ship"}
            confirmed={c.shipConfirmed}
            search={(q) => (draft.cruiseLine.trim() ? api.searchCruiseShips(q, draft.cruiseLine) : Promise.resolve([]))}
            onText={c.onShipText}
            onPick={(item) => c.onShipPick(item.name, item.url)}
          />
          <input type="date" value={draft.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} title="Sail date" style={{ maxWidth: 150 }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13, color: "var(--text)" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={c.reuse} onChange={(e) => c.setReuse(e.target.checked)} />
          Reuse this itinerary for my dates (keep my start date; shift port days to match)
        </label>
        <button type="button" style={{ marginTop: 8 }} onClick={c.find} disabled={c.busy || !draft.ship.trim()}>
          {c.busy ? "Searching CruiseMapper…" : "🔎 Find on CruiseMapper"}
        </button>

        {c.result?.shipName && <div style={{ marginTop: 6, fontSize: 13 }}>Found: <strong>{c.result.shipName}</strong></div>}

        {c.result && c.result.sailings.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="sub" style={{ marginBottom: 4 }}>Sailings — pick the one matching your date:</div>
            <div className="sailing-list">
              {c.result.sailings.map((s: CruiseSailing, i: number) => (
                <div key={i} className={`sailing-row ${draft.occurredOn && s.dateISO === draft.occurredOn ? "match" : ""}`} onClick={() => c.pickSailing(s)}>
                  <span className="sailing-date">{s.dateText}</span>
                  <span className="sailing-title">{s.title}</span>
                  <span className="sailing-dep">{s.departurePort}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {c.result && c.result.ports.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="sub" style={{ marginBottom: 4 }}>Ports this ship visits — tap to add in order:</div>
            <div className="chips">
              {c.result.ports.map((p, i) => (
                <button key={i} type="button" className="chip" onClick={() => c.addPort(p.label, p.lng, p.lat)}>+ {p.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {c.warnings.length > 0 && (
        <div className="warnings">{c.warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>
      )}

      {c.lookupImage && (
        <div className="field">
          <img src={c.lookupImage} alt="" style={{ width: "100%", borderRadius: "var(--radius)", maxHeight: 160, objectFit: "cover" }} />
          <div className="row" style={{ marginTop: 6, alignItems: "center", gap: 8 }}>
            {c.result?.lineLogo && (
              <button type="button" onClick={() => c.useImageAsPin(c.result!.lineLogo!)} disabled={c.pinBusy}>
                {c.pinBusy ? "Importing…" : "🏷 Use line logo as pin"}
              </button>
            )}
            <button type="button" onClick={() => c.useImageAsPin(c.lookupImage!)} disabled={c.pinBusy}>📌 Use ship photo as pin</button>
          </div>
        </div>
      )}

      <StopBuilder stops={draft.stops} onChange={(stops) => set({ stops, routePath: null })} source="ports" label="Ports of call (in order)" />
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/visit-editor/CruiseForm.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visit-editor/CruiseForm.tsx frontend/src/components/visit-editor/CruiseForm.test.tsx
git commit -m "feat(visit-editor): CruiseForm (presentational, driven by useCruiseLookup)"
```

---

## Task 6: `DriveForm`

**Files:**
- Create: `frontend/src/components/visit-editor/DriveForm.tsx`
- Test: `frontend/src/components/visit-editor/DriveForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/visit-editor/DriveForm.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "", api: { searchPlaces: vi.fn(async () => []) } }));
import { DriveForm } from "./DriveForm";

test("renders the drive stop builder", () => {
  render(<DriveForm stops={[]} onChange={() => {}} />);
  expect(screen.getByText(/Stops along the drive/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/visit-editor/DriveForm.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `DriveForm`**

Create `frontend/src/components/visit-editor/DriveForm.tsx`:
```tsx
import type { Waypoint } from "../../api/client";
import { StopBuilder } from "../StopBuilder";

export function DriveForm({ stops, onChange }: { stops: Waypoint[]; onChange: (stops: Waypoint[]) => void }) {
  return <StopBuilder stops={stops} onChange={onChange} source="places" label="Stops along the drive (in order)" />;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/visit-editor/DriveForm.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visit-editor/DriveForm.tsx frontend/src/components/visit-editor/DriveForm.test.tsx
git commit -m "feat(visit-editor): DriveForm (ordered stops)"
```

---

## Task 7: `AppearanceTab`

**Files:**
- Create: `frontend/src/components/visit-editor/AppearanceTab.tsx`
- Test: `frontend/src/components/visit-editor/AppearanceTab.test.tsx`

Reuses `StylePicker`/`PinStyleControls`/`PathStyleControls` + a theme `<select>`. Trail controls only for route kinds.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/visit-editor/AppearanceTab.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "", api: { listIcons: vi.fn(async () => ({ builtin: [], custom: [] })) } }));
import { AppearanceTab } from "./AppearanceTab";
import type { VisitDraft } from "./useVisitDraft";

const baseDraft = {
  kind: "place", themeId: null, color: "#2563eb", icon: "pin",
  pin: { size: 28, shape: "circle", borderWidth: 2, borderColor: "#fff" },
  path: { style: "solid", color: "#2563eb", width: 3 },
} as unknown as VisitDraft;

test("shows the theme select; hides the trail controls for point kinds", () => {
  render(<AppearanceTab draft={baseDraft} set={() => {}} applyTheme={() => {}} themes={[]} customIcons={[]} />);
  expect(screen.getByText(/Theme/)).toBeInTheDocument();
  expect(screen.queryByText(/Trail \(path line\)/)).not.toBeInTheDocument();
});

test("shows the trail controls for route kinds", () => {
  render(<AppearanceTab draft={{ ...baseDraft, kind: "drive" } as VisitDraft} set={() => {}} applyTheme={() => {}} themes={[]} customIcons={[]} />);
  expect(screen.getByText(/Trail \(path line\)/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/visit-editor/AppearanceTab.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `AppearanceTab`**

Create `frontend/src/components/visit-editor/AppearanceTab.tsx`:
```tsx
import type { CustomIcon, Theme } from "../../api/client";
import { StylePicker } from "../StylePicker";
import { PinStyleControls } from "../PinStyleControls";
import { PathStyleControls } from "../PathStyleControls";
import { POINT_KINDS, type VisitDraft } from "./useVisitDraft";

interface Props {
  draft: VisitDraft;
  set: (patch: Partial<VisitDraft>) => void;
  applyTheme: (id: string | null, themes: { id: string; color: string; icon: string }[]) => void;
  themes: Theme[];
  customIcons: CustomIcon[];
  onIconsChanged?: () => void;
}

export function AppearanceTab({ draft, set, applyTheme, themes, customIcons, onIconsChanged }: Props) {
  const isPoint = POINT_KINDS.includes(draft.kind);
  return (
    <>
      <div className="field">
        <label>Theme</label>
        <select value={draft.themeId ?? ""} onChange={(e) => applyTheme(e.target.value || null, themes)}>
          <option value="">— None (custom style) —</option>
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name} {t.isBuiltin ? "" : "(yours)"}</option>)}
        </select>
      </div>

      <StylePicker color={draft.color} icon={draft.icon} customIcons={customIcons} onColor={(color) => set({ color })} onIcon={(icon) => set({ icon })} onUploaded={onIconsChanged} />
      <PinStyleControls value={draft.pin} color={draft.color} icon={draft.icon} onChange={(pin) => set({ pin })} />
      {!isPoint && (
        <>
          <div className="section-title"><span>Trail (path line)</span></div>
          <PathStyleControls value={draft.path} customIcons={customIcons} onChange={(path) => set({ path })} />
        </>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/visit-editor/AppearanceTab.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visit-editor/AppearanceTab.tsx frontend/src/components/visit-editor/AppearanceTab.test.tsx
git commit -m "feat(visit-editor): AppearanceTab (theme + style controls)"
```

---

## Task 8: `VisitPhotos`

**Files:**
- Create: `frontend/src/components/visit-editor/VisitPhotos.tsx`
- Test: `frontend/src/components/visit-editor/VisitPhotos.test.tsx`

Existing photos (caption/delete via `api`) + new files staged with previews; the shell uploads staged on save. Adding to an *already-saved* visit uses `MediaUploader` (immediate upload+link). The shell owns the `staged` array (needed at save time).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/visit-editor/VisitPhotos.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { deletePhoto } = vi.hoisted(() => ({ deletePhoto: vi.fn(async () => {}) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { deletePhoto, updatePhoto: vi.fn(), uploadMedia: vi.fn(), createLink: vi.fn() } }));
import { VisitPhotos } from "./VisitPhotos";

test("stages selected files and reports them", () => {
  const onStaged = vi.fn();
  render(<VisitPhotos visitId={null} existing={[]} staged={[]} onStaged={onStaged} onExistingChanged={() => {}} />);
  const input = screen.getByTestId("visit-photo-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  expect(onStaged).toHaveBeenCalled();
  expect(onStaged.mock.calls[0][0]).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/visit-editor/VisitPhotos.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `VisitPhotos`**

Create `frontend/src/components/visit-editor/VisitPhotos.tsx`:
```tsx
import { useState } from "react";
import { api, type Photo } from "../../api/client";
import { MediaThumb } from "../MediaThumb";
import { MediaUploader } from "../shared/MediaUploader";

export interface StagedPhoto { file: File; caption: string; preview: string }

interface Props {
  visitId: string | null;                 // null while the visit is unsaved
  existing: Photo[];
  staged: StagedPhoto[];
  onStaged: (staged: StagedPhoto[]) => void;
  onExistingChanged: () => void;           // refresh after add/delete on a saved visit
}

export function VisitPhotos({ visitId, existing, staged, onStaged, onExistingChanged }: Props) {
  const [local, setLocal] = useState<Photo[]>(existing);

  function addFiles(files: FileList) {
    const next = Array.from(files).map((file) => ({ file, caption: "", preview: URL.createObjectURL(file) }));
    onStaged([...staged, ...next]);
  }
  function removeStaged(i: number) {
    URL.revokeObjectURL(staged[i].preview);
    onStaged(staged.filter((_, j) => j !== i));
  }
  async function deleteExisting(id: string) {
    await api.deletePhoto(id);
    setLocal((prev) => prev.filter((p) => p.id !== id));
  }
  async function saveCaption(id: string, caption: string) {
    setLocal((prev) => prev.map((p) => (p.id === id ? { ...p, caption } : p)));
    await api.updatePhoto(id, caption);
  }

  return (
    <div className="field">
      <label>Photos</label>
      <div className="photo-grid">
        {local.map((p) => (
          <div key={p.id} className="photo-tile">
            <MediaThumb photo={p} />
            <button type="button" className="photo-remove" onClick={() => deleteExisting(p.id)}>✕</button>
            <input className="photo-caption" defaultValue={p.caption} placeholder="Caption…"
              onBlur={(e) => e.target.value !== p.caption && saveCaption(p.id, e.target.value)} />
          </div>
        ))}
        {staged.map((p, i) => (
          <div key={i} className="photo-tile">
            {p.file.type.startsWith("image") ? <img src={p.preview} alt="" />
              : <div className="media-placeholder">{p.file.type.startsWith("video") ? "▶" : "🎵"}</div>}
            <button type="button" className="photo-remove" onClick={() => removeStaged(i)}>✕</button>
            <input className="photo-caption" value={p.caption} placeholder="Caption…"
              onChange={(e) => onStaged(staged.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
          </div>
        ))}
      </div>

      {visitId ? (
        // Saved visit: upload + link immediately via the shared component.
        <MediaUploader multiple linkTo={`visit:${visitId}`} label="+ Add photos" onUploaded={onExistingChanged} />
      ) : (
        <>
          <input data-testid="visit-photo-input" type="file" accept="image/*,video/*,audio/*" multiple style={{ marginTop: 8 }}
            onChange={(e) => e.target.files && addFiles(e.target.files)} />
          {staged.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{staged.length} photo(s) will upload when you save.</div>
          )}
        </>
      )}
    </div>
  );
}
```

> Note: `onExistingChanged` lets the shell re-fetch the visit (and thus its photos) after an immediate add on a saved visit. The shell wires it to a query invalidation.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/visit-editor/VisitPhotos.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visit-editor/VisitPhotos.tsx frontend/src/components/visit-editor/VisitPhotos.test.tsx
git commit -m "feat(visit-editor): VisitPhotos (existing caption/delete + staged adds)"
```

---

## Task 9: `VisitEditor` shell

**Files:**
- Create: `frontend/src/components/visit-editor/VisitEditor.tsx`
- Test: `frontend/src/components/visit-editor/VisitEditor.test.tsx`

Composes everything: type selector, Details/Appearance tabs, common fields, photos, and Save.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/visit-editor/VisitEditor.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { createItem, uploadMedia, createLink } = vi.hoisted(() => ({
  createItem: vi.fn(async (_ms: string, data: any) => ({ id: "v9", ...data })),
  uploadMedia: vi.fn(), createLink: vi.fn(),
}));
vi.mock("../../api/client", () => ({
  API_URL: "",
  api: { createItem, updateItem: vi.fn(), uploadMedia, createLink, searchPlaces: vi.fn(async () => []), readExif: vi.fn(), listIcons: vi.fn(async () => ({ builtin: [], custom: [] })) },
}));
import { VisitEditor } from "./VisitEditor";

const mapSet = { id: "ms1" } as any;

test("validates title, then saves a place visit", async () => {
  const onSaved = vi.fn();
  render(
    <VisitEditor mapSet={mapSet} item={null} themes={[]} trips={[]} customIcons={[]}
      onRequestPick={async () => [0, 0]} onClose={() => {}} onSaved={onSaved} />,
  );
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText(/give it a title/i)).toBeInTheDocument();
  expect(createItem).not.toHaveBeenCalled();

  fireEvent.change(screen.getByPlaceholderText(/Anniversary dinner/), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByText("Save"));
  // place kind needs a location:
  expect(await screen.findByText(/Pick a location/i)).toBeInTheDocument();
});

test("switches tabs between Details and Appearance", () => {
  render(
    <VisitEditor mapSet={mapSet} item={null} themes={[]} trips={[]} customIcons={[]}
      onRequestPick={async () => [0, 0]} onClose={() => {}} onSaved={() => {}} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
  expect(screen.getByText(/Theme/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/visit-editor/VisitEditor.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `VisitEditor`**

Create `frontend/src/components/visit-editor/VisitEditor.tsx`:
```tsx
import { useState } from "react";
import {
  api, type CustomIcon, type Item, type ItemKind, type LookupResult, type MapSet, type Photo,
  type PathSettings, type PinSettings, type Theme,
} from "../../api/client";
import { KIND_LABELS } from "../../lib/style";
import { useVisitDraft, POINT_KINDS } from "./useVisitDraft";
import { PlaceForm } from "./PlaceForm";
import { FlightForm } from "./FlightForm";
import { CruiseForm } from "./CruiseForm";
import { DriveForm } from "./DriveForm";
import { AppearanceTab } from "./AppearanceTab";
import { VisitPhotos, type StagedPhoto } from "./VisitPhotos";

interface Props {
  mapSet: MapSet;
  item: Item | null;
  themes: Theme[];
  trips: { id: string; name: string }[];
  customIcons: CustomIcon[];
  onRequestPick: () => Promise<[number, number]>;
  onClose: () => void;
  onSaved: () => void;
  onIconsChanged?: () => void;
  pinSettings?: PinSettings;
  pathSettings?: PathSettings;
}

const KINDS: ItemKind[] = ["place", "food", "flight", "cruise", "drive", "custom"];

export function VisitEditor(props: Props) {
  const { mapSet, item, themes, trips, customIcons, onRequestPick, onClose, onSaved } = props;
  const editing = Boolean(item);
  const { draft, set, setKind, applyTheme, validate, buildPayload } = useVisitDraft(item, props.pinSettings, props.pathSettings);
  const [tab, setTab] = useState<"details" | "appearance">("details");
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const savedId = item?.id ?? null; // non-null only when editing an existing visit
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"title" | "location" | null>(null);
  const [flightResult, setFlightResult] = useState<LookupResult | null>(null);

  const isPoint = POINT_KINDS.includes(draft.kind);

  async function pickOnMap() {
    setPicking(true);
    try { const [lng, lat] = await onRequestPick(); set({ point: [lng, lat] }); }
    finally { setPicking(false); }
  }

  function applyFlight(r: LookupResult) {
    setFlightResult(r);
    if (r.title && !draft.title) set({ title: r.title });
    set({ stops: r.waypoints.map((w, i) => ({ label: w.label, kind: (w.kind as any) ?? "stop", lng: w.lng, lat: w.lat, seq: i })) });
  }

  async function save() {
    const err = validate();
    if (err) { setError(err.message); setErrorField(err.field); if (err.field === "title") setTab("details"); return; }
    setError(null); setErrorField(null);
    setBusy(true);
    try {
      const payload = buildPayload();
      const saved = editing && item ? await api.updateItem(item.id, payload) : await api.createItem(mapSet.id, payload);
      // Upload any staged photos in parallel, then link each to the saved visit.
      await Promise.all(staged.map(async (p) => {
        const m = await api.uploadMedia(p.file, p.caption);
        await api.createLink(`media:${m.id}`, `visit:${saved.id}`, "appears_in");
      }));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1100 }}>
        <div className="warnings">Click on the map to set the location…</div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? "Edit item" : "Add to map"}</h2>

        <div className="field">
          <label>Type</label>
          <div className="add-buttons">
            {KINDS.map((k) => (
              <button key={k} className={k === draft.kind ? "primary" : ""} onClick={() => setKind(k)}>{KIND_LABELS[k]}</button>
            ))}
          </div>
        </div>

        <div className="tabs">
          <button type="button" className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}>Details</button>
          <button type="button" className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}>Appearance</button>
        </div>

        {tab === "details" ? (
          <>
            <div className="field">
              <label>Title</label>
              <input value={draft.title} placeholder="e.g. Anniversary dinner" onChange={(e) => set({ title: e.target.value })} />
              {errorField === "title" && error && <div className="error-text">{error}</div>}
            </div>

            {errorField === "location" && error && <div className="error-text">{error}</div>}

            {isPoint ? (
              <PlaceForm
                point={draft.point}
                onPick={pickOnMap}
                onSelect={(lng, lat, label) => { set({ point: [lng, lat] }); if (!draft.title) set({ title: label }); }}
                onPhotoLocation={(lat, lng, date) => { set({ point: [lng, lat] }); if (date && !draft.occurredOn) set({ occurredOn: date }); }}
              />
            ) : draft.kind === "flight" ? (
              <FlightForm onResult={applyFlight} />
            ) : draft.kind === "cruise" ? (
              <CruiseForm draft={draft} set={set} />
            ) : (
              <DriveForm stops={draft.stops} onChange={(stops) => set({ stops, routePath: null })} />
            )}

            {draft.kind === "flight" && flightResult && flightResult.warnings.length > 0 && (
              <div className="warnings">{flightResult.warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>
            )}

            {draft.kind !== "cruise" && (
              <div className="field">
                <label>Date (optional)</label>
                <input type="date" value={draft.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} />
              </div>
            )}

            <div className="field">
              <label>Trip</label>
              <select value={draft.tripId ?? ""} onChange={(e) => set({ tripId: e.target.value || null })}>
                <option value="">— No trip —</option>
                {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div className="field">
              <label>Notes</label>
              <textarea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
            </div>

            <VisitPhotos
              visitId={savedId}
              existing={item?.photos ?? []}
              staged={staged}
              onStaged={setStaged}
              onExistingChanged={onSaved}
            />
          </>
        ) : (
          <AppearanceTab draft={draft} set={set} applyTheme={applyTheme} themes={themes} customIcons={customIcons} onIconsChanged={props.onIconsChanged} />
        )}

        {error && !errorField && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
```

> Note on `savedId`: it's non-null only when editing an existing visit, so `VisitPhotos` uses the immediate `MediaUploader` path there; for a brand-new visit (`savedId === null`) photos are staged and uploaded on first save (parity with today, where the editor closes after the first save).

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/visit-editor/VisitEditor.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visit-editor/VisitEditor.tsx frontend/src/components/visit-editor/VisitEditor.test.tsx
git commit -m "feat(visit-editor): VisitEditor shell (type selector, tabs, save)"
```

---

## Task 10: Wire `MapPage` to `VisitEditor`; delete `ItemEditor`

**Files:**
- Modify: `frontend/src/pages/MapPage.tsx`
- Delete: `frontend/src/components/ItemEditor.tsx`

- [ ] **Step 1: Swap the import and usage in `MapPage.tsx`**

In `frontend/src/pages/MapPage.tsx`:
- Change the import `import { ItemEditor } from "../components/ItemEditor";` to `import { VisitEditor } from "../components/visit-editor/VisitEditor";`.
- In the JSX, replace the `<ItemEditor ... />` block with `<VisitEditor ... />` (identical props — the prop interface matches):
```tsx
        <VisitEditor
          mapSet={currentMapSet}
          item={editorItem}
          themes={themes}
          trips={trips}
          customIcons={customIcons}
          onRequestPick={requestPick}
          onClose={() => setEditorOpen(false)}
          onSaved={handleItemSaved}
          onIconsChanged={() => qc.invalidateQueries({ queryKey: ["icons"] })}
          pinSettings={pinSettings}
          pathSettings={pathSettings}
        />
```

- [ ] **Step 2: Delete the old editor**

Run:
```bash
git rm frontend/src/components/ItemEditor.tsx
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors. *(If `trips` prop type complains, `VisitEditor`'s `trips` is typed `{ id: string; name: string }[]`, which `Trip[]` satisfies structurally.)*

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/MapPage.tsx
git commit -m "refactor(map): use VisitEditor; remove the 790-line ItemEditor"
```

---

## Task 11: Full verification & parity check

**Files:** none (verification only)

- [ ] **Step 1: Full frontend suite + typecheck + build**

Run:
```bash
cd frontend && npm test && npm run typecheck && npm run build
```
Expected: all tests PASS; typecheck clean; build succeeds.

- [ ] **Step 2: Manual parity smoke (with backend running + seeded)**

Start the frontend (`npm run dev`) and confirm each, against today's behavior:
- **Place/Food/Custom:** add with search / pick-on-map / from-photo EXIF; saves a point pin.
- **Flight:** airport codes and flight-number both plot a route.
- **Cruise:** CruiseMapper find → pick a sailing → ports + real route; "reuse itinerary" keeps your start date and shifts port days; "use ship photo / line logo as pin" works.
- **Drive:** add/reorder/remove stops; saves a line.
- **Appearance tab:** theme select; color/icon; pin shape/size/border; trail style for route kinds only.
- **Photos:** add (staged on a new pin; immediate on an existing one), caption, delete.
- **Trip** assignment and **Date** persist; **Edit** an existing pin round-trips all of the above.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A frontend
git commit -m "chore: phase 3 map editor overhaul verified" || echo "nothing to commit"
```

---

## Done — Phase 3 complete

`ItemEditor.tsx` is gone; the editor is now `VisitEditor` + four per-kind forms + `AppearanceTab` + `VisitPhotos`, with the draft and cruise logic in tested hooks (~9 focused files, each well under 150 lines). The Details/Appearance tabbed, kind-tailored UX is in place, photos flow through the shared `MediaUploader`, and all six kinds keep behavior parity. Foundation for later modules to reuse these patterns.
