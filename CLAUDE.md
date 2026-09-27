# Werejugo — notes for Claude sessions

Self-hosted family travel scrapbook: Fastify + PostgreSQL/PostGIS backend (`backend/`), React + Vite + MapLibre frontend (`frontend/`), deployed with Docker on Unraid. The long-running plan to finish it is the **roadmap**:

**`docs/superpowers/specs/2026-09-26-completion-roadmap.md`**

## Roadmap discipline (mandatory)

This is a multi-session project, and conversation context gets lost. The roadmap file is the only reliable memory of where the project stands, so treat it as the source of truth and keep it current.

1. **Orient first.** Before doing any work — at session start, after resuming, and after context is compacted — read the roadmap's **Status** block, the section for the current phase, and the top of **§8 Progress & change log**. `node scripts/roadmap.mjs` prints a summary (a `SessionStart` hook in `.claude/settings.json` runs it automatically). If what the user asks for conflicts with the roadmap, say so before starting.
2. **Work from the roadmap.** Anything non-trivial that isn't already in it gets added first: a new checklist item in the right phase, ending `(added YYYY-MM-DD)`, plus a **Changed** log entry. Trivial fixes can go in without that, but they still get a **Note** log entry.
3. **Starting a phase:** write its detailed implementation plan at `docs/superpowers/plans/YYYY-MM-DD-phase-X.Y-<slug>.md` (same TDD, task-by-task style as the existing plans). Set the phase's status line to `Planned` with the Plan link, then `In progress` when building starts. Update the Status block.
4. **Tick items as they're finished,** `- [ ]` → `- [x]`, **in the same commit as the work.** Never tick something that isn't done and verified (tests run, behaviour checked).
5. **Finishing a phase:** when its work is complete and verified on the milestone branch (tests green, behaviour checked), set it to `Done` with the milestone PR link (every item ticked or dropped), add a **Done** log entry, and move the Status block to the next phase. Use `In review` only for a phase waiting on the owner (for example an approval). The milestone is finished when the owner merges the milestone PR.
6. **Changing the plan:** never diverge silently. Edit the roadmap in place:
   - New items end with `(added YYYY-MM-DD)`.
   - Dropped items are struck through, never deleted: `- [ ] ~~item~~ (dropped YYYY-MM-DD — reason)`.
   - Reordered or re-scoped phases get a **Changed** log entry saying what changed, why, and who decided.
   - Owner decisions also go in the §2 decisions table. When an open question in §7 is answered, move it to §2 and log it as **Decided**.
7. **Bugs found outside the current phase:** add them to the right phase (or Appendix A) and log a **Note**. Don't fix them silently unless they're trivial.
8. **Before ending a session that changed anything:** update **Last updated** and **Next step** in the Status block, add the log entries, and run `node scripts/roadmap.mjs --check` — it must pass.
9. **Milestone boundaries:** the owner reviews at the end of each milestone. Check the milestone's exit criteria, log a **Done** entry for the milestone, and wait for the owner's go-ahead before starting the next milestone.

Log entry format (newest date first, under a `### YYYY-MM-DD` heading):

```
- **Done** — Phase 1.1 Safety net & project hygiene merged (PR #12).
- **Changed** — Moved 5.3 Web push into Milestone 3 (owner asked for renewal reminders sooner).
- **Decided** — Families take their contributions with them when leaving a shared trip (§7 Q1 → §2).
- **Note** — Immich 2.x renamed the asset search endpoint; adapter updated.
```

## Branches and PRs

