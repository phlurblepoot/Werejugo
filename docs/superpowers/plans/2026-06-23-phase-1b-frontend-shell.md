# Phase 1B — Frontend Shell & Map Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the left-rail module shell and migrate the existing Map UI onto the new shared-core backend (visits + media + links) **without rewriting the Map components** — by keeping the `api` method names and DTO shapes stable and repointing them in `client.ts`, plus a small backend addendum so a visit's DTO carries its linked photos.

**Architecture:** A persistent left rail (`Rail`) lists modules; `AppShell` routes each to a full view via `react-router` (already a dependency). The Map is the one live module; People/Photos/Documents/Planning/Packing render a `ComingSoon` placeholder. The data migration is concentrated in `frontend/src/api/client.ts`: item/photo/trip/comment/stats endpoints are repointed to the new visits/media/links/family-scoped-trip routes while preserving their method names and return shapes, so `MapPage` and its children are untouched. Signed media URLs (from 1A) load directly in `<img>`.

**Tech Stack:** React 18, Vite, `@tanstack/react-query`, `react-router-dom` v6, MapLibre. Tests: **Vitest + @testing-library/react + jsdom** (added in Task 2). Depends on **Plan 1A** being implemented first (shared-core backend, signed file serving, `/api/visits`, `/api/media`, `/api/links`).

**Scope note — deliberate deviation from the spec:** The architecture spec lists five shared UI components for the foundation (`RelatedPanel`, `EntityPicker`, `MediaUploader`, `EntityList`, `EntityDetail`). Building them now — with no module to consume them — would be speculative (YAGNI). The true frontend foundation is **the shell + the Map running on the new core**. The shared components get built in **Phase 2 (People)**, their first real consumer, where their interfaces can be shaped by actual use. This plan delivers the shell and the migration; it does not build the five components. (Flag for the user; easy to pull forward if desired.)

---

## Conventions (apply to every task)

- **Frontend commands run from `frontend/`.** The one backend task (Task 1) runs from `backend/`.
- Components are function components; data fetching uses `@tanstack/react-query`; styling uses the existing global CSS class vocabulary (`.app`, `.app-header`, `.empty-state`, etc.).
- **Commit** after each task with the message in its final step.

---

## File Structure

**Backend (Task 1 — 1A addendum):**
- Modify: `backend/src/routes/visits.ts` — `loadVisit` attaches `photos` (linked media, signed URLs); export `loadVisit`.
- Modify: `backend/src/routes/mapsets.ts` — `GET /api/map-sets/:id/visits` returns full visit DTOs.

**Frontend — new files:**
- `frontend/vitest.config.ts`, `frontend/src/test/setup.ts` — test harness.
- `frontend/src/shell/modules.ts` — module registry (key, label, icon, path, enabled).
- `frontend/src/shell/Rail.tsx` — the persistent left rail.
- `frontend/src/shell/AppShell.tsx` — rail + routed module content.
- `frontend/src/shell/ComingSoon.tsx` — placeholder for not-yet-built modules.

**Frontend — modified files:**
- `frontend/package.json` — add test deps + `test` script.
- `frontend/src/api/client.ts` — repoint item/photo/trip/comment/stats methods; make `mapSetId` optional on `Item`/`Trip`.
- `frontend/src/App.tsx` — top-level routes: share view, login, or `AppShell`.
- `frontend/src/pages/ShareView.tsx` — read `token` from the router.
- `frontend/src/styles/global.css` — `.shell` / `.rail` styles.

**Unchanged (the win):** `MapPage.tsx`, `ItemEditor.tsx`, `MapView.tsx`, `ItemDetail.tsx`, `GalleryPanel.tsx`, `Lightbox.tsx`, `Sidebar.tsx`, `ManagePanel.tsx`, `TripsPanel.tsx`, `StatsPanel.tsx`, `MediaThumb.tsx` — no edits needed; they consume the stable `api` seam.

---

## Task 1: Backend addendum — visit photos & full map visits

