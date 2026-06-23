import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (url.includes("/suggestions")) return jsonRes({ trips: [], visits: [] });
    if (opts.method === "GET") return jsonRes({ items: [], nextCursor: null });
    return jsonRes({ applied: 1 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function jsonRes(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("listMedia builds a query string from filters", async () => {
  await api.listMedia({ trip: "t1", from: "2024-06-01", limit: 60 });
  expect(calls[0].url).toContain("/api/media?");
  expect(calls[0].url).toContain("trip=t1");
  expect(calls[0].url).toContain("from=2024-06-01");
  expect(calls[0].url).toContain("limit=60");
});

test("listMedia omits empty filters", async () => {
  await api.listMedia({ trip: "", person: undefined });
  expect(calls[0].url).not.toContain("trip=");
  expect(calls[0].url).not.toContain("person=");
});

test("applyMediaSuggestion posts the payload", async () => {
  await api.applyMediaSuggestion({ mediaIds: ["m1"], tripId: "t1" });
  expect(calls[0].url).toContain("/api/media/apply-suggestion");
  expect(JSON.parse(calls[0].body)).toMatchObject({ mediaIds: ["m1"], tripId: "t1" });
});
