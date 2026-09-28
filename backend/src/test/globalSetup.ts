import pg from "pg";

// Ensure the test database exists, run migrations against it, and load the reference data.
export async function setup(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  // Import after env is set so pool.ts picks up the test DATABASE_URL.
  const { migrate, LegacyDatabaseError } = await import("../db/migrate.js");
  const { pool } = await import("../db/pool.js");
  try {
    await migrate();
  } catch (err) {
    // A test database from before the schema baseline: it's disposable, so rebuild it.
    if (!(err instanceof LegacyDatabaseError)) throw err;
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate();
  }
  // The bundled airports and ports (skipped when unchanged since the last run).
  const { loadReferenceData } = await import("../db/reference.js");
  await loadReferenceData();
  await pool.end();
}
