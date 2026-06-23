# Phase 4B — Photos/Media Module (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Photos rail module — a date-grouped, filterable library (person/trip/place/date) with a Grid/Map toggle, a photo detail reusing `RelatedPanel`, and a bulk upload that runs a suggest-and-confirm review — on top of Plan 4A's endpoints.

**Architecture:** A `PhotosPage` composes focused components in `components/photos/`. The library list uses `@tanstack/react-query`'s `useInfiniteQuery` keyed on the filter set, paging via the `before` cursor. The map view uses MapLibre's **native GeoJSON clustering** (no extra lib). Components call the `api` object directly, matching the codebase.

**Tech Stack:** React 18 + Vite, `@tanstack/react-query` v5, `react-router-dom` v6, MapLibre 4. Tests: Vitest + @testing-library/react with `api` mocked.

**Depends on:** Plan 4A (endpoints) + Phase-2 `EntityPicker`/`RelatedPanel`/`MediaUploader`.

---

## Conventions (apply to every task)

- All commands run from `frontend/`.
- New files in `frontend/src/components/photos/` (and `pages/PhotosPage.tsx`).
- Tests mock `api`: `vi.mock("../../api/client", () => ({ API_URL: "", api: { ... } }))`. **Vitest hoists `vi.mock` above top-level `const`s** — wrap factory-referenced `vi.fn()`s in `vi.hoisted(() => ({...}))`.
- react-query components wrap in `withQC` (from `frontend/src/test/qc.tsx`, created in Phase 2B).
- Commit after each task with the message in its final step.

---

## File Structure

**New files:**
- `frontend/src/components/photos/groupByMonth.ts` — pure month-grouping helper.
- `frontend/src/components/photos/PhotoGrid.tsx`
- `frontend/src/components/photos/PhotoFilters.tsx`
- `frontend/src/components/photos/PhotoDetail.tsx`
- `frontend/src/components/photos/UploadReview.tsx`
- `frontend/src/components/photos/PhotoMap.tsx` (+ `toFeatureCollection` helper, tested)
- `frontend/src/pages/PhotosPage.tsx`

**Modified files:**
- `frontend/src/api/client.ts` — media library types + methods.
- `frontend/src/shell/modules.ts` — enable Photos.
- `frontend/src/shell/AppShell.tsx` — `/photos` route.
- `frontend/src/styles/global.css` — a few photo styles.

---

