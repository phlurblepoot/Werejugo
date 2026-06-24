# Phase 6B — Trip Planning Module (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Planning rail module — a Board (kanban by status) and a Timeline (trip bars + blackout bands), a trip detail with itinerary/wishlist + convert-to-visit, bookings, and travelers — on top of Plan 6A's endpoints.

**Architecture:** A `PlanningPage` toggles a `TripBoard` and a `TripTimeline`, and opens a `TripDetail`. Itinerary and blackouts use new client methods; bookings reuse the Phase-5 `DocumentList`; travelers reuse the Phase-2 `RelatedPanel`. Data via `@tanstack/react-query`.

**Tech Stack:** React 18 + Vite, `@tanstack/react-query` v5, `react-router-dom` v6. Tests: Vitest + @testing-library/react with `api` mocked.

**Depends on:** Plan 6A (endpoints) + Phase-2 `RelatedPanel`/`EntityPicker` + Phase-5 `DocumentList`.

---

## Conventions (apply to every task)

- All commands run from `frontend/`.
- New files in `frontend/src/components/planning/` (and `pages/PlanningPage.tsx`).
- Tests mock `api`; **wrap factory-referenced `vi.fn()`s in `vi.hoisted`**. react-query components use `withQC` (from `frontend/src/test/qc.tsx`).
- Commit after each task with the message in its final step.

---

## File Structure

**New files:**
- `frontend/src/components/planning/TripForm.tsx`
- `frontend/src/components/planning/TripBoard.tsx`
- `frontend/src/components/planning/timeline.ts` — pure `placeOnAxis` helper.
- `frontend/src/components/planning/TripTimeline.tsx`
- `frontend/src/components/planning/TripDetail.tsx`
- `frontend/src/components/planning/BlackoutManager.tsx`
- `frontend/src/pages/PlanningPage.tsx`

**Modified files:**
- `frontend/src/api/client.ts` — `Trip.status` + itinerary/blackout types & methods.
- `frontend/src/shell/modules.ts` — enable Planning.
- `frontend/src/shell/AppShell.tsx` — `/planning` route.
- `frontend/src/styles/global.css` — board/timeline styles.

---

