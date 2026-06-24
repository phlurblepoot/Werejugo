# Trip Planning Module — Design

**Date:** 2026-06-23
**Status:** Approved (design); **Phase 6** of the roadmap (architecture spec `2026-06-22-werejugo-architecture-design.md` §9).
**Scope:** A forward-looking Planning module — manage trips through an idea→planning→booked→done lifecycle on a **Board**, see tentative/dated trips and **blackout periods** on a **Timeline**, and build each trip's **itinerary + wishlist**, with bookings and travelers pulled from existing modules. A planned itinerary item can **convert** into a real map visit.
**Depends on:** Phases 1–2 (trips, visits, `links`, `EntityPicker`/`RelatedPanel`) and Phase 5 (trip-owned documents = bookings).

---

## 1. Context

Trips exist (family-scoped `trips`: name/description/start_date/end_date/cover/color) and are managed today only via the Map's basic `TripsPanel`. Visits link to a trip (`trip_id`), documents can be trip-owned (`owner_trip_id`), and people link to trips via the universal `links`. Missing: a trip **status**, a planning surface, an **itinerary** model, and **blackout periods**. This module adds those and elevates trips to a first-class module.

## 2. Decisions

| Decision | Choice |
|---|---|
| Views | **Board + Timeline** toggle. Board = kanban by status; Timeline = trip bars + blackout bands on a time axis |
| Trip status | Manual **idea / planning / booked / done** (column on the board; selector in the detail) |
| Itinerary model | **Separate `itinerary_items`** (not map visits) — `scheduled_on` set = scheduled, null = wishlist — with a **convert-to-visit** action |
| Blackouts | **One-off labeled date ranges** (`label, start, end, color`); recurrence is out of scope for v1 |
| Bookings & travelers | **Reused** — bookings = trip-owned documents (Phase 5); travelers = person↔trip links (Phase 2). No new endpoints |
| Implementation split | **6A (backend)** then **6B (frontend)** |

## 3. UX

A `Planning` rail module with a **Board / Timeline** toggle.
- **Board** — four columns (Idea / Planning / Booked / Done); each trip is a card (name, dates, status). Changing a card's status moves it (a per-card status control in v1; drag-and-drop is a later nicety). "Done" is effectively the history column.
- **Timeline** — trips drawn as bars positioned by their dates; **blackout periods** drawn as striped bands; a trip overlapping a blackout is flagged. Undated trips (ideas) are listed in a side bucket.
- **Trip detail** — a status selector + dates, then:
  - **Itinerary (scheduled)** — `itinerary_items` with a `scheduled_on`, in day order; each can **→ convert to a real map visit**.
  - **Wishlist (no date)** — undated `itinerary_items`, each with a "schedule" (set date) action.
  - **Bookings** — the trip's documents (`GET /api/documents?owner=trip:<id>`).
  - **Travelers** — people on the trip, via `RelatedPanel` on `trip:<id>`.
- **Blackouts** are managed from the Timeline (add/edit/delete labeled ranges).

## 4. Backend (Plan 6A)

### 4.1 Migration (`0009_trip_planning.sql`)
- `ALTER TABLE trips ADD COLUMN status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','planning','booked','done'));`
- `blackout_periods(id, family_id, label, start_date, end_date, color DEFAULT '#64748b', created_at)`.
- `itinerary_items(id, family_id, trip_id, title, notes, scheduled_on DATE NULL, seq INT DEFAULT 0, lat/lng DOUBLE PRECISION NULL, place_label TEXT, converted_visit_id UUID NULL REFERENCES visits(id) ON DELETE SET NULL, created_at)`. Indexed by `trip_id`.

### 4.2 Trips
`trips.ts` adds `status` to the create/patch schema and the DTO. No other change — the Board groups family trips by status client-side. (`updateTrip({ status })` moves a card.)

### 4.3 Itinerary (`itinerary.ts`, family-scoped)
- `GET /api/trips/:tripId/itinerary` — items for the trip, ordered `scheduled_on NULLS LAST, seq, created_at`.
- `POST /api/trips/:tripId/itinerary` — `{ title, notes?, scheduledOn?, seq?, lat?, lng?, placeLabel? }`.
- `PATCH /api/itinerary/:id` — edit fields, schedule a wishlist item (set `scheduledOn`), reorder (`seq`).
- `DELETE /api/itinerary/:id`.
- `POST /api/itinerary/:id/convert` — create a **visit** (`family_id`, `trip_id`, `kind='place'`, `title`, `occurred_on = scheduled_on`, `geom` from `lat/lng` when present), set `converted_visit_id`, return the visit + updated item. **Idempotent:** if already converted, returns the existing visit.

