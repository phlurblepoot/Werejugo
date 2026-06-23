# Photos / Media Module — Design

**Date:** 2026-06-23
**Status:** Approved (design); **Phase 4** of the roadmap (architecture spec `2026-06-22-werejugo-architecture-design.md` §9).
**Scope:** A real photo library module — browse the family's media by time, person, place, and trip; bulk upload with EXIF-driven link suggestions; per-photo linking and trip assignment. Builds on the Phase-1 `media` core and the Phase-2 shared components.
**Depends on:** Phases 1–2 (`media`/`links` tables, signed file serving, `MediaUploader`/`EntityPicker`/`RelatedPanel`).

---

## 1. Context & problem

Today, media exists (`media` table, `POST/GET/PATCH/DELETE /api/media`, signed URLs) but is only reachable *through a visit* — there's no library view, no list endpoint, and uploads don't capture EXIF. The Photos module makes media first-class: a browsable, filterable library where any photo can be found by who/where/when and connected to the rest of the app.

**Backend gaps this module fills:**
- No media **list** endpoint (only `GET /api/media/:id`).
- Upload stores width/height but **not** `taken_at` or `geom` — the `/api/exif` logic exists but runs only client-side today. Browsing by time/place and suggesting links both need EXIF captured at upload.

## 2. Decisions

