# Phase 7B — Packing Module (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Packing module — a shared category-grouped `PackingChecklist`, a Packing module page (templates + trip-lists overview), and a Packing section in the trip detail (start/seed + checklist + save-as-template) — on top of Plan 7A's endpoints.

**Architecture:** A shared `PackingChecklist` does the check-off UI. `PackingPage` (module) browses templates and per-trip lists. `TripPacking` is the trip-detail section, reused inside `PackingPage`'s trip view. Data via `@tanstack/react-query`.

**Tech Stack:** React 18 + Vite, `@tanstack/react-query` v5, `react-router-dom` v6. Tests: Vitest + @testing-library/react with `api` mocked.

**Depends on:** Plan 7A (endpoints) + Phase 6 `TripDetail` (to embed the section).

---

## Conventions (apply to every task)

- All commands run from `frontend/`.
- New files in `frontend/src/components/packing/` (and `pages/PackingPage.tsx`).
- Tests mock `api`; **wrap factory-referenced `vi.fn()`s in `vi.hoisted`**. react-query components use `withQC`.
- Commit after each task with the message in its final step.

---

## File Structure

**New files:**
- `frontend/src/components/packing/PackingChecklist.tsx`
- `frontend/src/components/packing/TripPacking.tsx`
- `frontend/src/pages/PackingPage.tsx`

**Modified files:**
- `frontend/src/api/client.ts` — packing types + methods.
- `frontend/src/components/planning/TripDetail.tsx` (+ its test) — add a Packing section.
- `frontend/src/shell/modules.ts` — enable Packing.
- `frontend/src/shell/AppShell.tsx` — `/packing` route.
- `frontend/src/styles/global.css` — packing styles.

---

