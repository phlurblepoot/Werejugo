# Werejugo — Completion Roadmap (v2)

**Written:** 2026-09-26
**Supersedes:** the build sequence in `2026-06-22-werejugo-architecture-design.md` §9 (Phases 1–8 are all built; this roadmap takes the app from "feature-complete on paper" to "finished and in daily use").
**Inputs:** a full audit of the repo at `e1136dd` (both test suites run against a real PostGIS database, the app run locally with demo data and clicked through in a headless browser at desktop and phone widths), plus a Q&A session with the owner whose answers are recorded in §2.

> **This file is the project's source of truth for what is planned, what is done, and what changed.** Every session reads the Status block below before working and updates this file in the same commit as the work. The rules are in `CLAUDE.md` → "Roadmap discipline"; `node scripts/roadmap.mjs` prints a summary and `--check` validates this file.

<!-- status:begin -->
## Status

| Field | Value |
|---|---|
| **Current milestone** | Milestone 3 — Finish every module (on the new design) |
| **Current phase** | 3.1 |
| **Next step** | Write the Phase 3.1 plan (Map & routes, including past cruises), then build it. The owner still deletes `claude/confident-ramanujan-xDIFr` on GitHub (the last 1.1 item). |
| **Blocked on** | Nothing |
| **Last updated** | 2026-09-27 |
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
| Photo uploads (2026-09-27) | **Uploaded through Werejugo.** Werejugo also sees everything in the family's Immich account, including photos added in Immich directly, and uses the people, places and dates in them to suggest trips, places and people, for existing items and new ones. Choosing photos for any item **browses the whole Immich library** |
| Past cruises (2026-09-27) | CruiseMapper lists only upcoming sailings, so a past cruise is built from: a listed sailing **matched by itinerary** (the same ports in order, on the ship or its sister ships) with its dates shifted; else **ports with per-day dates and legs routed along shipping lanes**; and **cruises proposed from the family's photos** (ports and trail from where the photos were taken). Not chosen: importing a recorded GPS track as a cruise's path, and paid ship-track history (AIS) |
| Immich hardware (2026-09-27) | **NVIDIA RTX 5070**: the install guide uses CUDA for face recognition and NVENC for video (was §7 Q8) |
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
- [ ] After `main` exists and the owner approves: delete `claude/confident-ramanujan-xDIFr`. *(Approved 2026-09-27. The session can't delete other branches, so the owner deletes it on GitHub; tick when it's gone.)*
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

