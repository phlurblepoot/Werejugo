# Werejugo — Modular Architecture Design

**Date:** 2026-06-22
**Status:** Approved (design); ready for implementation planning
**Scope:** The overall architecture and module system for Werejugo, plus a documented roadmap so each future module is straightforward to build. This is the **foundation** spec. Each later module (People, Photos, Documents, Planning, Packing) gets its own spec → plan → build cycle.

---

## 1. Context & goal

Werejugo is a self-hosted family scrapbook. The first module is an interactive map families pin journeys and memories onto (cruises, flights, road trips, meals, one-off visits). The long-term goal is a **central place for everything travel-related** for one household — past, present, and future: photos linked to trips/places/people, travel documents with renewal reminders, packing planning, future-trip planning, and more. It is explicitly **not** limited to full trips: a single restaurant or a one-off visit is a first-class thing to record.

This spec defines how the modules fit together and share data, so the map can be finished on a clean base and every later module plugs in the same way.

### Decisions locked (from brainstorming)

| Decision | Choice |
|---|---|
| App shell | **Module switcher** — persistent left rail; each module is a full view; map is a peer module |
| Data sharing | **Shared core + universal links** — a small set of first-class entities plus one generic links table; modules are views/filters over the core |
| Deployment | **One household per install** — keep internal family-scoping, assume a single family; members log in, guests are read-only |
| People | **First-class, optional account link** — anyone can be a Person (no login required); a Person may optionally link to a User account |
| Migration approach | **Refactor the core now**, as a **greenfield rebuild** — no real data exists, so wipe and rebuild the schema rather than transform data |
| Photo↔trip | A photo belongs to **at most one trip** (`media.trip_id`), set directly or inherited from a linked visit's trip |
| File storage | **Trip/event folders on disk (Scheme B)** — files live in a browsable tree; only metadata + relative path in the DB |
| Single/loose files | Date-grouped `loose/<year>/`; only trips get named folders |
| Move-on-link | Yes — linking/unlinking moves the file on disk and updates the stored path |
| Build order | Foundation → People → Map Editor Overhaul → Photos → Documents → Planning → Packing → Polish |

---

## 2. Architecture

### 2.1 Tech stack (unchanged)

- **Backend:** Fastify 5 + PostgreSQL/PostGIS, `@fastify/jwt` auth, `zod` validation, `pg`.
- **Frontend:** React + Vite + MapLibre GL.
- **Media:** filesystem storage with `sharp`-generated thumbnails (no bytes in the DB).

We are restructuring how data and screens are organized, not changing technologies.

### 2.2 Shell — persistent left rail

A persistent left rail lists the modules; clicking one opens it as a full view. Replaces the current map-first entry point (`App.tsx` routing straight into `MapPage`).

- Rail entries (in build order): **Map**, **People**, **Photos**, **Documents**, **Planning**, **Packing**. Modules not yet built render as disabled "coming soon" entries.
- The app boots into a default module (Map for now).
- One household per install: every rail view is family-scoped; a read-only guest sees the same rail with write actions hidden/disabled.
- Public read-only share links (`/s/<token>`) remain outside the shell (no login).

### 2.3 Shared core entities (family-scoped)

Five first-class entities every module reads/writes:

- **Person** — anyone relevant to the family's travels, with or without a login. Optional `user_id` link to an account.
- **Visit** — *the atom*: one thing done out in the world (a place, meal, flight, cruise, drive, or stay). Optional geometry (point or route) and date(s). Evolves today's `items`, but becomes **standalone and family-scoped** instead of being owned by a map.
- **Trip** — an optional container that groups visits, with a date range and cover. Can also own packing lists, planning, and documents.
- **Media** — photos/videos/audio as standalone, linkable records (evolves `item_photos`).
- **Document** — passports, visas, bookings, insurance; optional expiry that drives reminders.

### 2.4 Universal links

One generic association table connects any two core entities, with a `role` describing the relationship ("shows", "appears_in", "belongs_to", "visited_with"). A new kind of connection is a row, not a migration.

**Rule of thumb:**
- **One-to-many ownership** stays a plain foreign key (e.g. `visit.trip_id`, `media.trip_id`, `document.owner_person_id`).
- **Many-to-many / cross-cutting** relationships go through `links` (e.g. media↔person, media↔visit).

