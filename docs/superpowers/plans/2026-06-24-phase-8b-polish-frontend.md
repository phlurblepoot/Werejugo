# Phase 8B — Polish Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frontend for the final polish phase — a global command-palette search, generalized read-only sharing UI (trips + albums; map sharing retired), full-archive backup/restore in a Settings page, a consistent `ErrorState`, and a first-run welcome — plus a README.

**Architecture:** All on the existing React 18 + Vite + React Query + React Router stack. Search is a controlled `CommandPalette` overlay opened by Cmd/Ctrl-K or a rail button. Sharing reuses a single `ShareButton` component pointed at a `(targetType, targetId)`; the public `ShareView` is rewritten to render the new trip/album payloads. Backup/restore live on a new `/settings` page reached from the rail.

**Tech Stack:** React 18, `@tanstack/react-query` v5, `react-router-dom` v6, Vitest + @testing-library/react. Frontend commands run from `frontend/`.

**Depends on:** Phase 8A (the backend endpoints). 8A must be merged/available for manual testing, but the frontend tests mock `api`, so 8B tests pass independently.

**Conventions (read before starting):**
- Frontend commands run from `frontend/`.
- Component tests mock the API with `vi.hoisted` + `vi.mock("../api/client", () => ({ API_URL: "", api: h }))` and wrap UI in `withQC(...)` from `src/test/qc`. Router-dependent components are wrapped in `<MemoryRouter>`.
- Never weaken a behavioral assertion to pass. Commit per task with the exact message. Stage only that task's files (never `git add -A` — there are unrelated modified files in the tree).

---

