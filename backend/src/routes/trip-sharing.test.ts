import { afterAll, beforeAll, expect, test } from "vitest";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx, type TestUser } from "../test/helpers.js";
import { query } from "../db/pool.js";

// Family A (host, ctx) shares "Tahoe" with family B. Family C is a stranger.
let ctx: TestCtx;
let b: TestUser;
let bMember: TestUser;
let c: TestUser;
let trip: string;
let aVisit: string;
let aItem: string;

const req = (token: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });
const one = async (sql: string, params: unknown[]) => (await query<{ id: string }>(sql, params)).rows[0].id;

beforeAll(async () => {
  ctx = await buildTestApp();
  b = await addUser(ctx, { familyName: "The Smiths", role: "owner" });
  bMember = await addUser(ctx, { familyId: b.familyId, role: "member" });
  c = await addUser(ctx, { familyName: "Strangers", role: "owner" });
  trip = (await req(ctx.token, "POST", "/api/trips", { name: "Tahoe", startDate: "2025-07-10" })).json().id;
  aVisit = (await req(ctx.token, "POST", "/api/visits", { kind: "stay", title: "Cabin", tripId: trip, geometry: { type: "Point", coordinates: [-120, 39] } })).json().id;
  aItem = (await req(ctx.token, "POST", `/api/trips/${trip}/itinerary`, { title: "Kayak" })).json().id;
  // Private things of A's on the trip.
  await req(ctx.token, "POST", `/api/trips/${trip}/packing`, {});
  await req(ctx.token, "POST", "/api/documents", { title: "A's cabin booking", docType: "booking", ownerTripId: trip });
});
afterAll(() => closeTestApp(ctx));

async function invite(role: "coowner" | "contributor" = "contributor") {
  const res = await req(ctx.token, "POST", `/api/trips/${trip}/invites`, { role });
  expect(res.statusCode).toBe(201);
  return res.json().path.split("/").pop() as string;
}

test("only the host family's owners invite; strangers can't see the trip at all", async () => {
  const member = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  expect((await req(member.token, "POST", `/api/trips/${trip}/invites`, { role: "contributor" })).statusCode).toBe(403);
  expect((await req(c.token, "POST", `/api/trips/${trip}/invites`, { role: "contributor" })).statusCode).toBe(404);
  expect((await req(c.token, "GET", `/api/trips/${trip}/members`)).statusCode).toBe(404);
});

test("another family's owner previews and accepts an invite once; members can't", async () => {
  const token = await invite("contributor");
  const preview = (await req(b.token, "GET", `/api/trip-invites/${token}`)).json();
  expect(preview).toMatchObject({ tripName: "Tahoe", role: "contributor", canAccept: true, alreadyOnTrip: false });
  expect((await req(bMember.token, "GET", `/api/trip-invites/${token}`)).json().canAccept).toBe(false);
  expect((await req(bMember.token, "POST", `/api/trip-invites/${token}/accept`)).statusCode).toBe(403);
  expect((await req(ctx.token, "POST", `/api/trip-invites/${token}/accept`)).statusCode).toBe(409); // the host itself

  expect((await req(b.token, "POST", `/api/trip-invites/${token}/accept`)).json()).toEqual({ tripId: trip, role: "contributor" });
  expect((await req(c.token, "POST", `/api/trip-invites/${token}/accept`)).statusCode).toBe(404); // used

  const theirTrips = (await req(bMember.token, "GET", "/api/trips")).json();
  expect(theirTrips.find((t: { id: string }) => t.id === trip)).toMatchObject({ role: "contributor", hostFamilyName: "Test Family", shared: true });
  const members = (await req(ctx.token, "GET", `/api/trips/${trip}/members`)).json();
  expect(members.members.map((m: { familyName: string; role: string }) => [m.familyName, m.role])).toEqual([["The Smiths", "contributor"]]);
});

test("both families add to the trip and see who added what", async () => {
  const bVisit = await req(bMember.token, "POST", "/api/visits", { kind: "place", title: "Beach day", tripId: trip });
  expect(bVisit.statusCode).toBe(201);
  expect((await req(bMember.token, "POST", `/api/trips/${trip}/itinerary`, { title: "Gondola" })).statusCode).toBe(201);

  const aSees = (await req(ctx.token, "GET", `/api/visits/${bVisit.json().id}`)).json();
  expect(aSees).toMatchObject({ title: "Beach day", familyName: "The Smiths" });
  const itinerary = (await req(bMember.token, "GET", `/api/trips/${trip}/itinerary`)).json();
  expect(itinerary.map((i: { title: string; familyName: string; canEdit: boolean }) => [i.title, i.familyName, i.canEdit]))
    .toEqual(expect.arrayContaining([["Kayak", "Test Family", false], ["Gondola", "The Smiths", true]]));
  const bVisits = (await req(bMember.token, "GET", "/api/visits")).json().map((v: { title: string }) => v.title);
  expect(bVisits).toEqual(expect.arrayContaining(["Cabin", "Beach day"]));
  // strangers see none of it
  expect((await req(c.token, "GET", "/api/visits")).json()).toEqual([]);
});

