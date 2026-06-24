import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (opts.method === "GET") return jsonRes(url.includes("/trips/") ? { list: null } : []);
    return jsonRes({ id: "x" });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function jsonRes(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("template + trip + create methods hit the right urls", async () => {
  await api.listPackingTemplates();
  expect(calls[0].url).toContain("/api/packing/templates");
  await api.getTripPacking("t1");
  expect(calls[1].url).toContain("/api/trips/t1/packing");
  await api.createTripPacking("t1", { fromTemplateId: "tpl1" });
  expect(calls[2].method).toBe("POST");
  expect(JSON.parse(calls[2].body)).toMatchObject({ fromTemplateId: "tpl1" });
});

test("item check-off + save-as-template post correctly", async () => {
  await api.updatePackingItem("i1", { checked: true });
  expect(calls[0].url).toContain("/api/packing/items/i1");
  await api.savePackingTemplate({ name: "Base", fromListId: "l1" });
  expect(JSON.parse(calls[1].body)).toMatchObject({ name: "Base", fromListId: "l1" });
});