### Task 1: API client — search, generalized shares, backup/restore

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/share-backup-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/share-backup-client.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (url.includes("/api/backup")) return new Response(new Blob(["x"]), { status: 200 });
    return new Response(JSON.stringify({ id: "s1", token: "t".repeat(20), targetType: "trip", targetId: "tr1", createdAt: "" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

test("search hits /api/search with the query", async () => {
  await api.search("venice");
  expect(calls[0].url).toContain("/api/search?q=venice");
});

test("createShare posts targetType + targetId", async () => {
  await api.createShare("album", "tr1");
  expect(calls[0].url).toContain("/api/shares");
  expect(JSON.parse(calls[0].body)).toMatchObject({ targetType: "album", targetId: "tr1" });
});

test("listShares passes target in the query string", async () => {
  await api.listShares("trip", "tr1");
  expect(calls[0].url).toContain("/api/shares?targetType=trip&targetId=tr1");
});

test("downloadBackup fetches the archive as a blob", async () => {
  const blob = await api.downloadBackup();
  expect(calls[0].url).toContain("/api/backup");
  expect(blob).toBeInstanceOf(Blob);
});

test("restoreBackup posts the file as multipart", async () => {
  await api.restoreBackup(new File(["x"], "b.tar.gz"));
  expect(calls[0].url).toContain("/api/restore");
  expect(calls[0].body).toBeInstanceOf(FormData);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- share-backup-client`
Expected: FAIL — `api.search`/`api.downloadBackup`/`api.restoreBackup` undefined; `createShare`/`listShares` have the old signature.

- [ ] **Step 3: Update the types**

In `frontend/src/api/client.ts`, **replace** the existing `ShareLink` and `SharePayload` interfaces (around lines 158–170) with:

```ts
export interface SearchHit { type: string; id: string; label: string; thumbUrl: string | null; to: string; }
export interface SearchResults {
  people: SearchHit[]; trips: SearchHit[]; visits: SearchHit[]; photos: SearchHit[]; documents: SearchHit[];
}

export type ShareTargetType = "trip" | "album";
export interface ShareLink {
  id: string; token: string; targetType: ShareTargetType; targetId: string; createdAt: string;
}

export interface SharedTrip {
  id: string; name: string; description: string; color: string; startDate: string | null; endDate: string | null;
}
export interface SharedPhoto { id: string; url: string; thumbUrl: string | null; mediaType: MediaType; caption: string; seq: number; }
export interface SharedVisit {
  id: string; kind: ItemKind; title: string; notes: string; color: string | null; icon: string | null;
  occurredOn: string | null; geometry: Geometry | null; photos: SharedPhoto[];
}
export interface SharedItineraryItem { id: string; title: string; notes: string; scheduledOn: string | null; seq: number; }
export interface TripSharePayload { targetType: "trip"; trip: SharedTrip; visits: SharedVisit[]; itinerary: SharedItineraryItem[]; photos: SharedPhoto[]; }
export interface AlbumSharePayload { targetType: "album"; trip: SharedTrip; photos: SharedPhoto[]; }
export type SharePayload = TripSharePayload | AlbumSharePayload;
```

- [ ] **Step 4: Update the client methods**

In `frontend/src/api/client.ts`, **replace** the existing `// share links` block (the four `listShares`/`createShare`/`deleteShare`/`getShare` lines, around 555–560) with:

```ts
  // global search
  search: (q: string) => request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),

  // share links (trips + albums)
  listShares: (targetType: ShareTargetType, targetId: string) =>
    request<ShareLink[]>(`/api/shares?targetType=${targetType}&targetId=${targetId}`),
  createShare: (targetType: ShareTargetType, targetId: string) =>
    request<ShareLink>("/api/shares", { method: "POST", body: body({ targetType, targetId }) }),
  deleteShare: (id: string) => request<void>(`/api/shares/${id}`, { method: "DELETE" }),
  getShare: (token: string) => request<SharePayload>(`/api/share/${token}`),

  // backup / restore
  downloadBackup: async (): Promise<Blob> => {
    const token = tokenStore.get();
    const res = await fetch(`${API_URL}/api/backup`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, "Backup failed");
    return res.blob();
  },
  restoreBackup: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ ok: boolean; counts: Record<string, number> }>("/api/restore", { method: "POST", body: fd });
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- share-backup-client`
Expected: PASS (5 tests).

> Note: this temporarily breaks `MapSetEditor.tsx` (old `createShare(id)` call) and `ShareView.tsx` (old payload). Those are fixed in Tasks 6 and 7. Do not run a full typecheck until then.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/share-backup-client.test.ts
git commit -m "feat(api): search, trip/album shares, backup/restore client"
```

---

### Task 2: `ErrorState` component + apply to PhotosPage

**Files:**
- Modify: `frontend/src/components/ui.tsx`
- Modify: `frontend/src/pages/PhotosPage.tsx`
- Test: `frontend/src/components/ui.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ErrorState } from "./ui";

test("shows the message and fires retry", () => {
  const onRetry = vi.fn();
  render(<ErrorState hint="Network down" onRetry={onRetry} />);
  expect(screen.getByText("Network down")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Try again"));
  expect(onRetry).toHaveBeenCalled();
});

test("omits the retry button when no handler is given", () => {
  render(<ErrorState title="Broke" />);
  expect(screen.getByText("Broke")).toBeInTheDocument();
  expect(screen.queryByText("Try again")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- ui.test`
Expected: FAIL — `ErrorState` not exported.

- [ ] **Step 3: Add `ErrorState` to `ui.tsx`**

Append to `frontend/src/components/ui.tsx`:

```tsx
/** Consistent error state with an optional retry. */
export function ErrorState({
  title = "Something went wrong",
  hint,
  onRetry,
}: {
  title?: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-emoji" aria-hidden="true">⚠️</div>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
      {onRetry && (
        <div className="empty-state-action">
          <button onClick={onRetry}>Try again</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Apply it in PhotosPage**

In `frontend/src/pages/PhotosPage.tsx`, change the import on line 10 to include `ErrorState`:

```tsx
import { EmptyState, ErrorState, Spinner } from "../components/ui";
```

and change the loading branch (around line 48) so an error renders `ErrorState`:

```tsx
        {mediaQuery.isError ? (
          <ErrorState hint="Couldn't load photos." onRetry={() => mediaQuery.refetch()} />
        ) : mediaQuery.isLoading ? (
          <Spinner label="Loading photos…" />
        ) : items.length === 0 ? (
```

- [ ] **Step 5: Apply the same pattern to the other module pages**

Read each of these files and add an `isError` branch (rendering `<ErrorState hint="…" onRetry={() => <thatQuery>.refetch()} />`) ahead of the existing loading/empty branch, importing `ErrorState` from `../components/ui`. Mirror the PhotosPage edit exactly:
- `frontend/src/pages/PeoplePage.tsx`
- `frontend/src/pages/DocumentsPage.tsx`
- `frontend/src/pages/PlanningPage.tsx`
- `frontend/src/pages/PackingPage.tsx`

For each, find its primary `useQuery`/`useInfiniteQuery`, and where it currently branches on `isLoading`, add the leading `isError` branch. If a page has no loading branch (renders immediately), skip it and note that in your task report.

- [ ] **Step 6: Run the tests**

Run: `npm test -- ui.test PhotosPage`
Expected: PASS. (Existing page tests must still pass — run `npm test` if unsure.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui.tsx frontend/src/components/ui.test.tsx frontend/src/pages/PhotosPage.tsx frontend/src/pages/PeoplePage.tsx frontend/src/pages/DocumentsPage.tsx frontend/src/pages/PlanningPage.tsx frontend/src/pages/PackingPage.tsx
git commit -m "feat(ui): shared ErrorState across module pages"
```

---

### Task 3: `CommandPalette` component

**Files:**
- Create: `frontend/src/shell/CommandPalette.tsx`
- Modify: `frontend/src/styles/global.css` (palette styles)
- Test: `frontend/src/shell/CommandPalette.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shell/CommandPalette.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";

const nav = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<any>()), useNavigate: () => nav }));
const h = vi.hoisted(() => ({
  search: vi.fn(async () => ({
    people: [], visits: [], photos: [], documents: [],
    trips: [{ type: "trip", id: "t1", label: "Venice Trip", thumbUrl: null, to: "/planning?trip=t1" }],
  })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { CommandPalette } from "./CommandPalette";

test("typing searches and selecting a hit navigates", async () => {
  render(withQC(<MemoryRouter><CommandPalette open onClose={() => {}} /></MemoryRouter>));
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Venice" } });
  fireEvent.click(await screen.findByText("Venice Trip"));
  await waitFor(() => expect(nav).toHaveBeenCalledWith("/planning?trip=t1"));
});

test("renders nothing when closed", () => {
  const { container } = render(withQC(<MemoryRouter><CommandPalette open={false} onClose={() => {}} /></MemoryRouter>));
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- CommandPalette`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/shell/CommandPalette.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type SearchResults } from "../api/client";

const GROUPS: Array<{ key: keyof SearchResults; label: string }> = [
  { key: "people", label: "People" },
  { key: "trips", label: "Trips" },
  { key: "visits", label: "Visits" },
  { key: "photos", label: "Photos" },
  { key: "documents", label: "Documents" },
];
const EMPTY: SearchResults = { people: [], trips: [], visits: [], photos: [], documents: [] };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { data = EMPTY } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: q.trim().length > 0,
  });
  if (!open) return null;

  const go = (to: string) => { onClose(); setQ(""); nav(to); };
  const total = GROUPS.reduce((n, g) => n + data[g.key].length, 0);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Search people, trips, photos, documents…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        />
        <div className="palette-results">
          {q.trim().length === 0 && <div className="er-sub palette-hint">Type to search across everything.</div>}
          {q.trim().length > 0 && total === 0 && <div className="er-sub palette-hint">No matches.</div>}
          {GROUPS.map((g) =>
            data[g.key].length > 0 ? (
              <div key={g.key} className="palette-group">
                <div className="palette-group-label">{g.label}</div>
                {data[g.key].map((hit) => (
                  <button key={hit.id} className="palette-hit" onClick={() => go(hit.to)}>
                    {hit.thumbUrl ? (
                      <img src={hit.thumbUrl} alt="" className="palette-thumb" />
                    ) : (
                      <span className="palette-thumb placeholder" aria-hidden="true" />
                    )}
                    <span>{hit.label}</span>
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add palette styles**

Append to `frontend/src/styles/global.css`:

```css
.palette-backdrop { position: fixed; inset: 0; background: rgba(2,6,23,.55); display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; z-index: 1000; }
.palette { width: min(560px, 92vw); background: #0f172a; border: 1px solid #334155; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.6); overflow: hidden; }
.palette-input { width: 100%; border: 0; border-bottom: 1px solid #1e293b; background: transparent; color: inherit; padding: 14px 16px; font-size: 16px; outline: none; box-sizing: border-box; }
.palette-results { max-height: 56vh; overflow: auto; }
.palette-hint { padding: 12px 16px; }
.palette-group-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; padding: 8px 16px 2px; }
.palette-hit { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: transparent; border: 0; color: inherit; padding: 8px 16px; cursor: pointer; }
.palette-hit:hover { background: #1e293b; }
.palette-thumb { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; flex: 0 0 auto; }
.palette-thumb.placeholder { background: #1e293b; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- CommandPalette`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shell/CommandPalette.tsx frontend/src/shell/CommandPalette.test.tsx frontend/src/styles/global.css
git commit -m "feat(search): CommandPalette overlay"
```

---

### Task 4: `ShareButton` component

**Files:**
- Create: `frontend/src/components/shared/ShareButton.tsx`
- Test: `frontend/src/components/shared/ShareButton.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shared/ShareButton.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  listShares: vi.fn(async () => []),
  createShare: vi.fn(async () => ({ id: "s1", token: "abcdefghijabcdefghij", targetType: "trip", targetId: "t1", createdAt: "" })),
  deleteShare: vi.fn(async () => {}),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { ShareButton } from "./ShareButton";

test("opens, creates a link, and shows the public URL", async () => {
  render(<ShareButton targetType="trip" targetId="t1" label="Share" />);
  fireEvent.click(screen.getByText(/Share/));
  fireEvent.click(await screen.findByText("+ Create link"));
  await waitFor(() => expect(h.createShare).toHaveBeenCalledWith("trip", "t1"));
  expect(await screen.findByText(/\/s\/abcdefghijabcdefghij/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- ShareButton`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/shared/ShareButton.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type ShareLink, type ShareTargetType } from "../../api/client";

export function ShareButton({
  targetType,
  targetId,
  label,
}: {
  targetType: ShareTargetType;
  targetId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (open) api.listShares(targetType, targetId).then(setShares).catch(() => {});
  }, [open, targetType, targetId]);

  const urlFor = (token: string) => `${window.location.origin}/s/${token}`;

  async function create() {
    const link = await api.createShare(targetType, targetId);
    setShares((prev) => [link, ...prev]);
  }
  async function revoke(id: string) {
    await api.deleteShare(id);
    setShares((prev) => prev.filter((s) => s.id !== id));
  }
  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(urlFor(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* manual copy fallback */ }
  }

  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)}>🔗 {label}</button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Share — read-only link</h2>
            {shares.length === 0 && <div className="er-sub">No share links yet.</div>}
            {shares.map((s) => (
              <div key={s.id} className="item-row">
                <div className="sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{urlFor(s.token)}</div>
                <button className="ghost" onClick={() => copy(s.token)}>{copied === s.token ? "✓" : "Copy"}</button>
                <button className="ghost" onClick={() => revoke(s.id)}>Revoke</button>
              </div>
            ))}
            <button onClick={create} style={{ marginTop: 6 }}>+ Create link</button>
            <div className="modal-actions"><button className="primary" onClick={() => setOpen(false)}>Done</button></div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- ShareButton`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/ShareButton.tsx frontend/src/components/shared/ShareButton.test.tsx
git commit -m "feat(share): reusable ShareButton for trip/album targets"
```

---

### Task 5: Wire sharing into TripDetail (trip) and PhotosPage (album)

**Files:**
- Modify: `frontend/src/components/planning/TripDetail.tsx`
- Modify: `frontend/src/components/planning/TripDetail.test.tsx` (extend the mock)
- Modify: `frontend/src/pages/PhotosPage.tsx`
- Test: reuse the existing TripDetail test + a new PhotosPage album test

- [ ] **Step 1: Extend the TripDetail test mock and assert the Share button**

In `frontend/src/components/planning/TripDetail.test.tsx`, add these three keys to the `vi.hoisted` object (so the new `ShareButton` import resolves):

```ts
  listShares: vi.fn(async () => []), createShare: vi.fn(), deleteShare: vi.fn(),
```

Then add a test at the end:

```tsx
test("offers a Share action for the trip", async () => {
  render(withQC(<TripDetail trip={trip} onClose={() => {}} onChanged={() => {}} />));
  expect(await screen.findByText(/Share/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- TripDetail`
Expected: FAIL — no "Share" control yet.

- [ ] **Step 3: Add the Share button to TripDetail**

In `frontend/src/components/planning/TripDetail.tsx`, add the import:

```tsx
import { ShareButton } from "../shared/ShareButton";
```

and in the header row (around line 43–49), add the share button before the status `<select>`:

```tsx
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ flex: 1 }}>{trip.name}</h2>
          <ShareButton targetType="trip" targetId={trip.id} label="Share" />
          <select value={trip.status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="ghost" aria-label="Close" onClick={onClose}>✕</button>
        </div>
```

- [ ] **Step 4: Run the TripDetail test to verify it passes**

Run: `npm test -- TripDetail`
Expected: PASS (existing + new test).

- [ ] **Step 5: Add an album Share button to PhotosPage and test it**

Create `frontend/src/pages/PhotosPage.album.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({
  listTrips: vi.fn(async () => [{ id: "t1", name: "Italy", status: "planning", startDate: null, endDate: null, color: "#2563eb", description: "" }]),
  listMedia: vi.fn(async () => ({ items: [], nextCursor: null })),
  listShares: vi.fn(async () => []), createShare: vi.fn(), deleteShare: vi.fn(),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { PhotosPage } from "./PhotosPage";

test("shows a 'Share album' action only when filtered to a trip", async () => {
  const { rerender } = render(withQC(<PhotosPage />));
  // no trip filter → no album share
  expect(screen.queryByText(/Share album/)).not.toBeInTheDocument();
  rerender(withQC(<PhotosPage initialTrip="t1" />));
  expect(await screen.findByText(/Share album/)).toBeInTheDocument();
});
```

Then update `frontend/src/pages/PhotosPage.tsx`:

Add the import:

```tsx
import { ShareButton } from "../components/shared/ShareButton";
```

Accept an optional `initialTrip` prop and seed the filter with it (change the signature + the `filters` state):

```tsx
export function PhotosPage({ initialTrip }: { initialTrip?: string } = {}) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<MediaFilters>(initialTrip ? { trip: initialTrip } : {});
```

and in the header (around line 40, after the `<MediaUploader .../>`), add an album share button shown only when a trip filter is active:

```tsx
        {filters.trip && <ShareButton targetType="album" targetId={filters.trip} label="Share album" />}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- PhotosPage TripDetail`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/planning/TripDetail.tsx frontend/src/components/planning/TripDetail.test.tsx frontend/src/pages/PhotosPage.tsx frontend/src/pages/PhotosPage.album.test.tsx
git commit -m "feat(share): trip share in TripDetail, album share in Photos"
```

---

### Task 6: Retire map-set sharing in MapSetEditor

**Files:**
- Modify: `frontend/src/components/MapSetEditor.tsx`
- Test: `frontend/src/components/MapSetEditor.share-removed.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/MapSetEditor.share-removed.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  updateMapSet: vi.fn(), createMapSet: vi.fn(), deleteMapSet: vi.fn(), importFile: vi.fn(), uploadImage: vi.fn(),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
vi.mock("./Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { MapSetEditor } from "./MapSetEditor";

const mapSet = { id: "m1", name: "Trips", description: "", baseKind: "vector", styleUrl: null, overlayUrl: null, overlayBounds: null, defaultLng: 0, defaultLat: 0, defaultZoom: 2, createdAt: "" } as any;

test("no longer offers a map share link", () => {
  render(<MapSetEditor mapSet={mapSet} onClose={() => {}} onSaved={() => {}} onDeleted={() => {}} onImported={() => {}} />);
  expect(screen.queryByText(/Create share link/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Share \(read-only/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- MapSetEditor.share-removed`
Expected: FAIL — the share section still renders.

- [ ] **Step 3: Remove the map share code**

In `frontend/src/components/MapSetEditor.tsx`:

1. Change the import on line 2 to drop `ShareLink`:
   ```tsx
   import { api, type MapSet } from "../api/client";
   ```
2. Delete the share state (lines 17–18): the `shares` and `copied` `useState` lines.
3. Delete the `useEffect` that calls `api.listShares` (lines 20–22).
4. Delete the `shareUrl`, `createShare`, `revokeShare`, and `copyShare` functions (lines 24–54).
5. Delete the entire `<div className="section-title"><span>Share (read-only links)</span></div>` block through the `+ Create share link` button (lines 206–219).

Leave the rest (name/description/base map/import) untouched.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- MapSetEditor`
Expected: PASS (and any existing MapSetEditor tests still pass).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MapSetEditor.tsx frontend/src/components/MapSetEditor.share-removed.test.tsx
git commit -m "feat(share): retire map-set sharing UI"
```

---

### Task 7: Rewrite `ShareView` for trip + album payloads

**Files:**
- Modify: `frontend/src/pages/ShareView.tsx`
- Test: `frontend/src/pages/ShareView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/ShareView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  getShare: vi.fn(async () => ({
    targetType: "album",
    trip: { id: "t1", name: "Italy 2024", description: "", color: "#2563eb", startDate: null, endDate: null },
    photos: [{ id: "p1", url: "/api/files/x?sig=1", thumbUrl: null, mediaType: "image", caption: "Canal", seq: 0 }],
  })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { ShareView } from "./ShareView";

test("renders a shared album gallery", async () => {
  render(
    <MemoryRouter initialEntries={["/s/tok"]}>
      <Routes><Route path="/s/:token" element={<ShareView />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText("Italy 2024")).toBeInTheDocument();
  expect(await screen.findByText(/read-only/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- ShareView`
Expected: FAIL — current ShareView expects the old map payload (`data.mapSet`), so it throws / shows the error state.

- [ ] **Step 3: Rewrite ShareView**

Replace the entire contents of `frontend/src/pages/ShareView.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Item, type MapSet, type SharePayload, type SharedPhoto, type Theme } from "../api/client";
import { resolveItemStyle } from "../lib/style";
import { MapView } from "../components/MapView";
import { EmptyState, Spinner } from "../components/ui";

const NO_THEMES = new Map<string, Theme>();
const noop = () => {};

function PhotoWall({ photos }: { photos: SharedPhoto[] }) {
  if (photos.length === 0) return <EmptyState emoji="🖼️" title="No photos in this album" />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8, padding: 16, overflow: "auto" }}>
      {photos.map((p) => (
        <figure key={p.id} style={{ margin: 0 }}>
          <img src={p.thumbUrl ?? p.url} alt={p.caption} style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 8 }} />
          {p.caption && <figcaption className="er-sub">{p.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

export function ShareView() {
  const { token = "" } = useParams<{ token: string }>();
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getShare(token).then(setData).catch(() => setError("This shared link is unavailable or was revoked."));
  }, [token]);

  if (error) return <EmptyState emoji="🔌" title="Unavailable" hint={error} />;
  if (!data) return <Spinner label="Loading…" />;

  const header = (
    <header className="app-header">
      <span className="brand">{data.targetType === "album" ? "🖼️" : "🗺️"} {data.trip.name}</span>
      <span className="who">shared {data.targetType} · read-only</span>
      <span className="spacer" />
    </header>
  );

  if (data.targetType === "album") {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
        {header}
        <div style={{ flex: 1, overflow: "auto" }}><PhotoWall photos={data.photos} /></div>
      </div>
    );
  }

  // trip share — render the visits on a map
  const mapSet: MapSet = {
    id: "shared", name: data.trip.name, description: data.trip.description, baseKind: "vector",
    styleUrl: null, overlayUrl: null, overlayBounds: null, defaultLng: 0, defaultLat: 20, defaultZoom: 2, createdAt: "",
  };
  const items: Item[] = data.visits.map((v) => ({
    id: v.id, mapSetId: "shared", kind: v.kind, title: v.title, notes: v.notes, themeId: null, tripId: data.trip.id,
    color: v.color, icon: v.icon, occurredOn: v.occurredOn, geometry: v.geometry, waypoints: [], photos: v.photos,
    createdBy: null, createdByName: null, createdAt: "",
  }));

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {header}
      <div style={{ position: "relative", flex: 1 }}>
        <MapView
          mapSet={mapSet}
          items={items}
          selectedItemId={null}
          getStyle={(item) => resolveItemStyle(item, NO_THEMES)}
          pickMode={false}
          editMode={false}
          onPick={noop}
          onSelectItem={noop}
          onMovePoint={noop}
          onMoveWaypoint={noop}
        />
      </div>
      {data.photos.length > 0 && (
        <div style={{ maxHeight: "32vh", overflow: "auto", borderTop: "1px solid #1e293b" }}>
          <PhotoWall photos={data.photos} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- ShareView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ShareView.tsx frontend/src/pages/ShareView.test.tsx
git commit -m "feat(share): public ShareView for trip + album"
```

---

### Task 8: Settings page (backup & restore)

**Files:**
- Create: `frontend/src/pages/SettingsPage.tsx`
- Test: `frontend/src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/SettingsPage.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  downloadBackup: vi.fn(async () => new Blob(["x"])),
  restoreBackup: vi.fn(async () => ({ ok: true, counts: { trips: 2 } })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { role: "owner" } }) }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { SettingsPage } from "./SettingsPage";

beforeAll(() => {
  // jsdom lacks object URLs
  (URL as any).createObjectURL = vi.fn(() => "blob:x");
  (URL as any).revokeObjectURL = vi.fn();
});

test("downloads a backup", async () => {
  render(<SettingsPage />);
  fireEvent.click(screen.getByText(/Download backup/));
  await waitFor(() => expect(h.downloadBackup).toHaveBeenCalled());
});

test("restore stays disabled until 'restore' is typed", async () => {
  render(<SettingsPage />);
  const file = new File(["x"], "b.tar.gz");
  fireEvent.change(screen.getByLabelText(/restore archive/i), { target: { files: [file] } });
  const btn = screen.getByText(/Restore & replace/) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText("restore"), { target: { value: "restore" } });
  expect((screen.getByText(/Restore & replace/) as HTMLButtonElement).disabled).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- SettingsPage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Create `frontend/src/pages/SettingsPage.tsx`:

```tsx
import { useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";

export function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isOwner = user?.role === "owner";
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<File | null>(null);

  async function download() {
    setBusy(true);
    try {
      const blob = await api.downloadBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "werejugo-backup.tar.gz";
      a.click();
      URL.revokeObjectURL(url);
      toast("Backup downloaded", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Backup failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!fileRef.current) return;
    setBusy(true);
    try {
      const { counts } = await api.restoreBackup(fileRef.current);
      const n = Object.values(counts).reduce((a, b) => a + b, 0);
      toast(`Restored ${n} rows`, "success");
      setConfirm("");
      setFileName("");
      fileRef.current = null;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Restore failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header"><span className="brand">⚙️ Settings</span></header>
      <div style={{ padding: 16, maxWidth: 560 }}>
        <div className="section-title"><span>Backup</span></div>
        <p className="er-sub">Download your entire hub — database and all photo/document files — as one archive.</p>
        <button className="primary" disabled={busy} onClick={download}>⬇ Download backup</button>

        {isOwner && (
          <>
            <div className="section-title" style={{ marginTop: 20 }}><span>Restore</span></div>
            <p className="er-sub">Replaces <strong>all</strong> current data with the uploaded archive. This cannot be undone.</p>
            <label className="er-sub" htmlFor="restore-file">Restore archive (.tar.gz)</label>
            <input
              id="restore-file"
              type="file"
              accept=".gz,.tgz,application/gzip"
              onChange={(e) => { fileRef.current = e.target.files?.[0] ?? null; setFileName(e.target.files?.[0]?.name ?? ""); }}
            />
            {fileName && (
              <div style={{ marginTop: 8 }}>
                <label className="er-sub">Type <code>restore</code> to confirm:</label>{" "}
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="restore" />
                <button className="danger" disabled={busy || confirm !== "restore"} onClick={restore} style={{ marginLeft: 8 }}>
                  Restore &amp; replace
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- SettingsPage`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx frontend/src/pages/SettingsPage.test.tsx
git commit -m "feat(settings): backup download + owner-only restore page"
```

---

### Task 9: First-run welcome

**Files:**
- Create: `frontend/src/shell/FirstRunWelcome.tsx`
- Modify: `frontend/src/styles/global.css`
- Test: `frontend/src/shell/FirstRunWelcome.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shell/FirstRunWelcome.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({ getStats: vi.fn(async () => ({ items: 0, photos: 0, trips: 0, firstDate: null, lastDate: null, countByKind: {}, distanceMetersByKind: {}, totalDistanceMeters: 0 })) }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { FirstRunWelcome } from "./FirstRunWelcome";

test("welcomes a brand-new, empty hub", async () => {
  render(withQC(<MemoryRouter><FirstRunWelcome /></MemoryRouter>));
  expect(await screen.findByText(/Welcome to Werejugo/)).toBeInTheDocument();
});

test("renders nothing once there is data", async () => {
  h.getStats.mockResolvedValueOnce({ items: 3, photos: 0, trips: 1, firstDate: null, lastDate: null, countByKind: {}, distanceMetersByKind: {}, totalDistanceMeters: 0 });
  const { container } = render(withQC(<MemoryRouter><FirstRunWelcome /></MemoryRouter>));
  // allow the query to resolve
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector(".first-run")).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- FirstRunWelcome`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/shell/FirstRunWelcome.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/ui";

export function FirstRunWelcome() {
  const { data } = useQuery({ queryKey: ["first-run-stats"], queryFn: () => api.getStats("") });
  if (!data) return null;
  if (data.items > 0 || data.photos > 0 || data.trips > 0) return null;
  return (
    <div className="first-run">
      <EmptyState
        emoji="👋"
        title="Welcome to Werejugo"
        hint="Your family travel hub is empty. Start by adding people, creating a trip, or dropping in photos."
      />
      <div className="first-run-actions">
        <Link className="first-run-cta" to="/people">＋ Add people</Link>
        <Link className="first-run-cta" to="/planning">＋ Create a trip</Link>
        <Link className="first-run-cta" to="/photos">＋ Add photos</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add styles**

Append to `frontend/src/styles/global.css`:

```css
.first-run { position: absolute; inset: 0; z-index: 50; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #0b1220; }
.first-run-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.first-run-cta { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 8px 14px; color: inherit; text-decoration: none; }
.first-run-cta:hover { background: #334155; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- FirstRunWelcome`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shell/FirstRunWelcome.tsx frontend/src/shell/FirstRunWelcome.test.tsx frontend/src/styles/global.css
git commit -m "feat(onboarding): first-run welcome for an empty hub"
```

---

### Task 10: Shell wiring — palette, search/settings rail, routes, welcome

**Files:**
- Modify: `frontend/src/shell/Rail.tsx`
- Modify: `frontend/src/shell/AppShell.tsx`
- Test: `frontend/src/shell/Rail.search.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shell/Rail.search.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { Rail } from "./Rail";

test("the search button calls onSearch", () => {
  const onSearch = vi.fn();
  render(<MemoryRouter><Rail onSignOut={() => {}} onSearch={onSearch} /></MemoryRouter>);
  fireEvent.click(screen.getByText("Search"));
  expect(onSearch).toHaveBeenCalled();
});

test("offers a Settings link", () => {
  render(<MemoryRouter><Rail onSignOut={() => {}} /></MemoryRouter>);
  expect(screen.getByText("Settings").closest("a")).toHaveAttribute("href", "/settings");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- Rail.search`
Expected: FAIL — no Search button / Settings link.

- [ ] **Step 3: Update the Rail**

Replace the contents of `frontend/src/shell/Rail.tsx` with:

```tsx
import { NavLink } from "react-router-dom";
import { MODULES } from "./modules";

export function Rail({
  onSignOut,
  onSearch = () => {},
  badges = {},
}: {
  onSignOut: () => void;
  onSearch?: () => void;
  badges?: Record<string, number>;
}) {
  return (
    <nav className="rail" aria-label="Modules">
      <button className="rail-item" onClick={onSearch} title="Search (Ctrl/Cmd-K)">
        <span className="rail-icon" aria-hidden="true">🔍</span>
        <span>Search</span>
      </button>
      {MODULES.map((m) =>
        m.enabled ? (
          <NavLink
            key={m.key}
            to={m.path}
            className={({ isActive }) => `rail-item${isActive ? " active" : ""}`}
            title={m.label}
          >
            <span className="rail-icon" aria-hidden="true">{m.icon}</span>
            {badges[m.key] > 0 && <span className="rail-badge">{badges[m.key]}</span>}
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
      <NavLink to="/settings" className={({ isActive }) => `rail-item${isActive ? " active" : ""}`} title="Settings">
        <span className="rail-icon" aria-hidden="true">⚙️</span>
        <span>Settings</span>
      </NavLink>
      <button className="rail-item" onClick={onSignOut} title="Sign out">
        <span className="rail-icon" aria-hidden="true">🚪</span>
        <span>Out</span>
      </button>
    </nav>
  );
}
```

- [ ] **Step 4: Wire AppShell**

Replace the contents of `frontend/src/shell/AppShell.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../api/client";
import { MapPage } from "../pages/MapPage";
import { PeoplePage } from "../pages/PeoplePage";
import { PhotosPage } from "../pages/PhotosPage";
import { DocumentsPage } from "../pages/DocumentsPage";
import { PlanningPage } from "../pages/PlanningPage";
import { PackingPage } from "../pages/PackingPage";
import { SettingsPage } from "../pages/SettingsPage";
import { Rail } from "./Rail";
import { ComingSoon } from "./ComingSoon";
import { CommandPalette } from "./CommandPalette";
import { FirstRunWelcome } from "./FirstRunWelcome";
import { MODULES } from "./modules";

export function AppShell() {
  const { logout } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: dueCount } = useQuery({ queryKey: ["documents-due-count"], queryFn: api.documentsDueCount });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="shell">
      <Rail onSignOut={logout} onSearch={() => setSearchOpen(true)} badges={{ documents: dueCount?.count ?? 0 }} />
      <div className="shell-main">
        <FirstRunWelcome />
        <Routes>
          <Route path="/" element={<Navigate to="/map" replace />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/photos" element={<PhotosPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/packing" element={<PackingPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {MODULES.filter((m) => !m.enabled).map((m) => (
            <Route key={m.key} path={m.path} element={<ComingSoon label={m.label} />} />
          ))}
          <Route path="*" element={<Navigate to="/map" replace />} />
        </Routes>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- Rail`
Expected: PASS (the new search/settings tests **and** the existing `Rail.test.tsx` / `Rail.search.test.tsx`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shell/Rail.tsx frontend/src/shell/AppShell.tsx frontend/src/shell/Rail.search.test.tsx
git commit -m "feat(shell): command palette, search/settings rail, first-run mount"
```

---

### Task 11: README + full verification gate

**Files:**
- Create: `README.md` (repo root)
- Test: the full frontend gate

- [ ] **Step 1: Write the README**

Create `README.md` at the repo root:

```markdown
# Werejugo

A self-hosted family travel scrapbook: map everywhere you've been, keep a searchable photo library tied to trips/places/people, track travel documents and renewals, plan future trips with itineraries and packing lists, search across everything, share selected trips and albums read-only, and back the whole thing up.

## Stack

- **Backend:** Fastify 5 + PostgreSQL 16 / PostGIS, `pg`, `@fastify/jwt`, `zod`, `sharp`.
- **Frontend:** React 18 + Vite + MapLibre GL + React Query + React Router.
- **Storage:** files live on disk in a browsable tree; only metadata + relative paths in the DB.

## Running with Docker

```bash
docker compose up --build
```

The app is served on the configured port (see `docker-compose.yml`). On first boot the database migrates and seeds reference data (airports/ports), built-in map themes, and built-in packing templates.

## Local development (without Docker)

You need a local PostgreSQL 16 with PostGIS. Set `UPLOADS_DIR` and `STORAGE_DIR` to writable paths or the backend will refuse to boot.

```bash
# backend
cd backend
cp .env.example .env   # if present; otherwise set the vars below
npm install
npm run migrate
npm run seed
npm run dev

# frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### Key environment variables

| Var | Purpose | Default |
|-----|---------|---------|
| `DATABASE_URL` | Postgres connection string | `postgres://werejugo:change-me-in-production@localhost:5432/werejugo` |
| `JWT_SECRET` | Token signing secret — **change in production** | dev placeholder |
| `STORAGE_DIR` | Root of the file storage tree | `/app/storage` |
| `UPLOADS_DIR` | Temp upload dir | `/app/uploads` |
| `CORS_ORIGIN` | Allowed origins (comma-separated) | `http://localhost:8080` |

## Modules

Map · People · Photos · Documents · Planning · Packing — all views over one shared core (Person, Visit, Trip, Media, Document) connected by a universal links table. A global search (Ctrl/Cmd-K) jumps to anything.

## Sharing

Trips and photo albums can be shared as public, read-only links (`/s/<token>`) — no login required. Maps and documents are not shareable.

## Backup & restore

**Settings → Backup** downloads your entire hub — database **and** all files — as a single `.tar.gz`. An owner can restore an archive from the same page; restore **replaces all current data** and is guarded by a typed confirmation. The archive is a plain gzipped tar (a JSON table dump under `db.json` plus a `storage/` tree), so it is also restorable by hand.

## Tests

```bash
cd backend && npm test     # Vitest against a real werejugo_test database
cd frontend && npm test    # Vitest + Testing Library
```
```

- [ ] **Step 2: Run the full frontend gate**

Run, in order:
```bash
npm test
npm run typecheck
npm run build
```
Expected: all suites PASS; typecheck clean; build succeeds.

> If typecheck flags a leftover reference to the old `SharePayload.mapSet` or old `createShare(id)` signature, it means a Task 6/7 edit was missed — fix it before committing.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: project README (setup, sharing, backup/restore)"
```

---

## Self-review notes (for the executor)

- **Task ordering matters:** the API client change in Task 1 deliberately breaks `MapSetEditor` (Task 6) and `ShareView` (Task 7) at the type level. Don't run `npm run typecheck` until Tasks 6 and 7 are done; per-task `npm test -- <name>` still works because tests mock the API.
- **`PhotosPage` signature change** (Task 5) adds an optional prop with a default, so the existing `<Route ... element={<PhotosPage />} />` and existing PhotosPage tests keep working.
- **`Rail` `onSearch`** is optional (defaults to a no-op) so the existing `Rail.test.tsx` (which renders `<Rail onSignOut={...} />`) still passes — but it now needs a router ancestor because of the Settings `NavLink`; the existing test already wraps in `MemoryRouter`. Confirm; if not, wrap it.
- Keep author/reviewer passes separate: after all tasks, the full gate (`npm test && npm run typecheck && npm run build`) is the completion evidence.
```
