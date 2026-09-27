import { query } from "../db/pool.js";

// Questions being answered right now, so the same one asked twice at once goes out once.
const inFlight = new Map<string, Promise<unknown>>();

/**
 * An outside service's answer to `key`: from `lookup_cache` while it's fresh,
 * otherwise from `fn`, kept for `ttlMs`. Failures (a throw) aren't kept, so the
 * next ask tries again; `null` ("nothing found") is.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = await query<{ value: T }>("SELECT value FROM lookup_cache WHERE key = $1 AND expires_at > now()", [key]);
  if (hit.rows[0]) return hit.rows[0].value;

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const p = (async () => {
    const value = await fn();
    await query(
      `INSERT INTO lookup_cache (key, value, expires_at) VALUES ($1, $2::jsonb, now() + $3 * interval '1 millisecond')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, fetched_at = now(), expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(value ?? null), ttlMs],
    );
    // Now and then, clear out what has expired.
    if (Math.random() < 0.02) await query("DELETE FROM lookup_cache WHERE expires_at < now() - interval '1 day'");
    return value;
  })();
  inFlight.set(key, p);
  try {
    return await p;
  } finally {
    inFlight.delete(key);
  }
}

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
