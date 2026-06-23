# Map Editor Overhaul — Design

**Date:** 2026-06-23
**Status:** Approved (design); slated as **Phase 3** of the roadmap (see the architecture spec, `2026-06-22-werejugo-architecture-design.md` §9)
**Scope:** Reorganize, modernize, and improve the "Add to map" / edit-item experience — currently a single 790-line god-component (`frontend/src/components/ItemEditor.tsx`). Full overhaul: clean structure **+** alignment to the Phase-1 shared core **+** UX improvements.
**Depends on:** Phase 2 (People), which builds the shared UI components — this overhaul reuses `MediaUploader`.

---

## 1. Context & problem

Adding or editing a map item goes through `ItemEditor.tsx`, a ~790-line component that conflates, in one place:

- Form state for all six kinds (place / food / flight / cruise / drive / custom) — ~30 `useState` hooks.
- Pin styling *and* path/trail styling state.
- Photo staging + a sequential upload loop on save.
- **Cruise lookup** (the largest tangle): CruiseMapper search, sailing selection, "reuse itinerary" date-shifting, port chips, image-as-pin — ~150 lines of orchestration.
- Flight lookup, point-picking, EXIF-from-photo.
- Geometry assembly + the multi-step save.

Sub-components exist (`PointFields`, `FlightFields`, `CruiseFields`) but the parent owns essentially all state and logic, so every kind and concern is entangled. Changing the save path or adding a kind means reasoning about the whole file. The appearance/styling controls sit messily at the bottom of the same scroll.

## 2. Decisions

| Decision | Choice |
|---|---|
| UX shape | **A+C** — a type selector on top; the body adapts to the chosen kind (only relevant fields) |
| Appearance controls | **Separated into a tab** — the editor has two tabs: **Details** and **Appearance** |
| Structure | Decompose the god-component into a thin shell + per-kind forms + extracted hooks (~8 files, each <150 lines) |
| Core alignment | Think in **visits**; photos go through Phase-2's **`MediaUploader`** (media + media↔visit link); reuse existing style controls |
| Optimization | Parallel photo uploads; lazy-mount Appearance tab; isolate kind forms to cut re-renders |
| Roadmap placement | **New Phase 3**, immediately after People (Photos→4, Documents→5, Planning→6, Packing→7, Polish→8) |
| Backend changes | **None** — reuses the existing `api.createItem`/`updateItem`/media/links seam from Phase 1 |

## 3. UX shape

Type selector (kind pills) at the top of the modal. Below it, two tabs:

- **Details** — a kind-tailored form. Place/Food/Custom share a compact location-first form (search / pick-on-map / from-photo EXIF, title, date). Flight, Cruise, and Drive each get their own form showing only what they need.
- **Appearance** — theme picker + color/icon, pin shape/size/border, and (for route kinds) trail style. These reuse the same controls the Themes and Settings screens use. Closed/unmounted until the tab is opened; the kind/theme default applies if untouched.

Save validates, assembles the payload, persists the visit, then commits any staged photos.

## 4. Component architecture

New module (e.g. `frontend/src/components/visit-editor/`):

- **`VisitEditor.tsx`** — the shell (~120 lines). Renders the modal, type selector, the Details/Appearance tab switcher, and Save/Cancel. Owns the draft via `useVisitDraft`. Delegates the Details body to the kind form and the Appearance body to `AppearanceTab`. Knows nothing about cruise/flight/style internals.
- **Per-kind Details forms** (one job each):
  - `PlaceForm.tsx` — place / food / custom: `PlaceSearch` + pick-on-map + EXIF-from-photo, title, date.
  - `FlightForm.tsx` — airport codes / flight-number lookup → stops.
  - `CruiseForm.tsx` — the CruiseMapper UI (line/ship autocompletes, sailings list, port chips); all logic via `useCruiseLookup`.
  - `DriveForm.tsx` — ordered stops via `StopBuilder`.
- **`AppearanceTab.tsx`** — theme picker + `StylePicker` + `PinStyleControls` + `PathStyleControls` (trail only for route kinds). No new styling controls — reuse.
- **Photos** — render the shared **`MediaUploader`** (Phase 2). It owns staging, previews, captions, and upload; replaces `addFiles`/`removePending`/`deleteExisting`/`saveCaption` and the bespoke photo grid.

### Extracted logic (no JSX, unit-testable)

