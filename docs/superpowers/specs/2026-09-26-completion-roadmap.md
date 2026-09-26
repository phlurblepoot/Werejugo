# Werejugo — Completion Roadmap (v2)

**Written:** 2026-09-26
**Supersedes:** the build sequence in `2026-06-22-werejugo-architecture-design.md` §9 (Phases 1–8 are all built; this roadmap takes the app from "feature-complete on paper" to "finished and in daily use").
**Inputs:** a full audit of the repo at `e1136dd` (both test suites run against a real PostGIS database, the app run locally with demo data and clicked through in a headless browser at desktop and phone widths), plus a Q&A session with the owner whose answers are recorded in §2.

> **This file is the project's source of truth for what is planned, what is done, and what changed.** Every session reads the Status block below before working and updates this file in the same commit as the work. The rules are in `CLAUDE.md` → "Roadmap discipline"; `node scripts/roadmap.mjs` prints a summary and `--check` validates this file.

<!-- status:begin -->
## Status

| Field | Value |
|---|---|
| **Current milestone** | Milestone 1 — Foundation: safe, multi-family, new design |
| **Current phase** | 1.4 |
| **Next step** | Build Phase 1.4: error handler + validation → `access.ts` → baseline migration → migrate routes → tenant-isolation suite → per-family export |
| **Blocked on** | Nothing |
| **Last updated** | 2026-09-26 |
<!-- status:end -->

**How tracking works**

- Each phase in §4 has a line `**Status:** <state> · **Plan:** <link> · **PR:** <link>`. States: `Not started` → `Planned` (detailed plan written) → `In progress` → `In review` (PR open) → `Done`; or `Dropped` (with the reason in §8).
- Checklist items are ticked `[x]` in the same commit as the work. Items are never deleted: dropped items are struck through `~~like this~~ (dropped YYYY-MM-DD — reason)`, and new ones end with `(added YYYY-MM-DD)`.
- Every completed phase, plan change, owner decision and notable finding gets a dated entry in **§8 Progress & change log** (newest first).

---

## 1. Where things stand

### 1.1 What exists

Werejugo started on 2026-05-23 as a single-map app: pins for places, food, flights, cruises and drives; CruiseMapper cruise lookup with the real sailed route; timeline playback; a "passport" country map; share links; a basic PWA; and an Unraid install via GHCR images. Between 2026-06-22 and 06-25 it was rebuilt, following the phased specs in this folder, into a six-module hub over a shared core (Person, Visit, Trip, Media, Document + a universal `links` table):

| Module | What works today |
|---|---|
| Map | Map sets, add/edit editor per kind (place/food/flight/cruise/drive/custom), cruise lookup (line → ship → sailing → real route), pin/trail styling, themes, timeline, passport map, GPX/KML import |
| People | People list/detail, avatar, related-items panel |
| Photos | Month-grouped grid, filters, map view, upload with EXIF, trip/visit suggestions |
| Documents | Documents with owner (person/trip), optional file, expiry status, renewal banner, rail badge |
| Planning | Kanban board by status, timeline with blackout dates, trip detail (itinerary, wishlist, bookings, packing, travelers) |
| Packing | Built-in + custom templates, per-trip checklists |
| Shell | Left rail, Ctrl/Cmd-K search, trip/album public share links, full backup/restore, first-run welcome |

Health: backend typecheck clean, **102/102** tests pass; frontend typecheck clean, **100/101** tests pass (the one failure is a jsdom `Blob` realm quirk in `src/api/share-backup-client.test.ts`, not an app bug). Tests are shallow (1–6 per route file) and the frontend tests nearly all mock the API.

### 1.2 Blocking problems (all reproduced)

| # | Problem | Where |
|---|---|---|
| B1 | **A new family is locked out.** The first-run welcome is an absolute overlay covering every page, can't be dismissed, and never refetches; its buttons navigate underneath it. | `frontend/src/shell/FirstRunWelcome.tsx`, `global.css:572` |
| B2 | **Photos and documents are not persisted in Docker/Unraid.** Files go to `STORAGE_DIR=/app/storage`, but only `/app/uploads` is a volume, so everything is lost when the container is recreated/updated. | `docker-compose.yml:34-35`, `unraid/werejugo-backend.xml`, `backend/src/config.ts:19` |
| B3 | **Anyone who can reach the app can register, then download a backup of every family on the server** (all users incl. password hashes, all files) — or, as the "owner" of their new family, **restore and wipe everyone**. | `backend/src/routes/auth.ts:41`, `backend/src/routes/backup.ts:15,40`, `backend/src/lib/archive.ts:17` |
| B4 | The default JWT secret is used silently when unset; it also signs file URLs, so tokens and file links are forgeable. | `backend/src/config.ts:11`, `backend/src/lib/filesign.ts` |
| B5 | GPX/KML import returns 500 for any file with elevation ("Geometry has Z dimension but column does not"). | `backend/src/routes/import.ts:87` |
| B6 | Dates render as raw timestamps (`2024-06-01T00:00:00.000Z`) and **shift by a day** on servers in time zones east of UTC (node-pg parses `DATE` as local midnight). | `backend/src/db/pool.ts` (no type parser), e.g. `Sidebar.tsx:106`, `TripBoard.tsx:24` |

### 1.3 Other notable gaps (details in Appendix A)