### 4.4 Blackouts (`blackouts.ts`, family-scoped)
- `GET/POST/PATCH/DELETE /api/blackouts` over `blackout_periods`. Validates `end_date >= start_date`.

### 4.5 Reused (no new endpoints)
- **Bookings:** `GET /api/documents?owner=trip:<id>` (Phase 5).
- **Travelers:** `GET /api/relations?entity=trip:<id>`, filtered to `person` entries on the client (Phase 2A).

## 5. Frontend (Plan 6B)

- **`pages/PlanningPage.tsx`** — the Board/Timeline toggle; owns the selected trip + modals.
- **`components/planning/TripBoard.tsx`** — four status columns of trip cards; a per-card status `<select>` calls `updateTrip({ status })`.
- **`components/planning/TripTimeline.tsx`** — positions trips + blackout bands on a time axis from their dates (a pure `placeOnAxis(range, items)` helper is unit-tested); flags trips overlapping a blackout.
- **`components/planning/TripDetail.tsx`** — status selector + dates; the Itinerary/Wishlist sections (add/schedule/convert/delete via the itinerary API); Bookings (reusing the Phase-5 document list, filtered to the trip); Travelers (`RelatedPanel` on `trip:<id>`).
- **`components/planning/TripForm.tsx`** — create/edit a trip (name, dates, status, color, description).
- **`components/planning/BlackoutManager.tsx`** — list/add/edit/delete blackout ranges.
- **Client (`api/client.ts`):** add `status` to the `Trip` type; `listItinerary(tripId)`, `createItineraryItem`, `updateItineraryItem`, `deleteItineraryItem`, `convertItineraryItem`; `listBlackouts`, `createBlackout`, `updateBlackout`, `deleteBlackout`. Bookings/travelers reuse `listDocuments({ owner })` and `getRelations`.
- Enable Planning in `shell/modules.ts` + a `/planning` route in `AppShell.tsx`.

## 6. Data flow

1. Board → `listTrips` grouped by `status`; status change → `updateTrip` → invalidate.
2. Timeline → `listTrips` + `listBlackouts` → bars + bands; overlap detection client-side.
3. Trip detail → `listItinerary(tripId)` + `listDocuments({ owner: 'trip:<id>' })` + `getRelations('trip:<id>')`.
4. Convert → `POST /api/itinerary/:id/convert` → a new visit; invalidate itinerary.

## 7. Error handling

- `zod` validation on every route; family-scoping everywhere (itinerary/blackout/trip ids verified to the family; cross-family 404).
- Date ranges require `end_date >= start_date` (blackouts; and trip dates when both set).
- Convert is idempotent — a second call returns the already-created visit rather than duplicating.

## 8. Testing

- **Backend:** trip `status` create/patch; itinerary CRUD incl. scheduled-vs-wishlist ordering and scheduling a wishlist item; `convert` creates a visit with the right fields and sets `converted_visit_id` (and is idempotent); blackout CRUD + the `end >= start` check; family-scoping.
- **Frontend:** `TripBoard` groups by status and a status change calls `updateTrip`; the `TripTimeline` `placeOnAxis` helper; `TripDetail` adds/schedules/converts an itinerary item and shows bookings/travelers; `BlackoutManager` CRUD; `PlanningPage` view toggle.

## 9. Out of scope

- Recurring blackout patterns (annual/weekly) — v1 is one-off ranges.
- Drag-and-drop on the board / timeline — status changes via a control in v1.
- Auto-adding a converted visit to a specific map set (the visit is created family-scoped; the Map module adds it to a map as usual).
- Collaborative editing / suggestions / cost budgeting — future ideas, not this phase.

## 10. Definition of done

The Planning rail module is live: a Board (idea/planning/booked/done) and a Timeline (trip bars + blackout bands with overlap flags); trips carry a status; each trip's detail builds an itinerary + wishlist (with convert-to-visit), and shows its bookings (documents) and travelers (people); blackout ranges are managed; all endpoints are family-scoped and tested; frontend tests, typecheck, and build pass.
