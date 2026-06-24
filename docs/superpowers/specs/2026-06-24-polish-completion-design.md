# Phase 8 — Polish & Completion Design

**Scope:** The final roadmap phase (§9, Phase 8). Turns the module set built in Phases 1–7 into a finished, shareable, backup-able product. Five workstreams, **no new core entities** — everything reuses the shared core, the universal `links` table, and the existing storage layer.

**Depends on:** Phases 1–7 (all complete).

---

## 1. Scope

Selected for Phase 8:

| Workstream | In scope |
|---|---|
| Global "find anything" search | ✅ |
| Generalized read-only sharing | ✅ (repurpose existing plumbing) |
| Full archive backup & restore | ✅ |
| Consistent empty / loading / error states | ✅ |
| Docs & onboarding | ✅ |
| **Read-only guest role** | ❌ **out of scope** — public share links cover external viewers; anyone needing full access gets a member account |

### Decisions locked (from brainstorming)

| Decision | Choice |
|---|---|
| Search surface | Command palette (Cmd/Ctrl-K) **and** a visible 🔍 button in the rail; both open the same palette |
| Search scope | All core types at once (people, trips, visits, photos, documents), grouped results |
| Backup format | Single `.tar.gz`: `pg_dump` (custom format) DB dump + the full storage tree + `manifest.json` |
| Restore semantics | In-app **full wipe & replace**, owner-only, typed-confirmation guard |
| Sharing targets | **Trips** and **Albums** only |
| Maps shareable? | **No** — drop the map Share button; keep the generic public-view plumbing |
| Documents shareable? | **No** — too sensitive |
| Sharing mechanism | Repurpose the existing `share_links` / token / `ShareView` infrastructure |
| Empty/loading/error | Three shared components applied across every module |
| Onboarding | README + a first-run welcome panel (reuses `<EmptyState>`) |

---

## 2. Global search

### 2.1 Backend — `GET /api/search`

A new endpoint that searches **all** core types in one call and returns grouped results. (The existing `GET /api/entities/search` searches a single `type` at a time and powers the `EntityPicker` autocomplete; it stays as-is. The new endpoint reuses the same per-type ILIKE queries already present in `relations.ts`.)

- **Auth:** `requireAuth`; every query family-scoped on `req.user.familyId`.
- **Query:** `q` (trimmed). Empty `q` → all groups empty.
- **Per group cap:** 6 results, ordered by relevance/recency as each existing query already does.
- **Response shape:**

```jsonc
{
  "people":    [{ "type": "person",   "id": "...", "label": "Aunt Venicia",  "thumbUrl": "/api/files/...?sig=...", "to": "/people/<id>" }],
  "trips":     [{ "type": "trip",     "id": "...", "label": "Venice 2024",   "thumbUrl": null, "to": "/planning/trips/<id>" }],
  "visits":    [{ "type": "visit",    "id": "...", "label": "Rialto Bridge", "thumbUrl": null, "to": "/map?visit=<id>" }],
  "photos":    [{ "type": "media",    "id": "...", "label": "venice-canal.jpg", "thumbUrl": "/api/files/...?sig=...", "to": "/photos?photo=<id>" }],
  "documents": [{ "type": "document", "id": "...", "label": "Passport",      "thumbUrl": null, "to": "/documents/<id>" }]
}
```

Search columns (matching the existing per-type queries): visit `title`; trip `name`; person `display_name`; media `caption` or `original_name`; document `title`. Thumbnails are signed file URLs (`signFileUrl`) where the entity has an image, else `null`. The `to` field is the client route the palette navigates to on selection — computed server-side from the entity type so the frontend stays dumb.

### 2.2 Frontend — `CommandPalette`

A `CommandPalette` component mounted once in `AppShell`.

- **Open triggers:** a global **Cmd/Ctrl-K** key handler, and a visible **🔍 search button in the left rail**. Both toggle the same palette. **Esc** closes.
- **Layout:** centered overlay (modal) with a query input and grouped result list below.
- **Behavior:** debounced (~200 ms) query → `api.search(q)` (React Query); results render grouped by type with thumbnails and a small type label. **↑/↓** moves a highlight across the flattened result list, **Enter** navigates to the highlighted result's `to` route and closes the palette; clicking a result does the same.
- **Empty/idle:** before typing, show a hint ("Search people, trips, photos, documents…"); with a query and no matches, show a compact "No matches" line.
- **API client:** add `search(q: string)` to `frontend/src/api/client.ts` returning the grouped shape above.

---

## 3. Generalized sharing

Reuse the working public-view infrastructure — `share_links`, the share token, auth-gated file access via token, and the public `ShareView` page — and change *what* can be shared.

### 3.1 Data model — generalize `share_links`

Today `share_links` points at a map set. A migration generalizes the target:

