import { afterAll, beforeAll, expect, test, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, installErrorHandling, notFound } from "./errors.js";
import { endsBeforeStart, likeEscape, optionalYmd, ymd } from "./validate.js";

let app: FastifyInstance;
const pgError = (code: string) => Object.assign(new Error(`pg ${code} internals`), { code, severity: "ERROR" });

beforeAll(async () => {
  app = Fastify({ logger: false });
  installErrorHandling(app);
  await app.register(async (child) => {
    child.get("/things/:id", async () => ({ ok: true }));
    child.get("/trips/:tripId/items", async () => ({ ok: true }));
    child.get("/share/:token", async () => ({ ok: true }));
    child.get("/http", async () => { throw new HttpError(409, "Taken"); });
    child.get("/missing", async () => { throw notFound("No such trip"); });
    child.get("/zod", async () => { z.object({ n: z.number() }).parse({ n: "x" }); });
    child.get("/pg/:code", async (req) => { throw pgError((req.params as { code: string }).code); });
    child.get("/boom", async () => { throw new Error("secret stack details"); });
    child.post("/json", async () => ({ ok: true }));
  });
});
afterAll(() => app.close());

const get = (url: string) => app.inject({ method: "GET", url });
const UUID = "4b0c4f5e-3a1c-4d2b-9e8f-1a2b3c4d5e6f";

test("id-like route params must be UUIDs, others are left alone", async () => {
  expect((await get("/things/nope")).statusCode).toBe(404);
  expect((await get(`/things/${UUID}`)).statusCode).toBe(200);
  expect((await get("/trips/1/items")).statusCode).toBe(404);
  expect((await get("/share/any-token-at-all")).statusCode).toBe(200);
});

test("HttpErrors and zod errors become 4xx with a readable body", async () => {
  expect((await get("/http")).json()).toEqual({ error: "Taken" });
  expect((await get("/missing")).statusCode).toBe(404);
  const z400 = await get("/zod");
  expect(z400.statusCode).toBe(400);
  expect(z400.json().error.fieldErrors.n).toBeDefined();
});

test("Postgres input errors are 400/409, never 500", async () => {
  for (const code of ["22P02", "22007", "22008", "23514"]) expect((await get(`/pg/${code}`)).statusCode).toBe(400);
  expect((await get("/pg/23503")).statusCode).toBe(400);
  expect((await get("/pg/23505")).statusCode).toBe(409);
  expect((await get("/pg/23505")).body).not.toContain("internals");
});

test("unexpected errors are a generic 500 without internals", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await get("/boom");
  spy.mockRestore();
  expect(res.statusCode).toBe(500);
  expect(res.body).not.toContain("secret");
});

test("Fastify's own client errors pass through", async () => {
  const res = await app.inject({ method: "POST", url: "/json", headers: { "content-type": "application/json" }, payload: "{bad" });
  expect(res.statusCode).toBe(400);
});

test("date and search helpers", () => {
  expect(ymd.safeParse("2024-02-29").success).toBe(true);
  expect(ymd.safeParse("2023-02-29").success).toBe(false);
  expect(ymd.safeParse("2024-6-1").success).toBe(false);
  expect(optionalYmd.parse("")).toBeNull();
  expect(optionalYmd.parse(undefined)).toBeUndefined();
  expect(endsBeforeStart("2024-06-10", "2024-06-01")).toBe(true);
  expect(endsBeforeStart("2024-06-01", null)).toBe(false);
  expect(likeEscape("50%_off\\")).toBe("50\\%\\_off\\\\");
});