| Decision | Choice |
|---|---|
| Browse model | **Timeline** — one grid grouped into date sections, with person / trip / place filters layered on top |
| "Place" filter | **Both** — filter by a linked visit/location **and** a Grid/Map toggle showing geotagged photos |
| EXIF auto-linking | **Suggest + confirm** — after upload, a review step proposes trip (by capture date) and nearby visit (by GPS); the user accepts/adjusts before anything links or moves. People are tagged manually (EXIF can't infer them) |
| Photo detail | A modal reusing Phase-2 `RelatedPanel`; caption + trip select + EXIF readout + delete |
| Implementation split | **4A (backend)** then **4B (frontend)**, like prior phases |

## 3. Page UX

A `Photos` rail module. Top bar: **Upload** + a **Grid / Map** toggle. A **filter bar** of removable chips (Person, Trip, Place/visit, Date) that combine. 

- **Grid view:** photos in date-section groups (by capture month, falling back to upload date), each a responsive thumbnail grid; infinite scroll. Click a thumbnail → detail.
- **Map view:** a MapLibre map with clustered markers for geotagged photos, honoring the active filters; clicking a marker opens that photo.
- **Photo detail (modal):** large image; editable caption; a **Trip** selector (which moves the file's folder, §1/Phase-1 reconciler); EXIF readout (date + coordinates); a **Related** panel (people + visits) reusing `RelatedPanel`; delete.
- **Upload + review:** a multi-file `MediaUploader` run; afterward a **suggestion review** lists grouped proposals — e.g. "12 photos → Italy 2024 (by date)", "8 photos → near Colosseum (by GPS)" — each with *Link all / Skip*. People are tagged by hand in the detail.

## 4. Backend (Plan 4A)

No schema changes — `media` already has `taken_at`, `geom`, `trip_id`, dimensions.

### 4.1 EXIF on upload
Factor the existing `/api/exif` logic into a shared `extractExif(absPath) → { takenAt: string | null; lat: number | null; lng: number | null }` helper (`lib/exif.ts`), using `exifr`. In `POST /api/media`, after the file is saved, call it and populate `media.taken_at` and `media.geom` (`ST_SetSRID(ST_MakePoint(lng,lat),4326)`). The `/api/exif` route is refactored to use the same helper. EXIF failures are non-fatal (the photo still uploads).

### 4.2 `GET /api/media` — list with filters + pagination
Query params (all optional): `person` (person id, via `links`), `trip` (`media.trip_id`), `visit` (visit id, via `links`), `from`/`to` (dates, compared against `COALESCE(taken_at, created_at)`), `bbox` (`minLng,minLat,maxLng,maxLat`, via `geom && ST_MakeEnvelope(...,4326)` for the map), `limit` (default 60, max 200), `before` (keyset cursor = the last item's sort key). Returns media DTOs (signed `url`/`thumbUrl`, `takenAt`, `lng`/`lat`, `tripId`, `caption`) ordered by `COALESCE(taken_at, created_at) DESC, id DESC`. `zod`-validated; family-scoped.

### 4.3 `POST /api/media/suggestions`
Body `{ mediaIds: string[] }` (the just-uploaded set). Returns:
```
{
  trips:  [{ tripId, name, mediaIds }],   // media taken_at within a trip's [start_date, end_date]
  visits: [{ visitId, title, mediaIds }], // media geom within ~500m of a visit's point (ST_DWithin, geography)
}
```
Only family media/trips/visits are considered; media without `taken_at`/`geom` simply yield no suggestion.

### 4.4 `POST /api/media/apply-suggestion`
Body `{ mediaIds: string[], tripId?: string, visitId?: string }`. Validates every id is family media (and the trip/visit belongs to the family), then in a transaction: if `tripId`, sets `media.trip_id` and runs the move-on-trip reconciler per file; if `visitId`, creates a `media→visit` link per media (deduped). Returns the count applied. (Accepting one suggestion group = one call.)

## 5. Frontend (Plan 4B)

- **`pages/PhotosPage.tsx`** — composes the bar, filters, the active view (grid/map), the detail, and the upload→review flow; fetches media via `@tanstack/react-query` keyed on the filter set; infinite scroll via the `before` cursor.
- **`components/photos/PhotoFilters.tsx`** — the chip bar; person/trip/visit pickers reuse `EntityPicker`; a date-range control. Owns filter state, reported up.
- **`components/photos/PhotoGrid.tsx`** — groups loaded media by capture month and renders date-headed thumbnail grids; signals "load more" at the end.
- **`components/photos/PhotoMap.tsx`** — MapLibre + `supercluster` (both existing deps) clustered markers from each photo's `lng`/`lat`; click opens the photo. (WebGL canvas isn't unit-tested; the clustering input is.)
- **`components/photos/PhotoDetail.tsx`** — modal: image, caption (`PATCH`), trip `<select>` (`PATCH`), EXIF readout, `RelatedPanel` (`addTypes: ["person","visit"]`), delete.
- **`components/photos/UploadReview.tsx`** — runs after a multi-file `MediaUploader`; calls `/suggestions`, renders grouped *Link all / Skip*, applies via `/apply-suggestion`, then refreshes the library.
- **Client (`api/client.ts`):** add `listMedia(filters)`, `getMedia(id)`, `getMediaSuggestions(ids)`, `applyMediaSuggestion({ mediaIds, tripId?, visitId? })`. (`updatePhoto`/`deletePhoto` already target `/api/media`.)
- Enable Photos in `shell/modules.ts` and add the `/photos` route in `AppShell.tsx`.

## 6. Data flow

1. Filters → query params → `GET /api/media` → grouped by month → grid, **or** → markers on the map (same query, `bbox` added in map mode).
2. Upload: multi-file `MediaUploader` (no `linkTo`) → collect new media ids → `POST /suggestions` → review → `POST /apply-suggestion` → invalidate the media query.
3. Detail edits go straight through `PATCH /api/media/:id` (caption/trip) and the links API (`RelatedPanel`); a trip change moves the file via the existing reconciler.

## 7. Error handling

- EXIF extraction failures are silent — the photo uploads without a date/location.
- All list/suggestion params `zod`-validated; bad `bbox`/dates → 400.
- Family-scoping enforced everywhere; cross-family ids → 404. `apply-suggestion` validates every id before mutating, and is transactional.
- Upload/apply failures surface in the review panel without losing already-uploaded photos.

## 8. Testing

- **Backend:** `GET /api/media` filters (person, trip, visit, date range, bbox) and keyset pagination; EXIF populates `taken_at`/`geom` on upload (and silent failure on a non-photo); `/suggestions` (trip-by-date and visit-by-distance grouping); `/apply-suggestion` (sets trip + reconciles, creates visit links, validates family ownership).
- **Frontend:** `PhotoFilters` chip add/remove updates the query; `PhotoGrid` groups by month; `PhotoDetail` caption/trip/delete + `RelatedPanel`; `UploadReview` accept/skip calls `/apply-suggestion`; the `supercluster` grouping helper.

## 9. Out of scope

- Face recognition / automatic people tagging (people stay manual).
- Albums as a separate construct (trips already group photos; the timeline + filters cover browsing).
- Video/audio-specific players beyond the existing media handling.
- Editing photos (crop/rotate) — the library organizes, it doesn't edit pixels.

## 10. Definition of done

The Photos rail module is live: a date-grouped, filterable (person/trip/place/date) library with a Grid/Map toggle; bulk upload captures EXIF and runs a suggest-and-confirm review that links trips/visits; each photo's detail edits caption, trip, and people/visit links; all backend endpoints are family-scoped and tested; frontend tests, typecheck, and build pass.
