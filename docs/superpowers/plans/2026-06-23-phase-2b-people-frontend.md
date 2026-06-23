# Phase 2B — People Module & Shared Components (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five reusable shared UI components (`MediaUploader`, `EntityPicker`, `RelatedPanel`, `EntityList`, `EntityDetail`) and the People module page on top of them, then enable the People rail entry — consuming the Plan 2A endpoints.

**Architecture:** Generic, entity-agnostic components live in `frontend/src/components/shared/`. They talk to the backend through new generic `api` methods (people, relations, entity-search, media upload, links). The People page composes `EntityList` (people) + `EntityDetail` (a person) + `RelatedPanel` (their linked visits/trips/photos) + `MediaUploader` (avatar). Data fetching uses `@tanstack/react-query` (already in the app); components call the `api` object directly, matching the existing pattern.

**Tech Stack:** React 18 + Vite, `@tanstack/react-query`, `react-router-dom` v6. Tests: Vitest + @testing-library/react (set up in Plan 1B) with the `api` module mocked.

**Depends on:** Plan 2A (endpoints) implemented first. Reuses Phase-1 `api` infrastructure (`request`, `API_URL`, signed media URLs).

**Scope note:** This is **Plan 2B** of Phase 2 and completes the phase. The components are built generic but shaped by their first real consumer (People), per the spec.

---

## Conventions (apply to every task)

- All commands run from `frontend/`.
- Component tests mock the `api` module: `vi.mock("../../api/client", () => ({ API_URL: "", api: { ... } }))`. The mock only needs the runtime exports the component uses (`api`, `API_URL`); types are erased.
- react-query components are wrapped in a fresh `QueryClientProvider` in tests (helper below).
- Commit after each task with the message in its final step.

**Test wrapper helper** (used by several tests) — create `frontend/src/test/qc.tsx` in Task 2:
```tsx
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
export function withQC(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}
```

---

## File Structure

**New files:**
- `frontend/src/test/qc.tsx` — test wrapper.
- `frontend/src/components/shared/MediaUploader.tsx`
- `frontend/src/components/shared/EntityPicker.tsx`
- `frontend/src/components/shared/RelatedPanel.tsx`
- `frontend/src/components/shared/EntityList.tsx`
- `frontend/src/components/shared/EntityDetail.tsx`
- `frontend/src/components/shared/EntityThumb.tsx` — tiny shared thumb/avatar renderer.
- `frontend/src/pages/PeoplePage.tsx`
- `frontend/src/components/people/PersonForm.tsx`

**Modified files:**
- `frontend/src/api/client.ts` — add types + generic methods.
- `frontend/src/shell/modules.ts` — enable People.
- `frontend/src/shell/AppShell.tsx` — add the `/people` route.
- `frontend/src/styles/global.css` — a few shared-component styles.

---