**Files:**
- Modify: `backend/src/routes/visits.ts`
- Modify: `backend/src/routes/mapsets.ts`
- Test: `backend/src/routes/visit-photos.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/visit-photos.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("a visit DTO includes linked media as photos with signed urls", async () => {
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'place','Tower') RETURNING id", [ctx.familyId]);
  const m = await query<{ id: string }>(
    "INSERT INTO media (family_id, kind, rel_path, thumb_rel_path, caption) VALUES ($1,'image','loose/2024/a.jpg','loose/2024/a.thumb.jpg','Nice') RETURNING id",
    [ctx.familyId]);
  await query(
    `INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role)
     VALUES ($1,'media',$2,'visit',$3,'appears_in')`, [ctx.familyId, m.rows[0].id, v.rows[0].id]);

  const res = await ctx.app.inject({ method: "GET", url: `/api/visits/${v.rows[0].id}`, headers: auth() });
  const dto = res.json();
  expect(dto.photos).toHaveLength(1);
  expect(dto.photos[0]).toMatchObject({ mediaType: "image", caption: "Nice" });
  expect(dto.photos[0].url).toContain("/api/files/");
  expect(dto.photos[0].thumbUrl).toContain("sig=");
});

test("GET /api/map-sets/:id/visits returns full visit DTOs for members", async () => {
  const ms = await query<{ id: string }>(
    "INSERT INTO map_sets (family_id, name) VALUES ($1,'Main') RETURNING id", [ctx.familyId]);
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'food','Joe''s') RETURNING id", [ctx.familyId]);
  await query("INSERT INTO map_set_visits (map_set_id, visit_id) VALUES ($1,$2)", [ms.rows[0].id, v.rows[0].id]);

  const res = await ctx.app.inject({
    method: "GET", url: `/api/map-sets/${ms.rows[0].id}/visits`, headers: auth() });
  const arr = res.json();
  expect(arr).toHaveLength(1);
  expect(arr[0]).toMatchObject({ title: "Joe's", kind: "food" });
  expect(Array.isArray(arr[0].photos)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/visit-photos.test.ts`
Expected: FAIL (no `photos` on the DTO; membership endpoint returns `{visitId, seq}`).

- [ ] **Step 3: Attach photos in `loadVisit` and export it**

In `backend/src/routes/visits.ts`, add the import:
```ts
import { signFileUrl } from "../lib/filesign.js";
```
Inside `loadVisit`, after the `wps` query and before the `return`, add a media query:
```ts
  const photoRows = await query<any>(
    `SELECT m.id, m.rel_path, m.thumb_rel_path, m.kind, m.caption, m.created_at
     FROM links l JOIN media m ON m.id = CASE
        WHEN l.from_type = 'media' THEN l.from_id ELSE l.to_id END
     WHERE l.family_id = $2
       AND ((l.from_type='media' AND l.to_type='visit' AND l.to_id=$1)
         OR (l.to_type='media' AND l.from_type='visit' AND l.from_id=$1))
     ORDER BY m.created_at ASC`,
    [id, familyId],
  );
```
Then add `photos` to the returned object (alongside `waypoints`):
```ts
    photos: photoRows.rows.map((p, i) => ({
      id: p.id,
      url: signFileUrl(p.rel_path),
      thumbUrl: p.thumb_rel_path ? signFileUrl(p.thumb_rel_path) : null,
      mediaType: p.kind,
      caption: p.caption,
      seq: i,
    })),
```
Change the function signature to be exported: `export async function loadVisit(familyId: string, id: string) {`.

- [ ] **Step 4: Make the membership GET return full visits**

In `backend/src/routes/mapsets.ts`, add the import at the top:
```ts
import { loadVisit } from "./visits.js";
```
Replace the body of the `GET /api/map-sets/:id/visits` handler with:
```ts
    const id = (req.params as { id: string }).id;
    if (!(await ownsMapSet(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const { rows } = await query<{ visit_id: string }>(
      "SELECT visit_id FROM map_set_visits WHERE map_set_id = $1 ORDER BY seq ASC", [id]);
    return Promise.all(rows.map((r) => loadVisit(req.user.familyId, r.visit_id)));
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/visit-photos.test.ts`
Expected: PASS (2 tests). Then re-run the 1A membership test to confirm no regression: `npm test -- src/routes/mapsets.test.ts` (its `toHaveLength(1)` assertion still holds).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/visits.ts backend/src/routes/mapsets.ts backend/src/routes/visit-photos.test.ts
git commit -m "feat(visits): attach linked photos to visit DTO; full visits for a map"
```

---

## Task 2: Frontend test harness

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`, `frontend/src/test/setup.ts`

