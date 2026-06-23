import exifr from "exifr";

export interface ExifData {
  takenAt: string | null; // ISO datetime
  lat: number | null;
  lng: number | null;
}

/** Best-effort EXIF: GPS coordinates and capture date. Accepts a file path or buffer. */
export async function extractExif(input: string | Buffer): Promise<ExifData> {
  let lat: number | null = null;
  let lng: number | null = null;
  let takenAt: string | null = null;
  try {
    const gps = await exifr.gps(input as never);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      lat = gps.latitude;
      lng = gps.longitude;
    }
  } catch {
    /* no GPS */
  }
  try {
    const meta = await exifr.parse(input as never, ["DateTimeOriginal", "CreateDate"]);
    const d = meta?.DateTimeOriginal ?? meta?.CreateDate;
    if (d) takenAt = new Date(d).toISOString();
  } catch {
    /* no date */
  }
  return { takenAt, lat, lng };
}