- Add `target_type text` and `target_id uuid` to `share_links`, with a CHECK allow-list `target_type IN ('trip','album')`.
- Backfill is unnecessary (greenfield; no real shares). Existing map-set share columns/rows are dropped or migrated out, since map sharing is being retired (§3.3).
- An **album** share stores its definition (which photos) as `target_type='album'` with `target_id` referencing a saved album, or — if albums are not a stored entity — the share row carries a small JSON filter describing the gallery. **Resolved:** albums are defined by a trip or an explicit media set; the share resolves the media list at view time from the same query the in-app gallery uses. The album share row stores `target_type='album'`, `target_id` = the owning trip id (gallery = that trip's photos) for v1; a free-form album builder is out of scope for Phase 8.

### 3.2 Backend — share routes

Generalize the share creation route to accept `{ target_type, target_id }` validated against the allow-list and verified to belong to the family. The public read route `GET /api/share/:token` resolves the target and returns a read-only payload:

- **Trip share:** the trip, its visits (with geometry for the map), its linked photos, and its itinerary — all read-only.
- **Album share:** the resolved media list (signed thumb + full URLs through the token).

Files referenced by a shared view are served through the existing token-gated file path so no login is required but URLs remain unguessable. **Documents are never included** in any share payload.

### 3.3 Frontend

- **Add** a "Share" action to **trip detail** and to a **photo gallery/album** view → creates a share link, shows the public URL with copy.
- **Remove** the "Share" button from the map/map-set UI so maps can no longer be newly shared. The generic public-view plumbing and route remain.
- **`ShareView`** gains rendering for the two target types: a trip (map + read-only photo grid + itinerary) and an album (read-only grid + lightbox). No login; no edit affordances.

---

## 4. Backup & restore

A new **Settings → Backup** area, owner-only.

### 4.1 Download — `GET /api/backup`

Streams a single `.tar.gz` containing:

1. `db.dump` — `pg_dump` in **custom format** (`-Fc`) of the application database. Custom format round-trips PostGIS geometry, sequences, and FK ordering losslessly.
2. `storage/` — the entire storage tree (photos, documents, thumbnails) as it exists on disk.
3. `manifest.json` — app/schema version, ISO timestamp, table list, and counts, so restore can sanity-check the archive before touching anything.

**Dependency:** the backend image needs the `postgres-client` binaries (`pg_dump`/`pg_restore`) — one line added to the backend Dockerfile. Documented in the README.

### 4.2 Restore — `POST /api/restore`

Owner-only, destructive, guarded by a typed confirmation ("type `restore`") in the UI.

1. Accept the uploaded `.tar.gz` (multipart, raised size limit for this route).
2. Read and validate `manifest.json` (recognizable archive, compatible schema version) → reject early with a clear error if invalid.
3. **Wipe & replace:** restore `db.dump` with `pg_restore --clean --if-exists` into the app database, and replace the storage tree with the archive's `storage/`.
4. Return success with restored counts.

Because restore swaps the whole world, it is the natural disaster-recovery / server-migration path. It is never available to non-owners and never runs without the typed confirmation.

### 4.3 Frontend — Settings → Backup

- **Download backup** button → triggers the `GET /api/backup` download.
- **Restore from backup**: file picker + a typed-confirmation modal ("This replaces ALL current data. Type `restore` to continue.") → `POST /api/restore`, then a success/refresh state. Owner-only; hidden for non-owners.

---

## 5. Shared empty / loading / error states

Three small shared components in `frontend/src/components/ui` (or `components/shared`), then applied across every module's list/detail views, replacing today's ad-hoc inline handling:

- **`<EmptyState>`** — icon + message + optional call-to-action button (e.g. "No trips yet — Create your first trip").
- **`<Loading>`** — consistent spinner/skeleton for query-loading states.
- **`<ErrorState>`** — message + a retry action for failed queries.

Pure UI consolidation; no backend changes. Each module's main views (People, Photos, Documents, Planning, Packing, Map lists) switch to these.

---

## 6. Docs & onboarding

- **README** — setup and run (Docker + local dev), required env vars (incl. `UPLOADS_DIR`/`STORAGE_DIR`), the backup/restore workflow and its `pg_dump` dependency, and a short module overview.
- **First-run welcome** — when the family has no data, the app shows a short "Welcome — here's how to start" panel (add people → create a trip → drop in photos) instead of empty modules. Built on `<EmptyState>`.

---

## 7. Testing

Same gates as Phases 1–7.

**Backend (Vitest against the live `werejugo_test` DB):**
- `/api/search`: grouped results across types; family-scoping (no cross-family leakage); empty-query handling; per-group cap.
- Sharing: a trip and an album are shareable and resolve their read-only payloads; a map set is **not** shareable; a document target is rejected; public `GET /api/share/:token` returns the right read-only shape and excludes documents.
- Backup/restore **round-trip**: seed a DB + storage, download a backup, wipe the DB and storage, restore the archive, assert rows and files return. Manifest validation rejects a malformed archive. Restore is owner-gated.

**Frontend (Vitest + Testing-Library):**
- Command palette: opens via keyboard and via the rail button; debounced grouped results render; ↑/↓ + Enter navigation; Esc closes.
- Share UI: Share actions present on trip + album, absent on maps; copy of the public URL.
- Restore confirm guard: restore disabled until `restore` is typed; hidden for non-owners.
- Shared state components render the right empty/loading/error UI; first-run welcome appears only with no data.

---

## 8. Plan structure

Following the established A/B split, Phase 8 breaks into two independently testable plans:

- **Phase 8A (backend):** `GET /api/search`; `share_links` generalization migration + retargeted share routes; `GET /api/backup` + `POST /api/restore` (+ Dockerfile `postgres-client`).
- **Phase 8B (frontend):** `CommandPalette` (+ rail button + `api.search`); trip/album Share UI and retired map Share button; `ShareView` rendering for trip + album; Settings → Backup download/restore UI; shared `<EmptyState>`/`<Loading>`/`<ErrorState>` applied across modules; first-run welcome; README.

---

## 9. Definition of done

The completed Werejugo hub: a self-hosted household travel scrapbook where the family can map everywhere they've been, keep a searchable photo library tied to trips/places/people, track people and travel documents with renewal reminders, plan future trips with itineraries and packing lists, **find anything across the whole archive from one search box**, **share selected trips and albums read-only by link**, **back up and restore the entire hub (database + files) in one archive**, and read consistent, finished-feeling UI with onboarding for a fresh install — all over the same shared core, one links API, and one Related panel.
