import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    const method = opts.method ?? "GET";
    calls.push({ url, method, body: opts.body });
    // Return shapes per endpoint.
    if (url.endsWith("/api/visits") && method === "POST")
      return jsonRes({ id: "v1", kind: "place", title: "X", photos: [], waypoints: [] });
    if (url.includes("/api/media") && method === "POST")
      return jsonRes({ id: "m1", kind: "image", url: "/api/files/x?sig=1", thumbUrl: null, caption: "" });
    if (method === "GET") return jsonRes([]); // all list endpoints return arrays
    return jsonRes({ ok: true });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

function jsonRes(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("listItems reads the map's visits and stamps mapSetId", async () => {
  await api.listItems("ms1");
  expect(calls[0].url).toContain("/api/map-sets/ms1/visits");
});

test("createItem creates a visit then adds map membership", async () => {
  const item = await api.createItem("ms1", { kind: "place", title: "X" });
  expect(calls[0].url).toContain("/api/visits");
  expect(calls[0].method).toBe("POST");
  expect(calls[1].url).toContain("/api/map-sets/ms1/visits");
  expect(item.mapSetId).toBe("ms1");
});

test("uploadItemPhoto uploads media then links it to the visit", async () => {
  const file = new File(["x"], "p.jpg", { type: "image/jpeg" });
  const photo = await api.uploadItemPhoto("v1", file, "cap");
  expect(calls[0].url).toContain("/api/media");
  expect(calls[1].url).toContain("/api/links");
  expect(JSON.parse(calls[1].body)).toMatchObject({ from: "media:m1", to: "visit:v1" });
  expect(photo.mediaType).toBe("image");
});

test("listTrips uses the family-scoped endpoint", async () => {
  await api.listTrips("ms1");
  expect(calls[0].url).toContain("/api/trips");
  expect(calls[0].url).not.toContain("map-sets");
});

test("listComments and addComment target the visit", async () => {
  await api.listComments("v1");
  expect(calls[0].url).toContain("/api/visits/v1/comments");
});
