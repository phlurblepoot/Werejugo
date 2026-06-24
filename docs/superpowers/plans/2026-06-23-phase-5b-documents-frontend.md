# Phase 5B — Documents Module (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Documents rail module — a renewals banner + filterable list, an add/edit form with a None/Person/Trip owner and an optional PDF/image file, and a due-count rail badge — on top of Plan 5A's endpoints.

**Architecture:** A `DocumentsPage` composes a `DocumentList` and a `DocumentForm` (reusing `EntityPicker` for owners), with `@tanstack/react-query`. The Rail gains a generic `badges` prop; `AppShell` feeds it the documents due-count. Components call the `api` object directly.

**Tech Stack:** React 18 + Vite, `@tanstack/react-query` v5, `react-router-dom` v6. Tests: Vitest + @testing-library/react with `api` mocked.

**Depends on:** Plan 5A (endpoints) + Phase-2 `EntityPicker`.

---

## Conventions (apply to every task)

- All commands run from `frontend/`.
- New files in `frontend/src/components/documents/` (and `pages/DocumentsPage.tsx`).
- Tests mock `api`; **wrap factory-referenced `vi.fn()`s in `vi.hoisted`** (vitest hoists `vi.mock`). react-query components use `withQC` (from `frontend/src/test/qc.tsx`).
- Commit after each task with the message in its final step.

---

## File Structure

**New files:**
- `frontend/src/components/documents/DocumentForm.tsx`
- `frontend/src/components/documents/DocumentList.tsx`
- `frontend/src/pages/DocumentsPage.tsx`

**Modified files:**
- `frontend/src/api/client.ts` — document types + methods.
- `frontend/src/shell/Rail.tsx` — `badges` prop.
- `frontend/src/shell/AppShell.tsx` — feed the due-count; add `/documents` route.
- `frontend/src/shell/modules.ts` — enable Documents.
- `frontend/src/styles/global.css` — badge + status-chip styles.

---