**A photo belongs to at most one trip.** A photo is taken on a single trip, so the trip association is a foreign key (`media.trip_id`), not a link. It can be set directly or inherited from a linked visit's trip (§6.2). Attempting to give a photo a second, conflicting trip (e.g. linking it to a visit in a different trip) is rejected with a clear message.

### 2.5 Per-module extras

Tables owned by exactly one module, kept out of the shared core:

- **Map:** `map_sets`, `themes`, `icons`, `visit_waypoints` (renamed from `item_waypoints`), `map_set_visits` (membership), reference tables `airports`/`ports`.
- **Packing:** `packing_lists`, `packing_items` (later phase).
- **Documents:** `reminders` (derived/queried from document expiry; later phase may add a row-backed table).

Shared services used by all modules: auth/users, families, comments, share links, and filesystem media storage.

---

## 3. The module contract

Every module is the same four pieces, so adding one is mechanical:

1. **A rail entry** — icon, label, route path.
2. **A page component** — assembled from shared building blocks *(built at the start of Phase 2, not Phase 1 — see §7.3)*:
   - `EntityList` — filterable/sortable list of a core entity.
   - `EntityDetail` — a detail view.
   - `RelatedPanel` — shows and edits an entity's links (its photos, people, trips, documents). The standard cross-module surface.
   - `EntityPicker` — search/select a core entity (used when creating links).
   - `MediaUploader` — drag-drop upload producing `media` records.
3. **A routes file** — `backend/src/routes/<module>.ts`, family-scoped by shared auth middleware, registered in `index.ts`.
4. **Linking via one generic API** (see §4) — reused by every module; no per-pair plumbing.

**Adding a module = a routes file + a page + a rail entry.** Linking, media upload, auth, and the Related panel are all reused.

---

## 4. Universal links API

A single set of endpoints, family-scoped:

- `POST /api/links` — body `{ from: "visit:<id>", to: "trip:<id>", role?: string }`. Validates both entity types and family ownership; dedupes.
- `GET /api/links?entity=visit:<id>` — returns all links touching the entity, in both directions, with the linked entity's summary (title, thumb, date) for rendering.
- `DELETE /api/links/<id>`.

**Schema sketch (`links`):**

```
links(
  id          uuid pk default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  from_type   text not null,   -- 'visit'|'trip'|'person'|'media'|'document'
  from_id     uuid not null,
  to_type     text not null,
  to_id       uuid not null,
  role        text,            -- relationship label, nullable
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique(family_id, from_type, from_id, to_type, to_id, role)
)
```

- Entity references are stored as `(type, id)` pairs; `GET` queries both `from_*` and `to_*` so direction is transparent to callers.
- A small allow-list of `(from_type, to_type)` pairs is validated server-side to keep links meaningful.
- Creating/deleting a link that affects a file's canonical location triggers the storage reconciler (§6.3).

---

## 5. Core schema sketches

Indicative shapes; exact columns finalized in the implementation plan.

```
people(
  id uuid pk, family_id uuid not null,
  display_name text not null, relationship text,
  avatar_media_id uuid null references media(id) on delete set null,
  user_id uuid null references users(id) on delete set null,  -- optional account
  notes text default '', created_at timestamptz default now()
)

visits(                              -- evolves items
  id uuid pk, family_id uuid not null,           -- NEW family scope
  trip_id uuid null references trips(id) on delete set null,
  kind text not null,                            -- place|food|flight|cruise|drive|stay|custom
  title text not null, notes text default '',
  occurred_on date, occurred_end date,
  geom geometry(Geometry,4326),
  theme_id uuid, color text, icon text,
  properties jsonb default '{}',
  created_by uuid, created_at timestamptz, updated_at timestamptz
)                                    -- map_set_id removed -> map_set_visits

media(
  id uuid pk, family_id uuid not null,
  kind text not null,                            -- image|video|audio
  trip_id uuid null references trips(id) on delete set null,  -- at most one trip; drives folder
  rel_path text not null,                        -- e.g. trips/2024-italy/photos/venice-canal.jpg
  thumb_path text, original_name text,
  taken_at timestamptz,                          -- EXIF date (fallback: upload time)
  geom geometry(Point,4326),                     -- EXIF GPS (suggests visit links)
  width int, height int, bytes bigint,
  caption text default '', created_by uuid, created_at timestamptz
)

documents(
  id uuid pk, family_id uuid not null,
  title text not null, doc_type text not null,   -- passport|visa|booking|insurance|other
  rel_path text not null, original_name text,
  owner_person_id uuid null references people(id) on delete set null,
  owner_trip_id   uuid null references trips(id)  on delete set null,
  issued_on date, expires_on date, reminder_lead_days int,
  notes text default '', created_by uuid, created_at timestamptz
)

map_set_visits(
  map_set_id uuid references map_sets(id) on delete cascade,
  visit_id   uuid references visits(id)   on delete cascade,
  seq int default 0,
  primary key (map_set_id, visit_id)
)
```