- Search results only open the module, never the item (deep links are ignored by every page).
- Trips can't be edited or deleted from Planning; itinerary "→ visit" creates a visit with no location and no map membership, so it never appears.
- Uploading a photo in the map editor closes the editor and discards edits; a failed photo upload + Save creates a duplicate visit.
- The Documents search box loses focus on every keystroke; custom packing template edits never refresh.
- Settings holds only backup/restore — no profile, password change, members, or invite management; the invite code is shown only in the Map header and hidden on phones.
- Mobile: rail always visible, header actions overflow off-screen, fixed-width board/packing columns, no safe-area handling, 14px inputs zoom on iOS.
- iPhone photos (HEIC) are rejected; 25 MB upload cap; nginx caps requests at 30 MB (so restores of real archives fail).
- Only 69 airports and 46 ports are bundled; place search hits the public Nominatim server as-you-type (against its usage policy).
- The Map sidebar keeps legacy Trips/Photos/Stats/Export panels that duplicate newer modules.
- Shared trip page ignores the itinerary, doesn't zoom to the trip, and pins aren't clickable.
- Trip rename doesn't re-home files (`backend/src/routes/trips.ts:50` TODO).
- Project hygiene: there is no `main` branch, CI publishes images from `claude/laughing-edison-sTVtG` and runs no tests; an old branch `claude/confident-ramanujan-xDIFr` holds one unmerged styling commit.

---

## 2. Decisions (from the owner Q&A, 2026-09-26)

| Topic | Decision |
|---|---|
| Current data | Running with **test data only** — breaking schema changes and a one-time DB reset are fine |
| Exposure | **Public domain via Cloudflare Tunnel** → security fixes come first |
| Tenancy | **Multiple families per server.** Each login belongs to exactly one family |
| Shared trips | Trips can be **shared between families**; both add to them. The **host picks the role per invite** (co-owner or contributor). Invites are **one-time links/codes** |
| Shared-trip photos | Another family's photos show **only inside the shared trip**, not in my library |
| Private on shared trips | **Packing lists, bookings & documents, budget/expenses** stay private per family |
| People | People can be **linked across families** (one "Grandma" across both families) |
| Server admin | A **separate admin role**; the admin **can see and control everything** |
| New families | **Admin sends a one-time invite**; no public signup |
| Sequencing | **Multi-family first**, then the rest; work reviewed in **milestones** |
| Devices | Phones and desktop **equally** |
| Top modules | **All**: Map, Photos, Documents, Planning + Packing |
| Map sets | Replace with **one family map + filters** |
| Legacy map panels | **Remove and link out**; stats move to a Stats page |
| Cruises | **Essential** — keep and harden the CruiseMapper lookup (real sailed route + ship info) |
| Flights | World airports list **plus flight-number lookup** (AeroDataBox) |
| Geocoding | **Photon** |
| Road trips | **Follow roads** |
| Photos | Sources: iPhone, Android, dedicated cameras. **20,000+ photos per family. Full video support** |
| Photo backend | **Immich is the photo store and backend**, but Werejugo must feel seamless (images look native to Werejugo) |
| Immich accounts | Each family gets an **account on the owner's Immich server** (not yet installed) |
| Immich features | **Faces → people, trip ↔ Immich album sync, smart search, auto-suggest trip photos, location data to suggest new trips/visited places** |
| Albums | **Smart albums** (saved filters) |
| Notifications | **Phone push** (web push) |
| Document security | **Encrypt document files at rest** |
| Share links | **Expiry date, richer trip page, allow downloads** |
| Offline | **Key trip info offline** (itinerary, packing, bookings, document copies) |
| Design | **Fresh design pass** — a real design system, light + dark |
| Scrapbook features | **Trip journal, Memories (on this day / year in review), printable trip book, travel stats** |
| Planning extras | **Drag & drop, day-by-day itinerary, budget & expenses, packing per person** |
| Imports | **Google Maps Timeline, TripIt / booking emails** |
| Git | **`main` + PRs + CI**; images publish only from `main` and tags |
| Old branch | Delete `claude/confident-ramanujan-xDIFr` once `main` exists (owner approves at that point) |
| Progress tracking | This roadmap is the source of truth for where we are, what is done and what changed. It is updated in the same commit as the work, enforced by `CLAUDE.md` rules, a session-start status hook, the PR template and a CI check |

---

## 3. Target architecture changes

### 3.1 Accounts, families and the server admin

- `users.is_admin` (server admin) is separate from the family role (`owner`/`member`). The first account is created by a **setup wizard** on an empty server (creates the admin and their family). Public registration is removed.
- **Admin console**: families (create via one-time invite link, rename, disable, delete), users (disable, promote, generate password-reset link), server backup/restore, Immich connection + per-family Immich status, storage usage, audit log. The admin can **switch into any family** to see and control its data; every such access is written to the audit log, and families are told at onboarding that the server admin has full access.
- **Family settings**: members, one-time member invite links (replace the static `invite_code`), roles, remove member.
- **Account**: profile, password change, "sign out everywhere" (a `token_version` on users checked by `requireAuth`, so role changes and disables take effect immediately).

### 3.2 A single access layer

Today every route hand-writes `WHERE family_id = $1`. With shared trips that rule becomes "my family's rows **or** rows on a trip my family is a member of, minus the per-family-private kinds". That must live in one place:

- `backend/src/lib/access.ts` — `viewerScope(user)` (family id, admin flag, member trip ids + roles) and `canRead/canEdit/canDelete(entityType, row, scope)`.
- Every route goes through it; a table-driven **tenant-isolation test suite** asserts, for every endpoint, that family B can't read or change family A's rows unless a shared trip grants it, and that private kinds never leak across a shared trip.
- A global Fastify error handler (zod → 400, bad UUID → 400/404, not-found → 404) replaces today's 500s.
- Optional defense-in-depth: Postgres row-level security keyed on a per-request `app.family_id` setting. Evaluate in Phase 1.4; not required.

### 3.3 Shared trips (data model sketch)