## Task 1: API client — document types & methods

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/documents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/documents.test.ts`:
```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (url.includes("due-count")) return jsonRes({ count: 3 });
    if (opts.method === "GET") return jsonRes([]);
    return jsonRes({ id: "d1" });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function jsonRes(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("listDocuments builds a query string", async () => {
  await api.listDocuments({ docType: "passport", due: "1" });
  expect(calls[0].url).toContain("/api/documents?");
  expect(calls[0].url).toContain("docType=passport");
  expect(calls[0].url).toContain("due=1");
});

test("createDocument without a file posts JSON", async () => {
  await api.createDocument({ title: "Passport", docType: "passport" });
  expect(calls[0].url).toContain("/api/documents");
  expect(JSON.parse(calls[0].body)).toMatchObject({ title: "Passport" });
});

test("createDocument with a file posts FormData", async () => {
  const f = new File(["x"], "p.pdf", { type: "application/pdf" });
  await api.createDocument({ title: "Passport", docType: "passport" }, f);
  expect(calls[0].body).toBeInstanceOf(FormData);
});

test("documentsDueCount fetches the count", async () => {
  const r = await api.documentsDueCount();
  expect(r.count).toBe(3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/api/documents.test.ts`
Expected: FAIL (methods undefined).

- [ ] **Step 3: Add types and methods to `client.ts`**

(a) Add types near the other module types:
```ts
export type DocStatus = "overdue" | "upcoming" | "ok" | "none";
export type DocType = "passport" | "visa" | "booking" | "insurance" | "other";

export interface DocumentItem {
  id: string;
  title: string;
  docType: DocType;
  ownerPersonId: string | null;
  ownerPersonName: string | null;
  ownerTripId: string | null;
  ownerTripName: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  reminderLeadDays: number;
  notes: string;
  fileUrl: string | null;
  originalName: string;
  createdAt: string;
  status: DocStatus;
  daysUntilExpiry: number | null;
}

export interface DocumentInput {
  title?: string;
  docType?: DocType;
  ownerPersonId?: string | null;
  ownerTripId?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  reminderLeadDays?: number;
  notes?: string;
}

export interface DocumentFilters { docType?: string; owner?: string; q?: string; due?: string; }
```

(b) Add methods in the `api` object:
```ts
  // documents
  listDocuments: (f: DocumentFilters = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    return request<DocumentItem[]>(`/api/documents?${qs.toString()}`);
  },
  documentsDueCount: () => request<{ count: number }>("/api/documents/due-count"),
  createDocument: (data: DocumentInput, file?: File | null) => {
    if (file) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== null) fd.append(k, String(v));
      fd.append("file", file);
      return request<DocumentItem>("/api/documents", { method: "POST", body: fd });
    }
    return request<DocumentItem>("/api/documents", { method: "POST", body: body(data) });
  },
  updateDocument: (id: string, data: DocumentInput) =>
    request<DocumentItem>(`/api/documents/${id}`, { method: "PATCH", body: body(data) }),
  attachDocumentFile: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<DocumentItem>(`/api/documents/${id}/file`, { method: "POST", body: fd });
  },
  deleteDocument: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/api/documents.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/documents.test.ts
git commit -m "feat(api): document list/create/update/file/delete + due-count"
```

---

## Task 2: Rail badge support

**Files:**
- Modify: `frontend/src/shell/Rail.tsx`, `frontend/src/styles/global.css`
- Test: `frontend/src/shell/Rail.badge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shell/Rail.badge.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { Rail } from "./Rail";

// Badge only renders on enabled modules; Documents isn't enabled until Task 6,
// so test the mechanism on "map" (already enabled).
test("renders a numeric badge for a module when provided", () => {
  render(
    <MemoryRouter initialEntries={["/map"]}>
      <Rail onSignOut={() => {}} badges={{ map: 2 }} />
    </MemoryRouter>,
  );
  expect(screen.getByText("2")).toBeInTheDocument();
});

test("renders no badge when the count is 0 or absent", () => {
  render(
    <MemoryRouter initialEntries={["/map"]}>
      <Rail onSignOut={() => {}} badges={{ map: 0 }} />
    </MemoryRouter>,
  );
  expect(screen.queryByText("0")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/shell/Rail.badge.test.tsx`
Expected: FAIL (Rail has no `badges` prop / no badge rendered).

- [ ] **Step 3: Add the `badges` prop to `Rail`**

In `frontend/src/shell/Rail.tsx`, change the signature and render a badge on enabled items. Update the function signature:
```tsx
export function Rail({ onSignOut, badges = {} }: { onSignOut: () => void; badges?: Record<string, number> }) {
```
Inside the `m.enabled ? (<NavLink ...>` block, add a badge after the icon span (so it renders inside the NavLink):
```tsx
            <span className="rail-icon" aria-hidden="true">{m.icon}</span>
            {badges[m.key] > 0 && <span className="rail-badge">{badges[m.key]}</span>}
```
(Place the `{badges...}` line immediately after the existing `rail-icon` span, before the label span.)

- [ ] **Step 4: Add the badge style**

Append to `frontend/src/styles/global.css`:
```css
.rail-item { position: relative; }
.rail-badge {
  position: absolute; top: 4px; right: 14px;
  background: #ef4444; color: #fff; font-size: 9px; font-weight: 700;
  border-radius: 9px; padding: 0 5px; line-height: 14px; min-width: 14px; text-align: center;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm test -- src/shell/Rail.badge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shell/Rail.tsx frontend/src/shell/Rail.badge.test.tsx frontend/src/styles/global.css
git commit -m "feat(shell): Rail badge support"
```

---

## Task 3: `DocumentList`

**Files:**
- Create: `frontend/src/components/documents/DocumentList.tsx`
- Test: `frontend/src/components/documents/DocumentList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/documents/DocumentList.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DocumentList } from "./DocumentList";

const docs = [
  { id: "d1", title: "Dad's Passport", docType: "passport", ownerPersonName: "Dad", ownerTripName: null, status: "upcoming", daysUntilExpiry: 74, expiresOn: "2031-04-11" },
  { id: "d2", title: "Old Visa", docType: "visa", ownerPersonName: null, ownerTripName: null, status: "overdue", daysUntilExpiry: -5, expiresOn: "2024-01-01" },
] as any;

test("renders rows with status and opens one on click", () => {
  const onOpen = vi.fn();
  render(<DocumentList documents={docs} onOpen={onOpen} />);
  expect(screen.getByText("Dad's Passport")).toBeInTheDocument();
  expect(screen.getByText(/74 days/)).toBeInTheDocument();
  expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Dad's Passport"));
  expect(onOpen).toHaveBeenCalledWith(docs[0]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/documents/DocumentList.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `DocumentList`**

Create `frontend/src/components/documents/DocumentList.tsx`:
```tsx
import type { DocumentItem } from "../../api/client";

function statusText(d: DocumentItem): string {
  if (d.status === "overdue" && d.daysUntilExpiry != null) return `overdue ${Math.abs(d.daysUntilExpiry)} days`;
  if (d.status === "upcoming" && d.daysUntilExpiry != null) return `in ${d.daysUntilExpiry} days`;
  if (d.status === "ok") return d.expiresOn ? `expires ${d.expiresOn}` : "";
  return "no expiry";
}

const DOC_ICON: Record<string, string> = { passport: "🛂", visa: "📄", booking: "🏨", insurance: "🛡️", other: "📎" };

export function DocumentList({ documents, onOpen }: { documents: DocumentItem[]; onOpen: (d: DocumentItem) => void }) {
  return (
    <div>
      {documents.map((d) => (
        <div key={d.id} className="entity-row" onClick={() => onOpen(d)}>
          <span className="er-thumb" aria-hidden="true" style={{ fontSize: 20 }}>{DOC_ICON[d.docType] ?? "📎"}</span>
          <span className="er-main">
            <span className="er-title">{d.title}</span>
            <span className="er-sub">
              {d.docType}
              {(d.ownerPersonName || d.ownerTripName) && ` · ${d.ownerPersonName ?? d.ownerTripName}`}
            </span>
          </span>
          <span className={`doc-status doc-${d.status}`}>{statusText(d)}</span>
        </div>
      ))}
    </div>
  );
}
```

Append to `frontend/src/styles/global.css`:
```css
.doc-status { font-size: 11px; flex: 0 0 auto; }
.doc-overdue { color: #f87171; font-weight: 700; }
.doc-upcoming { color: #fbbf24; }
.doc-ok, .doc-none { color: #64748b; }
.er-thumb { width: 28px; text-align: center; flex: 0 0 auto; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/components/documents/DocumentList.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/documents/DocumentList.tsx frontend/src/components/documents/DocumentList.test.tsx frontend/src/styles/global.css
git commit -m "feat(documents): DocumentList (rows + status chip)"
```

---

## Task 4: `DocumentForm`

**Files:**
- Create: `frontend/src/components/documents/DocumentForm.tsx`
- Test: `frontend/src/components/documents/DocumentForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/documents/DocumentForm.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { createDocument, searchEntities } = vi.hoisted(() => ({
  createDocument: vi.fn(async () => ({ id: "d9" })),
  searchEntities: vi.fn(async () => [{ type: "person", id: "p1", label: "Dad", thumbUrl: null }]),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { createDocument, updateDocument: vi.fn(), attachDocumentFile: vi.fn(), deleteDocument: vi.fn(), searchEntities } }));
import { DocumentForm } from "./DocumentForm";

test("validates title, picks a person owner, and creates", async () => {
  const onSaved = vi.fn();
  render(<DocumentForm doc={null} onClose={() => {}} onSaved={onSaved} />);
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText(/please enter a title/i)).toBeInTheDocument(); // validation (specific, not the "Title" label)

  fireEvent.change(screen.getByPlaceholderText(/e.g. Passport/), { target: { value: "Dad's Passport" } });
  fireEvent.click(screen.getByRole("button", { name: "Person" }));
  fireEvent.change(screen.getByPlaceholderText(/person/i), { target: { value: "da" } });
  fireEvent.mouseDown(await screen.findByText("Dad"));
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(createDocument).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Dad's Passport", ownerPersonId: "p1" }), null));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/components/documents/DocumentForm.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `DocumentForm`**

Create `frontend/src/components/documents/DocumentForm.tsx`:
```tsx
import { useState } from "react";
import { api, API_URL, type DocType, type DocumentItem } from "../../api/client";
import { EntityPicker } from "../shared/EntityPicker";

type OwnerKind = "none" | "person" | "trip";
const DOC_TYPES: DocType[] = ["passport", "visa", "booking", "insurance", "other"];

interface Props { doc: DocumentItem | null; onClose: () => void; onSaved: () => void }

export function DocumentForm({ doc, onClose, onSaved }: Props) {
  const editing = Boolean(doc);
  const [title, setTitle] = useState(doc?.title ?? "");
  const [docType, setDocType] = useState<DocType>(doc?.docType ?? "passport");
  const [ownerKind, setOwnerKind] = useState<OwnerKind>(doc?.ownerPersonId ? "person" : doc?.ownerTripId ? "trip" : "none");
  const [ownerId, setOwnerId] = useState<string | null>(doc?.ownerPersonId ?? doc?.ownerTripId ?? null);
  const [ownerLabel, setOwnerLabel] = useState<string | null>(doc?.ownerPersonName ?? doc?.ownerTripName ?? null);
  const [issuedOn, setIssuedOn] = useState(doc?.issuedOn ?? "");
  const [expiresOn, setExpiresOn] = useState(doc?.expiresOn ?? "");
  const [reminderLeadDays, setReminderLeadDays] = useState(String(doc?.reminderLeadDays ?? 30));
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickOwnerKind(k: OwnerKind) { setOwnerKind(k); setOwnerId(null); setOwnerLabel(null); }

  async function save() {
    if (!title.trim()) { setError("Please enter a title."); return; }
    setBusy(true); setError(null);
    const data = {
      title: title.trim(), docType,
      ownerPersonId: ownerKind === "person" ? ownerId : null,
      ownerTripId: ownerKind === "trip" ? ownerId : null,
      issuedOn: issuedOn || null, expiresOn: expiresOn || null,
      reminderLeadDays: Number(reminderLeadDays) || 30, notes,
    };
    try {
      if (editing && doc) {
        await api.updateDocument(doc.id, data);
        if (file) await api.attachDocumentFile(doc.id, file);
      } else {
        await api.createDocument(data, file);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!doc) return;
    await api.deleteDocument(doc.id);
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? "Edit document" : "Add document"}</h2>

        <div className="field"><label>Title</label>
          <input value={title} placeholder="e.g. Passport" onChange={(e) => setTitle(e.target.value)} /></div>

        <div className="row">
          <div className="field"><label>Type</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field"><label>Owner</label>
            <div className="tabs">
              {(["none", "person", "trip"] as OwnerKind[]).map((k) => (
                <button key={k} type="button" className={ownerKind === k ? "active" : ""} onClick={() => pickOwnerKind(k)}>
                  {k === "none" ? "None" : k === "person" ? "Person" : "Trip"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {ownerKind !== "none" && (
          <div className="field">
            <label>{ownerKind === "person" ? "Person" : "Trip"}</label>
            {ownerId ? (
              <span className="fchip act">{ownerLabel}
                <button aria-label="Clear owner" onClick={() => { setOwnerId(null); setOwnerLabel(null); }}>✕</button>
              </span>
            ) : (
              <EntityPicker type={ownerKind} placeholder={`Search ${ownerKind}…`} onPick={(e) => { setOwnerId(e.id); setOwnerLabel(e.label); }} />
            )}
          </div>
        )}

        <div className="row">
          <div className="field"><label>Issued</label><input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></div>
          <div className="field"><label>Expires</label><input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></div>
          <div className="field"><label>Remind (days before)</label><input type="number" value={reminderLeadDays} onChange={(e) => setReminderLeadDays(e.target.value)} /></div>
        </div>

        <div className="field"><label>Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        <div className="field"><label>File (optional)</label>
          {doc?.fileUrl && <div><a href={`${API_URL}${doc.fileUrl}`} target="_blank" rel="noreferrer">📎 {doc.originalName || "View current file"}</a></div>}
          <input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>

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

Run: `cd frontend && npm test -- src/components/documents/DocumentForm.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/documents/DocumentForm.tsx frontend/src/components/documents/DocumentForm.test.tsx
git commit -m "feat(documents): DocumentForm (owner toggle, optional file)"
```

---

## Task 5: `DocumentsPage`

**Files:**
- Create: `frontend/src/pages/DocumentsPage.tsx`
- Test: `frontend/src/pages/DocumentsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/DocumentsPage.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const { listDocuments } = vi.hoisted(() => ({
  listDocuments: vi.fn(async () => [
    { id: "d1", title: "Old Visa", docType: "visa", ownerPersonName: null, ownerTripName: null, status: "overdue", daysUntilExpiry: -5, expiresOn: "2024-01-01", fileUrl: null, originalName: "", notes: "", reminderLeadDays: 30, issuedOn: null, ownerPersonId: null, ownerTripId: null, createdAt: "" },
    { id: "d2", title: "Booking", docType: "booking", ownerPersonName: null, ownerTripName: null, status: "none", daysUntilExpiry: null, expiresOn: null, fileUrl: null, originalName: "", notes: "", reminderLeadDays: 30, issuedOn: null, ownerPersonId: null, ownerTripId: null, createdAt: "" },
  ]),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: { listDocuments } }));
import { DocumentsPage } from "./DocumentsPage";

test("shows the renewals banner with the overdue doc and lists all", async () => {
  render(withQC(<DocumentsPage />));
  expect(await screen.findByText(/Coming up/)).toBeInTheDocument();
  // Old Visa appears in both the banner and the list:
  expect(screen.getAllByText("Old Visa").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("Booking")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/pages/DocumentsPage.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `DocumentsPage`**

Create `frontend/src/pages/DocumentsPage.tsx`:
```tsx
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type DocumentItem, type DocumentFilters, type DocType } from "../api/client";
import { DocumentList } from "../components/documents/DocumentList";
import { DocumentForm } from "../components/documents/DocumentForm";
import { EmptyState, Spinner } from "../components/ui";

const DOC_TYPES: DocType[] = ["passport", "visa", "booking", "insurance", "other"];

export function DocumentsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<DocumentFilters>({});
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["documents", filters],
    queryFn: () => api.listDocuments(filters),
  });

  const due = (documents ?? []).filter((d) => d.status === "overdue" || d.status === "upcoming");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["documents"] });
    qc.invalidateQueries({ queryKey: ["documents-due-count"] });
  };

  function setType(t: DocType | undefined) { setFilters((f) => ({ ...f, docType: t })); }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">🛂 Documents</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding(true)}>+ Add</button>
      </header>

      <div style={{ padding: 16, overflow: "auto" }}>
        {isLoading ? (
          <Spinner label="Loading documents…" />
        ) : (documents && documents.length > 0) ? (
          <>
            {due.length > 0 && (
              <div className="renewals">
                <h4>⏰ Coming up ({due.length})</h4>
                <DocumentList documents={due} onOpen={setEditing} />
              </div>
            )}

            <div className="photo-filter-bar">
              {DOC_TYPES.map((t) => (
                <span key={t} className={`fchip ${filters.docType === t ? "act" : ""}`} onClick={() => setType(filters.docType === t ? undefined : t)}>{t}</span>
              ))}
              <input placeholder="Search…" value={filters.q ?? ""} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))} />
            </div>

            <DocumentList documents={documents} onOpen={setEditing} />
          </>
        ) : (
          <EmptyState emoji="🛂" title="No documents yet" hint="Add passports, visas, bookings and insurance — and we'll remind you before they expire."
            action={<button className="primary" onClick={() => setAdding(true)}>Add a document</button>} />
        )}
      </div>

      {(adding || editing) && (
        <DocumentForm
          doc={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}
```

Append to `frontend/src/styles/global.css`:
```css
.renewals { background: #2a1f0a; border: 1px solid #7c5e1e; border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; }
.renewals h4 { margin: 0 0 4px; color: #fbbf24; font-size: 12px; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/pages/DocumentsPage.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DocumentsPage.tsx frontend/src/pages/DocumentsPage.test.tsx frontend/src/styles/global.css
git commit -m "feat(documents): DocumentsPage (renewals banner + filterable list)"
```

---

## Task 6: Enable the Documents module + feed the badge

**Files:**
- Modify: `frontend/src/shell/modules.ts`, `frontend/src/shell/AppShell.tsx`
- Test: `frontend/src/shell/modules.docs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shell/modules.docs.test.ts`:
```ts
import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("Documents is enabled", () => {
  expect(MODULES.find((m) => m.key === "documents")?.enabled).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- src/shell/modules.docs.test.ts`
Expected: FAIL (documents still `enabled: false`).

- [ ] **Step 3: Enable Documents + route + badge feed**

In `frontend/src/shell/modules.ts`, set the Documents entry to `enabled: true`:
```ts
  { key: "documents", label: "Documents", icon: "🛂", path: "/documents", enabled: true },
```

In `frontend/src/shell/AppShell.tsx`:
- Add imports:
```tsx
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { DocumentsPage } from "../pages/DocumentsPage";
```
- Inside `AppShell()`, before the return, fetch the due-count:
```tsx
  const { data: dueCount } = useQuery({ queryKey: ["documents-due-count"], queryFn: api.documentsDueCount });
```
- Pass badges to the Rail:
```tsx
      <Rail onSignOut={logout} badges={{ documents: dueCount?.count ?? 0 }} />
```
- Add the route inside `<Routes>`, after the `/photos` route:
```tsx
          <Route path="/documents" element={<DocumentsPage />} />
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- src/shell/modules.docs.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shell/modules.ts frontend/src/shell/AppShell.tsx frontend/src/shell/modules.docs.test.ts
git commit -m "feat(shell): enable Documents module + due-count badge"
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

- [ ] **Step 2: Manual smoke (with the 5A backend running + seeded)**

Start the frontend (`npm run dev`) and verify:
- The rail's **Documents** entry is active; a red **badge** shows the due/overdue count.
- **Add** a document (title + type + owner toggle None/Person/Trip → picker; optional file) → it appears; an expiry within its lead time shows in the **Coming up** banner.
- **Type chips / search** filter the list.
- Open a document → edit fields, attach a file, change owner (file moves folders), delete.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A frontend
git commit -m "chore: phase 5B documents frontend verified" || echo "nothing to commit"
```

---

## Phase 5 complete

With 5A + 5B: the Documents hub — store passports/visas/bookings/insurance with a None/Person/Trip owner and an optional file, see upcoming/overdue renewals in a banner and as a rail badge, and edit/attach/delete each. The shared `EntityPicker` carries another module, and the Rail gained a reusable badge mechanism for future modules.