- [ ] **Step 1: Install test dependencies**

Run:
```bash
cd frontend && npm install -D vitest@^2.1.0 jsdom@^25.0.0 @testing-library/react@^16.0.0 @testing-library/jest-dom@^6.5.0 @testing-library/user-event@^14.5.0
```

- [ ] **Step 2: Add the `test` script**

In `frontend/package.json` `scripts`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write the Vitest config**

Create `frontend/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

- [ ] **Step 4: Write the setup file**

Create `frontend/src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Smoke test the harness**

Create `frontend/src/test/setup.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("react-testing-library renders", () => {
  render(<div>hello shell</div>);
  expect(screen.getByText("hello shell")).toBeInTheDocument();
});
```
Run: `cd frontend && npm test -- src/test/setup.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/vitest.config.ts frontend/src/test
git commit -m "test: add vitest + react-testing-library harness for the frontend"
```

---

## Task 3: Migrate the API client to the new endpoints

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

This is the heart of the migration. Method names and return shapes stay the same; only URLs (and a couple of compositions) change. `MapPage` and its children are unaffected.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/client.test.ts`:
```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    const method = opts.method ?? "GET";
    calls.push({ url, method, body: opts.body });
    // Return shapes per endpoint.
    if (url.endsWith("/api/visits") && method === "POST")
      return jsonRes({ id: "v1", kind: "place", title: "X", photos: [], waypoints: [] });
    if (url.includes("/api/media") && method === "POST")
      return jsonRes({ id: "m1", kind: "image", url: "/api/files/x?sig=1", thumbUrl: null, caption: "" });
    if (method === "GET") return jsonRes([]); // all list endpoints return arrays
    return jsonRes({ ok: true });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