## Task 1: API client — media library methods

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/media-lib.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/media-lib.test.ts`:
```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (url.includes("/suggestions")) return jsonRes({ trips: [], visits: [] });
    if (opts.method === "GET") return jsonRes({ items: [], nextCursor: null });
    return jsonRes({ applied: 1 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function jsonRes(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("listMedia builds a query string from filters", async () => {
  await api.listMedia({ trip: "t1", from: "2024-06-01", limit: 60 });
  expect(calls[0].url).toContain("/api/media?");
  expect(calls[0].url).toContain("trip=t1");
  expect(calls[0].url).toContain("from=2024-06-01");
  expect(calls[0].url).toContain("limit=60");
});

test("listMedia omits empty filters", async () => {
  await api.listMedia({ trip: "", person: undefined });
  expect(calls[0].url).not.toContain("trip=");
  expect(calls[0].url).not.toContain("person=");
});

test("applyMediaSuggestion posts the payload", async () => {
  await api.applyMediaSuggestion({ mediaIds: ["m1"], tripId: "t1" });
  expect(calls[0].url).toContain("/api/media/apply-suggestion");
  expect(JSON.parse(calls[0].body)).toMatchObject({ mediaIds: ["m1"], tripId: "t1" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/api/media-lib.test.ts`
Expected: FAIL (methods undefined).

- [ ] **Step 3: Add types and methods to `client.ts`**

(a) Near the media types, add:
```ts
export interface MediaItem {
  id: string;
  kind: MediaType;
  tripId: string | null;
  url: string;
  thumbUrl: string | null;
  caption: string;
  takenAt: string | null;
  createdAt: string;
  width: number | null;
  height: number | null;
  lng: number | null;
  lat: number | null;
  cursor: string;
}

export interface MediaFilters {
  person?: string; trip?: string; visit?: string;
  from?: string; to?: string; bbox?: string;
  limit?: number; before?: string;
}

export interface MediaPage { items: MediaItem[]; nextCursor: string | null; }

export interface MediaSuggestions {
  trips: { tripId: string; name: string; mediaIds: string[] }[];
  visits: { visitId: string; title: string; mediaIds: string[] }[];
}
```

(b) In the `api` object, add (after the existing media/photo methods):
```ts
  // media library
  listMedia: (f: MediaFilters = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    return request<MediaPage>(`/api/media?${qs.toString()}`);
  },
  setMediaTrip: (id: string, tripId: string | null) =>
    request<unknown>(`/api/media/${id}`, { method: "PATCH", body: body({ tripId }) }),
  getMediaSuggestions: (mediaIds: string[]) =>
    request<MediaSuggestions>("/api/media/suggestions", { method: "POST", body: body({ mediaIds }) }),
  applyMediaSuggestion: (data: { mediaIds: string[]; tripId?: string | null; visitId?: string }) =>
    request<{ applied: number }>("/api/media/apply-suggestion", { method: "POST", body: body(data) }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/api/media-lib.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/media-lib.test.ts
git commit -m "feat(api): media library list/suggestions/apply methods"
```

---

## Task 2: `groupByMonth` + `PhotoGrid`

**Files:**
- Create: `frontend/src/components/photos/groupByMonth.ts`, `frontend/src/components/photos/PhotoGrid.tsx`
- Modify: `frontend/src/styles/global.css`
- Test: `frontend/src/components/photos/groupByMonth.test.ts`, `frontend/src/components/photos/PhotoGrid.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/photos/groupByMonth.test.ts`:
```ts
import { expect, test } from "vitest";
import { groupByMonth } from "./groupByMonth";

test("groups items by capture month, newest first, with labels", () => {
  const items = [
    { id: "a", takenAt: "2024-06-10T10:00:00Z", createdAt: "2024-09-01T00:00:00Z" },
    { id: "b", takenAt: "2024-03-05T10:00:00Z", createdAt: "2024-09-01T00:00:00Z" },
    { id: "c", takenAt: null, createdAt: "2024-06-20T00:00:00Z" },
  ];
  const groups = groupByMonth(items, (i) => i.takenAt ?? i.createdAt);
  expect(groups.map((g) => g.key)).toEqual(["2024-06", "2024-03"]);
  expect(groups[0].label).toMatch(/June 2024/);
  expect(groups[0].items.map((i) => i.id)).toEqual(["a", "c"]);
});
```

Create `frontend/src/components/photos/PhotoGrid.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "" }));
import { PhotoGrid } from "./PhotoGrid";

const items = [
  { id: "a", kind: "image", tripId: null, url: "/api/files/a?sig=1", thumbUrl: "/api/files/a.t?sig=1", caption: "Sunset", takenAt: "2024-06-10T10:00:00Z", createdAt: "", width: null, height: null, lng: null, lat: null, cursor: "c1" },
] as any;

test("renders a date header and opens a photo on click", () => {
  const onOpen = vi.fn();
  render(<PhotoGrid items={items} onOpen={onOpen} hasMore={false} onLoadMore={() => {}} />);
  expect(screen.getByText(/June 2024/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("img", { name: "Sunset" }));
  expect(onOpen).toHaveBeenCalledWith(items[0]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npm test -- src/components/photos/groupByMonth.test.ts src/components/photos/PhotoGrid.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `groupByMonth`**

Create `frontend/src/components/photos/groupByMonth.ts`:
```ts
export interface MonthGroup<T> { key: string; label: string; items: T[] }

/** Group items by YYYY-MM of the given date, newest month first. Null dates → "Undated". */
export function groupByMonth<T>(items: T[], dateOf: (item: T) => string | null): MonthGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const d = dateOf(it);
    const key = d ? d.slice(0, 7) : "0000-00";
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, groupItems]) => ({ key, label: labelFor(key), items: groupItems }));
}

function labelFor(key: string): string {
  if (key === "0000-00") return "Undated";
  return new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
```

- [ ] **Step 4: Implement `PhotoGrid`**

Create `frontend/src/components/photos/PhotoGrid.tsx`:
```tsx
import { API_URL, type MediaItem } from "../../api/client";
import { groupByMonth } from "./groupByMonth";

interface Props {
  items: MediaItem[];
  onOpen: (item: MediaItem) => void;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function PhotoGrid({ items, onOpen, hasMore, onLoadMore }: Props) {
  const groups = groupByMonth(items, (i) => i.takenAt ?? i.createdAt);
  return (
    <div>
      {groups.map((g) => (
        <div key={g.key} className="photo-month">
          <div className="datehdr">{g.label}</div>
          <div className="photo-grid-lib">
            {g.items.map((m) => (
              <button key={m.id} className="photo-cell" onClick={() => onOpen(m)} title={m.caption}>
                {m.kind === "image" ? (
                  <img src={`${API_URL}${m.thumbUrl ?? m.url}`} alt={m.caption || "Photo"} loading="lazy" />
                ) : (
                  <span className="media-placeholder">{m.kind === "video" ? "▶" : "🎵"}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
      {hasMore && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button onClick={onLoadMore}>Load more</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add styles**

Append to `frontend/src/styles/global.css`:
```css
/* --- Photos library --- */
.photo-month { margin-bottom: 14px; }
.photo-grid-lib { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 4px; }
.photo-cell { aspect-ratio: 1; padding: 0; border: none; border-radius: 4px; overflow: hidden; cursor: pointer; background: #1e293b; }
.photo-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo-filter-bar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; padding: 8px 0; }
.photo-detail-img { width: 100%; max-height: 60vh; object-fit: contain; background: #000; border-radius: 6px; }
.suggestion { background: #13243b; border: 1px solid #1e3a5f; border-radius: 8px; padding: 8px 10px; margin: 6px 0; }
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd frontend && npm test -- src/components/photos/groupByMonth.test.ts src/components/photos/PhotoGrid.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/photos/groupByMonth.ts frontend/src/components/photos/groupByMonth.test.ts frontend/src/components/photos/PhotoGrid.tsx frontend/src/components/photos/PhotoGrid.test.tsx frontend/src/styles/global.css
git commit -m "feat(photos): groupByMonth + PhotoGrid (timeline grid)"
```

---

## Task 3: `PhotoFilters`

**Files:**
- Create: `frontend/src/components/photos/PhotoFilters.tsx`
- Test: `frontend/src/components/photos/PhotoFilters.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/photos/PhotoFilters.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { searchEntities } = vi.hoisted(() => ({ searchEntities: vi.fn(async () => [{ type: "person", id: "p1", label: "Mom", thumbUrl: null }]) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { searchEntities } }));
import { PhotoFilters } from "./PhotoFilters";

test("picking a person reports it; clearing removes it", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<PhotoFilters value={{}} onChange={onChange} trips={[]} />);
  fireEvent.change(screen.getByPlaceholderText(/person/i), { target: { value: "mo" } });
  fireEvent.mouseDown(await screen.findByText("Mom"));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ person: "p1" }));

  rerender(<PhotoFilters value={{ person: "p1" }} onChange={onChange} trips={[]} />);
  fireEvent.click(screen.getByLabelText("Clear person filter"));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ person: undefined }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/photos/PhotoFilters.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `PhotoFilters`**

Create `frontend/src/components/photos/PhotoFilters.tsx`:
```tsx
import { useState } from "react";
import type { MediaFilters } from "../../api/client";
import { EntityPicker } from "../shared/EntityPicker";

interface Props {
  value: MediaFilters;
  onChange: (f: MediaFilters) => void;
  trips: { id: string; name: string }[];
}

export function PhotoFilters({ value, onChange, trips }: Props) {
  const [labels, setLabels] = useState<{ person?: string; visit?: string }>({});

  const set = (patch: Partial<MediaFilters>) => onChange({ ...value, ...patch });

  return (
    <div className="photo-filter-bar">
      {value.person ? (
        <span className="fchip act">👤 {labels.person ?? "Person"}
          <button aria-label="Clear person filter" onClick={() => set({ person: undefined })}>✕</button>
        </span>
      ) : (
        <EntityPicker type="person" placeholder="Filter by person…" onPick={(e) => { setLabels((l) => ({ ...l, person: e.label })); set({ person: e.id }); }} />
      )}

      <select value={value.trip ?? ""} onChange={(e) => set({ trip: e.target.value || undefined })}>
        <option value="">✈️ Any trip</option>
        {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {value.visit ? (
        <span className="fchip act">📍 {labels.visit ?? "Place"}
          <button aria-label="Clear place filter" onClick={() => set({ visit: undefined })}>✕</button>
        </span>
      ) : (
        <EntityPicker type="visit" placeholder="Filter by place…" onPick={(e) => { setLabels((l) => ({ ...l, visit: e.label })); set({ visit: e.id }); }} />
      )}

      <input type="date" value={value.from ?? ""} title="From" onChange={(e) => set({ from: e.target.value || undefined })} />
      <input type="date" value={value.to ?? ""} title="To" onChange={(e) => set({ to: e.target.value || undefined })} />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/photos/PhotoFilters.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/photos/PhotoFilters.tsx frontend/src/components/photos/PhotoFilters.test.tsx
git commit -m "feat(photos): PhotoFilters (person/trip/place/date chips)"
```

---

## Task 4: `PhotoDetail`

**Files:**
- Create: `frontend/src/components/photos/PhotoDetail.tsx`
- Test: `frontend/src/components/photos/PhotoDetail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/photos/PhotoDetail.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const { updatePhoto, deletePhoto, setMediaTrip, getRelations } = vi.hoisted(() => ({
  updatePhoto: vi.fn(async () => ({})), deletePhoto: vi.fn(async () => {}),
  setMediaTrip: vi.fn(async () => ({})), getRelations: vi.fn(async () => []),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { updatePhoto, deletePhoto, setMediaTrip, getRelations, createLink: vi.fn(), deleteLink: vi.fn(), searchEntities: vi.fn(async () => []) } }));
import { PhotoDetail } from "./PhotoDetail";

const item = { id: "m1", kind: "image", tripId: null, url: "/api/files/a?sig=1", thumbUrl: null, caption: "Hi", takenAt: "2024-06-10T10:00:00Z", createdAt: "", width: null, height: null, lng: 12.5, lat: 41.9, cursor: "c" } as any;

test("edits caption and deletes", async () => {
  const onChanged = vi.fn(); const onClose = vi.fn();
  render(withQC(<PhotoDetail item={item} trips={[]} onChanged={onChanged} onClose={onClose} />));
  const cap = screen.getByDisplayValue("Hi");
  fireEvent.change(cap, { target: { value: "Sunset" } });
  fireEvent.blur(cap);
  await waitFor(() => expect(updatePhoto).toHaveBeenCalledWith("m1", "Sunset"));
  fireEvent.click(screen.getByText("Delete"));
  await waitFor(() => expect(deletePhoto).toHaveBeenCalledWith("m1"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/photos/PhotoDetail.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `PhotoDetail`**

Create `frontend/src/components/photos/PhotoDetail.tsx`:
```tsx
import { api, API_URL, type MediaItem } from "../../api/client";
import { RelatedPanel } from "../shared/RelatedPanel";

interface Props {
  item: MediaItem;
  trips: { id: string; name: string }[];
  onChanged: () => void;
  onClose: () => void;
}

export function PhotoDetail({ item, trips, onChanged, onClose }: Props) {
  async function saveCaption(caption: string) {
    if (caption === item.caption) return;
    await api.updatePhoto(item.id, caption);
    onChanged();
  }
  async function setTrip(tripId: string | null) {
    await api.setMediaTrip(item.id, tripId);
    onChanged();
  }
  async function remove() {
    await api.deletePhoto(item.id);
    onChanged();
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="ghost" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <img className="photo-detail-img" src={`${API_URL}${item.url}`} alt={item.caption || "Photo"} />

        <div className="field">
          <label>Caption</label>
          <input defaultValue={item.caption} placeholder="Caption…" onBlur={(e) => saveCaption(e.target.value)} />
        </div>

        <div className="field">
          <label>Trip</label>
          <select defaultValue={item.tripId ?? ""} onChange={(e) => setTrip(e.target.value || null)}>
            <option value="">— No trip —</option>
            {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="er-sub" style={{ marginBottom: 8 }}>
          {item.takenAt ? `🕒 ${item.takenAt.slice(0, 10)}` : "🕒 No date"}
          {item.lat != null && item.lng != null ? ` · 📍 ${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}` : ""}
        </div>

        <RelatedPanel entity={`media:${item.id}`} addTypes={["person", "visit"]} />

        <div className="modal-actions">
          <button className="danger" style={{ marginRight: "auto" }} onClick={remove}>Delete</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/photos/PhotoDetail.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/photos/PhotoDetail.tsx frontend/src/components/photos/PhotoDetail.test.tsx
git commit -m "feat(photos): PhotoDetail (caption/trip/related/delete)"
```

---

## Task 5: `UploadReview`

**Files:**
- Create: `frontend/src/components/photos/UploadReview.tsx`
- Test: `frontend/src/components/photos/UploadReview.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/photos/UploadReview.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { getMediaSuggestions, applyMediaSuggestion } = vi.hoisted(() => ({
  getMediaSuggestions: vi.fn(async () => ({ trips: [{ tripId: "t1", name: "Italy 2024", mediaIds: ["m1", "m2"] }], visits: [] })),
  applyMediaSuggestion: vi.fn(async () => ({ applied: 2 })),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { getMediaSuggestions, applyMediaSuggestion } }));
import { UploadReview } from "./UploadReview";

test("shows a trip suggestion and applies it", async () => {
  render(<UploadReview mediaIds={["m1", "m2"]} onDone={() => {}} />);
  expect(await screen.findByText(/Italy 2024/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Link all"));
  await waitFor(() => expect(applyMediaSuggestion).toHaveBeenCalledWith({ mediaIds: ["m1", "m2"], tripId: "t1" }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/photos/UploadReview.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `UploadReview`**

Create `frontend/src/components/photos/UploadReview.tsx`:
```tsx
import { useEffect, useState } from "react";
import { api, type MediaSuggestions } from "../../api/client";

interface Props { mediaIds: string[]; onDone: () => void }

export function UploadReview({ mediaIds, onDone }: Props) {
  const [sug, setSug] = useState<MediaSuggestions | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => { api.getMediaSuggestions(mediaIds).then(setSug).catch(() => setSug({ trips: [], visits: [] })); }, [mediaIds]);

  async function applyTrip(tripId: string, ids: string[], key: string) {
    await api.applyMediaSuggestion({ mediaIds: ids, tripId });
    setDone((d) => new Set(d).add(key));
  }
  async function applyVisit(visitId: string, ids: string[], key: string) {
    await api.applyMediaSuggestion({ mediaIds: ids, visitId });
    setDone((d) => new Set(d).add(key));
  }

  const nothing = sug && sug.trips.length === 0 && sug.visits.length === 0;

  return (
    <div className="modal-backdrop" onClick={onDone}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Review suggestions</h2>
        {!sug && <div className="er-sub">Looking for matches…</div>}
        {nothing && <div className="er-sub">No automatic matches — you can link photos by hand anytime.</div>}

        {sug?.trips.map((t) => {
          const key = `t:${t.tripId}`;
          return (
            <div key={key} className="suggestion">
              <strong>{t.mediaIds.length} photos</strong> → trip <strong>{t.name}</strong> <span className="er-sub">by date</span>
              <div className="row" style={{ marginTop: 4 }}>
                {done.has(key) ? <span className="er-sub">Linked ✓</span> : (
                  <button className="primary" onClick={() => applyTrip(t.tripId, t.mediaIds, key)}>Link all</button>
                )}
              </div>
            </div>
          );
        })}

        {sug?.visits.map((v) => {
          const key = `v:${v.visitId}`;
          return (
            <div key={key} className="suggestion">
              <strong>{v.mediaIds.length} photos</strong> → near <strong>{v.title}</strong> <span className="er-sub">by GPS</span>
              <div className="row" style={{ marginTop: 4 }}>
                {done.has(key) ? <span className="er-sub">Tagged ✓</span> : (
                  <button className="primary" onClick={() => applyVisit(v.visitId, v.mediaIds, key)}>Tag visit</button>
                )}
              </div>
            </div>
          );
        })}

        <div className="er-sub" style={{ marginTop: 8 }}>People are tagged by hand in each photo.</div>
        <div className="modal-actions">
          <button className="primary" onClick={onDone}>Done</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/photos/UploadReview.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/photos/UploadReview.tsx frontend/src/components/photos/UploadReview.test.tsx
git commit -m "feat(photos): UploadReview (suggest-and-confirm)"
```

---

## Task 6: `PhotoMap`

**Files:**
- Create: `frontend/src/components/photos/PhotoMap.tsx`
- Test: `frontend/src/components/photos/photoMapData.test.ts`

Uses MapLibre's **native GeoJSON clustering** (no extra dependency). The pure `toFeatureCollection` helper is unit-tested; the WebGL map itself is verified in the manual smoke.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/photos/photoMapData.test.ts`:
```ts
import { expect, test } from "vitest";
import { toFeatureCollection } from "./PhotoMap";

test("builds a FeatureCollection from geotagged photos only", () => {
  const items = [
    { id: "a", lng: 12.5, lat: 41.9, thumbUrl: "/t/a" },
    { id: "b", lng: null, lat: null, thumbUrl: null },
  ] as any;
  const fc = toFeatureCollection(items);
  expect(fc.features).toHaveLength(1);
  expect(fc.features[0].geometry.coordinates).toEqual([12.5, 41.9]);
  expect(fc.features[0].properties.id).toBe("a");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/photos/photoMapData.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `PhotoMap`**

Create `frontend/src/components/photos/PhotoMap.tsx`:
```tsx
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { type MediaItem } from "../../api/client";

export interface PhotoFC {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: { id: string } }>;
}

/** Geotagged photos → GeoJSON points (drops photos without coordinates). */
export function toFeatureCollection(items: MediaItem[]): PhotoFC {
  return {
    type: "FeatureCollection",
    features: items
      .filter((m) => m.lng != null && m.lat != null)
      .map((m) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [m.lng as number, m.lat as number] },
        properties: { id: m.id },
      })),
  };
}

const STYLE_URL =
  (import.meta as { env?: Record<string, string> }).env?.VITE_MAP_STYLE_URL ??
  "https://tiles.openfreemap.org/styles/liberty";

export function PhotoMap({ items, onOpen }: { items: MediaItem[]; onOpen: (item: MediaItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({ container: ref.current, style: STYLE_URL, center: [0, 20], zoom: 1.4 });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("photos", { type: "geojson", data: toFeatureCollection(items), cluster: true, clusterRadius: 50 });
      map.addLayer({ id: "clusters", type: "circle", source: "photos", filter: ["has", "point_count"],
        paint: { "circle-color": "#2563eb", "circle-radius": ["step", ["get", "point_count"], 14, 10, 20, 50, 28], "circle-opacity": 0.85 } });
      map.addLayer({ id: "cluster-count", type: "symbol", source: "photos", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#fff" } });
      map.addLayer({ id: "photo-pt", type: "circle", source: "photos", filter: ["!", ["has", "point_count"]],
        paint: { "circle-color": "#f59e0b", "circle-radius": 6, "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
      map.on("click", "photo-pt", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const item = id ? items.find((m) => m.id === id) : undefined;
        if (item) onOpen(item);
      });
    });
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("photos") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(toFeatureCollection(items) as never);
  }, [items]);

  return <div ref={ref} style={{ position: "absolute", inset: 0 }} />;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/photos/photoMapData.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/photos/PhotoMap.tsx frontend/src/components/photos/photoMapData.test.ts
git commit -m "feat(photos): PhotoMap (clustered geotagged photos)"
```

---

## Task 7: `PhotosPage`

**Files:**
- Modify: `frontend/src/components/shared/MediaUploader.tsx` (add `onAllUploaded`)
- Create: `frontend/src/pages/PhotosPage.tsx`
- Test: `frontend/src/pages/PhotosPage.test.tsx`

- [ ] **Step 0: Add an `onAllUploaded` callback to `MediaUploader`**

In `frontend/src/components/shared/MediaUploader.tsx`, add the optional prop and fire it once after the batch resolves (backward-compatible — existing callers don't pass it). Change the `Props` interface to add:
```ts
  onAllUploaded?: (media: MediaDto[]) => void;
```
and update `handle` to collect results and call it:
```ts
  async function handle(files: FileList) {
    setBusy(true);
    setError(null);
    try {
      const media = await Promise.all(
        Array.from(files).map(async (file) => {
          const m = await api.uploadMedia(file);
          if (linkTo) await api.createLink(`media:${m.id}`, linkTo, linkRole);
          onUploaded(m);
          return m;
        }),
      );
      onAllUploaded?.(media);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }
```
(Destructure `onAllUploaded` from props alongside `onUploaded`.) Run the existing uploader test to confirm no regression: `npm test -- src/components/shared/MediaUploader.test.tsx` → PASS.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/PhotosPage.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const { listMedia, listTrips } = vi.hoisted(() => ({
  listMedia: vi.fn(async () => ({ items: [{ id: "a", kind: "image", tripId: null, url: "/api/files/a?sig=1", thumbUrl: "/api/files/a.t?sig=1", caption: "Sunset", takenAt: "2024-06-10T10:00:00Z", createdAt: "", width: null, height: null, lng: null, lat: null, cursor: "c1" }], nextCursor: null })),
  listTrips: vi.fn(async () => []),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: { listMedia, listTrips } }));
import { PhotosPage } from "./PhotosPage";

test("renders the library grid from listMedia", async () => {
  render(withQC(<PhotosPage />));
  expect(await screen.findByText(/June 2024/)).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Sunset" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/pages/PhotosPage.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `PhotosPage`**

Create `frontend/src/pages/PhotosPage.tsx`:
```tsx
import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type MediaFilters, type MediaItem } from "../api/client";
import { MediaUploader } from "../components/shared/MediaUploader";
import { PhotoFilters } from "../components/photos/PhotoFilters";
import { PhotoGrid } from "../components/photos/PhotoGrid";
import { PhotoMap } from "../components/photos/PhotoMap";
import { PhotoDetail } from "../components/photos/PhotoDetail";
import { UploadReview } from "../components/photos/UploadReview";
import { EmptyState, Spinner } from "../components/ui";

export function PhotosPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<MediaFilters>({});
  const [view, setView] = useState<"grid" | "map">("grid");
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [uploadedIds, setUploadedIds] = useState<string[] | null>(null);

  const { data: trips = [] } = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips("") });

  const mediaQuery = useInfiniteQuery({
    queryKey: ["media", filters],
    queryFn: ({ pageParam }) => api.listMedia({ ...filters, before: pageParam, limit: 60 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items: MediaItem[] = mediaQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["media"] });

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">🖼️ Photos</span>
        <span className="spacer" />
        <div className="tabs">
          <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>▦ Grid</button>
          <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>🗺️ Map</button>
        </div>
        <MediaUploader multiple label="⬆ Upload" onUploaded={() => {}} onAllUploaded={(media) => setUploadedIds(media.map((m) => m.id))} />
      </header>

      <div style={{ padding: "0 16px" }}>
        <PhotoFilters value={filters} onChange={setFilters} trips={trips} />
      </div>

      <div className="map-area" style={{ position: "relative", overflow: view === "grid" ? "auto" : "hidden" }}>
        {mediaQuery.isLoading ? (
          <Spinner label="Loading photos…" />
        ) : items.length === 0 ? (
          <EmptyState emoji="🖼️" title="No photos yet" hint="Upload photos to start your family library." />
        ) : view === "grid" ? (
          <div style={{ padding: 16 }}>
            <PhotoGrid items={items} onOpen={setSelected} hasMore={mediaQuery.hasNextPage} onLoadMore={() => mediaQuery.fetchNextPage()} />
          </div>
        ) : (
          <PhotoMap items={items} onOpen={setSelected} />
        )}
      </div>

      {selected && (
        <PhotoDetail item={selected} trips={trips} onClose={() => setSelected(null)} onChanged={() => { refresh(); setSelected(null); }} />
      )}

      {uploadedIds && (
        <UploadReview mediaIds={uploadedIds} onDone={() => { setUploadedIds(null); refresh(); }} />
      )}
    </div>
  );
}
```

> Upload batching: `MediaUploader` calls `onUploaded` per file *and* `onAllUploaded(media[])` once after the whole batch resolves (added in Step 3a below). `PhotosPage` uses `onAllUploaded` to open the review with the full set of new ids.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/pages/PhotosPage.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PhotosPage.tsx frontend/src/pages/PhotosPage.test.tsx frontend/src/components/shared/MediaUploader.tsx
git commit -m "feat(photos): PhotosPage (library, filters, grid/map, upload review)"
```

---

## Task 8: Enable the Photos module

**Files:**
- Modify: `frontend/src/shell/modules.ts`, `frontend/src/shell/AppShell.tsx`
- Test: `frontend/src/shell/modules.photos.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shell/modules.photos.test.ts`:
```ts
import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("Photos is enabled", () => {
  expect(MODULES.find((m) => m.key === "photos")?.enabled).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/shell/modules.photos.test.ts`
Expected: FAIL (photos still `enabled: false`).

- [ ] **Step 3: Enable Photos + add the route**

In `frontend/src/shell/modules.ts`, set the Photos entry to `enabled: true`:
```ts
  { key: "photos", label: "Photos", icon: "🖼️", path: "/photos", enabled: true },
```
In `frontend/src/shell/AppShell.tsx`, add the import and route:
```tsx
import { PhotosPage } from "../pages/PhotosPage";
```
Add inside `<Routes>`, after the `/people` route:
```tsx
          <Route path="/photos" element={<PhotosPage />} />
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/shell/modules.photos.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shell/modules.ts frontend/src/shell/AppShell.tsx frontend/src/shell/modules.photos.test.ts
git commit -m "feat(shell): enable the Photos module + route"
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

- [ ] **Step 2: Manual smoke (with the 4A backend running + seeded)**

Start the frontend (`npm run dev`) and verify:
- The rail's **Photos** entry is active; the page shows a date-grouped grid.
- **Upload** several photos → a review panel proposes trip/visit matches → "Link all" applies them; the grid refreshes.
- **Filters**: pick a person / trip / place / date range → the grid narrows; clearing a chip restores it.
- **Grid → Map** toggle shows clustered geotagged photos; clicking a point opens its detail.
- **Photo detail**: edit caption, set a trip (file moves folders), link a person/visit via Related, delete.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A frontend
git commit -m "chore: phase 4B photos frontend verified" || echo "nothing to commit"
```

---

## Phase 4 complete

With 4A + 4B: a real Photos library — browse by time (timeline grid), person, trip, and place (visit filter + clustered map); bulk upload captures EXIF and runs a suggest-and-confirm review; each photo's detail edits caption, trip, and people/visit links. The shared components (`EntityPicker`, `RelatedPanel`, `MediaUploader`) carry their second module, validating the foundation.
