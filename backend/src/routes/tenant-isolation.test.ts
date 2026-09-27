/**
 * Tenant isolation: family B tries every endpoint against family A's data.
 *
 * Every registered route must either appear in CASES or in EXEMPT with a
 * reason — the last test fails if a new route is added without deciding how
 * it is isolated. At the end, family A's data must be exactly as it was.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx, type TestUser } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx; // family A (its owner is also the server admin, like after setup)
let b: TestUser; // family B's owner
const A: Record<string, string> = {}; // family A's ids
const B: Record<string, string> = {}; // family B's own ids (for requests that reference A's)
const CANARY = "SECRET-A";

const one = async (sql: string, params: unknown[] = []) => (await query<{ id: string }>(sql, params)).rows[0].id;

beforeAll(async () => {
  ctx = await buildTestApp();
  b = await addUser(ctx, { familyName: "Family B", role: "owner" });
  const fa = ctx.familyId;
  A.user = ctx.userId;
  A.trip = await one(`INSERT INTO trips (family_id, name, start_date) VALUES ($1, '${CANARY} trip', '2024-06-01') RETURNING id`, [fa]);
  A.visit = await one(`INSERT INTO visits (family_id, trip_id, title, geom) VALUES ($1, $2, '${CANARY} visit', ST_SetSRID(ST_MakePoint(12.5, 41.9), 4326)) RETURNING id`, [fa, A.trip]);
  await query(`INSERT INTO visit_waypoints (visit_id, label, geom) VALUES ($1, '${CANARY} stop', ST_SetSRID(ST_MakePoint(1, 1), 4326))`, [A.visit]);
  A.comment = await one(`INSERT INTO comments (visit_id, user_id, body) VALUES ($1, $2, '${CANARY} comment') RETURNING id`, [A.visit, A.user]);
  A.person = await one(`INSERT INTO people (family_id, display_name) VALUES ($1, '${CANARY} person') RETURNING id`, [fa]);
  A.media = await one(`INSERT INTO media (family_id, trip_id, immich_asset_id, caption, taken_at, geom) VALUES ($1, $2, gen_random_uuid(), '${CANARY} photo', '2024-06-02', ST_SetSRID(ST_MakePoint(12.5, 41.9), 4326)) RETURNING id`, [fa, A.trip]);
  A.document = await one(`INSERT INTO documents (family_id, title, owner_person_id, expires_on) VALUES ($1, '${CANARY} passport', $2, CURRENT_DATE + 5) RETURNING id`, [fa, A.person]);
  A.theme = await one(`INSERT INTO themes (family_id, name) VALUES ($1, '${CANARY} theme') RETURNING id`, [fa]);
  A.icon = await one(`INSERT INTO icons (family_id, name, url) VALUES ($1, '${CANARY} icon', '/uploads/a.png') RETURNING id`, [fa]);
  A.itinerary = await one(`INSERT INTO itinerary_items (family_id, trip_id, title) VALUES ($1, $2, '${CANARY} plan') RETURNING id`, [fa, A.trip]);
  A.blackout = await one(`INSERT INTO blackout_periods (family_id, label, start_date, end_date) VALUES ($1, '${CANARY} school', '2024-01-01', '2024-01-10') RETURNING id`, [fa]);
  A.list = await one(`INSERT INTO packing_lists (family_id, trip_id, name) VALUES ($1, $2, '${CANARY} list') RETURNING id`, [fa, A.trip]);
  A.item = await one(`INSERT INTO packing_items (list_id, label) VALUES ($1, '${CANARY} socks') RETURNING id`, [A.list]);
  A.template = await one(`INSERT INTO packing_lists (family_id, name) VALUES ($1, '${CANARY} template') RETURNING id`, [fa]);
  A.link = await one("INSERT INTO links (family_id, from_type, from_id, to_type, to_id) VALUES ($1, 'person', $2, 'trip', $3) RETURNING id", [fa, A.person, A.trip]);
  A.share = await one("INSERT INTO share_links (token, family_id, target_type, target_id) VALUES ('secret-a-token', $1, 'trip', $2) RETURNING id", [fa, A.trip]);
  await query(`UPDATE families SET settings = '{"note": "${CANARY} settings"}' WHERE id = $1`, [fa]);
  A.tripInvite = await one("INSERT INTO trip_invites (trip_id, role, token_hash, expires_at) VALUES ($1, 'contributor', 'hash-a', now() + interval '1 day') RETURNING id", [A.trip]);
  A.person2 = await one(`INSERT INTO people (family_id, display_name) VALUES ($1, '${CANARY} person 2') RETURNING id`, [fa]);
  A.personLink = await one("INSERT INTO person_links (person_a, person_b) VALUES ($1, $2) RETURNING id", [A.person, A.person2]);
  await query(`INSERT INTO activity (trip_id, family_id, kind, summary) VALUES ($1, $2, 'visit.added', '${CANARY} activity')`, [A.trip, fa]);
  A.face = await one(`INSERT INTO immich_people (family_id, immich_person_id, name, photo_count) VALUES ($1, gen_random_uuid(), '${CANARY} face', 5) RETURNING id`, [fa]);
  A.upload = await one(`INSERT INTO media_uploads (family_id, user_id, filename, size, state, error) VALUES ($1, $2, '${CANARY}.jpg', 100, 'failed', 'x') RETURNING id`, [fa, A.user]);

  const fb = b.familyId;
  B.trip = await one("INSERT INTO trips (family_id, name) VALUES ($1, 'B trip') RETURNING id", [fb]);
  B.media = await one(`INSERT INTO media (family_id, immich_asset_id) VALUES ($1, gen_random_uuid()) RETURNING id`, [fb]);
  B.person = await one("INSERT INTO people (family_id, display_name) VALUES ($1, 'B person') RETURNING id", [fb]);
  B.visit = await one("INSERT INTO visits (family_id, title) VALUES ($1, 'B visit') RETURNING id", [fb]);

  before = await snapshotA();
});
afterAll(() => closeTestApp(ctx));

/** Everything family A has, as text, to prove nothing changed. */
async function snapshotA(): Promise<string> {
  const fa = ctx.familyId;
  const tables: Record<string, string> = {
    families: "SELECT * FROM families WHERE id = $1",
    users: "SELECT * FROM users WHERE family_id = $1",
    trips: "SELECT * FROM trips WHERE family_id = $1",
    visits: "SELECT * FROM visits WHERE family_id = $1",
    waypoints: "SELECT w.* FROM visit_waypoints w JOIN visits v ON v.id = w.visit_id WHERE v.family_id = $1",
    comments: "SELECT c.* FROM comments c JOIN visits v ON v.id = c.visit_id WHERE v.family_id = $1",
    people: "SELECT * FROM people WHERE family_id = $1",
    media: "SELECT * FROM media WHERE family_id = $1",
    documents: "SELECT * FROM documents WHERE family_id = $1",
    themes: "SELECT * FROM themes WHERE family_id = $1",
    icons: "SELECT * FROM icons WHERE family_id = $1",
    itinerary: "SELECT * FROM itinerary_items WHERE family_id = $1",
    blackouts: "SELECT * FROM blackout_periods WHERE family_id = $1",
    packing_lists: "SELECT * FROM packing_lists WHERE family_id = $1",
    packing_items: "SELECT i.* FROM packing_items i JOIN packing_lists l ON l.id = i.list_id WHERE l.family_id = $1",
    links: "SELECT * FROM links WHERE family_id = $1",
    share_links: "SELECT * FROM share_links WHERE family_id = $1",
    trip_members: "SELECT m.* FROM trip_members m JOIN trips t ON t.id = m.trip_id WHERE t.family_id = $1",
    trip_invites: "SELECT i.* FROM trip_invites i JOIN trips t ON t.id = i.trip_id WHERE t.family_id = $1",
    person_links: "SELECT l.* FROM person_links l JOIN people p ON p.id = l.person_a WHERE p.family_id = $1",
    activity: "SELECT a.* FROM activity a JOIN trips t ON t.id = a.trip_id WHERE t.family_id = $1",
    family_immich: "SELECT * FROM family_immich WHERE family_id = $1",
    media_uploads: "SELECT * FROM media_uploads WHERE family_id = $1",
    immich_people: "SELECT * FROM immich_people WHERE family_id = $1",
  };
  const out: Record<string, unknown> = {};
  for (const [name, sql] of Object.entries(tables)) {
    out[name] = (await query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t::text), '[]') AS rows FROM (${sql}) t`, [fa])).rows[0].rows;
  }
  return JSON.stringify(out);
}
let before = "";

type Outcome = 400 | 403 | 404 | "clean";
interface Case {
  /** The registered route this covers, e.g. "GET /api/visits/:id". */
  route: string;
  /** What family B sends. Ids are filled in lazily (the fixture runs first). */
  url: () => string;
  payload?: () => object;
  /** 400/403/404 exactly, or "clean": any 2xx whose body mentions nothing of family A. */
  expect: Outcome;
  note?: string;
}

const c = (route: string, url: () => string, expect: Outcome, payload?: () => object, note?: string): Case =>
  ({ route, url, expect, payload, note });

const CASES: Case[] = [
  // Places (visits) and their comments
  c("GET /api/visits", () => "/api/visits", "clean"),
  c("GET /api/visits/:id", () => `/api/visits/${A.visit}`, 404),
  c("PATCH /api/visits/:id", () => `/api/visits/${A.visit}`, 404, () => ({ title: "hijacked" })),
  c("DELETE /api/visits/:id", () => `/api/visits/${A.visit}`, 404),
  c("POST /api/visits", () => "/api/visits", 400, () => ({ kind: "place", title: "x", tripId: A.trip }), "their trip"),
  c("POST /api/visits", () => "/api/visits", 400, () => ({ kind: "place", title: "x", themeId: A.theme }), "their theme"),
  c("PATCH /api/visits/:id", () => `/api/visits/${B.visit}`, 400, () => ({ tripId: A.trip }), "move my place onto their trip"),
  c("GET /api/visits/:id/comments", () => `/api/visits/${A.visit}/comments`, 404),
  c("POST /api/visits/:id/comments", () => `/api/visits/${A.visit}/comments`, 404, () => ({ body: "hi" })),
  c("DELETE /api/comments/:id", () => `/api/comments/${A.comment}`, 404),

  // Immich: B sees only its own connection state
  c("GET /api/immich", () => "/api/immich", "clean"),

  // Trips, itinerary, blackouts
  c("GET /api/trips", () => "/api/trips", "clean"),
  c("POST /api/trips", () => "/api/trips", "clean", () => ({ name: "B's own trip" })),
  c("PATCH /api/trips/:id", () => `/api/trips/${A.trip}`, 404, () => ({ name: "hijacked" })),
  c("DELETE /api/trips/:id", () => `/api/trips/${A.trip}`, 404),
  c("GET /api/trips/:tripId/itinerary", () => `/api/trips/${A.trip}/itinerary`, 404),
  c("POST /api/trips/:tripId/itinerary", () => `/api/trips/${A.trip}/itinerary`, 404, () => ({ title: "x" })),
  c("PATCH /api/itinerary/:id", () => `/api/itinerary/${A.itinerary}`, 404, () => ({ title: "x" })),
  c("DELETE /api/itinerary/:id", () => `/api/itinerary/${A.itinerary}`, 404),
  c("POST /api/itinerary/:id/convert", () => `/api/itinerary/${A.itinerary}/convert`, 404),
  c("GET /api/blackouts", () => "/api/blackouts", "clean"),
  c("POST /api/blackouts", () => "/api/blackouts", "clean", () => ({ label: "B", startDate: "2024-02-01", endDate: "2024-02-02" })),
  c("PATCH /api/blackouts/:id", () => `/api/blackouts/${A.blackout}`, 404, () => ({ label: "x" })),
  c("DELETE /api/blackouts/:id", () => `/api/blackouts/${A.blackout}`, 404),

  // Packing (private per family)
  c("GET /api/packing/templates", () => "/api/packing/templates", "clean"),
  c("POST /api/packing/templates", () => "/api/packing/templates", 404, () => ({ name: "copy", fromListId: A.template })),
  c("GET /api/packing/lists/:id", () => `/api/packing/lists/${A.list}`, 404),
  c("PATCH /api/packing/lists/:id", () => `/api/packing/lists/${A.list}`, 404, () => ({ name: "x" })),
  c("DELETE /api/packing/lists/:id", () => `/api/packing/lists/${A.list}`, 404),
  c("POST /api/packing/lists/:id/items", () => `/api/packing/lists/${A.list}/items`, 404, () => ({ label: "x" })),
  c("PATCH /api/packing/items/:id", () => `/api/packing/items/${A.item}`, 404, () => ({ checked: true })),
  c("DELETE /api/packing/items/:id", () => `/api/packing/items/${A.item}`, 404),
  c("GET /api/trips/:tripId/packing", () => `/api/trips/${A.trip}/packing`, 404),
  c("POST /api/trips/:tripId/packing", () => `/api/trips/${A.trip}/packing`, 404, () => ({})),
  c("POST /api/trips/:tripId/packing", () => `/api/trips/${B.trip}/packing`, 404, () => ({ fromTripId: A.trip }), "copy their trip's list"),

  // Documents
  c("GET /api/documents", () => "/api/documents", "clean"),
  c("GET /api/documents", () => `/api/documents?owner=person:${A.person}`, "clean", undefined, "filter by their person"),
  c("GET /api/documents/due-count", () => "/api/documents/due-count", "clean"),
  c("GET /api/documents/:id", () => `/api/documents/${A.document}`, 404),
  c("PATCH /api/documents/:id", () => `/api/documents/${A.document}`, 404, () => ({ title: "x" })),
  c("DELETE /api/documents/:id", () => `/api/documents/${A.document}`, 404),
  c("POST /api/documents/:id/file", () => `/api/documents/${A.document}/file`, 404),
  c("POST /api/documents", () => "/api/documents", 400, () => ({ title: "x", docType: "other", ownerPersonId: A.person }), "their person"),
  c("POST /api/documents", () => "/api/documents", 400, () => ({ title: "x", docType: "other", ownerTripId: A.trip }), "their trip"),

  // People, relations, links
  c("GET /api/people", () => "/api/people", "clean"),
  c("GET /api/people/:id", () => `/api/people/${A.person}`, 404),
  c("PATCH /api/people/:id", () => `/api/people/${A.person}`, 404, () => ({ displayName: "x" })),
  c("DELETE /api/people/:id", () => `/api/people/${A.person}`, 404),
  c("POST /api/people", () => "/api/people", 400, () => ({ displayName: "x", avatarMediaId: A.media }), "their photo as avatar"),
  c("POST /api/people", () => "/api/people", 400, () => ({ displayName: "x", userId: A.user }), "their account"),
  c("PATCH /api/people/:id", () => `/api/people/${B.person}`, 400, () => ({ avatarMediaId: A.media }), "their photo as my avatar"),
  c("GET /api/family-members", () => "/api/family-members", "clean"),
  c("GET /api/relations", () => `/api/relations?entity=trip:${A.trip}`, 404),
  c("GET /api/entities/search", () => `/api/entities/search?type=trip&q=${CANARY}`, "clean"),
  c("GET /api/links", () => `/api/links?entity=trip:${A.trip}`, 404),
  c("POST /api/links", () => "/api/links", 400, () => ({ from: `person:${B.person}`, to: `trip:${A.trip}` })),
  c("DELETE /api/links/:id", () => `/api/links/${A.link}`, 404),

  // Faces found in photos
  c("GET /api/faces", () => "/api/faces?view=all", "clean"),
  c("GET /api/faces/count", () => "/api/faces/count", "clean"),
  c("PATCH /api/faces/:id", () => `/api/faces/${A.face}`, 404, () => ({ personId: B.person })),
  c("PATCH /api/faces/:id", () => `/api/faces/${A.face}`, 404, () => ({ ignored: true }), "ignore their face"),
  c("POST /api/faces/:id/person", () => `/api/faces/${A.face}/person`, 404, () => ({ displayName: "x" })),
  c("GET /api/people/:id/faces", () => `/api/people/${A.person}/faces`, 404),

  // Photos & videos
  c("GET /api/media", () => "/api/media", "clean"),
  c("GET /api/media", () => `/api/media?trip=${A.trip}`, "clean", undefined, "filter by their trip"),
  c("GET /api/media", () => `/api/media?person=${A.person}`, "clean", undefined, "filter by their person"),
  c("GET /api/media/:id", () => `/api/media/${A.media}`, 404),
  c("PATCH /api/media/:id", () => `/api/media/${A.media}`, 404, () => ({ caption: "x" })),
  c("PATCH /api/media/:id", () => `/api/media/${B.media}`, 400, () => ({ tripId: A.trip }), "put my photo in their trip"),
  c("DELETE /api/media/:id", () => `/api/media/${A.media}`, 404),
  c("POST /api/media/suggestions", () => "/api/media/suggestions", "clean", () => ({ mediaIds: [A.media, B.media] })),
  c("POST /api/media/apply-suggestion", () => "/api/media/apply-suggestion", 400, () => ({ mediaIds: [A.media], tripId: null })),
  c("POST /api/media/apply-suggestion", () => "/api/media/apply-suggestion", 400, () => ({ mediaIds: [B.media], tripId: A.trip })),
  c("POST /api/media/apply-suggestion", () => "/api/media/apply-suggestion", 400, () => ({ mediaIds: [B.media], visitId: A.visit })),
  c("GET /api/files/*", () => `/api/files/families/${ctx.familyId}/documents/passport-1234abcd.pdf`, 403, undefined, "no signature"),
  c("GET /api/media/timeline", () => "/api/media/timeline", "clean"),
  c("GET /api/media/timeline", () => `/api/media/timeline?trip=${A.trip}`, "clean", undefined, "their trip's months"),
  c("GET /api/media/geo", () => "/api/media/geo", "clean"),
  c("GET /api/media/geo", () => `/api/media/geo?trip=${A.trip}`, "clean", undefined, "their trip's points"),
  c("POST /api/media/links", () => "/api/media/links", "clean", () => ({ ids: [A.media, B.media] })),
  c("POST /api/media/bulk", () => "/api/media/bulk", 400, () => ({ mediaIds: [A.media], hidden: true })),
  c("POST /api/media/bulk", () => "/api/media/bulk", 400, () => ({ mediaIds: [B.media], tripId: A.trip }), "put my photos in their trip"),
  c("GET /api/media/for", () => `/api/media/for?entity=visit:${A.visit}`, 404),
  c("GET /api/media/for", () => `/api/media/for?entity=trip:${A.trip}`, 404),
  c("GET /api/media/for", () => `/api/media/for?entity=person:${A.person}`, 404),
  c("GET /api/media/for", () => `/api/media/for?entity=itinerary:${A.itinerary}`, 404),
  c("POST /api/media/attach", () => "/api/media/attach", 400, () => ({ mediaIds: [A.media], to: `visit:${B.visit}` }), "their photo"),
  c("POST /api/media/attach", () => "/api/media/attach", 400, () => ({ mediaIds: [B.media], to: `visit:${A.visit}` }), "their place"),
  c("POST /api/media/attach", () => "/api/media/attach", 400, () => ({ mediaIds: [B.media], to: `trip:${A.trip}` }), "their trip"),
  c("POST /api/media/attach", () => "/api/media/attach", 404, () => ({ mediaIds: [B.media], to: `itinerary:${A.itinerary}` }), "their plan"),
  c("POST /api/media/uploads", () => "/api/media/uploads", 400, () => ({ filename: "a.jpg", size: 10, mime: "image/jpeg", linkTo: `visit:${A.visit}` }), "for their place"),
  c("GET /api/media/uploads", () => "/api/media/uploads", "clean"),
  c("GET /api/media/uploads/:id", () => `/api/media/uploads/${A.upload}`, 404),
  c("PUT /api/media/uploads/:id", () => `/api/media/uploads/${A.upload}?offset=0`, 404, () => ({ bytes: "x" })),
  c("POST /api/media/uploads/:id/retry", () => `/api/media/uploads/${A.upload}/retry`, 404),
  c("DELETE /api/media/uploads/:id", () => `/api/media/uploads/${A.upload}`, 404),
  c("GET /api/m/:id/:size", () => `/api/m/${A.media}/thumbnail`, 403, undefined, "their photo, no signature"),
  c("GET /api/f/:id", () => `/api/f/${A.face}`, 403, undefined, "their face, no signature"),
  c("GET /api/f/:id", () => `/api/f/${A.face}?e=9999999999&s=forged`, 403, undefined, "their face, forged signature"),
  c("GET /api/m/:id/:size", () => `/api/m/${A.media}/original?e=9999999999&s=forged`, 403, undefined, "their photo, forged signature"),

  // Map sets and map styling
  c("GET /api/themes", () => "/api/themes", "clean"),
  c("POST /api/themes", () => "/api/themes", "clean", () => ({ name: "B theme" })),
  c("PATCH /api/themes/:id", () => `/api/themes/${A.theme}`, 404, () => ({ name: "x" })),
  c("DELETE /api/themes/:id", () => `/api/themes/${A.theme}`, 404),
  c("GET /api/icons", () => "/api/icons", "clean"),
  c("DELETE /api/icons/:id", () => `/api/icons/${A.icon}`, 404),
  c("GET /api/settings", () => "/api/settings", "clean"),
  c("PUT /api/settings", () => "/api/settings", "clean", () => ({ note: "B's own" })),

  // Family-wide views
  c("GET /api/stats", () => "/api/stats", "clean"),
  c("GET /api/search", () => `/api/search?q=${CANARY}`, "clean"),

  // Sharing a trip with other families (B is on none of A's trips)
  c("GET /api/trips/:id/members", () => `/api/trips/${A.trip}/members`, 404),
  c("POST /api/trips/:id/invites", () => `/api/trips/${A.trip}/invites`, 404, () => ({ role: "coowner" })),
  c("DELETE /api/trips/:id/invites/:inviteId", () => `/api/trips/${A.trip}/invites/${A.tripInvite}`, 404),
  c("PATCH /api/trips/:id/members/:familyId", () => `/api/trips/${A.trip}/members/${b.familyId}`, 404, () => ({ role: "coowner" })),
  c("DELETE /api/trips/:id/members/:familyId", () => `/api/trips/${A.trip}/members/${b.familyId}`, 404),
  c("GET /api/trips/:id/activity", () => `/api/trips/${A.trip}/activity`, 404),
  c("GET /api/trips/:id/people", () => `/api/trips/${A.trip}/people`, 404),
  c("GET /api/person-links", () => "/api/person-links", "clean"),
  c("POST /api/person-links", () => "/api/person-links", 404, () => ({ personId: B.person, otherPersonId: A.person }), "their person, no shared trip"),
  c("POST /api/person-links/:id/accept", () => `/api/person-links/${A.personLink}/accept`, 404),
  c("DELETE /api/person-links/:id", () => `/api/person-links/${A.personLink}`, 404),

  // Public share links
  c("GET /api/shares", () => `/api/shares?targetType=trip&targetId=${A.trip}`, "clean"),
  c("POST /api/shares", () => "/api/shares", 404, () => ({ targetType: "trip", targetId: A.trip })),
  c("DELETE /api/shares/:id", () => `/api/shares/${A.share}`, 404),
];

/** Routes that don't need a cross-family case here, and why. */
const EXEMPT: Record<string, string> = {
  "GET /api/health": "no data",
  "GET /api/auth/config": "public, no family data",
  "POST /api/auth/setup": "only works on an empty server (auth.test.ts)",
  "POST /api/auth/login": "public (auth.test.ts)",
  "POST /api/auth/register": "retired: always 410",
  "GET /api/auth/me": "the caller's own session (session.test.ts)",
  "GET /api/invites/:token": "public one-time link (invites.test.ts)",
  "POST /api/invites/:token/accept": "public one-time link (invites.test.ts)",
  "GET /api/password-resets/:token": "public one-time link (password-resets.test.ts)",
  "POST /api/password-resets/:token": "public one-time link (password-resets.test.ts)",
  "GET /api/share/:token": "public share link: only the shared trip (share-public.test.ts)",
  "GET /api/trip-invites/:token": "the token itself is the invitation (trip-sharing.test.ts)",
  "POST /api/trip-invites/:token/accept": "the token itself is the invitation; owners only (trip-sharing.test.ts)",
  "PATCH /api/account": "the caller's own account (account.test.ts)",
  "POST /api/account/password": "the caller's own account (account.test.ts)",
  "POST /api/account/sign-out-everywhere": "the caller's own account (account.test.ts)",
  "GET /api/family": "the caller's own family (family.test.ts)",
  "PATCH /api/family": "the caller's own family (family.test.ts)",
  "POST /api/family/invites": "the caller's own family (family.test.ts)",
  "DELETE /api/family/invites/:id": "scoped to the caller's family (family.test.ts)",
  "PATCH /api/family/members/:id": "scoped to the caller's family: another family's member is 404 (family.test.ts)",
  "DELETE /api/family/members/:id": "scoped to the caller's family: another family's member is 404 (family.test.ts)",
  "POST /api/family/members/:id/reset-link": "scoped to the caller's family (password-resets.test.ts)",
  "GET /api/family/export": "only the caller's family (family-export.test.ts)",
  "POST /api/downloads/ticket": "a ticket for the caller's own session (family-export.test.ts)",
  "GET /api/backup": "server admin only (backup.test.ts)",
  "POST /api/restore": "server admin only (restore.test.ts)",
  "GET /api/admin/overview": "server admin only (admin.test.ts)",
  "GET /api/admin/family-invites": "server admin only (admin.test.ts)",
  "POST /api/admin/family-invites": "server admin only (admin.test.ts)",
  "DELETE /api/admin/family-invites/:id": "server admin only (admin.test.ts)",
  "PATCH /api/admin/families/:id": "server admin only (admin.test.ts)",
  "DELETE /api/admin/families/:id": "server admin only (admin.test.ts)",
  "GET /api/admin/users": "server admin only (admin.test.ts)",
  "PATCH /api/admin/users/:id": "server admin only (admin.test.ts)",
  "POST /api/admin/users/:id/reset-link": "server admin only (admin.test.ts)",
  "POST /api/admin/view-family": "server admin only, audited (admin.test.ts)",
  "POST /api/admin/return": "server admin only (admin.test.ts)",
  "GET /api/admin/audit": "server admin only (admin.test.ts)",
  "GET /api/admin/immich": "server admin only (immich.test.ts)",
  "PUT /api/admin/immich": "server admin only, audited (immich.test.ts)",
  "POST /api/admin/immich/check": "server admin only (immich.test.ts)",
  "POST /api/admin/immich/connect-all": "server admin only, audited (immich.test.ts)",
  "POST /api/admin/immich/families/:id/connect": "server admin only, audited (immich.test.ts)",
  "POST /api/admin/immich/families/:id/link": "server admin only, audited (immich.test.ts)",
  "DELETE /api/admin/immich/families/:id": "server admin only, audited (immich.test.ts)",
  "POST /api/immich/password": "acts on the caller's own family only; no id to aim at another (immich.test.ts)",
  "POST /api/media": "creates in the caller's family's own Immich account (media.test.ts)",
  "POST /api/immich/refresh": "syncs the caller's own family only; no id to aim at another (immich.test.ts)",
  "POST /api/admin/immich/families/:id/sync": "server admin only (immich.test.ts)",
  "POST /api/import": "creates in the caller's family; onto another family's trip is 400 (import.test.ts)",
  "POST /api/icons": "creates in the caller's family",
  "POST /api/uploads/from-url": "no family data: a public map image",
  "POST /api/exif": "reads the uploaded file only",
  "GET /api/geo/airports": "reference data",
  "GET /api/geo/ports": "reference data",
  "GET /api/geo/resolve": "reference data",
  "GET /api/geo/search": "external lookup",
  "GET /api/lookup/cruise/lines": "external lookup",
  "GET /api/lookup/cruise/ships": "external lookup",
  "POST /api/lookup/cruise": "external lookup",
  "POST /api/lookup/cruise/diagnose": "external lookup",
  "POST /api/lookup/cruise/find": "external lookup",
  "POST /api/lookup/cruise/sailing": "external lookup",
  "POST /api/lookup/flight": "external lookup",
};

describe("family B can't reach family A's data", () => {
  for (const k of CASES) {
    const [method, pattern] = k.route.split(" ");
    test(`${k.route}${k.note ? ` (${k.note})` : ""} → ${k.expect}`, async () => {
      const res = await ctx.app.inject({
        method: method as "GET",
        url: k.url(),
        headers: bearer(b.token),
        ...(k.payload ? { payload: k.payload() } : {}),
      });
      expect(pattern).toBeTruthy();
      if (k.expect === "clean") {
        expect(res.statusCode, res.body).toBeGreaterThanOrEqual(200);
        expect(res.statusCode, res.body).toBeLessThan(300);
      } else {
        expect(res.statusCode, res.body).toBe(k.expect);
      }
      expect(res.body).not.toContain(CANARY);
      for (const id of Object.values(A)) {
        // Their ids may only appear where we sent them (e.g. an echoed filter).
        if (!k.url().includes(id) && !JSON.stringify(k.payload?.() ?? {}).includes(id)) expect(res.body).not.toContain(id);
      }
    });
  }
});

test("family A's data is exactly as it was", async () => {
  expect(await snapshotA()).toBe(before);
});

test("every route is covered or exempt with a reason", () => {
  const covered = new Set([...CASES.map((k) => k.route), ...Object.keys(EXEMPT)]);
  const missing = ctx.app.registeredRoutes.map((r) => `${r.method} ${r.url}`).filter((r) => !covered.has(r));
  expect(missing).toEqual([]);
  // …and nothing listed that doesn't exist (catches typos and removed routes).
  const registered = new Set(ctx.app.registeredRoutes.map((r) => `${r.method} ${r.url}`));
  expect([...covered].filter((r) => !registered.has(r))).toEqual([]);
});