`item_photos` is superseded by `media` (standalone) + `links` (media→visit/trip/person). `trips` keeps its current shape. `comments` may later generalize from visit-only to any entity via `(entity_type, entity_id)`; for the foundation it stays attached to visits.

---

## 6. File storage design (Scheme B — trip/event folders)

**Principle:** the DB stores only metadata and a **relative path**; file bytes always live on the filesystem in a human-browsable tree. Today's flat, opaque storage (`/app/uploads/<random>.jpg`) is replaced by an organized tree with readable filenames.

### 6.1 Folder layout

```
storage/
  trips/<YYYY-trip-slug>/
    photos/        <media files + .thumb.jpg siblings>
    documents/     <trip-owned documents>
  people/<person-slug>/        <person-owned documents, e.g. passports>
  loose/<YYYY>/                <photos not linked to any trip, incl. single visits>
  loose/documents/             <documents with no owner>
```

- **Only trips get named folders.** Single-visit and not-yet-linked photos live in `loose/<year>/` (year from `taken_at`, else upload time).
- Filenames derive from the original name, kebab-cased; on collision within a folder, append `-2`, `-3`, …
- Thumbnails sit beside the original as `<name>.thumb.jpg`.
- `slug` for a trip = `<YYYY>-<kebab(name)>` (year from `start_date`; omit year if undated). `person-slug` = `kebab(display_name)` (+ short id suffix on collision).

### 6.2 Canonical-location rule

For **media** (a photo belongs to at most one trip — `media.trip_id`):
1. `media.trip_id` is set either directly or by inheriting a linked visit's `trip_id` (**"follow the visit's trip"**): linking a photo to a visit that belongs to a trip sets the photo's `trip_id` to that trip.
2. If `trip_id` is set → `trips/<trip-slug>/photos/`.
3. Else → `loose/<YYYY>/` (year from `taken_at`, else upload time).

**Conflict rule:** if an action would give a photo a *different* non-null `trip_id` than it already has (e.g. linking it to a visit in another trip), the action is rejected with a clear message rather than silently re-homing the file.

For **documents**:
1. `owner_trip_id` set → `trips/<trip-slug>/documents/`.
2. else `owner_person_id` set → `people/<person-slug>/`.
3. else → `loose/documents/`.

### 6.3 Storage reconciler (move-on-link)

A service `reconcileStorage(entity)`:
- Computes the desired canonical path from current links/owners.
- If it differs from the stored `rel_path`, **moves the file and its thumbnail**, then updates `rel_path`/`thumb_path` in the same transaction.
- Is **idempotent** (safe to re-run) and best-effort on the filesystem move: move file first, then commit DB; a failed commit leaves a recoverable state the next reconcile fixes.

**Triggers:** `media.trip_id` change (set directly or inherited from a linked visit's trip); document owner change; trip rename or `start_date` change (re-slug → reconcile all of that trip's files).

### 6.4 Implications & edge cases

- A file has exactly **one** on-disk home (its `trip_id`, else `loose/`); all other relationships (people, visits) remain virtual in `links`.
- A photo can belong to at most one trip; conflicting trip assignments are rejected (§6.2), not silently re-homed.
- Changing a trip's name or start date re-slugs its folder and re-homes that trip's files.
- Deletion removes the file from its current folder (best-effort), then the row.
- The reconciler runs in the request path for single operations and can be batch-invoked after bulk imports.