**Status:** Done · **Plan:** [phase-1.4](../plans/2026-09-26-phase-1.4-tenancy-access.md) · **PR:** [#1](https://github.com/phlurblepoot/Werejugo/pull/1)

- [x] `access.ts` (§3.2) and every route migrated onto it; UUID/date validation on all params and bodies; global error handler.
- [x] Tenant-isolation test suite covering every endpoint.
- [x] Per-family "download our data" export vs admin full-server backup.
- [x] Squash migrations 0001–0012 into a new baseline (one-time reset of the test instance, documented in the release notes). *(0012 was added by 1.3, so the squash covers it too; old backups still restore.)*
- [x] Fix integrity gaps found in the audit: visit `tripId`/`themeId` ownership checks, document single-owner rule, blackout date order, a unique trip packing list, dangling `links` and `share_links` cleanup on delete.
- [x] Per-family storage folders and never-reused file names, so no family's file can be served, overwritten or deleted through another family's path. (added 2026-09-26 — found by the 1.4 audit)

#### 1.5 Shared trips & cross-family people — L

**Status:** Done · **Plan:** [phase-1.5](../plans/2026-09-26-phase-1.5-shared-trips.md) · **PR:** [#1](https://github.com/phlurblepoot/Werejugo/pull/1)

- [x] `trip_members` + `trip_invites` (§3.3); invite dialog on a trip (role picker, link with expiry); accept page for the invited family's owner; member management; leave/remove.
- [x] Visibility and edit rules per role; per-family-private kinds; attribution chips in every trip view.
- [x] `person_links` (§3.4): propose/accept, merged person pages, cross-family tagging inside shared trips.
- [x] An `activity` events table (who added what to which shared trip) for the feed and later push notifications.
- [x] Dev seed: two families and a shared trip.

#### 1.6 One map — M

**Status:** Done · **Plan:** [phase-1.6](../plans/2026-09-26-phase-1.6-one-map.md) · **PR:** [#1](https://github.com/phlurblepoot/Werejugo/pull/1)

- [x] Drop map sets (§3.5); URL-driven filters (trip, person, year/date, kind, family); shared-trip visits badged.
- [x] Remove the legacy Trips/Photos/Stats/Export panels and link out; stats move to the Stats page (4.2). *(Travel stats stays in the Map's ⋯ menu until 4.2.)*
- [x] Search deep links (`/map?visit=`, `/planning?trip=`, `/people?person=`, `/documents?doc=`) open the item — on every page.

**Milestone 1 exit:** the admin can invite families; two families can share a trip with the right roles and privacy; nothing leaks across families (test suite green); the app is safe on the public internet; the shell and account screens use the new design on phone and desktop.

### Milestone 2 — Photos on Immich

#### 2.1 Immich connector & provisioning — M

**Status:** Done · **Plan:** [phase-2.1](../plans/2026-09-27-phase-2.1-immich-connector.md) · **PR:** [#2](https://github.com/phlurblepoot/Werejugo/pull/2)

- [x] Admin setup (URL + admin key), version check, health on the admin page; per-family Immich user + API key creation (or link existing); keys encrypted at rest.
- [x] Adapter module; fixtures-based unit tests; contract tests against a real Immich in CI (a nightly job if too slow for every PR).
- [x] Unraid guide for installing Immich alongside Werejugo (GPU acceleration for face recognition optional).
- [x] A family can also use Immich directly (its web page or app): an owner sets the family's Immich password in Settings → Family. (added 2026-09-27)

#### 2.2 Media references & seamless serving — M

**Status:** Done · **Plan:** [phase-2.2](../plans/2026-09-27-phase-2.2-media-on-immich.md) · **PR:** [#2](https://github.com/phlurblepoot/Werejugo/pull/2)

- [x] `media` becomes a reference table (§3.6); drop the local photo pipeline (test data only, so no migration).
- [x] Proxy endpoints for thumb/preview/original/video with Range support and **cacheable** signed URLs (time-bucketed, fixing today's every-request `Date.now()` signatures).
- [x] pg-boss job queue (§3.7).
- [x] Library sync: everything in a family's Immich account, including photos added in Immich directly, shows up in Werejugo within minutes; edits and deletions follow. (added 2026-09-27)

#### 2.3 Uploads at scale — M

**Status:** Done · **Plan:** [phase-2.3](../plans/2026-09-27-phase-2.3-uploads-at-scale.md) · **PR:** [#2](https://github.com/phlurblepoot/Werejugo/pull/2)

- [x] Resumable chunked uploads (Cloudflare-safe) with per-file progress, retry and background hand-off to Immich; iPhone HEIC/Live Photos, RAW and video via Immich; duplicate detection surfaced ("already in your library").

#### 2.4 Library UI — M

**Status:** Done · **Plan:** [phase-2.4](../plans/2026-09-27-phase-2.4-library-ui.md) · **PR:** [#2](https://github.com/phlurblepoot/Werejugo/pull/2)

- [x] Virtualized timeline grid that stays fast at 20k+ items; filters; lightbox with video playback; hide/unlink; the Photos map with clustering and thumbnails.
- [x] Photo picker for any item (place, trip, person, itinerary item): browses the whole library, starting with photos taken near the item's dates and place. (added 2026-09-27)

#### 2.5 Faces → people — M

**Status:** Done · **Plan:** [phase-2.5](../plans/2026-09-27-phase-2.5-faces-people.md) · **PR:** [#2](https://github.com/phlurblepoot/Werejugo/pull/2)

- [x] Import Immich people per family; mapping UI (Immich face ↔ Werejugo person, including cross-family linked people); auto-tag photos; review queue for new faces.

#### 2.6 Trip ↔ Immich album sync — S

**Status:** Done · **Plan:** [phase-2.6](../plans/2026-09-27-phase-2.6-trip-albums.md) · **PR:** [#2](https://github.com/phlurblepoot/Werejugo/pull/2)

- [x] One Immich album per trip per member family; two-way sync (Werejugo writes immediately; Immich-side changes picked up by polling plus an on-demand "refresh").

#### 2.7 Suggestions from photos — M

**Status:** Done · **Plan:** [phase-2.7](../plans/2026-09-27-phase-2.7-photo-suggestions.md) · **PR:** [#2](https://github.com/phlurblepoot/Werejugo/pull/2)

- [x] For a trip: "143 photos taken during Italy 2024 (near its pins) — attach?"
- [x] For the library: location/date clusters not covered by any trip or visit → "Looks like you were in Lisbon, 3–9 March 2019 — create a trip?" and suggested visits from photo locations.
- [x] For existing items: photos for a place (its date and location), places missing from a trip (where its photos were taken), and people whose faces appear in a trip's or place's photos ("Grandma is in 12 photos from this trip — add her?"). (added 2026-09-27)

#### 2.8 Smart search & smart albums — S

**Status:** Done · **Plan:** [phase-2.8](../plans/2026-09-27-phase-2.8-smart-search.md) · **PR:** [#2](https://github.com/phlurblepoot/Werejugo/pull/2)

- [x] Immich smart search inside the command palette ("beach sunset").
- [x] Smart albums = saved filters (person, place, date range, trip, search text) that update automatically; shareable by link.

**Milestone 2 exit:** each family's photos live in its Immich account but look native in Werejugo; 20k+ photos and videos browse smoothly; faces tag people; trips suggest and sync their photos.

### Milestone 3 — Finish every module (on the new design)

#### 3.1 Map & routes — L

**Status:** Not started · **Plan:** — · **PR:** —

- [ ] Editor fixes: photo upload no longer closes the editor; no duplicate visit on retry; pick-on-map can be cancelled; one click opens one detail view (not popup + modal).
- [ ] **Cruises (essential):** cache CruiseMapper responses and **store the fetched route/ports/ship details on the visit** so they're never re-fetched; clear messages when blocked, with retry; honor `CRUISE_LOOKUP_ENABLED` everywhere; remove or admin-gate the diagnose endpoint; a full world ports list (NGA World Port Index) for manual entry; **sea-routing fallback** (e.g. `searoute-js`) so port-to-port legs follow water instead of crossing land when no sailed track exists; keep "reuse itinerary" for past cruises.
- [ ] **Past cruises:** find a listed sailing by itinerary rather than date (the same ports in the same order, on the ship or its sister ships on the line) and shift it to the user's dates; when nothing matches, ports with a day each and legs routed along shipping lanes. (added 2026-09-27)
- [ ] **Cruises from photos:** propose a cruise's ports and trail from the family's geotagged photos (days near a port become port calls, photos at sea shape the trail), and suggest cruises in "Trips in your photos". (added 2026-09-27)
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

- [ ] **Encryption at rest** (AES-256-GCM) for document files, key from the server's `ENCRYPTION_KEY` (introduced in 2.1 for stored Immich keys), key-rotation command, and loud docs: back the key up separately (without it, backups can't decrypt documents).
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
- [ ] Performance: ~~remove N+1 queries in visit loading~~ (done in 1.6 — the map list is four queries); add the missing indexes (media geom/timeline, documents owners, itinerary, people refs).
- [ ] Trip rename re-homes documents (the `trips.ts:50` TODO).
- [ ] Remove dead code and dependencies found in the audit.
- [ ] Every legacy `.modal-backdrop` dialog (14 of them: item detail, visit editor, map settings, stats, document/person/trip forms…) moves to the kit `Modal`, so Esc closes it, focus stays inside and screen readers announce a dialog. (added 2026-09-26)

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
8. ~~**Immich face recognition hardware:** CPU works; a GPU speeds it up if your Unraid box has one.~~ Decided 2026-09-27: an NVIDIA RTX 5070 (§2).
9. **Home, for "trips found in your photos":** inferred from where most photos were taken (by distinct days); photos more than 50 km away count as travel. *Alternative:* each family sets its home in Settings. (added 2026-09-27)

---

## 8. Progress & change log

Newest first. Entry types: **Done** (a phase or milestone finished), **Changed** (the plan was edited: items added, dropped or reordered), **Decided** (an owner decision, also recorded in §2), **Note** (anything a future session needs to know). Each entry names the phase and links the PR or commit where one exists.

### 2026-09-27

- **Decided** — Past cruises (§2): matched by itinerary on CruiseMapper, else ports with sea-routed legs, plus cruises proposed from photos. The owner found that a cruise more than a few weeks in the past can't be looked up: CruiseMapper lists only upcoming sailings, and "reuse this itinerary" only helps when a similar sailing is listed. Of the options offered, the owner chose these three; importing a GPS track as a cruise's path and paid ship-track history were not chosen.
- **Changed** — Phase 3.1 gains two items: past cruises (itinerary matching, sea-routed ports) and cruises from photos. Owner's decision above.
- **Note** — Milestone 3 started with the owner's go-ahead. The owner installed Immich with StaXX (a compose-file plugin for Unraid) using the guide's stack with the values written in, connected it, and tested some of Milestone 2 ("they worked good"); the rest they'll test as they go. The session branch restarts from `main`.
- **Done** — Milestone 2 Photos on Immich merged into `main` (PR #2).
- **Note** — CI: the Immich contract job retries pulling Immich's images (up to 4 times, with a pause). One run failed before any test ran because the container registry rate-limited the pull (`toomanyrequests`).
- **Note** — Milestone 2 is built and ready for the owner's review (PR #2). Exit criteria, checked:
  - **Each family's photos live in its Immich account but look native in Werejugo:**
    - 2.1 gives each family its own Immich account.
    - 2.2 serves thumbnails, previews, originals and video at Werejugo's own signed links, and syncs photos added in Immich directly.
    - 2.3 uploads in pieces.
    - The contract suite (16 tests) passes against a real Immich 3.2.2 in CI.
  - **20k+ photos and videos browse smoothly:** 2.4, Playwright with 20,007 photos: the first screen in ~0.2 s, about 50 cells in the page at a time, and months fetched as they scroll in.
  - **Faces tag people:** 2.5, a review queue and automatic tags, including another family's person.
  - **Trips suggest and sync their photos:** 2.6 (each trip an album in Immich, both ways) and 2.7 (suggestions for trips, places and people, and trips found in the photos).
  - **Also:** 2.8, smart search and smart albums.

  Last step: an upgrade from Milestone 1. A database built with `main`'s migrations and the dev seed took migrations 0004–0011 cleanly, and the backend then answered the new routes on it without Immich (library, faces, suggestions, smart albums; search explains that Immich is needed). Backend 468/468, frontend 266/266, typecheck and build clean. CI (both suites, the roadmap check and the real-Immich contract) runs on every push.

  For the owner: install Immich with the guide (machine learning on the RTX 5070 powers faces and smart search), set `ENCRYPTION_KEY` on the backend, and connect it in Admin → Immich. Photos uploaded before Milestone 2 aren't carried over (test data), as the README says. Still open: 1.1's last item, deleting `claude/confident-ramanujan-xDIFr`, which the owner does on GitHub.
- **Done** — Phase 2.8 Smart search & smart albums (PR #2).
  - **Smart search:** Immich's smart search (what's in the photos: "beach at sunset") is in the command palette ("In your photos", with thumbnails and "All photos of …") and on the Photos page, in Immich's relevance order and within Werejugo's filters. When Immich's machine learning is off, it says so.
  - **Smart albums:** a search and filters saved under a name, from the Photos page's **Smart albums** menu. They fill themselves as photos arrive, open at `/photos?album=`, can be renamed, updated to the current search, deleted, and shared by a public link. The link shows the family's own photos, evaluated when it's opened.
  - **Verified:**
    - Backend 468/468 (6 search and album tests, and isolation cases) and frontend 266/266.
    - The contract passes against the real Immich without machine learning: the refusal is well-formed and says why.
    - Playwright through nginx with the stand-in: 20 checks, including the palette, a person filter, saving, a new photo filling the album, the public link logged out, rename, delete, and phone layout.
- **Note** — Found in 2.8:
  - **Public trip and album links showed photos hidden from the library.** They no longer do, and smart albums follow the same rule. Test added.
  - **The Photos page** only read `?q=` when it first opened, so "All photos of …" from the palette, on the Photos page itself, didn't search. It now follows the address, for `?album=` too.
- **Note** — Planning 2.8:
  - Smart search needs Immich's machine learning, which CI's Immich doesn't run. The contract checks the refusal instead, and the stand-in imitates both states.
  - Found: a public album link shows photos hidden from the library. They're left out of public links from 2.8.

- **Done** — Phase 2.7 Suggestions from photos (PR #2).
  - **Planning, "Trips in your photos":** runs of photos away from home that are in no trip become "Looks like you were in Lisbon and Porto · 3–7 Mar 2019 · 12 photos", with a name to edit and **Create trip**, which makes the trip with its photos and opens it. The Photos page points there.
  - **A trip:**
    - Its photos: taken during it, and away from home or near its places.
    - Spots with 3 or more of its photos that aren't places yet ("You took 4 photos near Florence"), added with a name.
    - People in its photos, by face or tag, who aren't on it.
  - **A place:** photos taken within 2 km on its dates.
  - **Review** opens the photo picker. ✕ dismisses a suggestion; a photo suggestion comes back only for photos added later.
  - **Place names are Immich's own** (kept on each photo by the sync), so Werejugo calls no geocoding service.
  - **Verified:**
    - Backend 454/454 (11 suggestion tests, isolation cases for the 3 routes) and frontend 254/254.
    - The contract passes against the real Immich: a photo at the Eiffel Tower gets `city` and `country`.
    - Playwright through nginx with the stand-in: 31 checks, including every kind applied, dismissing, and phone layout. With 20,000 photos, the library's suggestions take about 60 ms and a trip's about 20 ms.
- **Note** — Found in 2.7:
  - **Immich names districts:** the real Immich calls the Eiffel Tower's spot "Paris 16 Passy" (GeoNames lists city districts). Labels drop a trailing district number and name, so the suggestion says "Paris"; the stand-in now does the same.
  - **Photos taken on a trip but far from its places** (a day in Florence on a Rome trip) weren't suggested anywhere. They're outside every new-trip run because they fall in the trip's dates, and too far from its places. A trip's photos now include anything taken away from home during its dates.
  - **Class names:** `.suggestions` was already the entity picker's dropdown (fixed height, scrolling), which clipped the new cards. They're now `sugg-`.
  - **Opening a made trip:** Planning cleared the `?trip=` it was told to open before its trip list had the new trip. It now refetches the list first.
  - **The stand-in** now reads a photo's date and GPS on upload and names the place, like Immich's metadata extraction.
- **Note** — Planning 2.7: place names come from Immich's own reverse geocoding (now kept on each photo), so Werejugo calls no geocoding service. A family's home is inferred for "trips found in your photos" (§7 Q9 added). Suggestions are computed on request, not stored; dismissing a photo suggestion lets newer photos bring it back.

- **Done** — Phase 2.6 Trip ↔ Immich album sync (PR #2).
  - **Every trip a family is on is also an album in its Immich account,** empty ones too, holding that family's photos of the trip.
  - **Werejugo → Immich:** putting photos in a trip, moving or taking them out, renaming a trip and deleting it all reach the album within seconds. A deleted trip's album is deleted; its photos stay.
  - **Immich → Werejugo:** adding photos to the album in Immich's app puts them in the trip, and removing them takes them out. This happens at the next sync (5 minutes) or at once with **Refresh from Immich**.
  - **Conflicts:** a photo changed on both sides between two passes follows Werejugo. An album deleted in Immich is made again. The album's name follows the trip's.
  - **A trip's Photos section** says "Also an album in Immich: *name*", or why the album couldn't be updated.
  - **Verified:**
    - Backend 436/436 (10 album-sync tests against the stand-in, including a conflict in either processing order; the isolation case) and frontend 246/246.
    - The album contract passes against the real Immich: adding and removing change `updatedAt` and `assetCount`, which the sync watches.
    - Playwright through nginx with the stand-in: 17 checks. Albums made for every trip, the Smiths' own album for the shared trip, photos added from the Photos page reaching the album, a photo added in "Immich" joining the trip after Refresh, a rename, a removal, phone layout.
- **Note** — Found in 2.6:
  - **Backups were missing `immich_people`** (2.5), so a restore would have lost every face match. At the next full sync that would have removed every face tag. Backups now include it and `trip_albums`, and a test fails if any table is neither backed up nor listed with a reason for leaving it out.
  - **Conflicts need a time, not just the last pass's contents:** whether a photo was put in another trip in Werejugo can't be told from that album's base when both albums are handled in the same pass. The trigger records `media.trip_changed_at`, compared with the album's last pass.
  - Removed a stale `TODO(phase-1b): re-home media on trip rename` in `routes/trips.ts`; the album now follows a rename.
- **Note** — Planning 2.6: an album deleted in Immich is made again rather than taking its photos out of the trip, and album names follow the trip's. Each family's album holds its own photos of a shared trip. Other families' photos stay visible only in Werejugo, as §3.3 decided.

- **Done** — Phase 2.5 Faces → people (PR #2).
  - **Faces:** after every library sync, each family's Immich people come into Werejugo with their photo counts. Renames, hiding and removal in Immich follow.
  - **People → Faces:** tabs To review / Matched / Ignored. To review lists faces in 2 or more photos that aren't hidden in Immich, most photos first. Its count shows on the People switch, on the rail, and on More on phones.
  - **"Who is this?":**
    - Our people first, then other families' people we share a trip with, each marked with their family.
    - **New person**, with the name from Immich filled in, or **Not someone we keep**.
    - A matched face can be changed or unmatched.
    - A face with no name in Immich gets the person's name there too.
  - **Tags:** matching a face tags every photo it's in (a media → person link with role `face`), straight away. New photos with that face are tagged at the next sync, and the nightly sync reconciles everyone. Only `face` links are ever removed this way; tags added by hand stay.
  - **A person's page:** "See N photos" opens the library filtered to them, with their faces beside it.
  - **Verified:**
    - Backend 423/423 (faces sync, routes, isolation cases) and frontend 244/244.
    - The people/faces contract passes against the real Immich in CI.
    - Playwright through nginx with the stand-in: 34 checks. Four faces reviewed: one to our Grandma Rose, one to the Smiths' Rose, one new person, one ignored. Badges on desktop and phone; Grandma Rose's 7 photos, counting the linked person's; the Smiths seeing the Wanderers' 3 photos of Rose from the shared trip.
- **Note** — Found in 2.5:
  - **The person filter** (the library's, and "See N photos") now covers every photo the family may see: its own, plus other families' photos on shared trips. It also matches tags of the same person in another family (an accepted person link), so "our Grandma is your Grandma" carries face tags across too. Before, it only covered the family's own photos, so the Smiths never saw the Wanderers' tagged photos of their Rose.
  - **Face tags stay out of a person's Related list** (there can be thousands); "See N photos" has them. On a photo, a face tag shows who's in it with no remove button, since the next sync would put it back. A person tagged by hand as well is listed once, removable.
  - **Faster sync:** the 5-minute sync first checks whether there are new photos at all, before searching each matched face.
- **Note** — Planning 2.5: Immich's **cluster groups** (shared face recognition between accounts) aren't used yet, although the fork research suggested them. Immich's API doesn't say which of another account's people is the same person, so there's nothing for Werejugo to read, and CI's Immich runs no machine learning to test them against. Cross-family faces work through Werejugo instead: a family can map a face to another family's person it can see, and person links carry the photos across.

- **Done** — Phase 2.4 Library UI (PR #2).
  - **Timeline:** the Photos page is one timeline, laid out from per-month counts and windowed. With 20,007 photos the first ones show in about 0.2 s, about 50 cells exist at a time, and scrolling fetches only the months that come into view. A year rail jumps anywhere.
  - **Filters:** Photos/Videos, No trip, and Hidden join person, trip, place and dates.
  - **Hide:** Werejugo's own flag; the photo stays in Immich and the sync never clears it.
  - **Selection:** Shift+click for a range, or a long press on a phone. It can add to a trip, remove from a trip, hide or show, and delete.
  - **Viewer:** full-screen with details beside the photo; ← → and swipes step across months; video plays.
  - **Photos map:** every geotagged photo (not just the first page), clustered, with thumbnails for the biggest clusters on screen.
  - **Add photos** on places, trips (a new Photos section), itinerary days and people opens on the photos taken then and there (matching both the dates and the place, those ticked for an item with none yet), or the whole library at that month. **Upload new** links there too (an upload can now go to a trip).
  - **Verified:**
    - Backend 399/399 and frontend 233/233.
    - Playwright through nginx with 20,007 photos: 37 checks, including the timing and DOM-size checks, jumping to 2012, a range hidden and shown, the viewer across a month boundary with video, map clusters zooming, the picker from a place, trip, itinerary day and person, and phone layout.
- **Note** — Found in 2.4:
  - **Class names:** the library's `.tl-row` class collided with the planning timeline's, which gave every row a grey band. The library's classes are now `lib-`.
  - **Map thumbnails:** a thumbnail that isn't in Immich yet shows a plain tile with the count instead of a broken image.
  - **Offline map style:** the Photos map falls back to a plain background when the map style can't load, so the photos still show.
  - **Tests:** the upload-cleanup test counted part files left over from earlier local runs; each test now clears the incoming folder.

- **Done** — Phase 2.3 Uploads at scale (PR #2).
  - **Uploads in pieces:** photos and videos go up in 8 MB pieces (Cloudflare-safe), three files at a time, up to `MAX_UPLOAD_GB` (20 by default). A dropped piece is retried on its own. After a reload, choosing the same file again sends only the rest.
  - **Upload tray:** at the bottom of every page (above the tab bar on phones). It shows each file's progress and outcome, with Retry, Choose file and Cancel.
  - **Background hand-off:** once the bytes are in, a job hands the file to Immich, so the person can leave. A photo added for a place or person is linked by the server when it arrives, and a new place's photos no longer hold its editor open.
  - **Duplicates** say "Already in your library"; one that was in Immich's trash comes back out.
  - **Immich trouble:** a file Immich refuses fails with Immich's reason. When Immich is unreachable, the job tries 3 more times, then keeps the bytes for Retry.
  - **Formats:** HEIC, RAW and video go to Immich as they are. The 5-minute sync drops Live Photo clips once Immich pairs and hides them.
  - **Cleanup:** a daily job removes abandoned uploads.
  - **Verified:**
    - Backend 372/372 and frontend 216/216.
    - Playwright through the real nginx config, the backend's job queue and the stand-in: 21 checks, including a dropped piece, a reload mid-video that resumed from 16 MB, and phone layout.
    - The contract test against a real Immich 3.2.2 in CI: trashed duplicates and restore, a video clip, an AVIF photo, and the hidden-asset search.
- **Note** — Found in 2.3:
  - **Memory:** Node's `fetch` (so the Immich SDK's upload) holds a whole request body in memory; a 600 MB video peaked at 720 MB. Uploads to Immich are now streamed with `node:http` (133 MB for the same file).
  - **The locked folder:** the contract test against the real Immich showed a search for its locked folder is refused (it needs the PIN-unlocked session), which would have failed every 5-minute sync. The sync looks for hidden assets only; photos moved to the locked folder leave at the nightly full sync.
  - **nginx:** a location ending in `/` made nginx answer `POST /api/media/uploads` with a 301. Running the browser checks through the real config found it.
  - **iPhones:** Safari's picker usually sends a JPEG copy and only the still of a Live Photo. The README and the Unraid guide point iPhone users to Immich's app for full quality.

- **Done** — Phase 2.2 Media references & seamless serving (PR #2). Photos and videos now live in each family's Immich account; a `media` row is a reference (`immich_asset_id`) plus a cache of date, place, size, caption and length.
  - **Uploads:** they go to Immich (EXIF date and place are read at once for suggestions). Duplicates come back as "Already in your library"; no Immich connection is a clear message; Immich being down is a clear error.
  - **Captions and deletes:** captions are Immich descriptions. Delete moves the photo to Immich's trash.
  - **Serving:** everything is served at Werejugo's own signed links (`/api/m/:id/:size`), cacheable for hours, with Range for video seeking and ETag passed through; originals download as files.
  - **Library sync:** pg-boss runs it every 5 minutes and a full reconcile nightly (and on a family's first connection). Photos added, edited, trashed or deleted in Immich follow; hidden Live Photo halves and the locked folder are skipped; one sync per family at a time. Admins see each family's photo count, last sync and errors, with "Sync now"; families get "Refresh from Immich".
  - **Removed:** the on-disk photo pipeline (folders, file moves on trip changes, sharp thumbnails for photos).
  - **Verified:**
    - Backend 344/344 and frontend 198/198.
    - The asset contract test against real Immich 3.2.2 in CI.
    - Playwright against the stand-in, with the real pg-boss queue: 18 checks, including an Immich-side upload appearing after Refresh, a public album link showing a photo, a 206 video range, and "Download original" returning the exact file.
- **Note** — Found in 2.2:
  - The contract test against the real Immich found three differences from the stand-in, now fixed in the code and copied into the stand-in:
    - Immich judges an upload by the file part's own name. The SDK sent a nameless blob, which Immich rejected as "Unsupported file type blob"; uploads now send a named File.
    - Immich 3.2's structured search includes trashed photos unless the filter excludes them, so the sync kept photos trashed in Immich. It now asks for `trashedAt = null`.
    - Immich sends an ETag for originals but answers a conditional request with the whole file (200, not 304). Werejugo passes either through; browsers cache by `Cache-Control`.
  - Playwright found that picking the same file twice did nothing (the file input kept its value); fixed in both upload pickers.
  - Thumbnails can be missing for a few seconds while Immich makes them, so images show a placeholder and retry instead of a broken icon.
- **Done** — Phase 2.1 Immich connector & provisioning (PR #2).
  - **Admin → Immich:** the admin enters Immich's address and an admin API key. Werejugo checks them live (Immich answers, the key belongs to an admin and has the needed permissions) and stores the key encrypted with the new `ENCRYPTION_KEY`. The page shows the version against the supported range (3.2 up to 4.0) and each family's state.
  - **Family accounts:**
    - Every family gets its own Immich account and key: one at a time, "Connect all", or automatically when a family is created.
    - A half-finished setup resumes; a rejected or unreadable key is replaced.
    - Existing accounts can be linked instead (never an Immich admin, never twice).
    - Disconnecting revokes Werejugo's key and leaves the account and its photos in Immich.
  - **Settings → Photos (Immich):** owners see their family's Immich login and can set its password to use Immich directly.
  - **Adapter:** all Immich calls go through `lib/immich/client.ts` (the official SDK, pinned to 3.2.2), tested against a stand-in Immich.
  - **Contract tests:** the same tests run in CI against a real Immich 3.2.2 (`immich-contract.yml`, which fails if it ever falls back to the stand-in).
  - **Unraid guide:** `docs/immich-on-unraid.md`, with NVIDIA acceleration for the owner's RTX 5070.
  - **Verified:**
    - Backend 322/322, frontend 189/189.
    - Contract tests 7/7 against real Immich 3.2.2 in CI.
    - Playwright against the stand-in (desktop and phone): connect, wrong key, connect all, disconnect and reconnect, the audit log, and an owner setting the Immich password then signing in to Immich with it. No console errors or overflow.
  - **Phone fix:** Admin's tab row now scrolls instead of clipping.
- **Note** — The owner asked whether an enhanced Immich fork is worth using. Research (2026-09-27) recommends **stock Immich**:
  - **Noodle Gallery** (open-noodle/gallery) is the only active, credible fork. It's API-compatible with 3.2.2 for Werejugo's calls.
  - Its extras (shared spaces, pets, video trim, S3, trip recaps) live mostly in its own UI.
  - It removes two upstream 3.2 features Werejugo can use: cross-user face "cluster groups" and the new structured search.
  - It depends on one AI-assisted maintainer, and switching back deletes the fork's data.

  The other forks are one-person experiments. For later phases: 2.5 should use upstream 3.2 **cluster groups** to match faces across families' accounts (linked people), and 2.8 should use 3.2's **structured search** (filters, AND/OR, search within albums).
- **Changed** — Started Milestone 2 at Phase 2.1 ([plan](../plans/2026-09-27-phase-2.1-immich-connector.md)). The owner hasn't installed Immich yet, and this sandbox can't pull Immich's images. So development runs against a stand-in Immich built from Immich 3.2.2's published API spec, and CI runs the same tests against a real Immich 3.2.2. Supported range: Immich 3.2 up to (not including) 4.0. The Unraid guide comes first in 2.1 so the owner can install Immich while the rest is built.
- **Changed** — Items added from the owner's answers: 2.1 a family can use Immich directly; 2.2 library sync of everything in the family's Immich account; 2.4 a photo picker on every item that browses the whole library; 2.7 suggestions for existing items (photos for places, missing places, people from faces). 3.3's document key becomes the shared `ENCRYPTION_KEY` introduced in 2.1.
- **Decided** — Photos are uploaded through Werejugo, and Werejugo also reads everything in the family's Immich account (including photos added in Immich directly) and uses its people, places and dates to suggest trips, places and people, for existing items and new ones. The photo picker browses the whole Immich library (§2).
- **Decided** — Immich hardware: an NVIDIA RTX 5070, so the guide uses CUDA for face recognition and NVENC for video (§7 Q8 → §2).
- **Note** — Deleting `claude/confident-ramanujan-xDIFr` is approved. Its one commit (`d67ffc5`, a May styling refresh replaced by 1.2) isn't in `main`. The session's git access can't delete other branches, so the owner deletes it on GitHub, and 1.1 stays In review until then.
- **Done** — Milestone 1 merged into `main` (PR #1), after the owner tested the preview on Unraid with a fresh database.

### 2026-09-26

- **Note** — Milestone 1 is built and ready for the owner's review (PR #1). Exit criteria, checked:
  - **The admin invites families:** 1.3; re-run on the Docker images.
  - **Two families share a trip with the right roles and privacy:** the 1.5 suite, plus Playwright as host, contributor and co-owner in 1.5 and 1.6.
  - **Nothing leaks across families:** the tenant-isolation suite (93 checks, covering every route) is green.
  - **Safe on the public internet:** 1.1 hardening — required secrets, rate limits, security headers, CSP, SVG refusal.
  - **New design on phone and desktop:** 1.2 and 1.3.

  Last step: both images were built from this branch with their real Dockerfiles and run like the Unraid containers (nginx CSP in front, migrate → seed → serve). On an empty database, the setup wizard, family and member invites, and password reset all passed (the 1.3 walkthrough). On a seeded one, the one-map walkthrough passed: filters, shared chips, edit gating, import onto a shared trip, uploads to the storage volume and every deep link. Also removed in the wrap-up: the unused `POST /api/uploads` (it only served map overlays, which went with map sets). CLAUDE.md and the README (preview images, sharing between families) are updated. Still open: 1.1's last item, deleting the old branch, which waits on the owner's approval.
- **Done** — Phase 1.6 One map (PR #1). Map sets are gone: the Map shows every place the family may see — its own and every place on a trip it shares — with filters for search, kind, trip, year, person and (when anything is shared) who added it, all kept in the URL so a view can be bookmarked or sent. Places from other families carry a "by <family>" chip and open read-only unless the viewer's family may edit them (host or co-owner). The map list loads in four queries instead of several per place. Migration `0003_one_map.sql` keeps a family's custom base-map style (now under Map appearance) and drops the map-set tables; restoring an older backup skips them. The Trips, Gallery, Stats and Export side panels are gone: the sidebar links to Planning and Photos; import (GPX/KML/GeoJSON, optionally onto a trip), pin styles, map appearance and Travel stats live in the Map's ⋯ menu. Search results open their item on every page (`/map?visit=`, `/planning?trip=`, `/people?person=`, `/documents?doc=`, `/photos?photo=`). Verified: backend 288/288 (with a data test for the 0003 migration), frontend 180/180, build; Playwright on the two-family seed database upgraded in place from 0002, as host, contributor and co-owner, at desktop and phone sizes: 36 checks, no console errors or overflow.
- **Note** — Found by the 1.6 QA and fixed: a place of kind "stay" (valid on the server, used by the seed's "Lakeside cabin") blanked the whole Map page because the web app didn't know the kind — map sets had hidden it until now. The app now has one list of kinds (`ITEM_KINDS`) with "Stay" in the editor, filters and pin styles, and the legend falls back safely for any kind it doesn't know. Also seen, left for 3.6 (added there): the 14 older dialogs don't close on Esc.

- **Done** — Phase 1.5 Shared trips & cross-family people (PR #1). A trip's host family invites another family with a one-time link and picks co-owner or contributor. Only family owners accept. Places, itinerary, photos and comments on the trip are visible to every family on it and say who added them. Contributors change only their own; co-owners change everything; the trip itself (details, status, sharing, members) stays the host's. Packing, bookings and documents stay private per family, including a guest family's own list and bookings for the shared trip. A family that leaves takes its contributions with it, and they return on re-invite. Other families' photos show only in the trip's album, never in your library. "Same person in another family" links people across families that share a trip; the person page merges what the viewer may see; tagging works across families. There's an activity feed and a two-family dev seed. Verified: backend 296/296 (a trip-sharing suite; the isolation suite now 102 cases), frontend 168/168; Playwright on a seeded database as host, contributor and a newly invited co-owner (phone), with no console errors or overflow.
- **Note** — 1.5 decisions: public share links of a shared trip show only the host family's content, so nobody's photos are published without their consent. Global search, stats and the photo library stay per family. Shared-trip places show on the map once 1.6 replaces map sets. The dev seed is now safe to run on every start (it crash-looped before).

- **Done** — Phase 1.4 Tenancy & access layer (PR #1): `lib/access.ts` decides who can see and change what (`loadReadable`/`loadEditable` → 404, `assertRefs` → 400), and every route uses it or a family-filtered statement. A global error handler turns bad input (zod, non-UUID ids, bad dates, out-of-range coordinates, Postgres input errors) into 400/404/409 instead of 500. The tenant-isolation suite runs 90 cross-family attempts over every registered route, fails on any new route it doesn't cover, and was shown to fail when a check is removed. Migrations 0001–0012 are squashed into `0001_baseline.sql` (pg_dump diff checked); a pre-baseline database is refused at start-up with reset steps. Owners can "Download our data" (the family's rows and files); big downloads stream through a two-minute ticket link. Verified: backend 275/275, frontend 156/156; Playwright on a fresh baseline database: the full 1.3 walkthrough, a family export containing only that family's rows and photo, the admin backup download, and a ticket refused as a login.
- **Note** — Found by the 1.4 audit and fixed (added to 1.4): photos and documents from different families shared storage folders (`loose/<year>`, `people/<name>`…) and reused file names, so two families' uploads could collide and an old photo link could show another family's file. Files now live under `families/<familyId>/`, names carry a random suffix and are created exclusively, and moves never overwrite.
- **Changed** — "Download our data" and the admin backup now download through a short-lived, single-purpose link instead of being loaded into browser memory (a 20k-photo library wouldn't fit). The old map-set JSON export (`GET /api/export`, the Map's "Export map data") is removed. Old backups still restore into the new schema.
- **Note** — Left for later phases (not tenancy leaks): any family member (not only owners) can change family settings, delete trips and create share links; `/uploads/*` (pin icons, map overlays) is public; signed file URLs stay valid for 24 h after a share link is revoked; photos are filed under the upload year rather than the EXIF year. Listed in the 1.4 plan's "Outcome".

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
- Map: photo upload in the editor closes it and discards edits (`VisitPhotos.tsx:61` → `onSaved`); duplicate visit on retry after a failed photo upload; pick-on-map has no cancel; popup + modal open together; ✅ style loads twice on mount (1.6); family/kind/cruise-line defaults never affect saved pins; legend uses kind defaults only; ✅ map sets' default view isn't editable and no UI to add an existing visit to another set (map sets removed, 1.6); ✅ stats titled "Map stats" but family-wide (now "Travel stats", 1.6).
- Planning: trips can't be edited/deleted from Planning; status select shows stale value; "schedule" sets today's date; itinerary items not editable; "→ visit" creates a location-less visit on no map; bookings not clickable; timeline axis hard-coded to 2025.
- Packing: custom template edits never refresh (`PackingPage.tsx:44`); save-as-template doesn't refresh or confirm; no rename/delete/qty/label edit.
- Documents: search input unmounts each keystroke; empty filter shows "No documents yet" with no way back; banner computed from the filtered list; no delete confirm.
- Photos: map view limited to the first 60 photos; stale click handler; ✅ video/audio render as `<img>` (videos play, 2.2); editing caption/trip closes the modal; album share ignores non-trip filters.
- People: delete without confirm; cancelled avatar upload leaves an orphan photo.
- Settings: backup/restore only; no cache reset after restore; JSON "Export" and backup both toast "Backup downloaded".
- Share view: itinerary never rendered, pins do nothing, fixed world view, waypoints dropped, ✅ image URLs skip `API_URL` (2.2).
- Auth: logout doesn't clear cached data (another user on the same tab can briefly see the previous family's data); a 401 clears the token but leaves the UI signed in.
- Missing try/catch or confirmations in: ManagePanel, SettingsPanel save, StylePicker upload, FlightForm, useCruiseLookup, PhotoDetail, UploadReview, ShareButton, PeoplePage, DocumentForm, TripForm, PlanningPage status change, VisitPhotos delete, itinerary delete, BlackoutManager.
- ✅ Inconsistent trip query keys (`["trips", mapSetId]` vs `["trips"]`) — one `["trips"]` key since 1.6; the due-count badge refreshes only from the Documents page.

### A.4 Mobile & PWA
- ✅ Rail always visible on phones; ✅ header actions overflow off-screen (Planning, Photos); board and packing columns fixed-width; one breakpoint in the whole stylesheet; 14px inputs (iOS zoom); no safe-area insets with `black-translucent`; invite code hidden ≤720px.
- Service worker caches only `/` (no real offline), static cache name, registered in dev too; SVG-only icons; manifest still named "Family Map"; signed media URLs expire after 24 h, so a long-open PWA shows broken images.

### A.5 Tests
- Untested: auth, themes, uploads/icons, lookup/geo, import, settings, comments, map-set CRUD (backend); MapPage/MapView and most map components, LoginPage/auth, all of `lib/*`, the ShareView trip branch (frontend).
- Low-value/stale: `MapSetEditor.share-removed.test.tsx`, `AppShell.test.tsx` (tests the unreachable ComingSoon), five one-line `modules.*.test.ts` files, `client.test.ts` for the unused `uploadItemPhoto`.