## Task 1: API client — packing types & methods

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/packing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/packing.test.ts`:
```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (opts.method === "GET") return jsonRes(url.includes("/trips/") ? { list: null } : []);
    return jsonRes({ id: "x" });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function jsonRes(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("template + trip + create methods hit the right urls", async () => {
  await api.listPackingTemplates();
  expect(calls[0].url).toContain("/api/packing/templates");
  await api.getTripPacking("t1");
  expect(calls[1].url).toContain("/api/trips/t1/packing");
  await api.createTripPacking("t1", { fromTemplateId: "tpl1" });
  expect(calls[2].method).toBe("POST");
  expect(JSON.parse(calls[2].body)).toMatchObject({ fromTemplateId: "tpl1" });
});

test("item check-off + save-as-template post correctly", async () => {
  await api.updatePackingItem("i1", { checked: true });
  expect(calls[0].url).toContain("/api/packing/items/i1");
  await api.savePackingTemplate({ name: "Base", fromListId: "l1" });
  expect(JSON.parse(calls[1].body)).toMatchObject({ name: "Base", fromListId: "l1" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/api/packing.test.ts`
Expected: FAIL (methods undefined).

- [ ] **Step 3: Add types and methods to `client.ts`**

(a) Add types:
```ts
export interface PackingItem { id: string; label: string; category: string; qty: number | null; checked: boolean; seq: number; }
export interface PackingList { id: string; name: string; tripId: string | null; isBuiltin: boolean; itemCount: number; checkedCount: number; }
export interface PackingListDetail extends PackingList { items: PackingItem[]; }
export interface PackingItemInput { label?: string; category?: string; qty?: number | null; checked?: boolean; seq?: number; }
```

(b) Add methods to the `api` object:
```ts
  // packing
  listPackingTemplates: () => request<PackingList[]>("/api/packing/templates"),
  getPackingList: (id: string) => request<PackingListDetail>(`/api/packing/lists/${id}`),
  getTripPacking: (tripId: string) => request<{ list: PackingListDetail | null }>(`/api/trips/${tripId}/packing`),
  createTripPacking: (tripId: string, opts: { name?: string; fromTemplateId?: string; fromTripId?: string } = {}) =>
    request<PackingListDetail>(`/api/trips/${tripId}/packing`, { method: "POST", body: body(opts) }),
  addPackingItem: (listId: string, data: { label: string; category?: string; qty?: number | null }) =>
    request<PackingItem>(`/api/packing/lists/${listId}/items`, { method: "POST", body: body(data) }),
  updatePackingItem: (id: string, data: PackingItemInput) =>
    request<PackingItem>(`/api/packing/items/${id}`, { method: "PATCH", body: body(data) }),
  deletePackingItem: (id: string) => request<void>(`/api/packing/items/${id}`, { method: "DELETE" }),
  renamePackingList: (id: string, name: string) => request<PackingList>(`/api/packing/lists/${id}`, { method: "PATCH", body: body({ name }) }),
  deletePackingList: (id: string) => request<void>(`/api/packing/lists/${id}`, { method: "DELETE" }),
  savePackingTemplate: (data: { name: string; fromListId?: string }) =>
    request<PackingListDetail>("/api/packing/templates", { method: "POST", body: body(data) }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/api/packing.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/packing.test.ts
git commit -m "feat(api): packing templates/lists/items + trip + save-as-template"
```

---

## Task 2: `PackingChecklist`

**Files:**
- Create: `frontend/src/components/packing/PackingChecklist.tsx`
- Modify: `frontend/src/styles/global.css`
- Test: `frontend/src/components/packing/PackingChecklist.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/packing/PackingChecklist.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const { updatePackingItem, addPackingItem, deletePackingItem } = vi.hoisted(() => ({
  updatePackingItem: vi.fn(async () => ({})), addPackingItem: vi.fn(async () => ({})), deletePackingItem: vi.fn(async () => {}),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { updatePackingItem, addPackingItem, deletePackingItem } }));
import { PackingChecklist } from "./PackingChecklist";

const items = [
  { id: "a", label: "Swimsuit", category: "Clothes", qty: null, checked: false, seq: 0 },
  { id: "b", label: "Toothbrush", category: "Toiletries", qty: null, checked: true, seq: 0 },
] as any;

test("groups by category, shows progress, and toggles an item", async () => {
  render(withQC(<PackingChecklist listId="l1" items={items} onChanged={() => {}} />));
  expect(screen.getByText("Clothes")).toBeInTheDocument();
  expect(screen.getByText("Toiletries")).toBeInTheDocument();
  expect(screen.getByText("1/2 packed")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Swimsuit"));
  await waitFor(() => expect(updatePackingItem).toHaveBeenCalledWith("a", { checked: true }));
});

test("readOnly hides the add row and remove buttons", () => {
  render(withQC(<PackingChecklist listId="l1" items={items} readOnly onChanged={() => {}} />));
  expect(screen.queryByPlaceholderText(/Add item/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Remove/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/packing/PackingChecklist.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `PackingChecklist`**

Create `frontend/src/components/packing/PackingChecklist.tsx`:
```tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type PackingItem } from "../../api/client";

interface Props { listId: string; items: PackingItem[]; readOnly?: boolean; onChanged: () => void }

export function PackingChecklist({ listId, items, readOnly = false, onChanged }: Props) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const toggle = useMutation({ mutationFn: (v: { id: string; checked: boolean }) => api.updatePackingItem(v.id, { checked: v.checked }), onSuccess: onChanged });
  const add = useMutation({ mutationFn: () => api.addPackingItem(listId, { label: label.trim(), category: category.trim() || undefined }), onSuccess: () => { setLabel(""); setCategory(""); onChanged(); } });
  const del = useMutation({ mutationFn: (id: string) => api.deletePackingItem(id), onSuccess: onChanged });

  const groups = new Map<string, PackingItem[]>();
  for (const it of items) { const k = it.category || "Other"; groups.set(k, [...(groups.get(k) ?? []), it]); }
  const checked = items.filter((i) => i.checked).length;

  return (
    <div>
      <div className="er-sub">{checked}/{items.length} packed</div>
      {[...groups].map(([cat, its]) => (
        <div key={cat} className="pack-group">
          <div className="cat-hdr">{cat}</div>
          {its.map((i) => (
            <div key={i.id} className="pack-item">
              <input type="checkbox" aria-label={i.label} checked={i.checked} disabled={readOnly}
                onChange={(e) => toggle.mutate({ id: i.id, checked: e.target.checked })} />
              <span className={i.checked ? "done" : ""}>{i.qty ? `${i.qty}× ` : ""}{i.label}</span>
              {!readOnly && <button className="ghost" aria-label={`Remove ${i.label}`} onClick={() => del.mutate(i.id)}>✕</button>}
            </div>
          ))}
        </div>
      ))}
      {!readOnly && (
        <div className="row" style={{ marginTop: 6 }}>
          <input value={label} placeholder="Add item…" onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && label.trim() && add.mutate()} />
          <input value={category} placeholder="Category" style={{ maxWidth: 110 }} onChange={(e) => setCategory(e.target.value)} />
          <button style={{ flex: "0 0 auto" }} disabled={!label.trim()} onClick={() => label.trim() && add.mutate()}>Add</button>
        </div>
      )}
    </div>
  );
}
```

Append to `frontend/src/styles/global.css`:
```css
/* --- Packing --- */
.pack-group { margin-bottom: 8px; }
.cat-hdr { color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; margin: 6px 0 3px; }
.pack-item { display: flex; align-items: center; gap: 8px; padding: 3px 0; color: #cbd5e1; }
.pack-item input[type="checkbox"] { width: auto; }
.pack-item .done { color: #64748b; text-decoration: line-through; }
.pack-item button { margin-left: auto; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/packing/PackingChecklist.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/packing/PackingChecklist.tsx frontend/src/components/packing/PackingChecklist.test.tsx frontend/src/styles/global.css
git commit -m "feat(packing): PackingChecklist (grouped, check-off, add/remove)"
```

---

## Task 3: `TripPacking`

**Files:**
- Create: `frontend/src/components/packing/TripPacking.tsx`
- Test: `frontend/src/components/packing/TripPacking.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/packing/TripPacking.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const h = vi.hoisted(() => ({
  getTripPacking: vi.fn(async () => ({ list: { id: "l1", name: "Packing", tripId: "t1", isBuiltin: false, itemCount: 1, checkedCount: 0,
    items: [{ id: "a", label: "Socks", category: "Clothes", qty: null, checked: false, seq: 0 }] } })),
  savePackingTemplate: vi.fn(async () => ({ id: "tpl9" })),
  updatePackingItem: vi.fn(async () => ({})), addPackingItem: vi.fn(async () => ({})), deletePackingItem: vi.fn(async () => {}),
  createTripPacking: vi.fn(), listPackingTemplates: vi.fn(async () => []), listTrips: vi.fn(async () => []),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { TripPacking } from "./TripPacking";

const trip = { id: "t1", name: "Italy" } as any;

test("shows the trip's checklist and saves it as a template", async () => {
  // window.prompt is used to name the template
  vi.spyOn(window, "prompt").mockReturnValue("Italy base");
  render(withQC(<TripPacking trip={trip} />));
  expect(await screen.findByText("Socks")).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Save as template/));
  await waitFor(() => expect(h.savePackingTemplate).toHaveBeenCalledWith({ name: "Italy base", fromListId: "l1" }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/packing/TripPacking.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `TripPacking`**

Create `frontend/src/components/packing/TripPacking.tsx`:
```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Trip } from "../../api/client";
import { PackingChecklist } from "./PackingChecklist";

export function TripPacking({ trip }: { trip: Trip }) {
  const qc = useQueryClient();
  const key = ["trip-packing", trip.id];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.getTripPacking(trip.id) });
  const [seedMode, setSeedMode] = useState<"none" | "template" | "trip">("none");

  const refetch = () => qc.invalidateQueries({ queryKey: key });
  const start = useMutation({
    mutationFn: (opts: { fromTemplateId?: string; fromTripId?: string }) => api.createTripPacking(trip.id, opts),
    onSuccess: refetch,
  });
  const saveTpl = useMutation({ mutationFn: (v: { name: string; fromListId: string }) => api.savePackingTemplate(v) });

  const templates = useQuery({ queryKey: ["packing-templates"], queryFn: api.listPackingTemplates, enabled: seedMode === "template" });
  const trips = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips(""), enabled: seedMode === "trip" });

  if (isLoading) return <div className="er-sub">Loading…</div>;

  if (!data?.list) {
    return (
      <div>
        <div className="row" style={{ gap: 6 }}>
          <button onClick={() => start.mutate({})}>Start blank</button>
          <button onClick={() => setSeedMode("template")}>From a template</button>
          <button onClick={() => setSeedMode("trip")}>From a past trip</button>
        </div>
        {seedMode === "template" && (
          <select defaultValue="" onChange={(e) => e.target.value && start.mutate({ fromTemplateId: e.target.value })} style={{ marginTop: 6 }}>
            <option value="">— pick a template —</option>
            {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {seedMode === "trip" && (
          <select defaultValue="" onChange={(e) => e.target.value && start.mutate({ fromTripId: e.target.value })} style={{ marginTop: 6 }}>
            <option value="">— pick a trip —</option>
            {(trips.data ?? []).filter((t) => t.id !== trip.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
    );
  }

  const list = data.list;
  return (
    <div>
      <PackingChecklist listId={list.id} items={list.items} onChanged={refetch} />
      <button style={{ marginTop: 6 }} onClick={() => {
        const name = window.prompt("Template name?", `${trip.name} packing`);
        if (name?.trim()) saveTpl.mutate({ name: name.trim(), fromListId: list.id });
      }}>💾 Save as template</button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/packing/TripPacking.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/packing/TripPacking.tsx frontend/src/components/packing/TripPacking.test.tsx
git commit -m "feat(packing): TripPacking (start/seed + checklist + save-as-template)"
```

---

## Task 4: `PackingPage`

**Files:**
- Create: `frontend/src/pages/PackingPage.tsx`
- Test: `frontend/src/pages/PackingPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/PackingPage.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({
  listPackingTemplates: vi.fn(async () => [{ id: "b1", name: "Beach", tripId: null, isBuiltin: true, itemCount: 5, checkedCount: 0 }]),
  listTrips: vi.fn(async () => [{ id: "t1", name: "Italy 2025", status: "planning", startDate: null, endDate: null, color: "#2563eb", description: "" }]),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { PackingPage } from "./PackingPage";

test("lists templates and trips", async () => {
  render(withQC(<PackingPage />));
  expect(await screen.findByText("Beach")).toBeInTheDocument();
  expect(screen.getByText("Italy 2025")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/pages/PackingPage.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `PackingPage`**

Create `frontend/src/pages/PackingPage.tsx`:
```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type PackingList, type Trip } from "../api/client";
import { PackingChecklist } from "../components/packing/PackingChecklist";
import { TripPacking } from "../components/packing/TripPacking";
import { Spinner } from "../components/ui";

type Sel = { kind: "template"; id: string } | { kind: "trip"; trip: Trip } | null;

export function PackingPage() {
  const { data: templates = [], isLoading } = useQuery({ queryKey: ["packing-templates"], queryFn: api.listPackingTemplates });
  const { data: trips = [] } = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips("") });
  const [sel, setSel] = useState<Sel>(null);

  return (
    <div className="app">
      <header className="app-header"><span className="brand">🎒 Packing</span></header>
      <div className="packing-cols">
        <div className="packing-side">
          <div className="cat-hdr">Templates</div>
          {isLoading ? <Spinner /> : templates.map((t: PackingList) => (
            <div key={t.id} className={`entity-row${sel?.kind === "template" && sel.id === t.id ? " active" : ""}`} onClick={() => setSel({ kind: "template", id: t.id })}>
              <span className="er-main"><span className="er-title">{t.name}</span><span className="er-sub"> {t.itemCount} items{t.isBuiltin ? " · built-in" : ""}</span></span>
            </div>
          ))}
          <div className="cat-hdr" style={{ marginTop: 10 }}>Trips</div>
          {trips.map((t: Trip) => (
            <div key={t.id} className={`entity-row${sel?.kind === "trip" && sel.trip.id === t.id ? " active" : ""}`} onClick={() => setSel({ kind: "trip", trip: t })}>
              <span className="er-main"><span className="er-title">{t.name}</span></span>
            </div>
          ))}
        </div>
        <div className="packing-main">
          {sel?.kind === "template" ? <TemplateView id={sel.id} /> : sel?.kind === "trip" ? <TripPacking trip={sel.trip} /> : <div className="er-sub">Pick a template or a trip.</div>}
        </div>
      </div>
    </div>
  );
}

function TemplateView({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ["packing-list", id], queryFn: () => api.getPackingList(id) });
  if (!data) return <Spinner />;
  return <PackingChecklist listId={data.id} items={data.items} readOnly={data.isBuiltin} onChanged={() => {}} />;
}
```

Append to `frontend/src/styles/global.css`:
```css
.packing-cols { display: grid; grid-template-columns: 240px 1fr; gap: 12px; padding: 16px; height: 100%; box-sizing: border-box; }
.packing-side { border-right: 1px solid #1e293b; padding-right: 8px; overflow: auto; }
.packing-main { overflow: auto; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/pages/PackingPage.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PackingPage.tsx frontend/src/pages/PackingPage.test.tsx frontend/src/styles/global.css
git commit -m "feat(packing): PackingPage (templates + trip-lists)"
```

---

## Task 5: Add a Packing section to `TripDetail`

**Files:**
- Modify: `frontend/src/components/planning/TripDetail.tsx`, `frontend/src/components/planning/TripDetail.test.tsx`

- [ ] **Step 1: Update the `TripDetail` test mock for the new dependency**

`TripDetail` will render `TripPacking`, which calls `api.getTripPacking`. Add those methods to the existing `TripDetail.test.tsx` `vi.hoisted` mock object so the test still passes. In `frontend/src/components/planning/TripDetail.test.tsx`, add to the `vi.hoisted(() => ({ ... }))` object:
```ts
  getTripPacking: vi.fn(async () => ({ list: null })),
  createTripPacking: vi.fn(), listPackingTemplates: vi.fn(async () => []),
  savePackingTemplate: vi.fn(), updatePackingItem: vi.fn(), addPackingItem: vi.fn(), deletePackingItem: vi.fn(),
```
(With `list: null`, `TripPacking` renders the Start controls and makes no further calls — the existing itinerary/convert assertions are unaffected.)

- [ ] **Step 2: Run the existing test to confirm it still passes**

Run: `cd frontend && npm test -- src/components/planning/TripDetail.test.tsx`
Expected: PASS (the mock now covers the new dependency, but the component doesn't render the section yet — still passes).

- [ ] **Step 3: Add the Packing section**

In `frontend/src/components/planning/TripDetail.tsx`:
- Add the import: `import { TripPacking } from "../packing/TripPacking";`
- Add the section just before the `👥 Travelers` section title:
```tsx
        <div className="section-title"><span>🎒 Packing</span></div>
        <TripPacking trip={trip} />
```

- [ ] **Step 4: Run the test to confirm still green**

Run: `cd frontend && npm test -- src/components/planning/TripDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/planning/TripDetail.tsx frontend/src/components/planning/TripDetail.test.tsx
git commit -m "feat(planning): Packing section in the trip detail"
```

---

## Task 6: Enable the Packing module

**Files:**
- Modify: `frontend/src/shell/modules.ts`, `frontend/src/shell/AppShell.tsx`
- Test: `frontend/src/shell/modules.packing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shell/modules.packing.test.ts`:
```ts
import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("Packing is enabled", () => {
  expect(MODULES.find((m) => m.key === "packing")?.enabled).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/shell/modules.packing.test.ts`
Expected: FAIL (packing still `enabled: false`).

- [ ] **Step 3: Enable Packing + route**

In `frontend/src/shell/modules.ts`, set the Packing entry to `enabled: true`:
```ts
  { key: "packing", label: "Packing", icon: "🎒", path: "/packing", enabled: true },
```
In `frontend/src/shell/AppShell.tsx`:
- Add `import { PackingPage } from "../pages/PackingPage";`
- Add the route inside `<Routes>`, after the `/planning` route:
```tsx
          <Route path="/packing" element={<PackingPage />} />
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/shell/modules.packing.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shell/modules.ts frontend/src/shell/AppShell.tsx frontend/src/shell/modules.packing.test.ts
git commit -m "feat(shell): enable the Packing module + route"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full frontend suite + typecheck + build**

Run:
```bash
cd frontend && npm test && npm run typecheck && npm run build
```
Expected: all tests PASS; typecheck clean; build succeeds.

- [ ] **Step 2: Manual smoke (with the 7A backend running + seeded)**

Start the frontend (`npm run dev`) and verify:
- The rail's **Packing** entry is active; the page lists built-in templates (Beach/Winter/Carry-on) and your trips.
- Open a built-in template → its checklist shows read-only (no add/remove).
- Open a trip → **Start blank / From a template / From a past trip**; seeding copies items (unchecked); check items off; **Save as template** creates a reusable template.
- In **Planning → a trip's detail**, the **🎒 Packing** section shows the same list (check-off works in both places).

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A frontend
git commit -m "chore: phase 7B packing frontend verified" || echo "nothing to commit"
```

---

## Phase 7 complete

With 7A + 7B: the Packing module — reusable templates (built-in + your own), per-trip category-grouped checklists with check-off, seeded from templates or past trips and saved back as templates, surfaced both as a standalone module and inside each trip's detail. The shared `PackingChecklist` serves both surfaces; no new shared primitives were needed beyond it.