---

## 7. Phase 1 — Foundation scope

### 7.1 Backend

- **Schema (greenfield rebuild, §8):** stand up the full target schema — `people`, `media` (with `trip_id`), `documents`, `links`, `map_set_visits`, `visits` (replacing `items`, with `family_id` and `kind 'stay'`), `visit_waypoints`, `comments` — and drop the old `items`/`item_photos`/`item_waypoints`/`item_comments` tables. Wipe and reseed dev data.
- **Generic links service + routes** (§4) and the **storage reconciler** (§6.3).
- **Refactor** `items`/`trips`/`uploads`/`mapsets`/`share`/`stats`/`export`/`import` routes onto the new model.
- Storage helper rewritten to compute canonical paths and readable names instead of flat random IDs.

### 7.2 Frontend

- **`AppShell`** with the left rail and module routing (replaces map-first `App.tsx`).
- **Map module:** `MapPage` becomes a module that reads visits via `map_set_visits`; existing maps keep working. The data migration is concentrated in `api/client.ts` (item/photo/trip/comment/stats methods repointed to the new endpoints while keeping their names and DTO shapes), so the Map components need no edits.
- Rail shows Map (working) with later modules disabled.
- **Shared UI components are deferred — see §7.3.** The genuine frontend foundation is the shell plus the Map on the new core; the reusable components are built alongside their first consumer in Phase 2.

### 7.3 Out of scope for the foundation

- **Shared UI components** — `RelatedPanel`, `EntityPicker`, `MediaUploader`, `EntityList`, `EntityDetail` are **deferred to Phase 2 (People)**, their first real consumer, so their interfaces are shaped by actual use rather than guessed. Building them in Phase 1 with no module to host them would be speculative (YAGNI). Phase 2's first task is to build these as reusable components (not People-specific), so every later module inherits them. The module contract (§3) still describes them as the standard building blocks — they simply land at the start of Phase 2 instead of Phase 1.
- People/Photos/Documents/Planning/Packing module UIs (later phases) — but their tables (`people`, `media`, `documents`) are created now so links work immediately.
- Notifications delivery (email/push) for reminders — only the data + a queryable "upcoming expiry" view exist.
- Generalized sharing beyond the current map share link.

---

## 8. Schema rebuild (greenfield)

There is **no real data to preserve** — only disposable test/seed rows. So this is a clean schema rebuild, not a data-preserving migration. This removes a large amount of risk and work.

**Approach:**
1. Author the new schema as the target state: `families`, `users`, `people`, `trips`, `visits` (replacing `items`), `media`, `documents`, `links`, `map_sets`, `themes`, `icons`, `visit_waypoints`, `map_set_visits`, `comments`, `share_links`, reference tables (`airports`, `ports`). Either consolidate into a fresh initial migration or add forward migrations that drop/replace the old `items`/`item_photos`/`item_waypoints`/`item_comments` tables.
2. Drop the existing dev database (and wipe the old `/app/uploads` folder) and re-run migrations from clean.
3. Update `seed.ts` to generate fake data in the new shape (people, visits with `trip_id`, media in trip/loose folders, a few links, sample documents).
4. No file-relocation step is needed — there are no real files to move; new uploads land in the Scheme B tree directly.

**Note:** because this wipes the dev data, do it as a deliberate reset. After this point the storage layout and schema are the canonical baseline for all later phases.

---

## 9. Build sequence to a completed application

The full app is reached through eight phases. Each phase after the foundation is its own spec → plan → build, reuses the module contract (§3), and ends in a shippable, usable increment. Phases are ordered by dependency and payoff; nothing depends on a phase that comes after it.

### Phase 1 — Foundation *(this spec)*

**Goal:** the shared core and shell that everything else is built on.
**Steps:**
1. Greenfield schema rebuild (§8): new tables, drop old `items`/`item_photos`/`item_waypoints`/`item_comments`, reseed.
2. Universal links service + API (§4) and the `(from_type,to_type)` allow-list.
3. Storage layer: Scheme B canonical paths, readable filenames, the move-on-link reconciler (§6), and the auth-gated file-serving route (§10).
4. Left-rail `AppShell` + module routing (replaces map-first `App.tsx`).
5. Refactor the Map onto the new core (visits via `map_set_visits`); existing maps keep working.

