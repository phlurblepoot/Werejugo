import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import * as tar from "tar";
import { query } from "../db/pool.js";
import { config } from "../config.js";

/**
 * One family's data, table by table. Only that family's rows; no password
 * hashes, tokens or invite/reset links; no other family's anything.
 */
const FAMILY_QUERIES: Record<string, string> = {
  family: "SELECT id, name, created_at, settings FROM families WHERE id = $1",
  users: "SELECT id, email, display_name, role, color, created_at, last_login_at FROM users WHERE family_id = $1",
  trips: "SELECT * FROM trips WHERE family_id = $1",
  people: "SELECT * FROM people WHERE family_id = $1",
  visits: "SELECT * FROM visits WHERE family_id = $1",
  visit_waypoints: "SELECT w.* FROM visit_waypoints w JOIN visits v ON v.id = w.visit_id WHERE v.family_id = $1",
  comments: "SELECT c.* FROM comments c JOIN visits v ON v.id = c.visit_id WHERE v.family_id = $1",
  media: "SELECT * FROM media WHERE family_id = $1",
  documents: "SELECT * FROM documents WHERE family_id = $1",
  links: "SELECT * FROM links WHERE family_id = $1",
  themes: "SELECT * FROM themes WHERE family_id = $1",
  icons: "SELECT * FROM icons WHERE family_id = $1",
  itinerary_items: "SELECT * FROM itinerary_items WHERE family_id = $1",
  blackout_periods: "SELECT * FROM blackout_periods WHERE family_id = $1",
  packing_lists: "SELECT * FROM packing_lists WHERE family_id = $1",
  packing_items: "SELECT i.* FROM packing_items i JOIN packing_lists l ON l.id = i.list_id WHERE l.family_id = $1",
  // trips hosted by other families that this family is on (its own contributions are in the tables above)
  trip_memberships: `SELECT m.trip_id, t.name AS trip_name, f.name AS host_family, m.role, m.joined_at
                       FROM trip_members m JOIN trips t ON t.id = m.trip_id JOIN families f ON f.id = t.family_id
                      WHERE m.family_id = $1`,
  person_links: `SELECT l.id, l.person_a, l.person_b, l.status, l.created_at FROM person_links l
                   JOIN people a ON a.id = l.person_a JOIN people b ON b.id = l.person_b
                  WHERE a.family_id = $1 OR b.family_id = $1`,
};

export async function familyData(familyId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [name, sql] of Object.entries(FAMILY_QUERIES)) {
    // to_jsonb: geometry comes out as GeoJSON, dates as plain strings.
    const { rows } = await query<{ rows: unknown[] }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows FROM (${sql}) t`, [familyId]);
    out[name] = rows[0].rows;
  }
  return out;
}

/** The family's files: [root, path relative to that root]. */
async function familyFiles(familyId: string): Promise<Array<{ root: "storage" | "uploads"; rel: string }>> {
  const { rows } = await query<{ root: "storage" | "uploads"; rel: string }>(
    `SELECT 'storage' AS root, rel_path AS rel FROM media WHERE family_id = $1
     UNION SELECT 'storage', thumb_rel_path FROM media WHERE family_id = $1 AND thumb_rel_path IS NOT NULL
     UNION SELECT 'storage', rel_path FROM documents WHERE family_id = $1 AND rel_path IS NOT NULL
     UNION SELECT 'uploads', substring(url FROM '^/uploads/(.+)$') FROM icons WHERE family_id = $1 AND url LIKE '/uploads/%'`,
    [familyId]);
  return rows.filter((r) => r.rel);
}

/** `rel` inside `root`, or null if it would escape it. */
function inside(root: string, rel: string): string | null {
  const base = resolve(root);
  const full = resolve(base, rel);
  return full.startsWith(base + sep) ? full : null;
}

/**
 * A streaming .tar.gz of one family's data: `family.json` plus `files/storage/…`
 * (photos, videos, documents) and `files/uploads/…` (icons, overlays). Files
 * are symlinked into a staging folder, not copied, so this needs no extra disk.
 */
export async function familyArchive(familyId: string, familyName: string): Promise<{ stream: Readable; cleanup: () => Promise<void> }> {
  const stage = await mkdtemp(join(tmpdir(), "wj-family-"));
  const data = await familyData(familyId);
  const missing: string[] = [];
  for (const f of await familyFiles(familyId)) {
    const src = inside(f.root === "storage" ? config.storageDir : config.uploadsDir, f.rel);
    if (!src || !(await stat(src).then((s) => s.isFile(), () => false))) {
      missing.push(`${f.root}/${f.rel}`);
      continue;
    }
    const dest = join(stage, "files", f.root, f.rel);
    await mkdir(dirname(dest), { recursive: true });
    await symlink(src, dest);
  }
  await writeFile(join(stage, "family.json"), JSON.stringify({
    app: "werejugo",
    kind: "family-export",
    version: 1,
    family: familyName,
    exportedAt: new Date().toISOString(),
    missingFiles: missing,
    data,
  }, null, 2));
  await mkdir(join(stage, "files"), { recursive: true });
  const stream = tar.c({ gzip: true, cwd: stage, follow: true, portable: true }, ["family.json", "files"]) as unknown as Readable;
  return { stream, cleanup: () => rm(stage, { recursive: true, force: true }) };
}
