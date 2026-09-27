import { afterAll, beforeAll, expect, test } from "vitest";
import { addUser, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { assertRefs, loadEditable, loadReadable, type Scope } from "./access.js";
import { HttpError } from "./errors.js";

let ctx: TestCtx;
let mine: Scope;
let theirs: Scope;
let tripId: string;
let builtinTheme: string;
let itemId: string;

beforeAll(async () => {
  ctx = await buildTestApp();
  const other = await addUser(ctx, { familyName: "Other", role: "owner" });
  mine = { userId: ctx.userId, familyId: ctx.familyId, role: "owner", isAdmin: true };
  theirs = { userId: other.userId, familyId: other.familyId, role: "owner", isAdmin: false };
  tripId = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1, 'Rome') RETURNING id", [ctx.familyId])).rows[0].id;
  builtinTheme = (await query<{ id: string }>("INSERT INTO themes (family_id, name, is_builtin) VALUES (NULL, 'Built-in', true) RETURNING id")).rows[0].id;
  const list = (await query<{ id: string }>("INSERT INTO packing_lists (family_id, name) VALUES ($1, 'Mine') RETURNING id", [ctx.familyId])).rows[0].id;
  itemId = (await query<{ id: string }>("INSERT INTO packing_items (list_id, label) VALUES ($1, 'Socks') RETURNING id", [list])).rows[0].id;
});
afterAll(() => closeTestApp(ctx));

const status = (p: Promise<unknown>) => p.then(() => 200, (e) => (e instanceof HttpError ? e.statusCode : 500));

test("your own rows load; another family's are simply not found", async () => {
  expect((await loadReadable<{ name: string }>("trip", tripId, mine)).name).toBe("Rome");
  expect(await status(loadReadable("trip", tripId, theirs))).toBe(404);
  expect(await status(loadEditable("trip", tripId, theirs))).toBe(404);
  expect(await status(loadReadable("trip", "not-a-uuid", mine))).toBe(404);
});

test("child rows are scoped through their parent", async () => {
  expect(await status(loadEditable("packing_item", itemId, mine))).toBe(200);
  expect(await status(loadEditable("packing_item", itemId, theirs))).toBe(404);
});

test("built-ins can be read and referenced by anyone but changed by no one", async () => {
  expect(await status(loadReadable("theme", builtinTheme, theirs))).toBe(200);
  expect(await status(loadEditable("theme", builtinTheme, mine))).toBe(404);
  await expect(assertRefs(theirs, { theme: builtinTheme })).resolves.toBeUndefined();
});

test("references must all be usable", async () => {
  await expect(assertRefs(mine, { trip: tripId, person: null, media: [] })).resolves.toBeUndefined();
  await expect(assertRefs(theirs, { trip: tripId })).rejects.toMatchObject({ statusCode: 400, message: "Unknown trip" });
  await expect(assertRefs(mine, { trip: [tripId, tripId] })).resolves.toBeUndefined();
  await expect(assertRefs(mine, { trip: "nope" })).rejects.toMatchObject({ statusCode: 400 });
});
