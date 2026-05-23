# Werejugo

A self-hosted **family scrapbook**, built as a set of modules. The first module is
an interactive **map** your family can pin journeys and memories onto — cruises,
flights, road trips, places you've eaten, anywhere you've been.

Everything runs on your own hardware via Docker. No third-party account required.

---

## What it does today

- **Vector map** with custom pins, themed icons, and colours.
- **Multiple map sets** — keep separate maps like *Summer Trips*, *All Cruises*,
  or *Places We've Eaten*, each with its own items.
- **Per-person family accounts** — create a family, then invite members with a code.
- **Item types**: places, food, flights, cruises, road trips, and a generic
  "custom" type.
- **Flights** are plotted as smooth great-circle arcs. Enter airport codes in order
  (`JFK, CDG, FCO`) or, if you configure an API key, look up a route by flight number.
- **Cruises** can be plotted from a list of ports of call, or auto-detected from a
  ship name via a best-effort CruiseMapper lookup (see caveats below).
- **Road trips** are drawn through stops you search for.
- **Themes & custom icons** — use the built-in icon set or upload your own images.
- **Custom base map** — replace the standard vector map with your own uploaded image
  overlay (e.g. a hand-drawn or fantasy map), positioned by geographic bounds.

---

## Architecture

| Layer    | Tech                                                            |
| -------- | --------------------------------------------------------------- |
| Frontend | React + Vite + TypeScript, MapLibre GL JS                       |
| Backend  | Node + Fastify + TypeScript, JWT auth                           |
| Database | PostgreSQL + PostGIS (geographic queries)                       |
| Tiles    | Online vector tiles (OpenFreeMap by default — no API key)       |
| Deploy   | Docker Compose (db + backend + frontend)                        |

```
              one exposed port (8080)
                       │
┌──────────────────────────────────┐      ┌──────────────────┐
│  frontend (nginx)                 │      │ postgres+postgis │
│  • serves the SPA                 │      │                  │
│  • proxies /api + /uploads ──────▶│ ───▶ │  (internal)      │
└──────────────────────────────────┘ HTTP └──────────────────┘
       │                    backend (Fastify, internal)
       └─ vector tiles            └─ optional: flight/geocode/cruise lookups
          (OpenFreeMap)
```

---

## Quick start

1. **Install Docker** (with the Compose plugin) on your server.
2. **Copy the env file and edit the secrets:**
   ```bash
   cp .env.example .env
   # At minimum, change POSTGRES_PASSWORD, DATABASE_URL's password, and JWT_SECRET.
   ```
3. **Build and start:**
   ```bash
   docker compose up -d --build
   ```
4. Open **http://<server-ip>:8080**, choose **New family**, and start pinning.

The backend automatically runs database migrations and seeds reference data
(airports, ports, built-in themes) on first start.

### Single origin — only one port to expose

The frontend's nginx reverse-proxies `/api` and `/uploads` to the backend, so the
**whole app lives behind one port** (`8080` by default). That means:

- You only expose `FRONTEND_PORT`. The backend stays internal to the compose network.
- No `VITE_API_URL` or `CORS_ORIGIN` to configure — it works at whatever
  IP/hostname/reverse-proxy you put in front of it, with no rebuild needed.

(Want the API published for debugging? Uncomment the `ports` block on the `backend`
service in `docker-compose.yml`.)

---

## Configuration reference

See `.env.example` for the full list. Highlights:

| Variable                   | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `JWT_SECRET`               | **Change this.** Signs login tokens.                                 |
| `POSTGRES_PASSWORD`        | **Change this.** Database password (also update `DATABASE_URL`).     |
| `FRONTEND_PORT`            | The single port the app is served on (default `8080`).               |
| `VITE_API_URL`             | Leave blank for the default single-origin proxy setup.               |
| `VITE_MAP_STYLE_URL`       | Vector tile style. Defaults to OpenFreeMap (free, no key).           |
| `CORS_ORIGIN`              | Only used if you publish the backend on its own origin.              |
| `AERODATABOX_RAPIDAPI_KEY` | Optional. Enables flight-number → route lookup.                      |
| `NOMINATIM_URL`            | Geocoder for place/port search. Defaults to public OSM Nominatim.    |
| `CRUISE_LOOKUP_ENABLED`    | Toggle the best-effort CruiseMapper scraper.                         |

---

## Caveats & honest limitations

- **Cruise auto-lookup is best-effort.** CruiseMapper has no public API, so the
  "by ship name" feature scrapes their public pages and **may break without notice**
  when their site changes. The reliable path is to type the ports of call in order —
  that always works and plots precisely. Cruise *legs* are drawn as great-circle
  arcs, not true sea routes (no marine routing engine).
- **Flight-number lookup needs an API key** (`AERODATABOX_RAPIDAPI_KEY`). Without it,
  enter origin/destination airport codes and the route is drawn as a great-circle arc.
- **Place/port search uses public OSM Nominatim** by default. Be respectful of their
  usage policy, or point `NOMINATIM_URL` at your own instance for heavy use.
- The bundled airport/port datasets cover major hubs. You can extend them in
  `backend/src/data/`.

---

## Project layout

```
.
├── docker-compose.yml
├── .env.example
├── backend/                # Fastify API + PostGIS
│   ├── src/
│   │   ├── routes/         # auth, map-sets, items, themes, uploads, lookup
│   │   ├── services/       # flight/cruise lookups, geocoding
│   │   ├── db/             # migrations, migrate + seed runners
│   │   ├── data/           # bundled airports.json / ports.json
│   │   └── lib/            # geo math, auth helpers
│   └── Dockerfile
└── frontend/               # React + MapLibre SPA
    ├── src/
    │   ├── components/     # MapView, ItemEditor, Sidebar, ...
    │   ├── pages/          # LoginPage, MapPage
    │   └── api/            # typed API client
    └── Dockerfile
```

## Local development (without Docker)

You'll need a PostgreSQL 16 + PostGIS database running.

```bash
# backend
cd backend
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/werejugo JWT_SECRET=dev-secret \
  npm run migrate && npm run seed && npm run dev

# frontend (separate terminal)
cd frontend
npm install
npm run dev   # Vite proxies /api and /uploads to localhost:4000 for you
```

## Roadmap ideas

- Drag-to-edit waypoints directly on the map.
- Photo attachments per item (the scrapbook angle).
- More modules beyond the map (timelines, recipe book, etc.).
- Self-hosted offline map tiles option.
