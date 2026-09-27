import { mediaUrls } from "./urls.js";

/** Columns every media DTO needs (alias `m`, with `f` = the owning family). */
export const MEDIA_COLUMNS = `m.id, m.kind, m.trip_id, m.family_id, m.caption, m.original_name, m.taken_at, m.created_at,
  m.width, m.height, m.duration_ms, m.thumbhash, ST_X(m.geom) AS lng, ST_Y(m.geom) AS lat`;

export interface MediaDtoRow {
  id: string; kind: string; trip_id: string | null; family_id: string; family_name?: string | null;
  caption: string; original_name: string; taken_at: string | null; created_at: string;
  width: number | null; height: number | null; duration_ms: number | null; thumbhash: string | null;
  lng: number | null; lat: number | null;
}

/** A photo or video as the web app sees it: signed links to Werejugo's copies, never Immich's. */
export function mediaDto(r: MediaDtoRow) {
  return {
    id: r.id, kind: r.kind, tripId: r.trip_id,
    // Another family's photo on a shared trip: shown with who added it, view-only.
    familyId: r.family_id, familyName: r.family_name ?? null,
    caption: r.caption, originalName: r.original_name,
    takenAt: r.taken_at, createdAt: r.created_at,
    width: r.width, height: r.height, durationMs: r.duration_ms, thumbhash: r.thumbhash,
    lng: r.lng, lat: r.lat,
    ...mediaUrls(r),
  };
}
