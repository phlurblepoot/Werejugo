# Documents & Reminders Module — Design

**Date:** 2026-06-23
**Status:** Approved (design); **Phase 5** of the roadmap (architecture spec `2026-06-22-werejugo-architecture-design.md` §9).
**Scope:** The practical travel-paperwork hub — store passports, visas, bookings, insurance and other documents (owned by a person or trip), each with an optional file and optional expiry, and surface upcoming/overdue renewals in-app and as a rail badge.
**Depends on:** Phases 1–2 (the `documents` table, signed file serving, `EntityPicker`). **Out of scope:** email/push delivery of reminders (deferred per architecture §7.3) — reminders are in-app only.

---

## 1. Context

The `documents` table exists from Phase 1 (`id, family_id, title, doc_type, rel_path, original_name, owner_person_id, owner_trip_id, issued_on, expires_on, reminder_lead_days, notes`) and `documentDirFor(owner)` already computes the on-disk folder (`trips/<slug>/documents`, `people/<slug>`, or `loose/documents`). Missing: **document routes**, a **PDF-capable file save** (the existing media save allows image/video/audio only), a **document reconciler** (owner-change file move), and a **rail badge** mechanism. This module fills those.

## 2. Decisions

| Decision | Choice |
|---|---|
| Page layout | **Renewals banner + filterable list** — a "Coming up" panel of due/overdue docs on top, then one filterable list (type/owner/search) |
| "Due" definition | **Per-document lead + overdue** — due when `today ≥ expires_on − reminder_lead_days`; expired docs show as **overdue**. Both feed the banner and the rail badge |
| File | **Optional** — record a document's details/expiry without a scan; attach the file later |
| Owner | **None / person / trip** (optional, one-of) — drives the file's folder |
| Reminders delivery | **In-app only** (banner + rail badge); email/push deferred |
| Implementation split | **5A (backend)** then **5B (frontend)** |

## 3. Page UX

A `Documents` rail module (with a **badge** showing the due/overdue count). The page:
- **"Coming up" banner** — documents that are due (within their lead time) or overdue, soonest first, each showing the days remaining / days overdue.
- **Filterable list** — every document; chips/controls for type, owner (person/trip via `EntityPicker`), and a title search. Each row shows title, type, owner, and an expiry status chip.
- **Add / edit form (modal)** — title; type (`passport/visa/booking/insurance/other`); an **Owner** segmented toggle (None / Person / Trip) that reveals an `EntityPicker` for the chosen kind; issued + expires dates; "remind N days before"; notes; an **optional** file (PDF or image, attachable later); plus, when editing, a "view current file" link and delete.

## 4. Backend (Plan 5A)

No schema changes.

### 4.1 PDF-capable file save
Add `saveDocumentUpload(part, relDir) → { relPath, originalName }` to `storage.ts`: a document extension allow-list (`.pdf .png .jpg .jpeg .webp .heic .heif .doc .docx`), streamed to a readable unique name (via the existing `uniqueName`), no thumbnail. The media save is unchanged.

### 4.2 Document reconciler
Add `reconcileDocument(client, docId)` to `reconcile.ts`: load the document + its owner (person name / trip name+start), compute `documentDirFor(owner)`, and move the file (via `moveStored`) + update `rel_path` when the directory differs. Called on owner change. Best-effort; DB is the source of truth.

### 4.3 Routes (`documents.ts`, family-scoped, `zod`-validated)
- `POST /api/documents` (multipart) — fields: `title`, `docType`, one-of `ownerPersonId`/`ownerTripId` (validated to the family) or none, `issuedOn?`, `expiresOn?`, `reminderLeadDays` (default 30), `notes?`; an **optional** `file`. Saves the file (when present) into `documentDirFor(owner)`; inserts the row.
- `GET /api/documents` — filters: `docType`, `owner` (`person:<id>` or `trip:<id>`), `q` (title ILIKE), `due` (`1` → only due/overdue). DTOs sorted by `expires_on NULLS LAST, created_at DESC`.
- `GET /api/documents/due-count` → `{ count }` — the rail badge (count of due/overdue).
- `GET /api/documents/:id`.
- `PATCH /api/documents/:id` (JSON) — metadata + owner; on owner change, runs `reconcileDocument`.
- `POST /api/documents/:id/file` (multipart) — attach or replace the file (supports "add the file later"); deletes the previous file if any.
- `DELETE /api/documents/:id` — removes the row and its file.

