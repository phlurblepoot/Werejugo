import { expect, test } from "vitest";
import sharp from "sharp";
import { extractExif } from "./exif.js";

test("returns nulls for an image with no EXIF", async () => {
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
  const r = await extractExif(png);
  expect(r).toEqual({ takenAt: null, lat: null, lng: null });
});

test("does not throw on non-image bytes", async () => {
  const r = await extractExif(Buffer.from("not an image"));
  expect(r).toEqual({ takenAt: null, lat: null, lng: null });
});