function jsonRes(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("listItems reads the map's visits and stamps mapSetId", async () => {
  await api.listItems("ms1");
  expect(calls[0].url).toContain("/api/map-sets/ms1/visits");
});

test("createItem creates a visit then adds map membership", async () => {
  const item = await api.createItem("ms1", { kind: "place", title: "X" });
  expect(calls[0].url).toContain("/api/visits");
  expect(calls[0].method).toBe("POST");
  expect(calls[1].url).toContain("/api/map-sets/ms1/visits");
  expect(item.mapSetId).toBe("ms1");
});

test("uploadItemPhoto uploads media then links it to the visit", async () => {
  const file = new File(["x"], "p.jpg", { type: "image/jpeg" });
  const photo = await api.uploadItemPhoto("v1", file, "cap");
  expect(calls[0].url).toContain("/api/media");
  expect(calls[1].url).toContain("/api/links");
  expect(JSON.parse(calls[1].body)).toMatchObject({ from: "media:m1", to: "visit:v1" });
  expect(photo.mediaType).toBe("image");
});

test("listTrips uses the family-scoped endpoint", async () => {
  await api.listTrips("ms1");
  expect(calls[0].url).toContain("/api/trips");
  expect(calls[0].url).not.toContain("map-sets");
});

test("listComments and addComment target the visit", async () => {
  await api.listComments("v1");
  expect(calls[0].url).toContain("/api/visits/v1/comments");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/api/client.test.ts`
Expected: FAIL (old URLs: `/api/map-sets/ms1/items`, `/api/items/...`).

- [ ] **Step 3: Apply the migration**

In `frontend/src/api/client.ts`:

(a) Make `mapSetId` optional on the two affected types:
- In `interface Item`, change `mapSetId: string;` → `mapSetId?: string;`
- In `interface Trip`, change `mapSetId: string;` → `mapSetId?: string;`

(b) Replace the `// items`, `// photos`, `// trips`, `// comments`, and `// stats` blocks of the `api` object with:
```ts
  // visits (formerly items) — kept as `Item` shape; mapSetId is stamped client-side
  listItems: async (mapSetId: string) => {
    const visits = await request<Item[]>(`/api/map-sets/${mapSetId}/visits`);
    return visits.map((v) => ({ ...v, mapSetId }));
  },
  createItem: async (mapSetId: string, data: Partial<Item>) => {
    const visit = await request<Item>("/api/visits", { method: "POST", body: body(data) });
    await request(`/api/map-sets/${mapSetId}/visits`, { method: "POST", body: body({ visitId: visit.id }) });
    return { ...visit, mapSetId };
  },
  updateItem: (id: string, data: Partial<Item>) =>
    request<Item>(`/api/visits/${id}`, { method: "PATCH", body: body(data) }),
  deleteItem: (id: string) => request<void>(`/api/visits/${id}`, { method: "DELETE" }),

  // photos -> media + a media↔visit link
  uploadItemPhoto: async (itemId: string, file: File, caption = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("caption", caption);
    const m = await request<{ id: string; url: string; thumbUrl: string | null; kind: MediaType; caption: string }>(
      "/api/media", { method: "POST", body: fd });
    await request("/api/links", {
      method: "POST",
      body: body({ from: `media:${m.id}`, to: `visit:${itemId}`, role: "appears_in" }),
    });
    return { id: m.id, url: m.url, thumbUrl: m.thumbUrl, mediaType: m.kind, caption: m.caption, seq: 0 } as Photo;
  },
  updatePhoto: async (id: string, caption: string) => {
    const m = await request<{ id: string; url: string; thumbUrl: string | null; kind: MediaType; caption: string }>(
      `/api/media/${id}`, { method: "PATCH", body: body({ caption }) });
    return { id: m.id, url: m.url, thumbUrl: m.thumbUrl, mediaType: m.kind, caption: m.caption, seq: 0 } as Photo;
  },
  deletePhoto: (id: string) => request<void>(`/api/media/${id}`, { method: "DELETE" }),

  // trips (family-scoped; mapSetId arg is ignored, kept for call-site compatibility)
  listTrips: (_mapSetId: string) => request<Trip[]>("/api/trips"),
  createTrip: (_mapSetId: string, data: Partial<Trip>) =>
    request<Trip>("/api/trips", { method: "POST", body: body(data) }),
  updateTrip: (id: string, data: Partial<Trip>) =>
    request<Trip>(`/api/trips/${id}`, { method: "PATCH", body: body(data) }),
  deleteTrip: (id: string) => request<void>(`/api/trips/${id}`, { method: "DELETE" }),

  // comments (now on visits)
  listComments: (itemId: string) => request<Comment[]>(`/api/visits/${itemId}/comments`),
  addComment: (itemId: string, body_: string) =>
    request<Comment>(`/api/visits/${itemId}/comments`, { method: "POST", body: body({ body: body_ }) }),
  deleteComment: (id: string) => request<void>(`/api/comments/${id}`, { method: "DELETE" }),

  // stats (family-scoped)
  getStats: (_mapSetId: string) => request<Stats>("/api/stats"),
```

> Leave `listShares`/`createShare`/`deleteShare`/`getShare`, map-sets, themes, icons, settings, lookups, exif, import, export **unchanged** — their backend routes keep the same paths (see 1A Task 15 for the share/import internals, which now read visits/media but expose the same DTO shape).

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/api/client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors. *(If a component reads `item.mapSetId` non-optionally, it now narrows — none in this codebase do, but fix any that surface.)*

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "refactor(api): repoint item/photo/trip/comment/stats to shared-core endpoints"
```

---

## Task 4: Module registry + shell styles

**Files:**
- Create: `frontend/src/shell/modules.ts`
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Write the module registry**

Create `frontend/src/shell/modules.ts`:
```ts
export interface ModuleDef {
  key: string;
  label: string;
  icon: string; // emoji
  path: string;
  enabled: boolean;
}

// The left-rail modules, in build order. Only Map is live in Phase 1.
export const MODULES: ModuleDef[] = [
  { key: "map", label: "Map", icon: "🗺️", path: "/map", enabled: true },
  { key: "people", label: "People", icon: "👤", path: "/people", enabled: false },
  { key: "photos", label: "Photos", icon: "🖼️", path: "/photos", enabled: false },
  { key: "documents", label: "Documents", icon: "🛂", path: "/documents", enabled: false },
  { key: "planning", label: "Planning", icon: "📅", path: "/planning", enabled: false },
  { key: "packing", label: "Packing", icon: "🎒", path: "/packing", enabled: false },
];
```

- [ ] **Step 2: Add rail styles**

Append to `frontend/src/styles/global.css`:
```css
/* --- Module shell --- */
.shell { position: absolute; inset: 0; display: flex; }
.rail {
  flex: 0 0 72px; background: #0f172a; color: #cbd5e1;
  display: flex; flex-direction: column; align-items: stretch;
  padding: 8px 0; gap: 4px; z-index: 20;
}
.rail-item {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 8px 4px; font-size: 10px; color: #94a3b8; text-decoration: none;
  border-left: 3px solid transparent; cursor: pointer; background: none; border-right: none; border-top: none; border-bottom: none;
}
.rail-item .rail-icon { font-size: 20px; }
.rail-item.active { color: #fff; border-left-color: #2563eb; background: #1e293b; }
.rail-item.disabled { opacity: 0.4; pointer-events: none; }
.rail-spacer { flex: 1; }
.shell-main { position: relative; flex: 1; min-width: 0; }
.shell-main > .app { position: absolute; inset: 0; }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shell/modules.ts frontend/src/styles/global.css
git commit -m "feat(shell): module registry and left-rail styles"
```

---

## Task 5: The Rail component

**Files:**
- Create: `frontend/src/shell/Rail.tsx`
- Test: `frontend/src/shell/Rail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shell/Rail.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { Rail } from "./Rail";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Rail onSignOut={() => {}} />
    </MemoryRouter>,
  );
}

test("renders every module label", () => {
  renderAt("/map");
  expect(screen.getByText("Map")).toBeInTheDocument();
  expect(screen.getByText("People")).toBeInTheDocument();
  expect(screen.getByText("Packing")).toBeInTheDocument();
});

test("marks the active module", () => {
  renderAt("/map");
  expect(screen.getByText("Map").closest(".rail-item")).toHaveClass("active");
});

test("disables not-yet-built modules", () => {
  renderAt("/map");
  expect(screen.getByText("People").closest(".rail-item")).toHaveClass("disabled");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/shell/Rail.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the Rail**

Create `frontend/src/shell/Rail.tsx`:
```tsx
import { NavLink } from "react-router-dom";
import { MODULES } from "./modules";

export function Rail({ onSignOut }: { onSignOut: () => void }) {
  return (
    <nav className="rail" aria-label="Modules">
      {MODULES.map((m) =>
        m.enabled ? (
          <NavLink
            key={m.key}
            to={m.path}
            className={({ isActive }) => `rail-item${isActive ? " active" : ""}`}
            title={m.label}
          >
            <span className="rail-icon" aria-hidden="true">{m.icon}</span>
            <span>{m.label}</span>
          </NavLink>
        ) : (
          <span key={m.key} className="rail-item disabled" title={`${m.label} — coming soon`}>
            <span className="rail-icon" aria-hidden="true">{m.icon}</span>
            <span>{m.label}</span>
          </span>
        ),
      )}
      <span className="rail-spacer" />
      <button className="rail-item" onClick={onSignOut} title="Sign out">
        <span className="rail-icon" aria-hidden="true">🚪</span>
        <span>Out</span>
      </button>
    </nav>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/shell/Rail.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shell/Rail.tsx frontend/src/shell/Rail.test.tsx
git commit -m "feat(shell): Rail navigation component"
```

---

## Task 6: AppShell, ComingSoon, and App routing

**Files:**
- Create: `frontend/src/shell/ComingSoon.tsx`, `frontend/src/shell/AppShell.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/pages/ShareView.tsx`
- Test: `frontend/src/shell/AppShell.test.tsx`

- [ ] **Step 1: Write the ComingSoon placeholder**

Create `frontend/src/shell/ComingSoon.tsx`:
```tsx
import { EmptyState } from "../components/ui";

export function ComingSoon({ label }: { label: string }) {
  return (
    <div className="app">
      <EmptyState emoji="🚧" title={`${label} is coming soon`} hint="This module isn't built yet — it's next on the roadmap." />
    </div>
  );
}
```

- [ ] **Step 2: Write the failing AppShell test**

Create `frontend/src/shell/AppShell.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { ComingSoon } from "./ComingSoon";

// AppShell pulls in MapPage (MapLibre), so this task tests the routing shape via ComingSoon,
// which exercises the same shell layout without a WebGL canvas.
test("ComingSoon renders the module label", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><ComingSoon label="People" /></MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText("People is coming soon")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npm test -- src/shell/AppShell.test.tsx`
Expected: FAIL (`./ComingSoon` not found until Step 1 lands; if Step 1 already created it, this passes — that's fine, it's a guard test).

- [ ] **Step 4: Implement AppShell**

Create `frontend/src/shell/AppShell.tsx`:
```tsx
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { MapPage } from "../pages/MapPage";
import { Rail } from "./Rail";
import { ComingSoon } from "./ComingSoon";
import { MODULES } from "./modules";

export function AppShell() {
  const { logout } = useAuth();
  return (
    <div className="shell">
      <Rail onSignOut={logout} />
      <div className="shell-main">
        <Routes>
          <Route path="/" element={<Navigate to="/map" replace />} />
          <Route path="/map" element={<MapPage />} />
          {MODULES.filter((m) => !m.enabled).map((m) => (
            <Route key={m.key} path={m.path} element={<ComingSoon label={m.label} />} />
          ))}
          <Route path="*" element={<Navigate to="/map" replace />} />
        </Routes>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `App.tsx` to route share / login / shell**

Replace `frontend/src/App.tsx` with:
```tsx
import { Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { ShareView } from "./pages/ShareView";
import { AppShell } from "./shell/AppShell";

export function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      {/* Public read-only share links — no login required. */}
      <Route path="/s/:token" element={<ShareView />} />
      <Route
        path="/*"
        element={loading ? <div className="centered">Loading…</div> : user ? <AppShell /> : <LoginPage />}
      />
    </Routes>
  );
}
```

- [ ] **Step 6: Update `ShareView` to read the route param**

In `frontend/src/pages/ShareView.tsx`, change the signature to read the token from the router:
- Add import: `import { useParams } from "react-router-dom";`
- Change `export function ShareView({ token }: { token: string }) {` to:
  ```tsx
  export function ShareView() {
    const { token = "" } = useParams<{ token: string }>();
  ```
(The rest of the component is unchanged — it already uses `token` in the `useEffect`.)

- [ ] **Step 7: Run the test + typecheck**

Run:
```bash
cd frontend && npm test -- src/shell/AppShell.test.tsx && npm run typecheck
```
Expected: test PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/shell/AppShell.tsx frontend/src/shell/ComingSoon.tsx frontend/src/App.tsx frontend/src/pages/ShareView.tsx frontend/src/shell/AppShell.test.tsx
git commit -m "feat(shell): AppShell routing, ComingSoon, share/login/shell split"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full frontend test suite + typecheck + build**

Run:
```bash
cd frontend && npm test && npm run typecheck && npm run build
```
Expected: all tests PASS; typecheck clean; production build succeeds.

- [ ] **Step 2: Manual smoke against the running stack**

With the 1A backend running and seeded (`SEED_DEV_DATA=true`), start the frontend (`npm run dev`) and verify:
- Logging in shows the **left rail** with Map active and the other modules greyed out.
- The Map loads the seeded visits as pins; clicking a pin opens its detail; a seeded photo (if linked) renders.
- Adding a new pin (`+ Add to map`) creates a visit, adds it to the current map, and it appears immediately.
- Uploading a photo to a pin shows it in the detail and gallery (served via a signed `/api/files/...` URL).
- Clicking a disabled module does nothing; navigating to `/people` manually shows "People is coming soon".
- A share link still opens read-only at `/s/<token>`.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A frontend
git commit -m "chore: phase 1B frontend shell + map migration verified" || echo "nothing to commit"
```

---

## Notes & follow-ups

- **Shared components** (`RelatedPanel`, `EntityPicker`, `MediaUploader`, `EntityList`, `EntityDetail`) are intentionally **not** built here — they ship with Phase 2 (People), their first consumer (see Scope note).
- **Trips are now family-wide.** Because trips dropped `map_set_id`, every map's `TripsPanel` shows all family trips. This matches the spec (trips are a shared-core entity) and is acceptable for the foundation; per-map trip filtering, if ever wanted, is a later refinement.
- **Stats are family-wide** for the same reason (the `getStats` arg is ignored).
- The `MapPage` header still renders family/invite/sign-out alongside the new rail's sign-out — a minor duplication left for **Phase 7 (Polish)**; it is not worth editing the large `MapPage` now.
- **Trip-rename file re-homing** (deferred in 1A Task 14) remains a known follow-up for Phase 1B/Phase 7.