## Task 1: API client — planning types & methods

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/planning.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/planning.test.ts`:
```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (opts.method === "GET") return jsonRes([]);
    return jsonRes({ id: "x" });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function jsonRes(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("listItinerary + create target the trip", async () => {
  await api.listItinerary("t1");
  expect(calls[0].url).toContain("/api/trips/t1/itinerary");
  await api.createItineraryItem("t1", { title: "Colosseum" });
  expect(calls[1].url).toContain("/api/trips/t1/itinerary");
  expect(calls[1].method).toBe("POST");
});

test("convertItineraryItem posts to the convert endpoint", async () => {
  await api.convertItineraryItem("i1");
  expect(calls[0].url).toContain("/api/itinerary/i1/convert");
});

test("blackout methods hit /api/blackouts", async () => {
  await api.listBlackouts();
  expect(calls[0].url).toContain("/api/blackouts");
  await api.createBlackout({ label: "School", startDate: "2025-09-01", endDate: "2026-06-15" });
  expect(JSON.parse(calls[1].body)).toMatchObject({ label: "School" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/api/planning.test.ts`
Expected: FAIL (methods undefined).

- [ ] **Step 3: Add types and methods to `client.ts`**

(a) Add `status` to the existing `Trip` interface (find `export interface Trip {` and add the field):
```ts
  status: "idea" | "planning" | "booked" | "done";
```

(b) Add new types near the trip types:
```ts
export interface ItineraryItem {
  id: string; tripId: string; title: string; notes: string;
  scheduledOn: string | null; seq: number;
  lat: number | null; lng: number | null; placeLabel: string;
  convertedVisitId: string | null; createdAt: string;
}
export interface ItineraryInput {
  title?: string; notes?: string; scheduledOn?: string | null; seq?: number;
  lat?: number | null; lng?: number | null; placeLabel?: string;
}
export interface Blackout { id: string; label: string; startDate: string; endDate: string; color: string; createdAt: string; }
export interface BlackoutInput { label?: string; startDate?: string; endDate?: string; color?: string; }
```

(c) Add methods to the `api` object (after the trip methods):
```ts
  // itinerary
  listItinerary: (tripId: string) => request<ItineraryItem[]>(`/api/trips/${tripId}/itinerary`),
  createItineraryItem: (tripId: string, data: ItineraryInput) =>
    request<ItineraryItem>(`/api/trips/${tripId}/itinerary`, { method: "POST", body: body(data) }),
  updateItineraryItem: (id: string, data: ItineraryInput) =>
    request<ItineraryItem>(`/api/itinerary/${id}`, { method: "PATCH", body: body(data) }),
  deleteItineraryItem: (id: string) => request<void>(`/api/itinerary/${id}`, { method: "DELETE" }),
  convertItineraryItem: (id: string) =>
    request<{ visitId: string; item: ItineraryItem }>(`/api/itinerary/${id}/convert`, { method: "POST", body: body({}) }),

  // blackouts
  listBlackouts: () => request<Blackout[]>("/api/blackouts"),
  createBlackout: (data: BlackoutInput) => request<Blackout>("/api/blackouts", { method: "POST", body: body(data) }),
  updateBlackout: (id: string, data: BlackoutInput) => request<Blackout>(`/api/blackouts/${id}`, { method: "PATCH", body: body(data) }),
  deleteBlackout: (id: string) => request<void>(`/api/blackouts/${id}`, { method: "DELETE" }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/api/planning.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/planning.test.ts
git commit -m "feat(api): trip status + itinerary + blackout client methods"
```

---

## Task 2: `TripForm`

**Files:**
- Create: `frontend/src/components/planning/TripForm.tsx`
- Test: `frontend/src/components/planning/TripForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/planning/TripForm.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { createTrip } = vi.hoisted(() => ({ createTrip: vi.fn(async () => ({ id: "t9" })) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { createTrip, updateTrip: vi.fn(), deleteTrip: vi.fn() } }));
import { TripForm } from "./TripForm";

test("requires a name then creates a trip", async () => {
  const onSaved = vi.fn();
  render(<TripForm trip={null} onClose={() => {}} onSaved={onSaved} />);
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText(/please enter a name/i)).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/e.g. Italy/), { target: { value: "Italy 2025" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(createTrip).toHaveBeenCalledWith("", expect.objectContaining({ name: "Italy 2025" })));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/planning/TripForm.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `TripForm`**

Create `frontend/src/components/planning/TripForm.tsx`:
```tsx
import { useState } from "react";
import { api, type Trip } from "../../api/client";

type Status = "idea" | "planning" | "booked" | "done";
const STATUSES: Status[] = ["idea", "planning", "booked", "done"];

export function TripForm({ trip, onClose, onSaved }: { trip: Trip | null; onClose: () => void; onSaved: () => void }) {
  const editing = Boolean(trip);
  const [name, setName] = useState(trip?.name ?? "");
  const [status, setStatus] = useState<Status>(trip?.status ?? "idea");
  const [startDate, setStartDate] = useState(trip?.startDate ?? "");
  const [endDate, setEndDate] = useState(trip?.endDate ?? "");
  const [color, setColor] = useState(trip?.color ?? "#2563eb");
  const [description, setDescription] = useState(trip?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError("Please enter a name."); return; }
    setBusy(true); setError(null);
    const data = { name: name.trim(), status, startDate: startDate || null, endDate: endDate || null, color, description };
    try {
      if (editing && trip) await api.updateTrip(trip.id, data);
      else await api.createTrip("", data);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() { if (trip) { await api.deleteTrip(trip.id); onSaved(); } }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? "Edit trip" : "New trip"}</h2>
        <div className="field"><label>Name</label><input value={name} placeholder="e.g. Italy 2025" onChange={(e) => setName(e.target.value)} /></div>
        <div className="row">
          <div className="field"><label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field"><label>Color</label><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></div>
        </div>
        <div className="row">
          <div className="field"><label>Start</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="field"><label>End</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        <div className="field"><label>Notes</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          {editing && <button className="danger" style={{ marginRight: "auto" }} onClick={remove}>Delete</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/planning/TripForm.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/planning/TripForm.tsx frontend/src/components/planning/TripForm.test.tsx
git commit -m "feat(planning): TripForm (create/edit with status)"
```

---

## Task 3: `TripBoard`

**Files:**
- Create: `frontend/src/components/planning/TripBoard.tsx`
- Test: `frontend/src/components/planning/TripBoard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/planning/TripBoard.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "" }));
import { TripBoard } from "./TripBoard";

const trips = [
  { id: "t1", name: "Japan", status: "idea", startDate: null, endDate: null, color: "#2563eb" },
  { id: "t2", name: "Italy", status: "planning", startDate: "2025-06-01", endDate: "2025-06-14", color: "#16a34a" },
] as any;

test("groups trips into status columns and changes status", () => {
  const onStatusChange = vi.fn();
  render(<TripBoard trips={trips} onOpen={() => {}} onStatusChange={onStatusChange} />);
  // Both column headers and cards present:
  expect(screen.getByText("Japan")).toBeInTheDocument();
  expect(screen.getByText("Italy")).toBeInTheDocument();
  // Move Japan from idea → booked via its card's select:
  const select = screen.getByLabelText("Status for Japan");
  fireEvent.change(select, { target: { value: "booked" } });
  expect(onStatusChange).toHaveBeenCalledWith(trips[0], "booked");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/planning/TripBoard.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `TripBoard`**

Create `frontend/src/components/planning/TripBoard.tsx`:
```tsx
import type { Trip } from "../../api/client";

type Status = "idea" | "planning" | "booked" | "done";
const COLUMNS: { key: Status; label: string }[] = [
  { key: "idea", label: "💡 Idea" }, { key: "planning", label: "📝 Planning" },
  { key: "booked", label: "✅ Booked" }, { key: "done", label: "🏁 Done" },
];

interface Props {
  trips: Trip[];
  onOpen: (trip: Trip) => void;
  onStatusChange: (trip: Trip, status: Status) => void;
}

export function TripBoard({ trips, onOpen, onStatusChange }: Props) {
  return (
    <div className="trip-board">
      {COLUMNS.map((col) => (
        <div key={col.key} className="trip-col">
          <h5>{col.label}</h5>
          {trips.filter((t) => t.status === col.key).map((t) => (
            <div key={t.id} className="trip-card" style={{ borderLeft: `3px solid ${t.color}` }}>
              <div className="tc-title" onClick={() => onOpen(t)}>{t.name}</div>
              <div className="tc-dates">{t.startDate ? `${t.startDate}${t.endDate ? ` – ${t.endDate}` : ""}` : "no dates"}</div>
              <select aria-label={`Status for ${t.name}`} value={t.status} onChange={(e) => onStatusChange(t, e.target.value as Status)}>
                {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
              </select>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

Append to `frontend/src/styles/global.css`:
```css
/* --- Planning --- */
.trip-board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.trip-col { background: #0b1220; border: 1px solid #1e293b; border-radius: 8px; padding: 8px; min-height: 120px; }
.trip-col h5 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; }
.trip-card { background: #1e293b; border-radius: 6px; padding: 7px 8px; margin-bottom: 6px; }
.trip-card .tc-title { color: #e2e8f0; font-weight: 600; cursor: pointer; }
.trip-card .tc-dates { color: #64748b; font-size: 11px; margin: 2px 0 4px; }
.trip-timeline { position: relative; }
.tl-axis { display: flex; justify-content: space-between; color: #64748b; font-size: 10px; margin-bottom: 6px; }
.tl-row { position: relative; height: 22px; background: #0b1220; border-radius: 4px; margin-bottom: 6px; }
.tl-bar { position: absolute; top: 3px; height: 16px; border-radius: 3px; cursor: pointer; color: #fff; font-size: 10px; padding: 0 4px; overflow: hidden; white-space: nowrap; }
.tl-black { position: absolute; top: 0; bottom: 0; border-radius: 3px; background: repeating-linear-gradient(45deg, #3f1d1d, #3f1d1d 4px, #2a1212 4px, #2a1212 8px); }
.itin-item { display: flex; gap: 8px; align-items: center; background: #1e293b; border-radius: 5px; padding: 5px 8px; margin-bottom: 4px; }
.itin-item .day { color: #64748b; font-size: 11px; width: 70px; flex: 0 0 auto; }
.itin-item .t { flex: 1; color: #e2e8f0; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/planning/TripBoard.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/planning/TripBoard.tsx frontend/src/components/planning/TripBoard.test.tsx frontend/src/styles/global.css
git commit -m "feat(planning): TripBoard (kanban by status)"
```

---

## Task 4: `TripTimeline`

**Files:**
- Create: `frontend/src/components/planning/timeline.ts`, `frontend/src/components/planning/TripTimeline.tsx`
- Test: `frontend/src/components/planning/timeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/planning/timeline.test.ts`:
```ts
import { expect, test } from "vitest";
import { placeOnAxis, axisBounds } from "./timeline";

test("placeOnAxis returns left/width percentages within the axis", () => {
  const r = placeOnAxis("2025-01-01", "2025-01-11", "2025-01-03", "2025-01-05");
  expect(r.left).toBeCloseTo(20, 1);
  expect(r.width).toBeCloseTo(20, 1);
});

test("placeOnAxis clamps a bar starting before the axis", () => {
  const r = placeOnAxis("2025-01-01", "2025-01-11", "2024-12-20", "2025-01-02");
  expect(r.left).toBe(0);
});

test("axisBounds spans the min start to the max end across items", () => {
  const b = axisBounds([
    { startDate: "2025-03-01", endDate: "2025-03-10" },
    { startDate: "2025-08-01", endDate: "2025-08-20" },
  ]);
  expect(b.start).toBe("2025-03-01");
  expect(b.end).toBe("2025-08-20");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/planning/timeline.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `timeline.ts`**

Create `frontend/src/components/planning/timeline.ts`:
```ts
export interface DateRange { startDate: string | null; endDate: string | null }

/** Left/width as percentages of an axis [axisStart, axisEnd]. Clamped to [0,100]. */
export function placeOnAxis(axisStart: string, axisEnd: string, start: string, end: string): { left: number; width: number } {
  const a = Date.parse(axisStart);
  const span = Date.parse(axisEnd) - a || 1;
  const s = Date.parse(start);
  const e = Date.parse(end);
  const left = Math.max(0, Math.min(100, ((s - a) / span) * 100));
  const right = Math.max(0, Math.min(100, ((e - a) / span) * 100));
  return { left, width: Math.max(1, right - left) };
}

/** Min start / max end across dated items, with a one-year fallback. */
export function axisBounds(items: DateRange[]): { start: string; end: string } {
  const starts = items.map((i) => i.startDate).filter(Boolean) as string[];
  const ends = items.map((i) => i.endDate ?? i.startDate).filter(Boolean) as string[];
  if (!starts.length) return { start: "2025-01-01", end: "2025-12-31" };
  return { start: starts.sort()[0], end: ends.sort()[ends.length - 1] };
}

/** True if a dated range overlaps a blackout range. */
export function overlaps(a: DateRange, b: DateRange): boolean {
  if (!a.startDate || !b.startDate) return false;
  const aS = Date.parse(a.startDate), aE = Date.parse(a.endDate ?? a.startDate);
  const bS = Date.parse(b.startDate), bE = Date.parse(b.endDate ?? b.startDate);
  return aS <= bE && bS <= aE;
}
```

- [ ] **Step 4: Implement `TripTimeline`**

Create `frontend/src/components/planning/TripTimeline.tsx`:
```tsx
import type { Blackout, Trip } from "../../api/client";
import { axisBounds, overlaps, placeOnAxis } from "./timeline";

interface Props { trips: Trip[]; blackouts: Blackout[]; onOpen: (trip: Trip) => void }

export function TripTimeline({ trips, blackouts, onOpen }: Props) {
  const dated = trips.filter((t) => t.startDate);
  const undated = trips.filter((t) => !t.startDate);
  const { start, end } = axisBounds([...dated.map((t) => ({ startDate: t.startDate, endDate: t.endDate })), ...blackouts]);

  return (
    <div className="trip-timeline">
      <div className="tl-axis"><span>{start}</span><span>{end}</span></div>

      {dated.map((t) => {
        const pos = placeOnAxis(start, end, t.startDate!, t.endDate ?? t.startDate!);
        const clash = blackouts.some((b) => overlaps({ startDate: t.startDate, endDate: t.endDate }, b));
        return (
          <div key={t.id} className="tl-row">
            {blackouts.map((b) => {
              const bp = placeOnAxis(start, end, b.startDate, b.endDate);
              return <div key={b.id} className="tl-black" style={{ left: `${bp.left}%`, width: `${bp.width}%` }} title={b.label} />;
            })}
            <div className="tl-bar" style={{ left: `${pos.left}%`, width: `${pos.width}%`, background: t.color }} onClick={() => onOpen(t)} title={t.name}>
              {clash ? "⚠️ " : ""}{t.name}
            </div>
          </div>
        );
      })}

      {undated.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="tl-axis"><span>Ideas (no dates)</span></div>
          {undated.map((t) => (
            <div key={t.id} className="trip-card" style={{ borderLeft: `3px solid ${t.color}` }} onClick={() => onOpen(t)}>
              <div className="tc-title">{t.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/planning/timeline.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/planning/timeline.ts frontend/src/components/planning/timeline.test.ts frontend/src/components/planning/TripTimeline.tsx
git commit -m "feat(planning): TripTimeline (bars + blackout bands + overlap flag)"
```

---

## Task 5: `TripDetail`

**Files:**
- Create: `frontend/src/components/planning/TripDetail.tsx`
- Test: `frontend/src/components/planning/TripDetail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/planning/TripDetail.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const h = vi.hoisted(() => ({
  listItinerary: vi.fn(async () => [
    { id: "i1", tripId: "t1", title: "Colosseum", notes: "", scheduledOn: "2025-06-04", seq: 0, lat: null, lng: null, placeLabel: "", convertedVisitId: null, createdAt: "" },
    { id: "i2", tripId: "t1", title: "Gelato crawl", notes: "", scheduledOn: null, seq: 0, lat: null, lng: null, placeLabel: "", convertedVisitId: null, createdAt: "" },
  ]),
  listDocuments: vi.fn(async () => []),
  getRelations: vi.fn(async () => []),
  convertItineraryItem: vi.fn(async () => ({ visitId: "v1", item: {} })),
  createItineraryItem: vi.fn(async () => ({})), deleteItineraryItem: vi.fn(async () => {}),
  updateItineraryItem: vi.fn(async () => ({})), updateTrip: vi.fn(async () => ({})),
  createLink: vi.fn(), deleteLink: vi.fn(), searchEntities: vi.fn(async () => []),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { TripDetail } from "./TripDetail";

const trip = { id: "t1", name: "Italy 2025", status: "planning", startDate: "2025-06-03", endDate: "2025-06-14", color: "#2563eb", description: "" } as any;

test("shows itinerary + wishlist and converts a scheduled item", async () => {
  render(withQC(<TripDetail trip={trip} onClose={() => {}} onChanged={() => {}} />));
  expect(await screen.findByText("Colosseum")).toBeInTheDocument();
  expect(screen.getByText("Gelato crawl")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Convert Colosseum to a visit"));
  await waitFor(() => expect(h.convertItineraryItem).toHaveBeenCalledWith("i1"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/planning/TripDetail.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `TripDetail`**

Create `frontend/src/components/planning/TripDetail.tsx`:
```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ItineraryItem, type Trip } from "../../api/client";
import { RelatedPanel } from "../shared/RelatedPanel";
import { DocumentList } from "../documents/DocumentList";

type Status = "idea" | "planning" | "booked" | "done";
const STATUSES: Status[] = ["idea", "planning", "booked", "done"];

export function TripDetail({ trip, onClose, onChanged }: { trip: Trip; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const itinKey = ["itinerary", trip.id];
  const { data: items = [] } = useQuery({ queryKey: itinKey, queryFn: () => api.listItinerary(trip.id) });
  const { data: docs = [] } = useQuery({ queryKey: ["documents", { owner: `trip:${trip.id}` }], queryFn: () => api.listDocuments({ owner: `trip:${trip.id}` }) });

  const refetchItin = () => qc.invalidateQueries({ queryKey: itinKey });
  const add = useMutation({ mutationFn: (title: string) => api.createItineraryItem(trip.id, { title }), onSuccess: () => { setNewTitle(""); refetchItin(); } });
  const del = useMutation({ mutationFn: (id: string) => api.deleteItineraryItem(id), onSuccess: refetchItin });
  const schedule = useMutation({ mutationFn: (id: string) => api.updateItineraryItem(id, { scheduledOn: new Date().toISOString().slice(0, 10) }), onSuccess: refetchItin });
  const convert = useMutation({ mutationFn: (id: string) => api.convertItineraryItem(id), onSuccess: () => { refetchItin(); onChanged(); } });

  async function setStatus(status: Status) { await api.updateTrip(trip.id, { status }); onChanged(); }

  const scheduled = items.filter((i) => i.scheduledOn);
  const wishlist = items.filter((i) => !i.scheduledOn);

  const itinRow = (i: ItineraryItem, scheduledView: boolean) => (
    <div key={i.id} className="itin-item">
      {scheduledView && <span className="day">{i.scheduledOn}</span>}
      <span className="t">{i.title}</span>
      {i.convertedVisitId ? <span className="chip">✓ visit</span>
        : scheduledView ? <button aria-label={`Convert ${i.title} to a visit`} onClick={() => convert.mutate(i.id)}>→ visit</button>
        : <button onClick={() => schedule.mutate(i.id)}>schedule</button>}
      <button className="ghost" aria-label={`Delete ${i.title}`} onClick={() => del.mutate(i.id)}>✕</button>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ flex: 1 }}>{trip.name}</h2>
          <select value={trip.status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="ghost" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="er-sub" style={{ marginBottom: 8 }}>{trip.startDate ? `${trip.startDate} – ${trip.endDate ?? "?"}` : "no dates"}</div>

        <div className="section-title"><span>🗺️ Itinerary</span></div>
        {scheduled.map((i) => itinRow(i, true))}
        {scheduled.length === 0 && <div className="er-sub">Nothing scheduled yet.</div>}

        <div className="section-title"><span>💡 Wishlist</span></div>
        {wishlist.map((i) => itinRow(i, false))}
        <div className="row" style={{ marginTop: 6 }}>
          <input value={newTitle} placeholder="Add an idea or stop…" onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newTitle.trim() && add.mutate(newTitle.trim())} />
          <button style={{ flex: "0 0 auto" }} disabled={!newTitle.trim()} onClick={() => newTitle.trim() && add.mutate(newTitle.trim())}>Add</button>
        </div>

        <div className="section-title"><span>🛂 Bookings</span></div>
        {docs.length > 0 ? <DocumentList documents={docs} onOpen={() => {}} /> : <div className="er-sub">No documents attached to this trip.</div>}

        <div className="section-title"><span>👥 Travelers</span></div>
        <RelatedPanel entity={`trip:${trip.id}`} addTypes={["person"]} />

        <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
```

> `RelatedPanel` (Phase 2) shows the trip's person links and lets you add travelers; `DocumentList` (Phase 5) renders the trip's bookings. Bookings/travelers need no new code.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/planning/TripDetail.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/planning/TripDetail.tsx frontend/src/components/planning/TripDetail.test.tsx
git commit -m "feat(planning): TripDetail (itinerary/wishlist/convert + bookings + travelers)"
```

---

## Task 6: `BlackoutManager`

**Files:**
- Create: `frontend/src/components/planning/BlackoutManager.tsx`
- Test: `frontend/src/components/planning/BlackoutManager.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/planning/BlackoutManager.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const h = vi.hoisted(() => ({
  listBlackouts: vi.fn(async () => [{ id: "b1", label: "School", startDate: "2025-09-01", endDate: "2026-06-15", color: "#64748b", createdAt: "" }]),
  createBlackout: vi.fn(async () => ({ id: "b2" })), deleteBlackout: vi.fn(async () => {}), updateBlackout: vi.fn(),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { BlackoutManager } from "./BlackoutManager";

test("lists blackouts and adds one", async () => {
  render(withQC(<BlackoutManager onClose={() => {}} />));
  expect(await screen.findByText("School")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/label/i), { target: { value: "Work crunch" } });
  fireEvent.change(screen.getByLabelText("Blackout start"), { target: { value: "2025-11-01" } });
  fireEvent.change(screen.getByLabelText("Blackout end"), { target: { value: "2025-11-15" } });
  fireEvent.click(screen.getByText("Add blackout"));
  await waitFor(() => expect(h.createBlackout).toHaveBeenCalledWith(expect.objectContaining({ label: "Work crunch", startDate: "2025-11-01", endDate: "2025-11-15" })));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/planning/BlackoutManager.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `BlackoutManager`**

Create `frontend/src/components/planning/BlackoutManager.tsx`:
```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export function BlackoutManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: blackouts = [] } = useQuery({ queryKey: ["blackouts"], queryFn: api.listBlackouts });
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refetch = () => qc.invalidateQueries({ queryKey: ["blackouts"] });
  const add = useMutation({
    mutationFn: () => api.createBlackout({ label: label.trim(), startDate, endDate }),
    onSuccess: () => { setLabel(""); setStartDate(""); setEndDate(""); setError(null); refetch(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not add"),
  });
  const del = useMutation({ mutationFn: (id: string) => api.deleteBlackout(id), onSuccess: refetch });

  function submit() {
    if (!label.trim() || !startDate || !endDate) { setError("Label and both dates are required."); return; }
    add.mutate();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Blackout dates</h2>
        <p className="er-sub">Periods when travel isn't possible (school, work). They show on the timeline.</p>
        {blackouts.map((b) => (
          <div key={b.id} className="itin-item">
            <span className="t">{b.label}</span>
            <span className="er-sub">{b.startDate} – {b.endDate}</span>
            <button className="ghost" aria-label={`Delete ${b.label}`} onClick={() => del.mutate(b.id)}>✕</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <input value={label} placeholder="Label (e.g. School 2025-26)" onChange={(e) => setLabel(e.target.value)} />
          <input type="date" aria-label="Blackout start" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input type="date" aria-label="Blackout end" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={submit} disabled={add.isPending}>Add blackout</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/planning/BlackoutManager.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/planning/BlackoutManager.tsx frontend/src/components/planning/BlackoutManager.test.tsx
git commit -m "feat(planning): BlackoutManager (CRUD blackout ranges)"
```

---

## Task 7: `PlanningPage`

**Files:**
- Create: `frontend/src/pages/PlanningPage.tsx`
- Test: `frontend/src/pages/PlanningPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/PlanningPage.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({
  listTrips: vi.fn(async () => [{ id: "t1", name: "Italy 2025", status: "planning", startDate: "2025-06-01", endDate: "2025-06-14", color: "#2563eb", description: "" }]),
  listBlackouts: vi.fn(async () => []),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { PlanningPage } from "./PlanningPage";

test("renders the board and toggles to the timeline", async () => {
  render(withQC(<PlanningPage />));
  expect(await screen.findByText("Italy 2025")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
  // Still shows the trip (now as a bar) after toggling:
  expect(screen.getByText(/Italy 2025/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/pages/PlanningPage.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `PlanningPage`**

Create `frontend/src/pages/PlanningPage.tsx`:
```tsx
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Trip } from "../api/client";
import { TripBoard } from "../components/planning/TripBoard";
import { TripTimeline } from "../components/planning/TripTimeline";
import { TripDetail } from "../components/planning/TripDetail";
import { TripForm } from "../components/planning/TripForm";
import { BlackoutManager } from "../components/planning/BlackoutManager";
import { EmptyState, Spinner } from "../components/ui";

type Status = "idea" | "planning" | "booked" | "done";

export function PlanningPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"board" | "timeline">("board");
  const [selected, setSelected] = useState<Trip | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [blackouts, setBlackouts] = useState(false);

  const { data: trips, isLoading } = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips("") });
  const { data: blackoutList = [] } = useQuery({ queryKey: ["blackouts"], queryFn: api.listBlackouts });
  const refresh = () => qc.invalidateQueries({ queryKey: ["trips"] });

  async function changeStatus(trip: Trip, status: Status) {
    await api.updateTrip(trip.id, { status });
    refresh();
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">📅 Planning</span>
        <span className="spacer" />
        <div className="tabs">
          <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>▦ Board</button>
          <button className={view === "timeline" ? "active" : ""} onClick={() => setView("timeline")}>📈 Timeline</button>
        </div>
        <button onClick={() => setBlackouts(true)}>⛔ Blackouts</button>
        <button className="primary" onClick={() => setAdding(true)}>+ Trip</button>
      </header>

      <div style={{ padding: 16, overflow: "auto" }}>
        {isLoading ? (
          <Spinner label="Loading trips…" />
        ) : (trips && trips.length > 0) ? (
          view === "board" ? (
            <TripBoard trips={trips} onOpen={setSelected} onStatusChange={changeStatus} />
          ) : (
            <TripTimeline trips={trips} blackouts={blackoutList} onOpen={setSelected} />
          )
        ) : (
          <EmptyState emoji="📅" title="No trips yet" hint="Plan a future trip — an idea, a date, an itinerary."
            action={<button className="primary" onClick={() => setAdding(true)}>Plan a trip</button>} />
        )}
      </div>

      {selected && <TripDetail trip={selected} onClose={() => setSelected(null)} onChanged={() => { refresh(); }} />}
      {(adding || editing) && (
        <TripForm trip={editing} onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); refresh(); }} />
      )}
      {blackouts && <BlackoutManager onClose={() => setBlackouts(false)} />}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/pages/PlanningPage.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PlanningPage.tsx frontend/src/pages/PlanningPage.test.tsx
git commit -m "feat(planning): PlanningPage (board/timeline toggle)"
```

---

## Task 8: Enable the Planning module

**Files:**
- Modify: `frontend/src/shell/modules.ts`, `frontend/src/shell/AppShell.tsx`
- Test: `frontend/src/shell/modules.planning.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shell/modules.planning.test.ts`:
```ts
import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("Planning is enabled", () => {
  expect(MODULES.find((m) => m.key === "planning")?.enabled).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/shell/modules.planning.test.ts`
Expected: FAIL (planning still `enabled: false`).

- [ ] **Step 3: Enable Planning + route**

In `frontend/src/shell/modules.ts`, set the Planning entry to `enabled: true`:
```ts
  { key: "planning", label: "Planning", icon: "📅", path: "/planning", enabled: true },
```
In `frontend/src/shell/AppShell.tsx`:
- Add `import { PlanningPage } from "../pages/PlanningPage";`
- Add the route inside `<Routes>`, after the `/documents` route:
```tsx
          <Route path="/planning" element={<PlanningPage />} />
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/shell/modules.planning.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shell/modules.ts frontend/src/shell/AppShell.tsx frontend/src/shell/modules.planning.test.ts
git commit -m "feat(shell): enable the Planning module + route"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full frontend suite + typecheck + build**

Run:
```bash
cd frontend && npm test && npm run typecheck && npm run build
```
Expected: all tests PASS; typecheck clean; build succeeds.

- [ ] **Step 2: Manual smoke (with the 6A backend running + seeded)**

Start the frontend (`npm run dev`) and verify:
- The rail's **Planning** entry is active; the **Board** shows trips in status columns; a card's status dropdown moves it across columns.
- **+ Trip** creates a trip (name, status, dates, color).
- **Timeline** toggle shows trip bars; **⛔ Blackouts** adds a labeled range that appears as a striped band; a trip overlapping it shows ⚠️.
- Open a trip → add an itinerary idea; schedule it; **→ visit** converts a scheduled item; bookings (trip documents) and travelers (people) show; add a traveler via the picker.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A frontend
git commit -m "chore: phase 6B planning frontend verified" || echo "nothing to commit"
```

---

## Phase 6 complete

With 6A + 6B: the Planning module — a Board (idea→planning→booked→done) and a Timeline (trip bars + blackout bands with overlap flags), each trip building an itinerary + wishlist with convert-to-visit, and aggregating its bookings (documents) and travelers (people). `RelatedPanel`, `DocumentList`, and `EntityPicker` carry yet another module, and the Rail/shared foundation absorbed planning with no new shared primitives needed.
