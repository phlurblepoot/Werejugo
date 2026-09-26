import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");

async function waitForDb(retries = 30): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("Database did not become available in time");
}

/**
 * The database was built by migrations this version doesn't have — in practice,
 * the pre-baseline 0001_init … 0012_accounts. It can't be upgraded in place.
 */
export class LegacyDatabaseError extends Error {
  constructor(public readonly unknown: string[]) {
    super(
      "This database was created by an older version of Werejugo (before the 2026-09 schema baseline) " +
      `and can't be upgraded in place (unknown migrations: ${unknown.join(", ")}). ` +
      "To keep the data, run the previous version once more and download a backup (Admin → Backup). " +
      "Then reset the database: stop Werejugo, delete the PostgreSQL data folder (or volume), start this version, " +
      "complete the setup screen and restore the backup from Admin → Backup. " +
      "See README → \"Resetting the database\".",
    );
    this.name = "LegacyDatabaseError";
  }
}

export async function migrate(): Promise<void> {
  await waitForDb();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows.map(
      (r) => r.filename,
    ),
  );
  const unknown = [...applied].filter((f) => !files.includes(f)).sort();
  if (unknown.length) throw new LegacyDatabaseError(unknown);

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    console.log(`[migrate] applying ${file}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[migrate] failed on ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log("[migrate] up to date");
}

// Run directly when invoked as a script.
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
