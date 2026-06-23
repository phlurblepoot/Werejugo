import pg from "pg";

// Ensure the test database exists, then run migrations against it.
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
  const { migrate } = await import("../db/migrate.js");
  const { pool } = await import("../db/pool.js");
  await migrate();
  await pool.end();
}
