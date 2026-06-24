import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (url.includes("due-count")) return jsonRes({ count: 3 });
    if (opts.method === "GET") return jsonRes([]);
    return jsonRes({ id: "d1" });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function jsonRes(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("listDocuments builds a query string", async () => {
  await api.listDocuments({ docType: "passport", due: "1" });
  expect(calls[0].url).toContain("/api/documents?");
  expect(calls[0].url).toContain("docType=passport");
  expect(calls[0].url).toContain("due=1");
});

test("createDocument without a file posts JSON", async () => {
  await api.createDocument({ title: "Passport", docType: "passport" });
  expect(calls[0].url).toContain("/api/documents");
  expect(JSON.parse(calls[0].body)).toMatchObject({ title: "Passport" });
});

test("createDocument with a file posts FormData", async () => {
  const f = new File(["x"], "p.pdf", { type: "application/pdf" });
  await api.createDocument({ title: "Passport", docType: "passport" }, f);
  expect(calls[0].body).toBeInstanceOf(FormData);
});

test("documentsDueCount fetches the count", async () => {
  const r = await api.documentsDueCount();
  expect(r.count).toBe(3);
});