## Task 1: API client — types & generic methods

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/people.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/people.test.ts`:
```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (url.includes("/api/media")) return jsonRes({ id: "m1", kind: "image", url: "/api/files/x?sig=1", thumbUrl: null, caption: "" });
    if (opts.method === "GET") return jsonRes([]);
    return jsonRes({ id: "x" });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function jsonRes(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("createPerson POSTs to /api/people", async () => {
  await api.createPerson({ displayName: "Mom" });
  expect(calls[0].url).toContain("/api/people");
  expect(calls[0].method).toBe("POST");
});

test("getRelations encodes the entity ref", async () => {
  await api.getRelations("person:abc");
  expect(calls[0].url).toContain("/api/relations?entity=person%3Aabc");
});

test("searchEntities passes type and query", async () => {
  await api.searchEntities("visit", "eiffel");
  expect(calls[0].url).toContain("/api/entities/search?type=visit&q=eiffel");
});

test("uploadMedia posts multipart and createLink posts a link", async () => {
  const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
  const m = await api.uploadMedia(file);
  expect(m.id).toBe("m1");
  expect(calls[0].url).toContain("/api/media");
  await api.createLink("media:m1", "person:p1", "shows");
  expect(JSON.parse(calls[1].body)).toMatchObject({ from: "media:m1", to: "person:p1", role: "shows" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/api/people.test.ts`
Expected: FAIL (methods undefined).

- [ ] **Step 3: Add types and methods to `client.ts`**

(a) Near the other type exports, add:
```ts
export type CoreType = "visit" | "trip" | "person" | "media" | "document";

export interface Person {
  id: string;
  displayName: string;
  relationship: string;
  notes: string;
  userId: string | null;
  avatarMediaId: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface PersonInput {
  displayName?: string;
  relationship?: string;
  notes?: string;
  userId?: string | null;
  avatarMediaId?: string | null;
}

export interface FamilyMember { id: string; displayName: string; email: string; color: string; }

export interface EntitySummary {
  type: CoreType; id: string; label: string; subtitle?: string | null; thumbUrl: string | null;
}

export interface Relation { linkId: string; role: string; entity: EntitySummary; }

export interface MediaDto { id: string; kind: MediaType; url: string; thumbUrl: string | null; caption: string; }
```

(b) Inside the `api` object (e.g. after the `// stats` block), add:
```ts
  // people
  listPeople: () => request<Person[]>("/api/people"),
  getPerson: (id: string) => request<Person>(`/api/people/${id}`),
  createPerson: (data: PersonInput) => request<Person>("/api/people", { method: "POST", body: body(data) }),
  updatePerson: (id: string, data: PersonInput) =>
    request<Person>(`/api/people/${id}`, { method: "PATCH", body: body(data) }),
  deletePerson: (id: string) => request<void>(`/api/people/${id}`, { method: "DELETE" }),
  listFamilyMembers: () => request<FamilyMember[]>("/api/family-members"),

  // entity graph
  getRelations: (entity: string) =>
    request<Relation[]>(`/api/relations?entity=${encodeURIComponent(entity)}`),
  searchEntities: (type: CoreType, q: string) =>
    request<EntitySummary[]>(`/api/entities/search?type=${type}&q=${encodeURIComponent(q)}`),

  // generic media + links
  uploadMedia: (file: File, caption = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("caption", caption);
    return request<MediaDto>("/api/media", { method: "POST", body: fd });
  },
  createLink: (from: string, to: string, role = "") =>
    request<{ id: string }>("/api/links", { method: "POST", body: body({ from, to, role }) }),
  deleteLink: (id: string) => request<void>(`/api/links/${id}`, { method: "DELETE" }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/api/people.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/people.test.ts
git commit -m "feat(api): people, relations, entity-search, media & link client methods"
```

---

## Task 2: EntityThumb + test wrapper + shared styles

**Files:**
- Create: `frontend/src/test/qc.tsx`, `frontend/src/components/shared/EntityThumb.tsx`
- Modify: `frontend/src/styles/global.css`
- Test: `frontend/src/components/shared/EntityThumb.test.tsx`

- [ ] **Step 1: Create the test wrapper**

Create `frontend/src/test/qc.tsx` with the `withQC` helper shown in the Conventions section above.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/shared/EntityThumb.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "" }));
import { EntityThumb } from "./EntityThumb";

test("renders an image when a thumbUrl is given", () => {
  render(<EntityThumb thumbUrl="/api/files/x?sig=1" label="Mom" />);
  expect(screen.getByRole("img")).toHaveAttribute("src", "/api/files/x?sig=1");
});

test("falls back to an initial when no thumbUrl", () => {
  render(<EntityThumb thumbUrl={null} label="Grandma" />);
  expect(screen.getByText("G")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/shared/EntityThumb.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `EntityThumb`**

Create `frontend/src/components/shared/EntityThumb.tsx`:
```tsx
import { API_URL } from "../../api/client";

/** Small square thumb/avatar: the image if available, else the label's initial. */
export function EntityThumb({ thumbUrl, label, size = 36 }: { thumbUrl: string | null; label: string; size?: number }) {
  if (thumbUrl) {
    return (
      <img
        className="entity-thumb"
        src={`${API_URL}${thumbUrl}`}
        alt={label}
        loading="lazy"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span className="entity-thumb entity-thumb-fallback" style={{ width: size, height: size }} aria-hidden="true">
      {(label.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
```

- [ ] **Step 5: Add styles**

Append to `frontend/src/styles/global.css`:
```css
/* --- Shared entity components --- */
.entity-thumb { border-radius: 6px; object-fit: cover; flex: 0 0 auto; background: #1e293b; }
.entity-thumb-fallback { display: inline-flex; align-items: center; justify-content: center; color: #94a3b8; font-weight: 700; }
.entity-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
.entity-row:hover { background: #1e293b; }
.entity-row .er-main { flex: 1; min-width: 0; }
.entity-row .er-title { color: #e2e8f0; font-weight: 600; }
.entity-row .er-sub { color: #94a3b8; font-size: 12px; }
.related-group { margin-top: 10px; }
.related-group h4 { margin: 0 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #94a3b8; }
.related-chip { display: inline-flex; align-items: center; gap: 6px; background: #1e293b; border-radius: 14px; padding: 3px 8px 3px 4px; margin: 0 4px 4px 0; }
.related-chip button { background: none; border: none; color: #64748b; cursor: pointer; }
.picker-wrap { position: relative; }
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/shared/EntityThumb.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/test/qc.tsx frontend/src/components/shared/EntityThumb.tsx frontend/src/components/shared/EntityThumb.test.tsx frontend/src/styles/global.css
git commit -m "feat(shared): EntityThumb + shared styles + test wrapper"
```

---

## Task 3: MediaUploader

**Files:**
- Create: `frontend/src/components/shared/MediaUploader.tsx`
- Test: `frontend/src/components/shared/MediaUploader.test.tsx`

Generic: uploads file(s); optionally links each to an entity; reports each created media via `onUploaded`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shared/MediaUploader.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const uploadMedia = vi.fn(async () => ({ id: "m1", kind: "image", url: "/api/files/x?sig=1", thumbUrl: null, caption: "" }));
const createLink = vi.fn(async () => ({ id: "l1" }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { uploadMedia, createLink } }));
import { MediaUploader } from "./MediaUploader";

test("uploads a file and reports the media", async () => {
  const onUploaded = vi.fn();
  render(<MediaUploader onUploaded={onUploaded} label="Add photo" />);
  const input = screen.getByTestId("media-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" })));
  expect(createLink).not.toHaveBeenCalled();
});

test("links the upload when linkTo is given", async () => {
  render(<MediaUploader onUploaded={() => {}} linkTo="person:p1" />);
  const input = screen.getByTestId("media-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(createLink).toHaveBeenCalledWith("media:m1", "person:p1", ""));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/shared/MediaUploader.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `MediaUploader`**

Create `frontend/src/components/shared/MediaUploader.tsx`:
```tsx
import { useState } from "react";
import { api, type MediaDto } from "../../api/client";

interface Props {
  onUploaded: (media: MediaDto) => void;
  linkTo?: string;        // e.g. "person:<id>" — links each upload to this entity
  linkRole?: string;
  multiple?: boolean;
  label?: string;
}

/** Generic media upload: uploads each file, optionally links it, reports each media. */
export function MediaUploader({ onUploaded, linkTo, linkRole = "", multiple = false, label = "Upload" }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(files: FileList) {
    setBusy(true);
    setError(null);
    try {
      await Promise.all(
        Array.from(files).map(async (file) => {
          const media = await api.uploadMedia(file);
          if (linkTo) await api.createLink(`media:${media.id}`, linkTo, linkRole);
          onUploaded(media);
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="filebtn">
      {busy ? "Uploading…" : label}
      <input
        data-testid="media-input"
        type="file"
        accept="image/*,video/*,audio/*"
        multiple={multiple}
        hidden
        disabled={busy}
        onChange={(e) => e.target.files?.length && handle(e.target.files)}
      />
      {error && <span className="error-text" style={{ marginLeft: 8 }}>{error}</span>}
    </label>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/shared/MediaUploader.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/MediaUploader.tsx frontend/src/components/shared/MediaUploader.test.tsx
git commit -m "feat(shared): MediaUploader (upload + optional link)"
```

---

## Task 4: EntityPicker

**Files:**
- Create: `frontend/src/components/shared/EntityPicker.tsx`
- Test: `frontend/src/components/shared/EntityPicker.test.tsx`

Debounced search of one entity type → pick a result. Modeled on `PlaceSearch`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shared/EntityPicker.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const searchEntities = vi.fn(async () => [{ type: "visit", id: "v1", label: "Eiffel Tower", thumbUrl: null }]);
vi.mock("../../api/client", () => ({ API_URL: "", api: { searchEntities } }));
import { EntityPicker } from "./EntityPicker";

test("searches and picks an entity", async () => {
  const onPick = vi.fn();
  render(<EntityPicker type="visit" onPick={onPick} placeholder="Link a visit…" />);
  fireEvent.change(screen.getByPlaceholderText("Link a visit…"), { target: { value: "eiff" } });
  const opt = await screen.findByText("Eiffel Tower");
  expect(searchEntities).toHaveBeenCalledWith("visit", "eiff");
  fireEvent.mouseDown(opt);
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", type: "visit" }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/shared/EntityPicker.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `EntityPicker`**

Create `frontend/src/components/shared/EntityPicker.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { api, type CoreType, type EntitySummary } from "../../api/client";
import { EntityThumb } from "./EntityThumb";

interface Props {
  type: CoreType;
  onPick: (entity: EntitySummary) => void;
  placeholder?: string;
}

export function EntityPicker({ type, onPick, placeholder }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<EntitySummary[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 1) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await api.searchEntities(type, q.trim());
        setResults(r);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, type]);

  return (
    <div className="picker-wrap">
      <input
        value={q}
        placeholder={placeholder ?? `Search ${type}…`}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div className="suggestions">
          {results.map((r) => (
            <div
              key={r.id}
              className="entity-row"
              onMouseDown={(e) => { e.preventDefault(); onPick(r); setQ(""); setResults([]); setOpen(false); }}
            >
              <EntityThumb thumbUrl={r.thumbUrl} label={r.label} size={24} />
              <span className="er-main"><span className="er-title">{r.label}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/shared/EntityPicker.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/EntityPicker.tsx frontend/src/components/shared/EntityPicker.test.tsx
git commit -m "feat(shared): EntityPicker (typed entity search/select)"
```

---

## Task 5: RelatedPanel

**Files:**
- Create: `frontend/src/components/shared/RelatedPanel.tsx`
- Test: `frontend/src/components/shared/RelatedPanel.test.tsx`

Shows an entity's related entities grouped by type, with add (via `EntityPicker`) and remove.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shared/RelatedPanel.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";

const getRelations = vi.fn(async () => [
  { linkId: "l1", role: "", entity: { type: "visit", id: "v1", label: "Eiffel Tower", subtitle: null, thumbUrl: null } },
]);
const deleteLink = vi.fn(async () => {});
const createLink = vi.fn(async () => ({ id: "l2" }));
const searchEntities = vi.fn(async () => []);
vi.mock("../../api/client", () => ({ API_URL: "", api: { getRelations, deleteLink, createLink, searchEntities } }));
import { RelatedPanel } from "./RelatedPanel";

test("lists related entities and removes one", async () => {
  render(withQC(<RelatedPanel entity="person:p1" addTypes={["visit"]} />));
  expect(await screen.findByText("Eiffel Tower")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Remove Eiffel Tower"));
  await waitFor(() => expect(deleteLink).toHaveBeenCalledWith("l1"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/shared/RelatedPanel.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `RelatedPanel`**

Create `frontend/src/components/shared/RelatedPanel.tsx`:
```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CoreType, type EntitySummary, type Relation } from "../../api/client";
import { EntityThumb } from "./EntityThumb";
import { EntityPicker } from "./EntityPicker";

const TYPE_LABELS: Record<CoreType, string> = {
  visit: "Places & visits", trip: "Trips", person: "People", media: "Photos", document: "Documents",
};

interface Props {
  entity: string;              // "person:<id>"
  addTypes?: CoreType[];       // types the user may link to this entity
}

export function RelatedPanel({ entity, addTypes = [] }: Props) {
  const qc = useQueryClient();
  const key = ["relations", entity];
  const { data: relations = [] } = useQuery({ queryKey: key, queryFn: () => api.getRelations(entity) });

  const add = useMutation({
    mutationFn: (picked: EntitySummary) => api.createLink(entity, `${picked.type}:${picked.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (linkId: string) => api.deleteLink(linkId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const groups = new Map<CoreType, Relation[]>();
  for (const r of relations) groups.set(r.entity.type, [...(groups.get(r.entity.type) ?? []), r]);

  return (
    <div>
      <div className="section-title"><span>Related</span></div>
      {relations.length === 0 && <div className="er-sub">Nothing linked yet.</div>}
      {[...groups].map(([type, rels]) => (
        <div key={type} className="related-group">
          <h4>{TYPE_LABELS[type]}</h4>
          {rels.map((r) => (
            <span key={r.linkId} className="related-chip">
              <EntityThumb thumbUrl={r.entity.thumbUrl} label={r.entity.label} size={22} />
              {r.entity.label}
              <button aria-label={`Remove ${r.entity.label}`} onClick={() => remove.mutate(r.linkId)}>✕</button>
            </span>
          ))}
        </div>
      ))}
      {addTypes.map((t) => (
        <div key={t} style={{ marginTop: 8 }}>
          <EntityPicker type={t} placeholder={`Link a ${t}…`} onPick={(e) => add.mutate(e)} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/shared/RelatedPanel.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/RelatedPanel.tsx frontend/src/components/shared/RelatedPanel.test.tsx
git commit -m "feat(shared): RelatedPanel (view/add/remove entity links)"
```

---

## Task 6: EntityList & EntityDetail

**Files:**
- Create: `frontend/src/components/shared/EntityList.tsx`, `frontend/src/components/shared/EntityDetail.tsx`
- Test: `frontend/src/components/shared/EntityList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shared/EntityList.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "" }));
import { EntityList } from "./EntityList";
import { EntityDetail } from "./EntityDetail";

const people = [{ id: "1", label: "Mom" }, { id: "2", label: "Dad" }];

test("filters by search text and selects a row", () => {
  const onSelect = vi.fn();
  render(
    <EntityList
      items={people}
      getKey={(p) => p.id}
      getSearchText={(p) => p.label}
      renderRow={(p) => <span>{p.label}</span>}
      onSelect={onSelect}
      searchPlaceholder="Search people…"
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("Search people…"), { target: { value: "da" } });
  expect(screen.queryByText("Mom")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Dad"));
  expect(onSelect).toHaveBeenCalledWith(people[1]);
});

test("EntityDetail shows title and fires onClose", () => {
  const onClose = vi.fn();
  render(<EntityDetail title="Mom" onClose={onClose}><div>body</div></EntityDetail>);
  expect(screen.getByText("Mom")).toBeInTheDocument();
  expect(screen.getByText("body")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Close"));
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/shared/EntityList.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `EntityList`**

Create `frontend/src/components/shared/EntityList.tsx`:
```tsx
import { useState, type ReactNode } from "react";

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  getSearchText?: (item: T) => string;
  onSelect?: (item: T) => void;
  searchPlaceholder?: string;
}

/** Generic searchable list of entities. */
export function EntityList<T>({ items, getKey, renderRow, getSearchText, onSelect, searchPlaceholder }: Props<T>) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const filtered = term && getSearchText
    ? items.filter((i) => getSearchText(i).toLowerCase().includes(term))
    : items;

  return (
    <div>
      {getSearchText && (
        <input value={q} placeholder={searchPlaceholder ?? "Search…"} onChange={(e) => setQ(e.target.value)} />
      )}
      <div style={{ marginTop: 8 }}>
        {filtered.map((item) => (
          <div key={getKey(item)} className="entity-row" onClick={() => onSelect?.(item)}>
            {renderRow(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `EntityDetail`**

Create `frontend/src/components/shared/EntityDetail.tsx`:
```tsx
import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string | null;
  onClose?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  children: ReactNode;
}

/** Generic detail modal: header (title/subtitle), optional edit/delete, and a body. */
export function EntityDetail({ title, subtitle, onClose, onEdit, onDelete, children }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {subtitle && <div style={{ color: "var(--muted)", fontSize: 13 }}>{subtitle}</div>}
          </div>
          {onClose && <button className="ghost" aria-label="Close" title="Close" onClick={onClose}>✕</button>}
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
        {(onEdit || onDelete) && (
          <div className="modal-actions">
            {onDelete && <button className="danger" style={{ marginRight: "auto" }} onClick={onDelete}>Delete</button>}
            {onEdit && <button className="primary" onClick={onEdit}>Edit</button>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/shared/EntityList.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/shared/EntityList.tsx frontend/src/components/shared/EntityDetail.tsx frontend/src/components/shared/EntityList.test.tsx
git commit -m "feat(shared): EntityList + EntityDetail"
```

---

## Task 7: PersonForm (add/edit)

**Files:**
- Create: `frontend/src/components/people/PersonForm.tsx`
- Test: `frontend/src/components/people/PersonForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/people/PersonForm.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const createPerson = vi.fn(async (d) => ({ id: "p9", ...d, avatarUrl: null }));
const listFamilyMembers = vi.fn(async () => []);
vi.mock("../../api/client", () => ({ API_URL: "", api: { createPerson, listFamilyMembers } }));
import { PersonForm } from "./PersonForm";

test("requires a name then creates a person", async () => {
  const onSaved = vi.fn();
  render(<PersonForm person={null} onClose={() => {}} onSaved={onSaved} />);
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText(/name/i)).toBeInTheDocument(); // validation message
  expect(createPerson).not.toHaveBeenCalled();

  fireEvent.change(screen.getByPlaceholderText("e.g. Grandma"), { target: { value: "Grandma" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(createPerson).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Grandma" })));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/people/PersonForm.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `PersonForm`**

Create `frontend/src/components/people/PersonForm.tsx`:
```tsx
import { useEffect, useState } from "react";
import { api, type Person, type FamilyMember, type MediaDto } from "../../api/client";
import { MediaUploader } from "../shared/MediaUploader";
import { EntityThumb } from "../shared/EntityThumb";

interface Props {
  person: Person | null;
  onClose: () => void;
  onSaved: (person: Person) => void;
}

export function PersonForm({ person, onClose, onSaved }: Props) {
  const editing = Boolean(person);
  const [displayName, setDisplayName] = useState(person?.displayName ?? "");
  const [relationship, setRelationship] = useState(person?.relationship ?? "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const [userId, setUserId] = useState<string | null>(person?.userId ?? null);
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(person?.avatarMediaId ?? null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(person?.avatarUrl ?? null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.listFamilyMembers().then(setMembers).catch(() => setMembers([])); }, []);

  function onAvatar(media: MediaDto) {
    setAvatarMediaId(media.id);
    setAvatarUrl(media.thumbUrl ?? media.url);
  }

  async function save() {
    if (!displayName.trim()) { setError("Please enter a name."); return; }
    setBusy(true);
    setError(null);
    const payload = { displayName: displayName.trim(), relationship, notes, userId, avatarMediaId };
    try {
      const saved = editing && person
        ? await api.updatePerson(person.id, payload)
        : await api.createPerson(payload);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? "Edit person" : "Add person"}</h2>

        <div className="field" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <EntityThumb thumbUrl={avatarUrl} label={displayName || "?"} size={56} />
          <MediaUploader onUploaded={onAvatar} label="📷 Set photo" />
        </div>

        <div className="field">
          <label>Name</label>
          <input value={displayName} placeholder="e.g. Grandma" onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label>Relationship</label>
          <input value={relationship} placeholder="e.g. Grandmother" onChange={(e) => setRelationship(e.target.value)} />
        </div>
        <div className="field">
          <label>Linked account (optional)</label>
          <select value={userId ?? ""} onChange={(e) => setUserId(e.target.value || null)}>
            <option value="">— Not a login account —</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.email})</option>)}
          </select>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/people/PersonForm.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/people/PersonForm.tsx frontend/src/components/people/PersonForm.test.tsx
git commit -m "feat(people): PersonForm (add/edit with avatar + account link)"
```

---

## Task 8: PeoplePage

**Files:**
- Create: `frontend/src/pages/PeoplePage.tsx`
- Test: `frontend/src/pages/PeoplePage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/PeoplePage.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";

const listPeople = vi.fn(async () => [
  { id: "p1", displayName: "Mom", relationship: "Family", notes: "", userId: null, avatarMediaId: null, avatarUrl: null, createdAt: "" },
]);
vi.mock("../api/client", () => ({ API_URL: "", api: { listPeople } }));
import { PeoplePage } from "./PeoplePage";

test("renders the family's people", async () => {
  render(withQC(<PeoplePage />));
  expect(await screen.findByText("Mom")).toBeInTheDocument();
  expect(screen.getByText(/Family/)).toBeInTheDocument(); // rendered as " · Family"
});

test("shows an empty state when there are no people", async () => {
  listPeople.mockResolvedValueOnce([]);
  render(withQC(<PeoplePage />));
  expect(await screen.findByText(/add your first/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/pages/PeoplePage.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `PeoplePage`**

Create `frontend/src/pages/PeoplePage.tsx`:
```tsx
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Person } from "../api/client";
import { EntityList } from "../components/shared/EntityList";
import { EntityDetail } from "../components/shared/EntityDetail";
import { EntityThumb } from "../components/shared/EntityThumb";
import { RelatedPanel } from "../components/shared/RelatedPanel";
import { PersonForm } from "../components/people/PersonForm";
import { EmptyState, Spinner } from "../components/ui";

export function PeoplePage() {
  const qc = useQueryClient();
  const { data: people, isLoading } = useQuery({ queryKey: ["people"], queryFn: api.listPeople });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);

  const selected = people?.find((p) => p.id === selectedId) ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["people"] });

  async function remove(p: Person) {
    await api.deletePerson(p.id);
    setSelectedId(null);
    refresh();
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">👤 People</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding(true)}>+ Add person</button>
      </header>

      <div style={{ padding: 16, overflow: "auto" }}>
        {isLoading ? (
          <Spinner label="Loading people…" />
        ) : people && people.length > 0 ? (
          <EntityList
            items={people}
            getKey={(p) => p.id}
            getSearchText={(p) => `${p.displayName} ${p.relationship}`}
            searchPlaceholder="Search people…"
            onSelect={(p) => setSelectedId(p.id)}
            renderRow={(p) => (
              <>
                <EntityThumb thumbUrl={p.avatarUrl} label={p.displayName} />
                <span className="er-main">
                  <span className="er-title">{p.displayName}</span>
                  {p.relationship && <span className="er-sub"> · {p.relationship}</span>}
                </span>
              </>
            )}
          />
        ) : (
          <EmptyState
            emoji="👋"
            title="No people yet"
            hint="Add your first family member or travel companion."
            action={<button className="primary" onClick={() => setAdding(true)}>Add a person</button>}
          />
        )}
      </div>

      {selected && !editing && (
        <EntityDetail
          title={selected.displayName}
          subtitle={selected.relationship || null}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditing(selected)}
          onDelete={() => remove(selected)}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
            <EntityThumb thumbUrl={selected.avatarUrl} label={selected.displayName} size={64} />
            {selected.userId && <span className="er-sub">Linked to a login account</span>}
          </div>
          {selected.notes && <p>{selected.notes}</p>}
          <RelatedPanel entity={`person:${selected.id}`} addTypes={["visit", "trip", "media"]} />
        </EntityDetail>
      )}

      {(adding || editing) && (
        <PersonForm
          person={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(p) => { setAdding(false); setEditing(null); setSelectedId(p.id); refresh(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/pages/PeoplePage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PeoplePage.tsx frontend/src/pages/PeoplePage.test.tsx
git commit -m "feat(people): PeoplePage (list, detail, related, add/edit)"
```

---

## Task 9: Enable the People module

**Files:**
- Modify: `frontend/src/shell/modules.ts`, `frontend/src/shell/AppShell.tsx`
- Test: `frontend/src/shell/modules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shell/modules.test.ts`:
```ts
import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("People is enabled", () => {
  expect(MODULES.find((m) => m.key === "people")?.enabled).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/shell/modules.test.ts`
Expected: FAIL (people still `enabled: false`).

- [ ] **Step 3: Enable People + add the route**

In `frontend/src/shell/modules.ts`, change the People entry to `enabled: true`:
```ts
  { key: "people", label: "People", icon: "👤", path: "/people", enabled: true },
```

In `frontend/src/shell/AppShell.tsx`, import the page and add its route (the `!m.enabled` filter now excludes People, so it won't fall through to `ComingSoon`):
```tsx
import { PeoplePage } from "../pages/PeoplePage";
```
Add inside `<Routes>`, after the `/map` route:
```tsx
          <Route path="/people" element={<PeoplePage />} />
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/shell/modules.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shell/modules.ts frontend/src/shell/AppShell.tsx frontend/src/shell/modules.test.ts
git commit -m "feat(shell): enable the People module + route"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full frontend suite + typecheck + build**

Run:
```bash
cd frontend && npm test && npm run typecheck && npm run build
```
Expected: all tests PASS; typecheck clean; build succeeds.

- [ ] **Step 2: Manual smoke (with the 2A backend running + seeded)**

Start the frontend (`npm run dev`) and verify:
- The rail's **People** entry is now active; clicking it opens the People page.
- "Add person" creates a person (name + relationship); setting a photo shows an avatar.
- Opening a person shows their detail with a **Related** section; linking a visit/trip/photo via the picker adds it and it appears; the ✕ removes it.
- Editing a person and linking a login account persists.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A frontend
git commit -m "chore: phase 2B people frontend verified" || echo "nothing to commit"
```

---

## Phase 2 complete

With 2A + 2B done: the reusable component library (`MediaUploader`, `EntityPicker`, `RelatedPanel`, `EntityList`, `EntityDetail`) exists and is consumed by a working **People** module — create anyone (with or without a login), give them a photo, and see/curate everything linked to them. These components are the foundation the **Map Editor Overhaul (Phase 3)**, **Photos (Phase 4)**, and later modules build on.
