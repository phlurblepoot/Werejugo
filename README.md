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

The app is served on `FRONTEND_PORT` (default 8080). The backend container migrates the database and then starts; there is no separate migration step. On first boot the database migrates and seeds reference data (airports/ports), built-in map themes and built-in packing templates. Open the app and the setup screen creates the first family; that person becomes the **server admin**. There is no public sign-up: the admin invites new families with one-time links (Admin → Families), and family owners invite their members the same way (Settings → Family). Forgotten passwords are reset with a one-time link from a family owner or the admin.

**Your data lives in three volumes — back them up:** `db-data` (database), `storage` (photos, videos, documents) and `uploads` (custom pin icons). On Unraid, map `/app/storage` and `/app/uploads` to folders under `/mnt/user/appdata/werejugo/` (the templates in `unraid/` do this).

### Testing a preview before it's merged

Every push to a `claude/<name>` branch publishes images tagged `claude-<name>` (for example `ghcr.io/phlurblepoot/werejugo-backend:claude-cool-hopper-pku4ne` and the matching `werejugo-frontend`). To try one on Unraid, edit both containers and change the tag after `:` in **Repository** from `latest` to the preview tag, then apply. Switch back to `latest` after the pull request is merged. A preview may need a database reset (see [Resetting the database](#resetting-the-database)); the pull request says so when it does.

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
| `ENCRYPTION_KEY` | Encrypts the Immich keys Werejugo stores (and, later, document files). At least 32 characters (`openssl rand -hex 32`). Needed to turn on Immich. **Keep a copy**: a backup restored without it needs the Immich keys entered again | — |
| `STORAGE_DIR` | Document files (browsable tree) | `/app/storage` |
| `UPLOADS_DIR` | Custom pin icons, and photos and videos while they upload (each is removed once Immich has it). Leave room for the largest batch you'll upload | `/app/uploads` |
| `MAX_UPLOAD_GB` | The largest single photo or video that can be uploaded | `20` |
| `CORS_ORIGIN` | Allowed origins (comma-separated) | `http://localhost:8080` |

## Photos (Immich)

Each family's photos and videos live in its own account on an [Immich](https://immich.app) server next to Werejugo; Werejugo shows them in its own pages (thumbnails, previews, originals and seekable video at its own signed links) and Immich stays off the internet. Uploading in Werejugo puts the file in the family's Immich account; photos added in Immich directly show up in Werejugo within about five minutes (or at once with **Refresh from Immich** on the Photos page), and edits and deletions follow. Deleting a photo in Werejugo moves it to Immich's trash, where it can be restored for 30 days. Install Immich with [docs/immich-on-unraid.md](docs/immich-on-unraid.md), set `ENCRYPTION_KEY` on the backend, then connect it in **Admin → Immich** (address + an Immich admin API key) and **Connect all families**. Werejugo supports Immich 3.2 up to (not including) 4.0.

**The library:** the Photos page is one timeline, fast with tens of thousands of photos. Jump to any year from the rail on the right; filter by person, trip, place, dates, photos or videos, photos in no trip, and hidden photos. **Hide** takes screenshots, receipts and the like out of Werejugo without deleting them from Immich. Select several photos (the tick button, Shift+click for a range, or a long press on a phone) to put them in a trip, hide or delete them together. A photo opens full-screen; ← and → step through the library. The Map view shows every photo with a place, clustered, with thumbnails. Places, trips (and their itinerary days) and people have **Add photos**, which opens on the photos taken then and there and can browse the whole library.

**Faces:** Immich recognises the people in a family's photos (face recognition runs on the Immich server; a GPU makes it faster). **People → Faces** lists the faces waiting to be named, most photos first, and People shows how many. For each, say who it is: someone already in Werejugo (including a person from a family you share a trip with), a new person, or nobody to keep. Every photo with that face is then tagged with that person, and new photos are tagged as they arrive. A person's page shows their faces and **See N photos**, which counts the photos you can see of them in any family linked as the same person.

**Trips are albums in Immich:** every trip your family is on is also an album in your Immich account, holding your photos of the trip (on a trip shared with another family, each family's album holds its own photos). Putting photos in a trip in Werejugo adds them to the album within seconds; adding photos to the album in Immich's app puts them in the trip within about five minutes (or at once with **Refresh from Immich**), and removing them takes them out. The album's name follows the trip's, deleting a trip deletes its album (not the photos), and an album deleted in Immich is made again, so delete a trip in Werejugo instead. If a photo is changed on both sides at once, Werejugo's change wins. A trip's Photos section shows its album.

**Suggestions from photos:** Werejugo reads your photos' dates, places (Immich names them) and faces, and offers to fill the gaps, one tap each:
- **Planning:** "Looks like you were in Lisbon, March 2019. Create trip?" for photos taken away from home that aren't in any trip. Home is worked out from where most of your photos were taken.
- **A trip:** the photos taken during it, places you took photos at that aren't on it yet, and people in its photos who aren't on it.
- **A place:** the photos taken there and then.

**Review** opens the photo picker, and ✕ dismisses a suggestion (a photo suggestion comes back only for photos added later).

**Smart search and smart albums:** search what's in your photos ("beach at sunset", "birthday cake") from the command palette (Ctrl/Cmd-K) or the Photos page's search field. This uses Immich's machine learning, so it needs the machine-learning container from the guide; without it, Werejugo says so. The results respect the Photos page's filters. **Smart albums** keep a search and filters under a name: they fill themselves as new photos arrive, and can be shared by a public link like a trip's album. Public links never show photos you've hidden from the library.

**Uploading:** files go up in 8 MB pieces (well under Cloudflare's 100 MB request limit), three at a time, with each file's progress in the upload panel at the bottom of the screen. A dropped connection is retried on its own; after a reload, choose the same file again and it continues where it stopped. Once a file is in, Werejugo hands it to Immich in the background, so you can leave the page; a photo added to a place or person is linked to it when it arrives. A file already in the library says "Already in your library" (and comes back out of Immich's trash if it was deleted). iPhone HEIC and Live Photos, camera RAW files and videos go to Immich as they are. On an iPhone, Safari usually sends a JPEG copy and only the still of a Live Photo; for full quality, back the phone up with Immich's own app (the photos then appear in Werejugo through the sync).

> **Upgrading from Milestone 1:** photos uploaded before Immich was added aren't carried over (the milestone ran on test data). Their files stay in the `storage` folder under `families/<id>/…/photos` and `families/<id>/loose/`; delete those folders once you no longer need them.

## Map data

Werejugo ships its own lists of places to pick from, loaded into the database at start-up (only when they change):

- **Ports:** about 15,000. They come from the World Port Index (NGA Pub. 150, public domain; via [tayljordan/ports](https://github.com/tayljordan/ports), MIT), UN/LOCODE ports (UNECE) and [searoute-ts](https://github.com/mayurrawte/searoute-ts)'s port list, merged with Werejugo's own list of cruise ports. Ports seen on CruiseMapper sailings (private islands and the like) are added as they're found.
- **Airports:** every airport with an IATA code (about 9,000), from [OurAirports](https://ourairports.com/data/) (public domain).

`cd backend && npx tsx scripts/build-reference-data.ts` rebuilds both files (`backend/src/data/`) from their pinned sources.

## Modules

Map · People · Photos · Documents · Planning · Packing — all views over one shared core (Person, Visit, Trip, Media, Document) connected by a universal links table. A global search (Ctrl/Cmd-K) jumps to anything.

## Sharing

**Between families on this server:** a trip's host family can invite another family (Planning → the trip → Families) with a one-time link, as a *co-owner* (may change everything on the trip) or a *contributor* (adds and changes only its own places, plans, photos and comments). Everyone on the trip sees its places, itinerary, photos and comments, marked with who added them; packing lists, bookings and documents stay private to each family. A family that leaves takes its contributions with it. People in different families can be linked as the same person.

**Public links:** trips and photo albums can be shared as public, read-only links (`/s/<token>`), with no login required. A shared trip's public link shows only the host family's content. Maps and documents are not shareable.

## Backup & restore

**Admin → Backup** downloads the whole server — database, photos, videos, documents and custom pin icons — as one `.tar.gz`. Only a **server admin** can back up or restore (Admin → Backup), because an archive contains every family on the server. Restore **replaces all current data**, is guarded by a typed confirmation, and checks the archive completely before changing anything. The archive is a plain gzipped tar (`db.json` table dump + `storage/` + `uploads/`), so it can also be restored by hand.

Archives larger than ~100 MB can't be uploaded through Cloudflare's free proxy; restore those from your local network address instead.

### Resetting the database

The database schema was restarted from a single baseline in September 2026. A database created before that (it still has the old `0001_init.sql` … `0012_accounts.sql` migrations) can't be upgraded in place: the backend stops at start-up with a message saying so, and changes nothing. To move to the new schema:

1. If you want to keep the data, download a backup first (Admin → Backup) with the **old** version still running.
2. Stop Werejugo and delete the database data: `docker compose down` then `docker volume rm werejugo_db-data` (the name may carry your project prefix; see `docker volume ls`). On Unraid, stop the containers and delete the database appdata folder (by default `/mnt/user/appdata/werejugo/db`).
3. Start Werejugo again. It builds an empty database and shows the setup screen.
4. To bring the data back, complete the setup screen, then restore the backup from Admin → Backup. Backups from older versions restore into the new schema (new settings get their defaults, and if the backup has no server admin, the oldest family's first owner becomes one).

Photos, videos and documents live in the `storage` volume, not the database, so they aren't touched by step 2.

## Tests

```bash
cd backend && npm test     # Vitest against a real werejugo_test database
cd frontend && npm test    # Vitest + Testing Library
```
