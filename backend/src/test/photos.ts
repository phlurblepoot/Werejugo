import sharp from "sharp";
import { query } from "../db/pool.js";
import { saveServer, provisionFamily } from "../lib/immich/provision.js";
import { settleJobs } from "../lib/jobs.js";
import type { FakeImmich } from "./fake-immich.js";

let shade = 0;

/** A small real JPEG, different every call, optionally with EXIF date and GPS. */
export async function jpeg(exif: { date?: string; lat?: number; lng?: number } = {}): Promise<Buffer> {
  const dms = (v: number) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = Math.round(((a - d) * 60 - m) * 60 * 100);
    return `${d}/1 ${m}/1 ${s}/100`;
  };
  shade = (shade + 37) % 255;
  let img = sharp({ create: { width: 16, height: 12, channels: 3, background: { r: shade, g: 120, b: 200 - (shade % 200) } } });
  if (exif.date || exif.lat !== undefined) {
    img = img.withExif({
      IFD0: { Make: "Werejugo tests" },
      ...(exif.date ? { IFD2: { DateTimeOriginal: exif.date.replace(/-/g, ":").replace("T", " ").slice(0, 19) } } : {}),
      ...(exif.lat !== undefined && exif.lng !== undefined ? {
        IFD3: {
          GPSLatitudeRef: exif.lat >= 0 ? "N" : "S", GPSLatitude: dms(exif.lat),
          GPSLongitudeRef: exif.lng >= 0 ? "E" : "W", GPSLongitude: dms(exif.lng),
        },
      } : {}),
    });
  }
  return img.jpeg().toBuffer();
}

/** Point Werejugo at the stand-in Immich and give `familyId` its account (first sync included). */
export async function connectToFake(fake: FakeImmich, adminUserId: string, familyId: string): Promise<{ immichUserId: string }> {
  await saveServer(fake.url, fake.adminKey, adminUserId);
  await provisionFamily(familyId);
  await settleJobs();
  const row = (await query<{ immich_user_id: string }>("SELECT immich_user_id FROM family_immich WHERE family_id = $1", [familyId])).rows[0];
  return { immichUserId: row.immich_user_id };
}