```
trip_members(trip_id → trips, family_id → families,
             role text check (role in ('host','coowner','contributor')),
             invited_by → users, joined_at, primary key (trip_id, family_id))
trip_invites(id, trip_id, role, token_hash, expires_at, created_by,
             accepted_family_id null, accepted_at null)
```

- Trip-scoped content (visits, itinerary items, journal entries, comments, photo references) keeps its **author family + user** on every row. Contributors edit/delete their own; co-owners edit everything; the host also manages members and trip details.
- **Private per family even on a shared trip:** packing lists, documents/bookings, expenses — always filtered to the viewer's family.
- **Another family's photos** appear only inside the shared trip view (never in my Photos library). Werejugo fetches them from Immich with the *owning* family's credentials, so no Immich-level sharing is needed.
- Attribution everywhere ("added by the Smiths").
- Default when a family leaves or is removed: its contributions leave with it (see §7).

### 3.4 People across families

`person_links(person_a → people, person_b → people, status pending|accepted, requested_by)` — one family proposes "our Grandma is your Grandma"; the other accepts. A linked person's page shows everything the **viewer** is allowed to see from both families. On a shared trip, either family can tag people from both families' lists.

### 3.5 One map

`map_sets` / `map_set_visits` are dropped. Every visit the viewer can see is on the one map, filtered by trip, person, date/year, kind and (for shared trips) family; filters live in the URL so they are deep-linkable. The base-map style moves to family settings. Visits created anywhere (e.g. itinerary → visit) show up automatically.

### 3.6 Immich as the photo backend

```
Browser ──(chunked, resumable upload / signed media URLs)──► Werejugo backend ──(LAN, per-family API key)──► Immich
                                                               │  media table = references + cached metadata
                                                               │  (immich_asset_id, family_id, trip_id, taken_at, geom, kind, w/h, hidden)
                                                               └─ pg-boss jobs: upload hand-off, sync, suggestions, face import, album sync
```

- **Seamless:** the browser never talks to Immich. Werejugo proxies thumbnails, previews, originals and video (with HTTP Range for seeking) at its own URLs, with cacheable signed links.
- **Provisioning:** the admin configures the Immich URL + an Immich admin API key once. Creating a family creates its Immich user and an API key for it (stored encrypted in Werejugo). Existing Immich users can be linked instead.
- **Uploads:** the browser uploads in chunks to Werejugo (tus-style, resumable; every chunk well under Cloudflare's 100 MB request cap). Werejugo hands the assembled file to Immich over the LAN, and Immich does HEIC/RAW decoding, video transcoding, thumbnails and duplicate detection.
- **Metadata cache:** Werejugo keeps a small copy of each asset's date, location, type and size so filters, the map and joins stay fast. A sync job reconciles it with Immich.
- **Features:** faces → Werejugo people, trip ↔ Immich album (two-way), smart search in the command palette, date + location photo suggestions for trips, and location clusters that suggest trips and visits that don't exist yet.
- **Werejugo's own file storage** keeps only documents (encrypted), custom pin icons and map overlays. The legacy public `/uploads` store is folded into the auth-gated storage tree.
- **Compatibility:** pin a supported Immich version range, check `/api/server/version` at startup and on the admin page, and keep all calls behind one adapter module with contract tests.

### 3.7 Background jobs

Introduce **pg-boss** (a job queue on the existing Postgres, so no Redis) for Immich hand-off and sync, suggestions, reminders/push schedules, imports and trip-book rendering.

### 3.8 Deployment topology (Unraid + Cloudflare Tunnel)

`werejugo-db` (PostGIS), `werejugo-backend`, `werejugo-frontend` (nginx), plus Immich's own containers (`immich-server`, `immich-machine-learning`, `redis`/`valkey`, Immich's `postgres`), with a `cloudflared` tunnel pointing at `werejugo-frontend` only (Immich stays LAN-only). Volumes: Werejugo DB, Werejugo storage (documents/icons), Immich library and DB.

---

## 4. Milestones

Each phase gets its own detailed implementation plan in `docs/superpowers/plans/` at the start of the phase (same TDD, task-by-task format as Phases 1–8). All phases of a milestone land on one branch and are reviewed as **one pull request per milestone** to `main`; a phase is `Done` when its work is complete and verified on that branch, and the milestone is finished when the owner merges the PR. The owner reviews and tests on Unraid at the end of each **milestone**. Sizes are relative: S < M < L < XL.

### Milestone 1 — Foundation: safe, multi-family, new design

#### 1.1 Safety net & project hygiene — S

