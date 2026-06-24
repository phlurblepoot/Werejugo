# Werejugo

A self-hosted family travel scrapbook: map everywhere you've been, keep a searchable photo library tied to trips/places/people, track travel documents and renewals, plan future trips with itineraries and packing lists, search across everything, share selected trips and albums read-only, and back the whole thing up.

## Stack

- **Backend:** Fastify 5 + PostgreSQL 16 / PostGIS, `pg`, `@fastify/jwt`, `zod`, `sharp`.
- **Frontend:** React 18 + Vite + MapLibre GL + React Query + React Router.
- **Storage:** files live on disk in a browsable tree; only metadata + relative paths in the DB.

## Running with Docker

```bash
docker compose up --build
```

The app is served on the configured port (see `docker-compose.yml`). On first boot the database migrates and seeds reference data (airports/ports), built-in map themes, and built-in packing templates.

## Local development (without Docker)

You need a local PostgreSQL 16 with PostGIS. Set `UPLOADS_DIR` and `STORAGE_DIR` to writable paths or the backend will refuse to boot.

```bash
# backend
cd backend
cp .env.example .env   # if present; otherwise set the vars below
npm install
npm run migrate
npm run seed
npm run dev

# frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### Key environment variables

| Var | Purpose | Default |
|-----|---------|---------|
| `DATABASE_URL` | Postgres connection string | `postgres://werejugo:change-me-in-production@localhost:5432/werejugo` |
| `JWT_SECRET` | Token signing secret — **change in production** | dev placeholder |
| `STORAGE_DIR` | Root of the file storage tree | `/app/storage` |
| `UPLOADS_DIR` | Temp upload dir | `/app/uploads` |
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