### 4.4 DTO & computed status
Each document DTO: `id, title, docType, ownerPersonId, ownerPersonName, ownerTripId, ownerTripName, issuedOn, expiresOn, reminderLeadDays, notes, fileUrl (signed | null), originalName, createdAt`, plus computed **`status`** and **`daysUntilExpiry`**:
- `status`: `overdue` if `expires_on < CURRENT_DATE`; `upcoming` if `expires_on <= CURRENT_DATE + make_interval(days => reminder_lead_days)` (and not overdue); `ok` if it has an expiry further out; `none` if `expires_on IS NULL`.
- `daysUntilExpiry`: `expires_on - CURRENT_DATE` (null when no expiry).
- The `due` filter and `due-count` select `expires_on IS NOT NULL AND expires_on <= CURRENT_DATE + make_interval(days => reminder_lead_days)` (covers both upcoming and overdue).

## 5. Frontend (Plan 5B)

- **`pages/DocumentsPage.tsx`** — composes the renewals banner (the `due` subset), the filterable list, and the add/edit form; data via `@tanstack/react-query`.
- **`components/documents/DocumentForm.tsx`** — the add/edit modal: fields + the Owner None/Person/Trip toggle (→ `EntityPicker`), the optional file input (`accept=".pdf,image/*"`) that posts to `POST /api/documents` on create or `POST /api/documents/:id/file` on edit, a current-file link, and delete.
- **`components/documents/DocumentList.tsx`** — rows with title/type/owner + an expiry **status chip** (overdue red, upcoming amber, ok/none muted).
- **Rail badge** — extend `Rail` to accept a `badges?: Record<string, number>` prop and render a small count bubble; `AppShell` fetches `documentsDueCount()` and passes `{ documents: count }`. This is the one new shell capability (reusable by later modules).
- **Client (`api/client.ts`):** `Document` type + `listDocuments(filters)`, `documentsDueCount()`, `createDocument(form: FormData)`, `updateDocument(id, data)`, `attachDocumentFile(id, file)`, `deleteDocument(id)`.
- Enable Documents in `shell/modules.ts` and add the `/documents` route in `AppShell.tsx`.

## 6. Data flow

1. Filters → `GET /api/documents` → the banner (rows with `status` `overdue`/`upcoming`) + the full list.
2. Create → multipart `POST` (optional file) → invalidate the documents + due-count queries. Edit → JSON `PATCH` (+ optional `POST /:id/file`) → invalidate. Owner change moves the file via the reconciler.
3. The rail badge is its own light `due-count` query, refreshed when documents change.

## 7. Error handling

- `zod` validation on every route; owner ids validated to belong to the family (else 404); a document may have at most one owner (person *or* trip).
- File type checked against the document allow-list (e.g. `.exe` rejected with 400); 25 MB multipart cap (existing).
- Family-scoping everywhere; cross-family access 404. `reconcileDocument` is best-effort on the filesystem with the DB authoritative.

## 8. Testing

- **Backend:** create with and without a file (PDF saved into the owner's folder; bad type rejected); list filters (type, owner, `q`, `due`); `due-count` and `status`/`daysUntilExpiry` correctness (overdue vs upcoming vs ok vs none); owner change moves the file (`reconcileDocument`); attach-file replaces; delete removes row + file.
- **Frontend:** `DocumentForm` owner toggle reveals the picker and creates a document; `DocumentsPage` shows the renewals banner and filters the list; the rail badge renders the due count.

## 9. Out of scope

- Email / push / digest delivery of reminders (architecture §7.3) — in-app only.
- Document content extraction/OCR (e.g. auto-reading passport expiry).
- Versioning / history of a document's file.
- Linking documents to entities beyond their single owner (the universal links table is for the other modules; documents use the owner FK).

## 10. Definition of done

The Documents rail module is live with a due/overdue **badge**: a renewals banner + a filterable list; add/edit documents with an optional PDF/image file and a None/Person/Trip owner; expiry status computed from each document's lead time; owner changes move the file on disk; all endpoints family-scoped and tested; frontend tests, typecheck, and build pass.
