import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (url.includes("/api/media")) return jsonRes({ id: "m1", kind: "image", url: "/api/files/x?sig=1", thumbUrl: null, caption: "" });
    if (opts.method === "GET") return jsonRes([]);
    return jsonRes({ id: "x" });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function jsonRes(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("createPerson POSTs to /api/people", async () => {
  await api.createPerson({ displayName: "Mom" });
  expect(calls[0].url).toContain("/api/people");
  expect(calls[0].method).toBe("POST");
});

test("getRelations encodes the entity ref", async () => {
  await api.getRelations("person:abc");
  expect(calls[0].url).toContain("/api/relations?entity=person%3Aabc");
});

test("searchEntities passes type and query", async () => {
  await api.searchEntities("visit", "eiffel");
  expect(calls[0].url).toContain("/api/entities/search?type=visit&q=eiffel");
});

test("uploadMedia posts multipart and createLink posts a link", async () => {
  const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
  const m = await api.uploadMedia(file);
  expect(m.id).toBe("m1");
  expect(calls[0].url).toContain("/api/media");
  await api.createLink("media:m1", "person:p1", "shows");
  expect(JSON.parse(calls[1].body)).toMatchObject({ from: "media:m1", to: "person:p1", role: "shows" });
});
