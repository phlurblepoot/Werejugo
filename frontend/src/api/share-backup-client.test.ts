import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./client";

const calls: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("werejugo.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({ url, method: opts.method ?? "GET", body: opts.body });
    if (url.includes("/api/backup")) return new Response(new Blob(["x"]), { status: 200 });
    return new Response(JSON.stringify({ id: "s1", token: "t".repeat(20), targetType: "trip", targetId: "tr1", createdAt: "" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

test("search hits /api/search with the query", async () => {
  await api.search("venice");
  expect(calls[0].url).toContain("/api/search?q=venice");
});

test("createShare posts targetType + targetId", async () => {
  await api.createShare("album", "tr1");
  expect(calls[0].url).toContain("/api/shares");
  expect(JSON.parse(calls[0].body)).toMatchObject({ targetType: "album", targetId: "tr1" });
});

test("listShares passes target in the query string", async () => {
  await api.listShares("trip", "tr1");
  expect(calls[0].url).toContain("/api/shares?targetType=trip&targetId=tr1");
});

test("downloadBackup fetches the archive as a blob", async () => {
  const blob = await api.downloadBackup();
  expect(calls[0].url).toContain("/api/backup");
  expect(blob).toBeInstanceOf(Blob);
});

test("restoreBackup posts the file as multipart", async () => {
  await api.restoreBackup(new File(["x"], "b.tar.gz"));
  expect(calls[0].url).toContain("/api/restore");
  expect(calls[0].body).toBeInstanceOf(FormData);
});