- **`useVisitDraft.ts`** — the single draft model and the only place geometry/payload is assembled:
  ```
  draft = { kind, title, notes, occurredOn, themeId, tripId,
            appearance: { color, icon, pin, path },
            point | stops | routePath,   // geometry inputs by kind
            properties }                 // cruiseLine/ship, pin/path overrides
  ```
  Exposes `set(partial)`, `setKind(k)` (applies kind defaults from settings), `buildPayload()` and `errors`. `buildPayload()` produces a `Partial<Visit>`: geometry is a `Point` from `point`, or a `LineString` from `routePath ?? buildRoutePath(kind, stops)`; `properties.pin`/`properties.path` carry per-item overrides; cruise meta (`cruiseLine`/`ship`) added for the cruise kind.
- **`useCruiseLookup.ts`** — extracts the entire CruiseMapper orchestration: line/ship search, `findCruise`, sailings, `pickSailing`, the reuse-itinerary date-shift (`shiftIso`), port resolution/chips, and image-as-pin. Takes the relevant draft slice + a `set` callback; returns the handlers and lookup state (`busy`, `result`, `warnings`, `lookupImage`). `CruiseForm` becomes presentational.

## 5. Data flow

1. `VisitEditor` initializes `useVisitDraft(item, settings)` (empty for a new pin, or hydrated from the existing visit).
2. Type pills call `draft.setKind`; the Details body switches to the matching kind form, which reads/writes its draft slice. Cruise/flight forms drive lookups through their hooks, which write `stops`/`routePath`/`title`/`properties` back into the draft.
3. The Appearance tab reads/writes `draft.appearance` and `themeId`.
4. `MediaUploader` stages files (new visit) or edits live media (existing visit).
5. **Save:** `draft.errors` is checked; `draft.buildPayload()` → `api.createItem(mapSet.id, payload)` (or `updateItem`). On success, `MediaUploader` commits staged photos (in parallel), then `onSaved()`.

No backend changes: the Phase-1 client seam already creates the visit + map membership and links media.

## 6. Optimization

- Staged photo uploads run **in parallel** (`Promise.all`) rather than the current sequential `await` loop — inside `MediaUploader`.
- The **Appearance tab is lazy-mounted** — its style controls don't render until the tab is selected.
- **Kind forms are isolated** so typing in Details doesn't re-render appearance/photos; default computations (`defaultColor`, `defaultPinStyle`, `defaultPathStyle`) are memoized.

## 7. Error handling

- Validation lives in `useVisitDraft.errors`: title required; point kinds require a location; route kinds require ≥2 stops. Surfaced inline at the relevant field, and Save is guarded.
- Lookup/network failures (CruiseMapper, EXIF, port resolve) surface as dismissible warnings (as today) and never block a manual save.
- Photo upload failures are reported by `MediaUploader` without losing the saved visit.

## 8. Testing

- **Unit:** `useVisitDraft.buildPayload()` for each kind (geometry + properties correctness, including `routePath` vs derived line); `useCruiseLookup` (closest-sailing auto-select, `shiftIso` date-shift math, port resolution) against a mocked `api`.
- **Component:** each kind form renders only its fields; switching kind adapts the Details body; tab switching shows/hides Appearance; "save with no title" surfaces the error; saving a place creates a point visit with the expected payload (mocked `api`).

## 9. Migration & rollout

- Build the new `visit-editor/` module alongside `ItemEditor.tsx`; switch `MapPage` to render `VisitEditor`; delete `ItemEditor.tsx` once parity is verified.
- Behavior parity to preserve: all six kinds, cruise itinerary reuse + date shifting, flight lookup, EXIF placement, pick-on-map, per-item style overrides, photo add/caption/delete, theme selection, trip assignment.

## 10. Out of scope

- No backend/API changes.
- No new map-rendering or styling capabilities — appearance reuses existing controls.
- The Photos *module* (Phase 4) is separate; this overhaul only consumes `MediaUploader`.

## 11. Definition of done

`MapPage` adds/edits via `VisitEditor`; `ItemEditor.tsx` is deleted; the editor is ~8 focused files each <150 lines; cruise/flight/draft logic is in tested hooks; the Details/Appearance tabbed, kind-tailored UX is in place; all six kinds reach behavior parity; photo uploads are parallel; tests above pass; typecheck and build are clean.