test("contributors change only their own things; co-owners change everything but the trip itself", async () => {
  expect((await req(bMember.token, "PATCH", `/api/itinerary/${aItem}`, { title: "hijack" })).statusCode).toBe(404);
  expect((await req(bMember.token, "PATCH", `/api/visits/${aVisit}`, { title: "hijack" })).statusCode).toBe(404);
  expect((await req(bMember.token, "PATCH", `/api/trips/${trip}`, { name: "hijack" })).statusCode).toBe(404);

  expect((await req(ctx.token, "PATCH", `/api/trips/${trip}/members/${b.familyId}`, { role: "coowner" })).statusCode).toBe(200);
  expect((await req(bMember.token, "PATCH", `/api/itinerary/${aItem}`, { title: "Kayak at dawn" })).json().title).toBe("Kayak at dawn");
  expect((await req(bMember.token, "PATCH", `/api/visits/${aVisit}`, { notes: "bring towels" })).statusCode).toBe(200);
  expect((await req(bMember.token, "PATCH", `/api/trips/${trip}`, { name: "hijack" })).statusCode).toBe(404);
  expect((await req(b.token, "POST", `/api/trips/${trip}/invites`, { role: "contributor" })).statusCode).toBe(404);
  expect((await req(bMember.token, "DELETE", `/api/trips/${trip}`)).statusCode).toBe(404);
});

test("packing, bookings and documents stay private to each family", async () => {
  expect((await req(bMember.token, "GET", `/api/trips/${trip}/packing`)).json().list).toBeNull();
  const ownList = await req(bMember.token, "POST", `/api/trips/${trip}/packing`, {});
  expect(ownList.statusCode).toBe(201);
  const bDoc = await req(bMember.token, "POST", "/api/documents", { title: "B's flights", docType: "booking", ownerTripId: trip });
  expect(bDoc.statusCode).toBe(201);
  const bDocs = (await req(bMember.token, "GET", `/api/documents?owner=trip:${trip}`)).json().map((d: { title: string }) => d.title);
  expect(bDocs).toEqual(["B's flights"]);
  const aDocs = (await req(ctx.token, "GET", `/api/documents?owner=trip:${trip}`)).json().map((d: { title: string }) => d.title);
  expect(aDocs).toEqual(["A's cabin booking"]);
});

test("another family's trip photos show in the trip album only, and stay theirs", async () => {
  const photo = await one("INSERT INTO media (family_id, trip_id, rel_path, caption) VALUES ($1, $2, 'families/b/x-1.jpg', 'Smiths at the lake') RETURNING id", [b.familyId, trip]);
  const album = (await req(ctx.token, "GET", `/api/media?trip=${trip}`)).json().items;
  expect(album.map((m: { caption: string; familyName: string }) => [m.caption, m.familyName])).toEqual([["Smiths at the lake", "The Smiths"]]);
  expect((await req(ctx.token, "GET", "/api/media")).json().items).toEqual([]); // not in A's library
  expect((await req(ctx.token, "PATCH", `/api/media/${photo}`, { caption: "mine now" })).statusCode).toBe(404);
  expect((await req(c.token, "GET", `/api/media?trip=${trip}`)).json().items).toEqual([]);
});

test("a family that leaves takes its contributions with it; re-inviting brings them back", async () => {
  expect((await req(bMember.token, "DELETE", `/api/trips/${trip}/members/${b.familyId}`)).statusCode).toBe(403); // members can't
  expect((await req(b.token, "DELETE", `/api/trips/${trip}/members/${b.familyId}`)).statusCode).toBe(204);

  const aTitles = async () => (await req(ctx.token, "GET", "/api/visits")).json().map((v: { title: string }) => v.title);
  expect(await aTitles()).toEqual(["Cabin"]);
  expect((await req(ctx.token, "GET", `/api/trips/${trip}/itinerary`)).json().map((i: { title: string }) => i.title)).toEqual(["Kayak at dawn"]);
  expect((await req(bMember.token, "GET", `/api/visits/${aVisit}`)).statusCode).toBe(404);
  expect((await req(bMember.token, "GET", "/api/trips")).json().some((t: { id: string }) => t.id === trip)).toBe(false);

  const token = await invite("contributor");
  await req(b.token, "POST", `/api/trip-invites/${token}/accept`);
  expect(await aTitles()).toEqual(expect.arrayContaining(["Cabin", "Beach day"]));
});