- `main` is the integration branch. Each **milestone** is built on one branch (the session's assigned branch) and reviewed as **one PR to `main`**; the owner reviews, tests and merges at milestone boundaries.
- Pushes to `claude/**` branches publish preview Docker images tagged with the branch name, so the owner can test a milestone on Unraid before merging.
- PRs follow `.github/pull_request_template.md`, including its Roadmap checklist. CI runs `node scripts/roadmap.mjs --check --changed-since origin/main` plus both test suites.

## Backend conventions

- **Tenancy goes through `backend/src/lib/access.ts`.** Load rows by id with `loadReadable`/`loadEditable` (404, never 403), check every id you store with `assertRefs` (400 "Unknown …"), and keep `family_id` in every `UPDATE`/`DELETE`. Shared trips (1.5) widen these helpers, not the routes.
- **Every new route needs a case in `routes/tenant-isolation.test.ts`** (or an `EXEMPT` entry with a reason) — the suite fails on any registered route it doesn't know.
- Throw `HttpError`s (`lib/errors.ts`) and parse bodies with zod `.parse()`; the global error handler turns them (and Postgres input errors) into 400/404/409. Dates use `ymd`/`optionalYmd` from `lib/validate.ts`; coordinates use `lib/geojson.ts`.
- Files live under `families/<familyId>/…` in `STORAGE_DIR`, with never-reused names (`lib/storage.ts`). That's documents only now: **photos and videos are `media` rows referencing Immich assets** (`immich_asset_id`), served by `GET /api/m/:id/:size` from signed links made with `lib/media/urls.ts` (`mediaUrls`, `signMediaUrl`) — never link to Immich or build file URLs for media. Build media DTOs with `lib/media/dto.ts`; turn Immich assets into rows with `lib/media/assets.ts`.
- Background work runs on pg-boss (`lib/jobs.ts`), started by the server; in tests `enqueue…` runs inline and `settleJobs()` waits for it. The Immich library sync is `lib/immich/sync.ts`.
- **The photo library** is `components/photos/LibraryTimeline.tsx`: laid out from `GET /api/media/timeline` month counts (`lib/timelineLayout.ts`) and windowed with `@tanstack/react-virtual`; months load through `useLibrary.ts` (keys start with `"media"`, so invalidating `["media"]` refreshes it). The list, counts and map share `lib/media/filters.ts` on the backend. **Add photos** anywhere is `PhotoPicker` (`/api/media/for` + `/api/media/attach`). Component tests that render it need `withApp()` (`src/test/app.tsx`, all providers) and `withElementSize()` (`src/test/size.ts`: jsdom has no layout or scrolling).
- **Faces:** Immich's people are mirrored per family in `immich_people` (`lib/immich/faces.ts`, run after each library sync). Matching one to a Werejugo person tags its photos with media → person links whose role is `face`; only `face` links are ever added or removed by the sync, never hand tags. Face tags are left out of a person's Related list (the library's person filter has them, and it includes other families' readable photos and person-linked tags). Face thumbnails are signed like media: `/api/f/:id`. The review queue is `/people?view=faces`.
- **Trip albums:** each trip is an album in each family's Immich account (`trip_albums`, `lib/immich/albums.ts`): a three-way merge against the album's contents at the last pass, run after each library sync and straight away via `enqueueAlbumSync()`. Triggers (migration 0009) mark a family's album whenever `media.trip_id` or a trip's name changes, and record `media.trip_changed_at` (conflicts follow Werejugo), so new code that changes a photo's trip needs nothing more than an `enqueueAlbumSync` for immediacy (the `onResponse` hook in `index.ts` covers the existing routes).
- **Suggestions from photos** are computed on request in `lib/suggest.ts` (no stored state but `suggestion_dismissals`), each with a stable key (`trip-photos:`, `trip-place:`, `trip-person:`, `visit-photos:`, `new-trip:`) that `POST /api/suggestions/apply|dismiss` re-checks. The sentences are written in `components/suggestions/Suggestions.tsx`. Place names are Immich's (`media.city/state/country`); `cityName()` drops GeoNames district suffixes.
- **Smart search** is Immich's (`immich.smartSearch`, needs its machine learning; `smartSearchOff()` → 409 "turned off"). `lib/media/search.ts` keeps Immich's order and applies Werejugo's filters. **Smart albums** (`smart_albums`) are saved filters plus `q`, evaluated when opened; `/photos?album=` and `/photos?q=` open them. The stand-in's machine learning is on unless `startFakeImmich({ machineLearning: false })` (the contract does that, like CI's Immich).
- **Reference data:** the bundled `backend/src/data/ports.json` and `airports.json` are built by `backend/scripts/build-reference-data.ts` (merge rules in `db/referenceMerge.ts`) and loaded by `db/reference.ts` at start-up and in the test setup, only when changed. Port and airport search (`services/places.ts`) folds accents and case into a `search` column with trigram indexes; ports learned from CruiseMapper (`source = 'cruisemapper'`) survive reloads.
- **Backups:** `BACKUP_TABLES` in `lib/archive.ts` lists every table, in insert order; a test fails on a new table that's neither there nor in `NOT_BACKED_UP`.
- **Uploads go in pieces:** `/api/media/uploads` (`routes/media-uploads.ts`, `lib/media/uploads.ts`) takes a file in chunks into `UPLOADS_DIR/incoming/`, then a job hands it to Immich with `lib/media/import.ts` (shared with the old single-request `POST /api/media`) and makes the requested link on the server. The web app uploads only through the upload manager (`frontend/src/lib/uploads`, `useUploads()`; its tray is `shell/UploadTray.tsx`); in component tests wrap with `withUploads()` from `src/test/uploads.tsx`. Never send a whole file to Immich with `fetch` (it buffers the body); `immich.uploadAsset` streams it.
- **Immich goes through `backend/src/lib/immich/client.ts`** (the official `@immich/sdk`, pinned to the version in `lib/immich/version.ts`); nothing else imports the SDK or calls Immich. Keys Werejugo stores are sealed with `lib/secretbox.ts` (`ENCRYPTION_KEY`) and never returned by a route.
- **Tests use the stand-in Immich** (`src/test/fake-immich.ts`); any new Immich call gets a case in `lib/immich/contract.test.ts`, which CI (`immich-contract.yml`) also runs against a real Immich. Keep the stand-in's shapes and error statuses identical to the real ones.
- Schema changes are new migrations after `0001_baseline.sql` (now up to `0013_inherit_styles.sql`); never edit an applied migration. Data migrations get a test in `src/db/migrations.test.ts` (run the SQL on old-shape data in a rolled-back transaction).

## Frontend conventions

- New screens use the kit in `frontend/src/components/kit` (Modal, Button, Field, PageHeader…); the older `.modal-backdrop` dialogs are being moved over (roadmap 3.6).
- Place kinds: `ITEM_KINDS` in `lib/style.ts` is the one list, and must match the backend's `visitSchema.kind` enum (`routes/visits.ts`).
- Anything search can find opens from a URL: `/map?visit=`, `/planning?trip=`, `/people?person=`, `/documents?doc=`, `/photos?photo=` (and `/photos?person=`, `?q=`, `?album=` for someone's photos, a smart search, a smart album). The map's filters live in the URL too (`lib/mapFilters.ts`).
- Other families' content (shared trips) carries a `ByFamily` chip and honours `canEdit` from the API; never infer edit rights on the client.

## Running things

Backend tests need PostgreSQL 16 with PostGIS on `localhost:5432`, with role `werejugo` / password `change-me-in-production` (or set `TEST_DATABASE_URL`). In a fresh cloud container, this worked:

```bash
apt-get install -y postgresql-16-postgis-3
mkdir -p /var/lib/postgresql/wj && chown postgres:postgres /var/lib/postgresql/wj
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/wj -A trust -U postgres"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/wj -l /var/lib/postgresql/wj/log -o '-p 5432 -k /tmp' start"
psql -h localhost -U postgres -c "CREATE ROLE werejugo LOGIN SUPERUSER PASSWORD 'change-me-in-production';" -c "CREATE DATABASE werejugo OWNER werejugo;"
```

| Task | Command |
|---|---|
| Backend install / typecheck / tests | `cd backend && npm ci && npx tsc --noEmit && npm test` |
| Frontend install / typecheck / tests / build | `cd frontend && npm ci && npx tsc --noEmit && npm test && npm run build` |
| Roadmap summary / validation | `node scripts/roadmap.mjs` / `node scripts/roadmap.mjs --check` |

To run the app locally with demo data:

```bash
cd backend
export STORAGE_DIR=/tmp/wj-storage UPLOADS_DIR=/tmp/wj-uploads SEED_DEV_DATA=true
npx tsx src/db/migrate.ts && npx tsx src/db/seed.ts   # safe to re-run; demo data is added once
npx tsx src/index.ts                                  # API on :4000
cd ../frontend && npx vite --port 5173                # UI on :5173, proxies /api
```

- Log in as `demo@werejugo.dev` (server admin, owner of The Wanderers) or `smith@werejugo.dev` (owner of The Smiths, a contributor on the Wanderers' "Lake Tahoe 2025"); password `password123` for both.
- `npm start` / the server itself does not migrate: run `migrate.ts` (and `seed.ts`) first, as the Docker image does.
- No Immich server? `cd backend && npm run fake-immich` starts the stand-in on :2283 (in memory); connect it in Admin → Immich with the key it prints, and set `ENCRYPTION_KEY` for the backend. To run the contract tests against a real Immich: `IMMICH_TEST_URL=http://host:2283 IMMICH_TEST_ADMIN_KEY=… npx vitest run src/lib/immich/contract.test.ts`.
- Chromium for Playwright is at `/opt/pw-browsers`. External map tiles may not load in the sandbox.

Known baseline (2026-09-27, end of Milestone 2): backend 468/468 tests pass, frontend 266/266; typecheck and build clean. The backend suite starts an in-memory Immich stand-in (`src/test/fake-immich.ts`); `npm run fake-immich` runs it on :2283 for trying the app (admin key `fake-immich-admin-key`).