**Status:** In review · **Plan:** [phase-1.1](../plans/2026-09-26-phase-1.1-safety-net.md) · **PR:** [#1](https://github.com/phlurblepoot/Werejugo/pull/1)

*(first PR; small, and needed before the app faces the internet)*

- [x] Create `main` from the current work; CI on every PR: backend + frontend typecheck, backend tests against a PostGIS service container, frontend tests, production builds; images publish only from `main` and `v*` tags; fix the jsdom `Blob` test.
- [x] Preview images: pushes to `claude/**` branches publish images tagged with the branch name (never `latest`), so a milestone can be tested on Unraid before it is merged. (added 2026-09-26)
- [x] B2: add a `/app/storage` volume to `docker-compose.yml` and the Unraid template; document `STORAGE_DIR`/`UPLOADS_DIR` in `.env.example`; fix README paths.
- [x] B4: refuse to boot in production with a missing, default or short `JWT_SECRET`; separate `FILE_SIGNING_SECRET`.
- [x] B3 (stopgap until 1.3): disable public registration after the first family (`ALLOW_SIGNUP=false` default); restrict backup/restore to the first family's owner; restore validates the archive's `storage/` before wiping anything.
- [x] Backups also include `UPLOADS_DIR` (icons, map overlays, ship images), and restore replaces the storage contents in place (the directory is a volume mount point in Docker). (added 2026-09-26)
- [x] B1: make the first-run welcome an inline, dismissible panel that refetches.
- [x] B5: `ST_Force2D` on import, handle every part of MultiLineStrings, report skipped features.
- [x] B6: parse `DATE` columns as plain `YYYY-MM-DD` strings; one shared frontend date formatter.
- [x] Quick hardening: `@fastify/rate-limit` on auth, `@fastify/helmet` security headers, reject SVG uploads, `/api/auth/me` returns 401 (not 500) for a deleted user, nginx `client_max_body_size`/timeouts sized for chunked uploads and restore.
- [ ] After `main` exists and the owner approves: delete `claude/confident-ramanujan-xDIFr`. *(Waiting on the owner's approval at the Milestone 1 review.)*
- [x] CI runs `node scripts/roadmap.mjs --check --changed-since origin/main` on every PR, so a PR that changes app code without updating this roadmap fails. (added 2026-09-26)

#### 1.2 Design system & responsive shell — M

**Status:** Done · **Plan:** [phase-1.2](../plans/2026-09-26-phase-1.2-design-system.md) · **PR:** [#1](https://github.com/phlurblepoot/Werejugo/pull/1)

- [x] Tokens (color, type scale, spacing, radius, elevation) with light, dark and "system" themes; an icon set (Lucide) replaces emoji icons.
- [x] Core components: PageHeader (with overflow menu), Button/IconButton, form fields (16px on mobile), Select, DatePicker, Modal ↔ bottom Sheet on phones, Tabs, Menu, ConfirmDialog, Toast, Card, Avatar, Chip, EmptyState/Spinner/ErrorState. Consider Radix primitives for accessible dialogs and menus.
- [x] Responsive shell: left rail on desktop, bottom tab bar + "More" on phones, safe-area insets, consistent header heights.
- [x] Restyle the login, settings and shell now; every later phase builds and restyles its screens on the new system (no module is styled twice).

#### 1.3 Accounts, admin & onboarding — M

**Status:** Done · **Plan:** [phase-1.3](../plans/2026-09-26-phase-1.3-accounts-admin.md) · **PR:** [#1](https://github.com/phlurblepoot/Werejugo/pull/1)

- [x] Setup wizard on an empty server (admin + first family); remove open registration for good.
- [x] Admin console (§3.1): families, one-time family invites, users, password-reset links, server backup/restore (moved here, admin-only), audit log, "switch into family".
- [x] Family settings: members, one-time member invites, roles, remove member.
- [x] Account settings: profile, password change, sign out everywhere (`token_version`).
- [x] Frontend auth fixes: clear the React Query cache on logout/login; a 401 signs the user out cleanly.

#### 1.4 Tenancy & access layer — L

**Status:** In progress · **Plan:** [phase-1.4](../plans/2026-09-26-phase-1.4-tenancy-access.md) · **PR:** [#1](https://github.com/phlurblepoot/Werejugo/pull/1)

- [ ] `access.ts` (§3.2) and every route migrated onto it; UUID/date validation on all params and bodies; global error handler.
- [ ] Tenant-isolation test suite covering every endpoint.
- [x] Per-family "download our data" export vs admin full-server backup.
- [x] Squash migrations 0001–0012 into a new baseline (one-time reset of the test instance, documented in the release notes). *(0012 was added by 1.3, so the squash covers it too; old backups still restore.)*
- [ ] Fix integrity gaps found in the audit: visit `tripId`/`themeId` ownership checks, document single-owner rule, blackout date order, a unique trip packing list, dangling `links` and `share_links` cleanup on delete.

#### 1.5 Shared trips & cross-family people — L

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] `trip_members` + `trip_invites` (§3.3); invite dialog on a trip (role picker, link with expiry); accept page for the invited family's owner; member management; leave/remove.
- [ ] Visibility and edit rules per role; per-family-private kinds; attribution chips in every trip view.
- [ ] `person_links` (§3.4): propose/accept, merged person pages, cross-family tagging inside shared trips.
- [ ] An `activity` events table (who added what to which shared trip) for the feed and later push notifications.
- [ ] Dev seed: two families and a shared trip.

#### 1.6 One map — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Drop map sets (§3.5); URL-driven filters (trip, person, year/date, kind, family); shared-trip visits badged.
- [ ] Remove the legacy Trips/Photos/Stats/Export panels and link out; stats move to the Stats page (4.2).
- [ ] Search deep links (`/map?visit=`, `/planning?trip=`, `/people?person=`, `/documents?doc=`) open the item — on every page.

**Milestone 1 exit:** the admin can invite families; two families can share a trip with the right roles and privacy; nothing leaks across families (test suite green); the app is safe on the public internet; the shell and account screens use the new design on phone and desktop.

### Milestone 2 — Photos on Immich

#### 2.1 Immich connector & provisioning — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Admin setup (URL + admin key), version check, health on the admin page; per-family Immich user + API key creation (or link existing); keys encrypted at rest.
- [ ] Adapter module; fixtures-based unit tests; contract tests against a real Immich in CI (a nightly job if too slow for every PR).
- [ ] Unraid guide for installing Immich alongside Werejugo (GPU acceleration for face recognition optional).

#### 2.2 Media references & seamless serving — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] `media` becomes a reference table (§3.6); drop the local photo pipeline (test data only, so no migration).
- [ ] Proxy endpoints for thumb/preview/original/video with Range support and **cacheable** signed URLs (time-bucketed, fixing today's every-request `Date.now()` signatures).
- [ ] pg-boss job queue (§3.7).

#### 2.3 Uploads at scale — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Resumable chunked uploads (Cloudflare-safe) with per-file progress, retry and background hand-off to Immich; iPhone HEIC/Live Photos, RAW and video via Immich; duplicate detection surfaced ("already in your library").

#### 2.4 Library UI — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Virtualized timeline grid that stays fast at 20k+ items; filters; lightbox with video playback; hide/unlink; the Photos map with clustering and thumbnails.

#### 2.5 Faces → people — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Import Immich people per family; mapping UI (Immich face ↔ Werejugo person, including cross-family linked people); auto-tag photos; review queue for new faces.

#### 2.6 Trip ↔ Immich album sync — S

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] One Immich album per trip per member family; two-way sync (Werejugo writes immediately; Immich-side changes picked up by polling plus an on-demand "refresh").

#### 2.7 Suggestions from photos — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] For a trip: "143 photos taken during Italy 2024 (near its pins) — attach?"
- [ ] For the library: location/date clusters not covered by any trip or visit → "Looks like you were in Lisbon, 3–9 March 2019 — create a trip?" and suggested visits from photo locations.

#### 2.8 Smart search & smart albums — S

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Immich smart search inside the command palette ("beach sunset").
- [ ] Smart albums = saved filters (person, place, date range, trip, search text) that update automatically; shareable by link.

**Milestone 2 exit:** each family's photos live in its Immich account but look native in Werejugo; 20k+ photos and videos browse smoothly; faces tag people; trips suggest and sync their photos.

### Milestone 3 — Finish every module (on the new design)

#### 3.1 Map & routes — L

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Editor fixes: photo upload no longer closes the editor; no duplicate visit on retry; pick-on-map can be cancelled; one click opens one detail view (not popup + modal).
- [ ] **Cruises (essential):** cache CruiseMapper responses and **store the fetched route/ports/ship details on the visit** so they're never re-fetched; clear messages when blocked, with retry; honor `CRUISE_LOOKUP_ENABLED` everywhere; remove or admin-gate the diagnose endpoint; a full world ports list (NGA World Port Index) for manual entry; **sea-routing fallback** (e.g. `searoute-js`) so port-to-port legs follow water instead of crossing land when no sailed track exists; keep "reuse itinerary" for past cruises.
- [ ] **Flights:** bundle the OurAirports dataset (~9k airports with IATA codes); flight-number lookup via AeroDataBox with multi-leg support and date validation; flight date fills the visit date.
- [ ] **Geocoding:** Photon for as-you-type place search (public server by default, self-hostable), with result caching.
- [ ] **Road trips:** route drives along roads (OSRM or OpenRouteService), store the geometry and distance at save time, re-route when stops change.
- [ ] Styling model fix: pins inherit family/kind/cruise-line defaults unless explicitly overridden (today the editor always saves explicit colors, so default changes never apply); legend matches actual pins; theme editing.
- [ ] Map fits to filtered pins; timeline shows undated items and a clearer axis.

#### 3.2 Planning & packing — L

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Trip create/edit/delete everywhere (board, trip detail); status stays in sync.
- [ ] **Day-by-day itinerary:** days with times, places (Photon search) on a mini map, notes, one-tap directions; wishlist → schedule with a real date picker; "→ visit" carries the location onto the map.
- [ ] **Drag & drop** between board columns and on the timeline; timeline gets month ticks and a "today" marker.
- [ ] Bookings open their document; trip detail shows description, visits and photos.
- [ ] **Packing per person:** assign items to people, "my list" view; rename/delete lists and templates, quantities, edit labels; fix template refresh and save-as-template feedback.

#### 3.3 Documents — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] **Encryption at rest** (AES-256-GCM) for document files, key from a required `DOCUMENTS_ENCRYPTION_KEY`, key-rotation command, and loud docs: back the key up separately (without it, backups can't decrypt documents).
- [ ] Fix search focus loss and the empty-filter dead end; delete confirmations; the renewals banner uses all documents, not the filtered list.
- [ ] Bookings on shared trips stay private to the adding family.

#### 3.4 People, search & settings — S

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] People: delete confirm, no orphan avatar uploads, readable picker labels, the linked account's name.
- [ ] Command palette: debounce, ↑/↓/Enter navigation, Esc from anywhere, reset on close.
- [ ] Settings reorganized: Account, Family, Notifications, Appearance, Map defaults (the map's own "Settings" folds in here).

#### 3.5 Sharing v2 — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Optional **expiry** per link; per-link **allow downloads** toggle (full-size photo/video download through the token).
- [ ] **Richer trip page**: map fitted to the trip with real routes and clickable pins, day-by-day itinerary, journal entries (after 4.1), photo wall with lightbox.
- [ ] Share tokens deleted when their trip/album is deleted.

#### 3.6 Robustness sweep — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Error handling and confirmations for every mutation listed in Appendix A.3; consistent cache invalidation (one query-key scheme for trips etc.).
- [ ] Performance: remove N+1 queries in visit loading; add the missing indexes (media geom/timeline, documents owners, itinerary, people refs).
- [ ] Trip rename re-homes documents (the `trips.ts:50` TODO).
- [ ] Remove dead code and dependencies found in the audit.

**Milestone 3 exit:** every module is complete, consistent and comfortable on phone and desktop; cruise, flight and road routes draw correctly.

### Milestone 4 — Scrapbook & planning features

#### 4.1 Trip journal — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Day-by-day stories per trip mixing text, photos and "map moments".
- [ ] On shared trips each family writes its own entries (attributed) and sees the others'.

#### 4.2 Travel stats & scratch map — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Countries/states/cities visited; miles flown/sailed/driven; per-year and per-person breakdowns.
- [ ] Travel heatmap and a scratch-off "visited" map (evolves today's Passport view).

#### 4.3 Memories — S

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] "On this day" flashbacks (home screen + optional push).
- [ ] Auto-generated year-in-review.

#### 4.4 Budget & expenses — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Planned vs actual per trip, by category.
- [ ] Multiple currencies with conversion (free ECB rates, e.g. frankfurter.app).
- [ ] Private per family on shared trips.

#### 4.5 Printable trip book — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Print-optimized trip layout (cover, map, days, journal, photo pages); v1 uses the browser's "Save as PDF" (no extra infrastructure). A server-rendered PDF (headless Chromium job) can follow if needed.

#### 4.6 Imports — L

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] **Google Maps Timeline** — support the new on-device export (from the Maps app) and the legacy Takeout JSON; produce trip/visit *suggestions* for review rather than auto-creating.
- [ ] **TripIt** — subscribe to the TripIt iCal feed URL to pull trips and bookings into itineraries.
- [ ] **Booking emails** — a dedicated mailbox polled via IMAP; parse the schema.org reservation markup most airlines, hotels and cruise lines embed; unstructured emails optionally parsed by an LLM (needs an API key; decide at that phase).

### Milestone 5 — Mobile, offline & notifications

#### 5.1 PWA hardening — S

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] PNG icons (192/512, maskable, Apple touch icon); manifest renamed from "Family Map".
- [ ] An update flow for new versions; install prompts.

#### 5.2 Offline trip pack — M

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] "Make available offline" on a trip caches its itinerary, packing lists, bookings and document copies (with a clear warning that document copies live on that device).
- [ ] Map tiles for the trip area where the tile provider permits.

#### 5.3 Web push — M

**Status:** Not started · **Plan:** — · **PR:** —

*This phase can be pulled forward into Milestone 3 if renewal reminders are wanted sooner.*

- [ ] VAPID keys, per-device subscriptions and per-user preferences.
- [ ] Document renewal reminders (by lead days), shared-trip activity digests, trip countdowns, memories. On iPhone, web push works only for the installed home-screen app (iOS 16.4+).

---

## 5. Cross-cutting work

- **Testing:** keep Vitest suites; add the tenant-isolation suite (1.4), Immich contract tests (2.1), and a Playwright end-to-end smoke test in CI (log in → every module → create/edit/delete one thing → shared trip between two families) at phone and desktop sizes.
- **Security:** required secrets, rate limits, security headers + CSP, upload validation, the SSRF guard on "upload from URL", admin audit log, Dependabot for dependency updates. Optional: Cloudflare Access in front of `/admin`.
- **Observability:** `/api/health` checks the database and Immich; structured logs; an admin status page (versions, job queue, storage use).
- **Backups:** Werejugo backup (DB + documents + icons) **plus** Immich's own backup (its DB dumps + library) documented together as one runbook; the documents encryption key backed up separately.
- **Docs:** README rewrite, Unraid install guide (all containers, volumes, env vars, Cloudflare Tunnel), backup/restore runbook, and a `CLAUDE.md` with the commands to run tests and the app, for future sessions.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Immich API changes between releases | Pin a version range, one adapter module, contract tests, startup version check, admin warning |
| CruiseMapper changes its site or blocks scraping | Store route/ports/ship data on the visit once fetched; cache; clear failure UI; manual ports from a world list; sea-routing fallback |
| Cloudflare limits | 100 MB/request → chunked uploads. Cloudflare's terms restrict serving large amounts of video through its free proxy; if heavy video viewing becomes a problem, family members can reach the app over Tailscale for video, or put media on a separate path |
| Cross-family data leaks | Single access layer + tenant-isolation suite as a required CI check |
| Admin superuser privacy | Onboarding notice + audit log of every admin access to family data |
| Lost encryption key | Setup wizard prompts to save it; admin page shows whether it's been confirmed as backed up |
| Scope | Milestones 1–2 already deliver a usable multi-family app with photos; 3–5 can be reordered or trimmed after each review |

---

## 7. Open questions (defaults chosen; confirm or change at the milestone review)

1. **A family leaves a shared trip:** its contributions leave with it (hidden from the trip, restored if re-invited). *Alternative:* they stay on the trip, attributed.
2. **Who can accept a trip invite:** family owners only. *Alternative:* any member.
3. **Custom image map overlays** (e.g. a scanned park map): dropped with map sets unless you use them; could return as an optional overlay layer.
4. **Units & currency:** miles and USD by default, with a per-user toggle.
5. **Booking-email parsing with an LLM:** decide at 4.6 (needs an API key; structured markup covers most bookings without it).
6. **Base map tiles:** OpenFreeMap (free, no key) stays the default.
7. **Printed book:** browser "Save as PDF" first; server-rendered PDFs only if needed.
8. **Immich face recognition hardware:** CPU works; a GPU speeds it up if your Unraid box has one.

---

## 8. Progress & change log

Newest first. Entry types: **Done** (a phase or milestone finished), **Changed** (the plan was edited: items added, dropped or reordered), **Decided** (an owner decision, also recorded in §2), **Note** (anything a future session needs to know). Each entry names the phase and links the PR or commit where one exists.

### 2026-09-26

- **Done** — Phase 1.3 Accounts, admin & onboarding (PR #1): a setup wizard on an empty server creates the admin and first family, and open registration and family invite codes are gone. New families join only through one-time admin invite links, which tell them the admin can see all data. Members join through one-time owner invite links with a chosen role. Password resets are one-time links issued by an owner or the admin. Settings covers profile, colour, password change, sign out everywhere, members and roles, invites and removal. The Admin page covers families (invite, rename, disable, delete by typed name, view as), people (search, admin, disable, reset link, role), backup and restore (moved here, admin only) and the audit log. While an admin views another family a banner shows "Return to my family". Sign-in and sign-out clear the React Query cache, and any 401 signs out cleanly. Verified: backend 164/164, frontend 155/155; a Playwright run on a fresh database under the nginx CSP covered setup → family invite → member invite → reset link (old session signed out) → admin view-as and return → people, audit and backup tabs, at desktop and phone sizes in light and dark, with no overflow or console errors.
- **Note** — Found during 1.3: the backend crashed whenever Postgres dropped an idle connection (e.g. the database container restarting), because the pool had no `error` listener. It now logs and carries on (`backend/src/db/pool.ts`). Also fixed: new people get distinct avatar colours, joining through an invite counts as a first sign-in, and the map's "no pins yet" hint no longer squashes on phones.
- **Note** — The database schema changed (migration `0012_accounts`): existing test instances keep working (the oldest family's owner becomes the admin), but a reset is simplest and 1.4 resets anyway when it squashes migrations.

- **Done** — Phase 1.2 Design system & responsive shell (PR #1): tokens with light/dark/system themes, a Lucide + Radix component kit, a desktop rail with account menu, a phone tab bar with a "More" sheet, the same page header on every page, and rebuilt Login and Settings. Verified: frontend 129/129; Playwright screenshots of every page at 1440×900 and 390×844 in light and dark with no horizontal overflow, no off-screen header controls and no console errors; production build under the nginx CSP with no violations.
- **Note** — Also in 1.2: the invite code moved from the Map header (hidden on phones) to Settings → Family; the Map's JSON export moved to its header menu until 1.6 removes it; the dead "coming soon" code and five one-line tests were removed; the dev-seed invite code is now upper-case (the old `wander-1` could never be joined).

- **Note** — Phase 1.1 complete on the milestone branch except deleting `claude/confident-ramanujan-xDIFr`, which waits for the owner's approval (so 1.1 stays `In review`). Verified: backend 131/131 and frontend 112/112 locally; CI green on PR #1 (roadmap check, backend on PostGIS, frontend build); nginx config checked with `nginx -t`; the production build loaded in Chromium under the new CSP with no violations; signup gating, date formatting, backup visibility and search checked in the browser.
- **Note** — Found during 1.1: restoring a backup into a Docker volume would have crashed half-way (it tried to delete the mount point); fixed by replacing the directory's contents in place.

- **Changed** — Milestone 1 is built on one branch (`claude/cool-hopper-pku4ne`) and reviewed as one PR to `main`, instead of one PR per phase: the owner reviews per milestone, and this session may only push to its assigned branch. Each phase still gets its own plan, status line and log entries; a phase is `Done` when complete and verified on the branch. `CLAUDE.md` updated to match.
- **Changed** — Phase 1.1: added preview images for `claude/**` branches (so the milestone can be tested on Unraid before merging) and uploads-in-backup / in-place restore.
- **Note** — Created `main` at `7f9d3a7` (roadmap + tracking on top of `e1136dd`). GitHub's default branch is still `claude/laughing-edison-sTVtG`; the owner should switch it to `main` in the repo settings.
- **Note** — Phase 1.1 started; plan at `docs/superpowers/plans/2026-09-26-phase-1.1-safety-net.md`. Found while planning: editing a trip or visit blanked its dates (date inputs received timestamps) — fixed by B6.

- **Changed** — Added progress tracking: the Status block and per-phase status lines in this file, `CLAUDE.md` "Roadmap discipline" rules, `scripts/roadmap.mjs` (summary + `--check`), a `SessionStart` hook in `.claude/settings.json` that prints the status on startup/resume/clear/compact, `.github/pull_request_template.md`, and a README pointer. `.gitignore` now keeps `.claude/settings.json` tracked. Added a CI roadmap check to Phase 1.1.
- **Decided** — Progress tracking lives in this roadmap (owner request, see §2).
- **Note** — Roadmap written from the audit of `e1136dd` and the owner Q&A (commit `7f15f0d`). All phases are `Not started`.

---

## Appendix A — Detailed audit findings

"✅" = reproduced during the audit; the rest come from code review with file references.

### A.1 Security & deployment
- ✅ Open registration; a stranger's backup contained every family, every user's password hash and all files (`routes/auth.ts:41`, `routes/backup.ts:15`, `lib/archive.ts:17`). Restore truncates every family and runs for any family owner (`routes/backup.ts:40`).
- Restore wipes `STORAGE_DIR` before checking the archive has `storage/`, after the DB transaction commits (`routes/backup.ts:68-73`); backups omit `UPLOADS_DIR` (icons, overlays, ship images); backup copies the whole tree to `/tmp` first (double disk use).
- ✅ Storage not persisted (`docker-compose.yml:34-35`, Unraid template maps only `/app/uploads`).
- Default JWT secret accepted silently; it also signs file URLs (`config.ts:11`, `lib/filesign.ts`). JWTs last 30 days with no revocation; deleted users keep working until expiry; `/api/auth/me` 500s for a deleted user (`routes/auth.ts:126-129`).
- No login rate limiting or security headers; public `/uploads` accepts SVG (stored XSS risk, `lib/upload.ts:11`); share tokens never expire and orphan on delete.
- nginx `client_max_body_size 30m` (`frontend/default.conf.template:11`) vs 2 GB restore limit; default 60 s proxy timeouts.
- CI builds/publishes from `claude/laughing-edison-sTVtG` with no tests (`.github/workflows/publish-images.yml`); `.env.example` lacks `STORAGE_DIR`/`UPLOADS_DIR`; README's `cp .env.example` path is wrong; `SEED_DEV_DATA=true` crash-loops on the second boot (seed not idempotent); the Dockerfile compiles tests into `dist`.

### A.2 Backend correctness
- ✅ GPX/KML with elevation → 500 (`routes/import.ts:87`); extra MultiLineString parts dropped; features over 2000 dropped silently.
- ✅ `DATE` columns serialized as timezone-dependent timestamps (`db/pool.ts`).
- Invalid UUIDs/dates → 500 (no error handler, unvalidated `:id` params, `z.string()` dates); empty `occurredOn` → 500 (`routes/visits.ts:116`).
- Visit `tripId`/`themeId` not checked for family ownership (`routes/visits.ts:19-20`); document PATCH can give a doc two owners (`routes/documents.ts:173-176`); blackout PATCH skips end ≥ start (`routes/blackouts.ts:39`); no unique trip packing list; `links` have no FKs and aren't cleaned on delete.
- Trip rename doesn't re-home files (`routes/trips.ts:50`); deleting a trip/person doesn't re-home files; file moves happen inside DB transactions.
- `/api/files` sends no Content-Type and no Range (video seeking breaks); signed URLs change every request (no caching); HEIC photos rejected; 25 MB multipart cap (`index.ts:45`); size-limit hits report "Unsupported file type"; uploads filed under the upload year, not the EXIF year.
- N+1 queries in visit loading (`routes/visits.ts:100`, `routes/mapsets.ts:145`); missing indexes (media geom/timeline, documents owners, itinerary, people refs); search `ILIKE` doesn't escape `%`/`_`.
- Flight lookup keeps only the first leg and re-resolves codes against 69 airports; `date` unvalidated in the URL path (`services/flightLookup.ts`). `CRUISE_LOOKUP_ENABLED=false` isn't honored by autocomplete/sailing/diagnose; `/api/lookup/cruise/diagnose` exposed to all users. Nominatim used for as-you-type search (against policy), no cache/throttle.
- Dead code: `savePhoto`, `deleteUploadFile` (`lib/upload.ts`), `lineStringGeoJSON`, `pointGeoJSON` (`lib/geo.ts`), `POST /api/lookup/cruise`; `media.bytes` never written; `/api/stats` ignores the map set; `/api/export` is a partial legacy export superseded by backup.

### A.3 Frontend flows
- ✅ First-run overlay locks out new families (`shell/FirstRunWelcome.tsx`, `global.css:572`).
- Command palette: no debounce, no ↑/↓/Enter, Esc only from the input; ✅ deep links (`/map?visit=` etc., `routes/search.ts:22-47`) ignored by every page.
- Map: photo upload in the editor closes it and discards edits (`VisitPhotos.tsx:61` → `onSaved`); duplicate visit on retry after a failed photo upload; pick-on-map has no cancel; popup + modal open together; style loads twice on mount; family/kind/cruise-line defaults never affect saved pins; legend uses kind defaults only; map sets' default view isn't editable; no UI to add an existing visit to another set; stats titled "Map stats" but family-wide.
- Planning: trips can't be edited/deleted from Planning; status select shows stale value; "schedule" sets today's date; itinerary items not editable; "→ visit" creates a location-less visit on no map; bookings not clickable; timeline axis hard-coded to 2025.
- Packing: custom template edits never refresh (`PackingPage.tsx:44`); save-as-template doesn't refresh or confirm; no rename/delete/qty/label edit.
- Documents: search input unmounts each keystroke; empty filter shows "No documents yet" with no way back; banner computed from the filtered list; no delete confirm.
- Photos: map view limited to the first 60 photos; stale click handler; video/audio render as `<img>`; editing caption/trip closes the modal; album share ignores non-trip filters.
- People: delete without confirm; cancelled avatar upload leaves an orphan photo.
- Settings: backup/restore only; no cache reset after restore; JSON "Export" and backup both toast "Backup downloaded".
- Share view: itinerary never rendered, pins do nothing, fixed world view, waypoints dropped, image URLs skip `API_URL`.
- Auth: logout doesn't clear cached data (another user on the same tab can briefly see the previous family's data); a 401 clears the token but leaves the UI signed in.
- Missing try/catch or confirmations in: ManagePanel, SettingsPanel save, StylePicker upload, FlightForm, useCruiseLookup, PhotoDetail, UploadReview, ShareButton, PeoplePage, DocumentForm, TripForm, PlanningPage status change, VisitPhotos delete, itinerary delete, BlackoutManager.
- Inconsistent trip query keys (`["trips", mapSetId]` vs `["trips"]`); the due-count badge refreshes only from the Documents page.

### A.4 Mobile & PWA
- ✅ Rail always visible on phones; ✅ header actions overflow off-screen (Planning, Photos); board and packing columns fixed-width; one breakpoint in the whole stylesheet; 14px inputs (iOS zoom); no safe-area insets with `black-translucent`; invite code hidden ≤720px.
- Service worker caches only `/` (no real offline), static cache name, registered in dev too; SVG-only icons; manifest still named "Family Map"; signed media URLs expire after 24 h, so a long-open PWA shows broken images.

### A.5 Tests
- Untested: auth, themes, uploads/icons, lookup/geo, import, settings, comments, map-set CRUD (backend); MapPage/MapView and most map components, LoginPage/auth, all of `lib/*`, the ShareView trip branch (frontend).
- Low-value/stale: `MapSetEditor.share-removed.test.tsx`, `AppShell.test.tsx` (tests the unreachable ComingSoon), five one-line `modules.*.test.ts` files, `client.test.ts` for the unused `uploadItemPhoto`.