test("the host removes a family; guests can't remove others; the host can't leave", async () => {
  const d = await addUser(ctx, { familyName: "The Does", role: "owner" });
  const token = await invite("contributor");
  await req(d.token, "POST", `/api/trip-invites/${token}/accept`);
  expect((await req(b.token, "DELETE", `/api/trips/${trip}/members/${d.familyId}`)).statusCode).toBe(403);
  expect((await req(ctx.token, "DELETE", `/api/trips/${trip}/members/${ctx.familyId}`)).statusCode).toBe(400);
  expect((await req(ctx.token, "DELETE", `/api/trips/${trip}/members/${d.familyId}`)).statusCode).toBe(204);
});

test("the activity feed says who did what", async () => {
  const feed = (await req(ctx.token, "GET", `/api/trips/${trip}/activity`)).json();
  const kinds = feed.map((e: { kind: string; familyName: string }) => `${e.kind}:${e.familyName}`);
  expect(kinds).toEqual(expect.arrayContaining([
    "member.joined:The Smiths", "visit.added:The Smiths", "itinerary.added:The Smiths", "member.left:The Smiths", "member.removed:The Does",
  ]));
  expect((await req(c.token, "GET", `/api/trips/${trip}/activity`)).statusCode).toBe(404);
});

test("Grandma is the same person in both families", async () => {
  const aGrandma = await one("INSERT INTO people (family_id, display_name, notes) VALUES ($1, 'Grandma Rose', 'private note') RETURNING id", [ctx.familyId]);
  const bRose = await one("INSERT INTO people (family_id, display_name, notes) VALUES ($1, 'Rose', 'their private note') RETURNING id", [b.familyId]);
  const cPerson = await one("INSERT INTO people (family_id, display_name) VALUES ($1, 'Stranger') RETURNING id", [c.familyId]);

  // Families on a trip together see each other's people for tagging — name and picture only.
  const onTrip = (await req(ctx.token, "GET", `/api/trips/${trip}/people`)).json();
  expect(onTrip.map((p: { displayName: string }) => p.displayName)).toEqual(expect.arrayContaining(["Grandma Rose", "Rose"]));
  const theirs = (await req(ctx.token, "GET", `/api/people/${bRose}`)).json();
  expect(theirs).toMatchObject({ displayName: "Rose", familyName: "The Smiths", readOnly: true, notes: "" });
  expect((await req(ctx.token, "GET", `/api/people/${cPerson}`)).statusCode).toBe(404);

  // Propose → the other family accepts.
  expect((await req(ctx.token, "POST", "/api/person-links", { personId: aGrandma, otherPersonId: cPerson })).statusCode).toBe(404);
  const proposed = await req(ctx.token, "POST", "/api/person-links", { personId: aGrandma, otherPersonId: bRose });
  expect(proposed.statusCode).toBe(201);
  expect((await req(ctx.token, "POST", "/api/person-links", { personId: aGrandma, otherPersonId: bRose })).statusCode).toBe(409);
  const incoming = (await req(bMember.token, "GET", "/api/person-links")).json().incoming;
  expect(incoming).toHaveLength(1);
  expect((await req(ctx.token, "POST", `/api/person-links/${proposed.json().id}/accept`)).statusCode).toBe(404); // not A's to accept
  expect((await req(bMember.token, "POST", `/api/person-links/${proposed.json().id}/accept`)).statusCode).toBe(200);

  // B tags Rose on the trip; A's Grandma page shows it (merged), A can't remove B's tag.
  expect((await req(bMember.token, "POST", "/api/links", { from: `person:${bRose}`, to: `trip:${trip}` })).statusCode).toBe(201);
  const rel = (await req(ctx.token, "GET", `/api/relations?entity=person:${aGrandma}`)).json();
  expect(rel).toEqual([expect.objectContaining({ canRemove: false, entity: expect.objectContaining({ type: "trip", label: "Tahoe" }) })]);
  const links = (await req(ctx.token, "GET", `/api/people/${aGrandma}`)).json().links;
  expect(links).toEqual([expect.objectContaining({ displayName: "Rose", familyName: "The Smiths", status: "accepted" })]);

  // A tags B's Rose on A's own place on the shared trip.
  expect((await req(ctx.token, "POST", "/api/links", { from: `person:${bRose}`, to: `visit:${aVisit}` })).statusCode).toBe(201);
  // …but never on something private.
  const privateTrip = (await req(ctx.token, "POST", "/api/trips", { name: "Just us" })).json().id;
  expect((await req(bMember.token, "POST", "/api/links", { from: `person:${bRose}`, to: `trip:${privateTrip}` })).statusCode).toBe(400);
});
