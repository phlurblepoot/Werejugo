# Werejugo

A self-hosted family travel scrapbook: map everywhere you've been, keep a searchable photo library tied to trips/places/people, track travel documents and renewals, plan future trips with itineraries and packing lists, search across everything, share selected trips and albums read-only, and back the whole thing up.

## Project status

Work to finish the app is tracked in the [completion roadmap](docs/superpowers/specs/2026-09-26-completion-roadmap.md): its Status block shows the current phase, each phase shows what's done, and §8 logs every change. Run `node scripts/roadmap.mjs` for a summary.

## Stack

- **Backend:** Fastify 5 + PostgreSQL 16 / PostGIS, `pg`, `@fastify/jwt`, `zod`, `sharp`.
- **Frontend:** React 18 + Vite + MapLibre GL + React Query + React Router.
- **Storage:** files live on disk in a browsable tree; only metadata + relative paths in the DB.

## Running with Docker

```bash
cp .env.example .env
# edit .env: set JWT_SECRET (openssl rand -hex 32) and POSTGRES_PASSWORD
docker compose up --build
```

The app is served on `FRONTEND_PORT` (default 8080). On first boot the database migrates and seeds reference data (airports/ports), built-in map themes and built-in packing templates. The first person to sign up creates the first family and becomes its owner; after that, new people join with the family's invite code (set `ALLOW_SIGNUP=true` to let anyone create another family).

**Your data lives in three volumes — back them up:** `db-data` (database), `storage` (photos, videos, documents) and `uploads` (custom pin icons, map overlays). On Unraid, map `/app/storage` and `/app/uploads` to folders under `/mnt/user/appdata/werejugo/` (the templates in `unraid/` do this).

## Local development (without Docker)

You need PostgreSQL 16 with PostGIS. The backend reads ordinary environment variables (there is no `.env` loader), so export what you need:

```bash
# backend (terminal 1)
cd backend
npm install
export DATABASE_URL=postgres://werejugo:change-me-in-production@localhost:5432/werejugo
export STORAGE_DIR=$PWD/../.data/storage UPLOADS_DIR=$PWD/../.data/uploads
npm run migrate
SEED_DEV_DATA=true npm run seed   # optional demo family: demo@werejugo.dev / password123
npm run dev                       # API on :4000

# frontend (terminal 2)
cd frontend
npm install
npm run dev                       # UI on :5173, proxies /api to :4000
```

Outside production a missing `JWT_SECRET` only logs a warning; with `NODE_ENV=production` the backend refuses to start without a strong one.

### Key environment variables

| Var | Purpose | Default |
|-----|---------|---------|
| `DATABASE_URL` | Postgres connection string | `postgres://werejugo:change-me-in-production@localhost:5432/werejugo` |
| `JWT_SECRET` | Signs login tokens. **Required in production**, at least 32 characters | — |
| `FILE_SIGNING_SECRET` | Signs photo/document links | derived from `JWT_SECRET` |
| `ALLOW_SIGNUP` | Let anyone create a new family after the first one | `false` |
| `STORAGE_DIR` | Photos, videos, documents (browsable tree) | `/app/storage` |
| `UPLOADS_DIR` | Custom pin icons, map overlays | `/app/uploads` |
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
