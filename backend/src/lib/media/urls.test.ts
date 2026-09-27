import { expect, test } from "vitest";
import { mediaUrls, signMediaUrl, verifyMediaSig } from "./urls.js";

const ID = "11111111-1111-4111-8111-111111111111";
const parse = (u: string) => new URL(u, "http://x");

test("a link verifies only for its own photo and size, until it expires", () => {
  const u = parse(signMediaUrl(ID, "thumbnail"));
  expect(u.pathname).toBe(`/api/m/${ID}/thumbnail`);
  const e = u.searchParams.get("e")!;
  const s = u.searchParams.get("s")!;
  expect(verifyMediaSig(ID, "thumbnail", e, s)).toBeGreaterThan(24 * 3600 - 1);
  expect(verifyMediaSig(ID, "original", e, s)).toBeNull();
  expect(verifyMediaSig("22222222-2222-4222-8222-222222222222", "thumbnail", e, s)).toBeNull();
  expect(verifyMediaSig(ID, "thumbnail", String(Number(e) + 1), s)).toBeNull();
  expect(verifyMediaSig(ID, "thumbnail", e, s, (Number(e) + 1) * 1000)).toBeNull();
  expect(verifyMediaSig(ID, "thumbnail", undefined, s)).toBeNull();
});

test("links stay the same for hours, so browsers can cache the photo", () => {
  const t = Date.UTC(2026, 8, 27, 7, 0, 0);
  expect(signMediaUrl(ID, "preview", t)).toBe(signMediaUrl(ID, "preview", t + 2 * 3600_000));
  expect(signMediaUrl(ID, "preview", t)).not.toBe(signMediaUrl(ID, "preview", t + 7 * 3600_000));
});

test("videos get a playback link; photos don't", () => {
  expect(mediaUrls({ id: ID, kind: "video" }).videoUrl).toMatch(/\/video\?/);
  expect(mediaUrls({ id: ID, kind: "image" }).videoUrl).toBeNull();
});
