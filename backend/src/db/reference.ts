import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withClient } from "./pool.js";
import { fold, portSearchText } from "./referenceMerge.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export type Loaded = number | "unchanged";

/**
 * Loads the bundled airports and ports (built by scripts/build-reference-data.ts)
 * in one statement each, skipping a file whose contents haven't changed since it
 * was last loaded. Ports learned from CruiseMapper sailings are kept.
 */
export async function loadReferenceData(opts: { force?: boolean } = {}): Promise<{ airports: Loaded; ports: Loaded }> {
  return {
    airports: await load("airports.json", opts.force, async (c, rows: Array<Record<string, unknown>>) => {
      await c.query("TRUNCATE airports");
      const withSearch = rows.map((a) => ({ ...a, search: fold(`${a.name} ${a.city ?? ""}`) }));
      await c.query(
        `INSERT INTO airports (iata, icao, name, city, country, lat, lng, type, search)
         SELECT iata, icao, name, city, country, lat, lng, type, search
         FROM jsonb_to_recordset($1::jsonb) AS x(iata text, icao text, name text, city text, country text,
                                                 lat float8, lng float8, type text, search text)`,
        [JSON.stringify(withSearch)],
      );
    }),
    ports: await load("ports.json", opts.force, async (c, rows: Array<{ name: string; aliases: string[] }>) => {
      await c.query("DELETE FROM ports WHERE source <> 'cruisemapper'");
      const withSearch = rows.map((p) => ({ ...p, search: portSearchText(p) }));
      await c.query(
        `INSERT INTO ports (name, country, locode, lat, lng, source, aliases, search)
         SELECT name, country, locode, lat, lng, source, aliases, search
         FROM jsonb_to_recordset($1::jsonb) AS x(name text, country text, locode text, lat float8, lng float8,
                                                 source text, aliases text[], search text)`,
        [JSON.stringify(withSearch)],
      );
    }),
  };
}

async function load<T>(
  file: string,
  force: boolean | undefined,
  replace: (c: import("pg").PoolClient, rows: T[]) => Promise<void>,
): Promise<Loaded> {
  const text = await readFile(join(DATA_DIR, file), "utf8");
  const hash = createHash("sha256").update(text).digest("hex");
  return withClient(async (c) => {
    await c.query("BEGIN");
    try {
      // One loader at a time (two containers starting together).
      await c.query("SELECT pg_advisory_xact_lock(hashtext('reference_data'))");
      const prev = await c.query<{ hash: string }>("SELECT hash FROM reference_data WHERE name = $1", [file]);
      if (!force && prev.rows[0]?.hash === hash) {
        await c.query("COMMIT");
        return "unchanged";
      }
      const rows = JSON.parse(text) as T[];
      await replace(c, rows);
      await c.query(
        `INSERT INTO reference_data (name, hash) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET hash = EXCLUDED.hash, loaded_at = now()`,
        [file, hash],
      );
      await c.query("COMMIT");
      return rows.length;
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    }
  });
}
