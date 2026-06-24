# Packing Module — Design

**Date:** 2026-06-23
**Status:** Approved (design); **Phase 7** of the roadmap (architecture spec `2026-06-22-werejugo-architecture-design.md` §9).
**Scope:** Reusable packing **templates** and per-trip packing **checklists** (grouped by category, with check-off), surfaced both as a standalone Packing module and as a section inside each trip's detail. A trip list can be seeded from a template or a past trip, and any list can be saved as a template.
**Depends on:** Phases 1–2 (families/users, seed pattern) and Phase 6 (trips + the trip detail to embed into).

---

## 1. Context

Packing is greenfield — no tables, no routes; the `packing` rail entry exists but is disabled. The trip detail (Phase 6) already has a sections pattern (Itinerary / Bookings / Travelers) to slot a Packing section into. Built-in starter content follows the existing built-in-themes pattern (`family_id IS NULL`).

## 2. Decisions

| Decision | Choice |
|---|---|
| Surfaces | **Both** — a standalone Packing module (templates + a trip-lists overview) **and** a Packing section embedded in each trip's detail |
| Item fields | **Label + optional category + optional quantity** — lists group into category sections |
| Templates | **User-made + save-as-template, plus built-in starters** (Beach / Winter / Carry-on), seeded family-less like built-in themes (built-ins are read-only, copyable) |
| List model | One `packing_lists` row is a **template** when `trip_id` is null, a **trip list** otherwise; a trip has at most one list |
| Seeding | A trip list can be created blank, **from a template**, or **from another trip** (copies items, unchecked) |
| Implementation split | **7A (backend)** then **7B (frontend)** |

## 3. UX

### Packing module page (rail entry)
- **Templates** — built-in + family templates; create, open (view/edit items grouped by category), delete. Built-ins are read-only but copyable.
- **Trip-lists overview** — every trip that has a packing list, with its progress (e.g. "4/9 packed"); open one to view/check.

### Trip detail — Packing section (Planning)
- No list yet → **Start a list**: blank, **seed from a template**, or **seed from a past trip**.
- Has a list → a checklist **grouped by category** with check-off, add/edit/remove items, a progress count, and **Save as template** (copies the items into a new reusable template).

A shared **`PackingChecklist`** renders a list (grouped, check/add/remove) and is reused by both surfaces.

## 4. Backend (Plan 7A)

### 4.1 Migration (`0010_packing.sql`)
- `packing_lists(id, family_id NULL, trip_id NULL, name, is_builtin BOOL DEFAULT false, created_by, created_at)`. Built-in templates: `family_id IS NULL AND is_builtin`. Indexed by `family_id` and `trip_id`.
- `packing_items(id, list_id REFERENCES packing_lists ON DELETE CASCADE, label, category TEXT DEFAULT '', qty INT NULL, checked BOOL DEFAULT false, seq INT DEFAULT 0, created_at)`. Indexed by `list_id`.

