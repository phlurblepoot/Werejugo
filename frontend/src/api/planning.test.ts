import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (opts.method === "GET") return jsonRes([]);
    return jsonRes({ id: "x" });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function jsonRes(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("listItinerary + create target the trip", async () => {
  await api.listItinerary("t1");
  expect(calls[0].url).toContain("/api/trips/t1/itinerary");
  await api.createItineraryItem("t1", { title: "Colosseum" });
  expect(calls[1].url).toContain("/api/trips/t1/itinerary");
  expect(calls[1].method).toBe("POST");
});

test("convertItineraryItem posts to the convert endpoint", async () => {
  await api.convertItineraryItem("i1");
  expect(calls[0].url).toContain("/api/itinerary/i1/convert");
});

test("blackout methods hit /api/blackouts", async () => {
  await api.listBlackouts();
  expect(calls[0].url).toContain("/api/blackouts");
  await api.createBlackout({ label: "School", startDate: "2025-09-01", endDate: "2026-06-15" });
  expect(JSON.parse(calls[1].body)).toMatchObject({ label: "School" });
});
