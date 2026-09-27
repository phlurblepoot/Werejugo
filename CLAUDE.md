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
- Files live under `families/<familyId>/…` in `STORAGE_DIR`, with never-reused names (`lib/storage.ts`).
- Schema changes are new migrations after `0001_baseline.sql` (now up to `0003_one_map.sql`); never edit an applied migration. Data migrations get a test in `src/db/migrations.test.ts` (run the SQL on old-shape data in a rolled-back transaction).

## Frontend conventions

- New screens use the kit in `frontend/src/components/kit` (Modal, Button, Field, PageHeader…); the older `.modal-backdrop` dialogs are being moved over (roadmap 3.6).
- Place kinds: `ITEM_KINDS` in `lib/style.ts` is the one list, and must match the backend's `visitSchema.kind` enum (`routes/visits.ts`).
- Anything search can find opens from a URL: `/map?visit=`, `/planning?trip=`, `/people?person=`, `/documents?doc=`, `/photos?photo=`. The map's filters live in the URL too (`lib/mapFilters.ts`).
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
- Chromium for Playwright is at `/opt/pw-browsers`. External map tiles may not load in the sandbox.

Known baseline (2026-09-26, end of Milestone 1): backend 288/288 tests pass, frontend 180/180; typecheck and build clean.