### 4.2 Built-in seed (`seed.ts`)
Add a `BUILTIN_PACKING` set (e.g. *Beach trip*, *Winter*, *Carry-on essentials*), each with categorized items, inserted idempotently (only when a built-in template of that name doesn't already exist) — mirroring `seedThemes`.

### 4.3 Routes (`packing.ts`, family-scoped, `zod`-validated)
- `GET /api/packing/templates` — templates the family can use: its own (`family_id = fam, trip_id IS NULL`) + built-ins (`family_id IS NULL, is_builtin`), each with `itemCount`.
- `GET /api/packing/lists/:id` — a list (template or trip) the family may see (own or built-in) + its items (ordered `category, seq, created_at`).
- `POST /api/packing/lists/:id/items` — `{ label, category?, qty? }`.
- `PATCH /api/packing/items/:id` — edit `label/category/qty/checked/seq` (this is **check-off**).
- `DELETE /api/packing/items/:id`.
- `PATCH /api/packing/lists/:id` — rename. `DELETE /api/packing/lists/:id`.
- `GET /api/trips/:tripId/packing` — the trip's list + items, or `{ list: null }` if none.
- `POST /api/trips/:tripId/packing` — create the trip's list `{ name?, fromTemplateId?, fromTripId? }`; copies the source's items (unchecked) when a source is given. If the trip already has a list, returns it (idempotent).
- `POST /api/packing/templates` — `{ name, fromListId? }` → create a family template (`trip_id NULL`), copying `fromListId`'s items (checked reset to false).

**Built-ins are read-only:** any mutation (`POST .../items`, `PATCH`/`DELETE` item, `PATCH`/`DELETE` list) targeting a list with `is_builtin = true` → **403**. The only way to use a built-in is to copy it (seed a trip list or save-as-template).

### 4.4 DTOs
- List summary: `{ id, name, tripId, isBuiltin, itemCount, checkedCount }`.
- Item: `{ id, label, category, qty, checked, seq }`.
- List detail: `{ id, name, tripId, isBuiltin, items: Item[] }`.

## 5. Frontend (Plan 7B)

- **`components/packing/PackingChecklist.tsx`** — renders a list's items grouped by `category`, with check toggles, an add-item row, inline edit/remove, and a progress count. Props `{ listId, items, readOnly?, onChanged }`; mutations call the API and invalidate.
- **`pages/PackingPage.tsx`** — the module: a Templates panel (built-in + family; create/open/delete) and a Trip-lists overview (each trip with a list + progress); opening a list shows `PackingChecklist` (read-only for built-ins).
- **`components/packing/TripPacking.tsx`** — the trip-detail section: loads the trip's list; if none, a Start control (blank / seed-from-template / seed-from-past-trip); if present, `PackingChecklist` + a **Save as template** action. Rendered as a new section in `TripDetail`.
- **Client (`api/client.ts`):** `PackingList`/`PackingItem` types + `listPackingTemplates`, `getPackingList(id)`, `getTripPacking(tripId)`, `createTripPacking(tripId, opts)`, `addPackingItem(listId, data)`, `updatePackingItem(id, data)`, `deletePackingItem(id)`, `renamePackingList(id, name)`, `deletePackingList(id)`, `savePackingTemplate({ name, fromListId })`.
- Enable Packing in `shell/modules.ts` + a `/packing` route in `AppShell.tsx`.

## 6. Data flow

1. Packing module → `listPackingTemplates` + `listTrips` (to show each trip's `getTripPacking` progress).
2. Trip detail → `getTripPacking(tripId)` → the checklist, or the Start control. Start → `createTripPacking` (optionally seeded) → refetch.
3. Check an item → `updatePackingItem(id, { checked })` → invalidate the list.
4. Save as template → `savePackingTemplate({ name, fromListId })`.

## 7. Error handling

- `zod` validation; family-scoping everywhere (cross-family list/item → 404).
- Built-in lists are read-only (mutations → 403).
- A trip has at most one packing list — re-`POST` returns the existing one rather than duplicating.
- Item endpoints verify the parent list belongs to the family (and isn't built-in for mutations).

## 8. Testing

- **Backend:** list + item CRUD; check-off via item PATCH; built-in templates are **visible** in `templates` and **read-only** (mutations → 403); `createTripPacking` blank and **seeded-from-template** (copies items, all unchecked); idempotent second create returns the same list; `savePackingTemplate` copies a list's items with `checked = false`.
- **Frontend:** `PackingChecklist` toggles an item and adds one; `PackingPage` lists templates and the trip-lists overview; `TripPacking` seeds a list from a template and saves a list as a template.

## 9. Out of scope

- Sharing/assigning items to specific travelers (e.g. "Dad packs the tent").
- Quantities with units / weights, or auto-suggesting items from the trip (weather, length).
- Reusable templates shared across families (built-ins cover the shared case).

## 10. Definition of done

The Packing rail module is live with a templates manager and a trip-lists overview; each trip's detail has a Packing section that starts a list (blank or seeded from a template/past trip), groups items by category with check-off and add/edit/remove, shows progress, and can save the list as a template; built-in starter templates ship and are read-only; all endpoints are family-scoped and tested; frontend tests, typecheck, and build pass.