*(The shared UI building blocks — `RelatedPanel`, `EntityPicker`, `MediaUploader`, `EntityList`, `EntityDetail` — are **deferred to the start of Phase 2**; see §7.3.)*

**Delivers:** the app runs on the new architecture; the Map module works end-to-end; later modules are now "a routes file + a page + a rail entry." **Depends on:** nothing.

### Phase 2 — People

**Goal:** people as first-class, taggable entities.
**Steps:** **first, build the deferred shared UI components** as reusable, entity-agnostic building blocks — `RelatedPanel`, `EntityPicker`, `MediaUploader`, `EntityList`, `EntityDetail` (factored from today's `ItemDetail`/`GalleryPanel`/`Lightbox`/`PlaceSearch`); then `people` CRUD routes; People module page (`EntityList` + `EntityDetail` with `RelatedPanel`); avatar upload (`MediaUploader`); optional link of a Person to a User account; the `EntityPicker` for people is reused by every other module.
**Delivers:** the reusable component library plus: create anyone (with or without a login) and see everything linked to them. **Depends on:** Phase 1.

### Phase 3 — Map Editor Overhaul

**Goal:** replace the messy 790-line `ItemEditor` with a clean, fast, kind-tailored add/edit experience. *(Full design: `2026-06-23-map-editor-overhaul-design.md`.)*
**Steps:** decompose the god-component into a thin `VisitEditor` shell + per-kind Details forms (`PlaceForm`/`FlightForm`/`CruiseForm`/`DriveForm`) + extracted hooks (`useVisitDraft`, `useCruiseLookup`); a type-selector-on-top, **Details / Appearance** tabbed UX; appearance reuses the existing style controls; photos go through Phase-2's `MediaUploader`. No backend changes.
**Delivers:** a maintainable editor (~8 files, each <150 lines, with tested draft/lookup hooks) and a less-cluttered, kind-aware add-to-map flow with parallel photo uploads. **Depends on:** Phase 2 (shared `MediaUploader`).

### Phase 4 — Photos / Media

**Goal:** a real photo library, not just per-pin attachments. *(Full design: `2026-06-23-photos-media-design.md`.)*
**Steps:** a **timeline** grid (photos grouped by capture month) with person / trip / place filters and a **Grid/Map** toggle (clustered map of geotagged photos); a `GET /api/media` list endpoint (filters + keyset paging); **EXIF captured on upload** (`taken_at`/`geom`); a bulk upload that runs a **suggest-and-confirm** review (trip by date, nearby visit by GPS — people stay manual); a photo detail with caption, trip select (drives its folder, §6), and `RelatedPanel` links.
**Delivers:** a central gallery where any photo can be found by who/where/when and connected to the rest of the app. **Depends on:** Phases 1–2 (people tagging, shared components).

### Phase 5 — Documents & reminders

**Goal:** the practical travel-paperwork hub. *(Full design: `2026-06-23-documents-reminders-design.md`.)*
**Steps:** a **renewals banner + filterable list** page; `documents` CRUD with a None/Person/Trip owner and an **optional** PDF/image file (saved into the owner's folder, with an attach-later endpoint); a PDF-capable `saveDocumentUpload` + a `reconcileDocument` (owner-change file move); a computed **status** (overdue/upcoming/ok) from each doc's `reminder_lead_days`; a `due-count` endpoint driving a **rail badge** (the one new shell capability).
**Delivers:** every important document stored, browsable on disk by owner, with upcoming/overdue renewals visible at a glance (in-app). **Depends on:** Phases 1–2. *(Email/push delivery remains deferred — §7.3.)*

### Phase 6 — Future trip planning

**Goal:** plan trips that haven't happened yet.
**Steps:** treat a planned trip as a Trip with future dates + a `status` (idea / planning / booked / done); itinerary of planned visits; idea/wishlist visits not yet scheduled; attach bookings (documents) and people; a planning view distinct from the past-trips view.
**Delivers:** upcoming trips live alongside past ones, with itinerary, bookings, and who's coming. **Depends on:** Phases 1, 2, 5 (visits, people, documents).

### Phase 7 — Packing

**Goal:** packing lists tied to trips.
**Steps:** `packing_lists` + `packing_items`; reusable list **templates**; per-trip checklists with check-off state; optionally seed a list from a template or a similar past trip.
**Delivers:** every trip can carry packing checklists, reused across trips. **Depends on:** Phases 1, 6 (trips/planning).

### Phase 8 — Polish & completion

**Goal:** turn the module set into a finished product.
**Steps:** consistent empty/loading/error states across modules; cross-module search ("find anything: a person, place, trip, document, photo"); finalize the read-only **guest** experience across all modules; generalized sharing if desired (promoted from §7.3); backup/export of the full family archive (DB + storage tree); docs/onboarding.
**Delivers:** a cohesive, shareable, backup-able family travel hub. **Depends on:** Phases 1–7.

### Definition of done — the completed application

A self-hosted hub where one household can: pin and map everywhere they've been (trips and one-off visits); keep a searchable photo library linked to trips, places, and people; record the people who share their travels; store travel documents and see renewals coming; plan future trips with itineraries, bookings, and packing lists; browse the whole archive as an organized folder tree on disk; share selected views read-only; and back the whole thing up. Every module reads and writes the same shared core through one links API and one Related panel — so new ideas that fit the theme remain quick to add.

---

## 10. Cross-cutting concerns

- **Auth & guests:** existing JWT. Roles `owner`/`member` plus a read-only **guest** capability (write actions hidden server- and client-side). One family per install; every query is family-scoped.
- **Media storage:** filesystem + `sharp` thumbnails; `media`/`documents` hold `rel_path` only. See §6.
- **File serving & privacy:** readable paths (`trips/2024-italy/photos/venice-canal.jpg`) are human-friendly but **guessable**, unlike today's random filenames. So files are served through an **auth-gated route** (family session required), not a wide-open static mount. Files belonging to a shared view are reachable via that view's **share token**. This preserves browsable on-disk names without making everything world-readable by URL.
- **Reminders:** documents carry `expires_on` + `reminder_lead_days`; a queryable "upcoming" view powers a reminders surface. Delivery channels (email/push) are a later hook, not built now.
- **Sharing:** current read-only map `share_links` keep working; generalized per-view sharing arrives with later modules.
- **Comments:** stay on visits for the foundation; may generalize to any entity later via `(entity_type, entity_id)`.

---

## 11. Error handling

- `zod` validation on every route (already the pattern).
- Family-scoping enforced in every query; cross-family access returns 404.
- Links: validate entity types against the allow-list, dedupe, and verify both endpoints belong to the family.
- Storage reconciler is idempotent; filesystem moves are best-effort with DB as source of truth.
- Uploads: enforce type/size limits (existing 25 MB multipart cap; per-type extension allow-list).

---

## 12. Testing strategy

- **Per-route API tests** for the new links service and each refactored route (family-scoping, validation, dedupe).
- **Schema/seed test:** run all migrations from clean and the seed script; assert the seed produces a coherent graph (visits with trips, media in the right folders, valid links) and that files land at correct canonical paths.
- **Storage reconciler tests:** setting/clearing `media.trip_id` (directly or via a visit link) moves the file and updates `rel_path`; the conflict rule rejects a second trip; trip rename re-homes files; idempotency.
- **Shell smoke test:** the rail renders, the Map module loads, disabled modules are inert.

---

## 13. Open questions / future considerations

- Notification delivery for reminders (email/push/digest) — channel + scheduling design.
- Generalized sharing (share a trip, an album, a person's page) — token scope model.
- Whether `comments` generalize to all entities and when.
- Optional later add-on: read-only `by-person` browse views on disk (symlink layer) if filesystem browsing by person becomes desirable — Scheme B already gives by-trip.

---

## 14. Summary

A persistent left-rail shell hosts modules that all read and write a small shared core (Person, Visit, Trip, Media, Document) connected by a universal links table. Files live in a browsable trip/event folder tree with only paths in the DB, and move to follow their trip links. The foundation phase refactors today's map onto this core and ships the links API and storage reconciler; the shared UI building blocks are built at the start of Phase 2 (their first consumer — see §7.3). After that, People, Photos, Documents, Planning, and Packing are each "a routes file + a page + a rail entry."
