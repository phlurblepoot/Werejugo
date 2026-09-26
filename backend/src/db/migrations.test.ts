import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { withClient } from "./pool.js";

// Data migrations, run against the old shape of the data inside a transaction that is rolled back.
let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

const sql = (file: string) => readFile(new URL(`./migrations/${file}`, import.meta.url), "utf8");

test("0003: a family's custom map style moves to its settings, and map sets go away", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`CREATE TABLE map_sets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), family_id UUID NOT NULL,
                       name TEXT NOT NULL, style_url TEXT, created_at TIMESTAMPTZ NOT NULL)`);
      await c.query("CREATE TABLE map_set_visits (map_set_id UUID, visit_id UUID)");
      const other = (await c.query<{ id: string }>("INSERT INTO families (name) VALUES ('No style') RETURNING id")).rows[0].id;
      await c.query("UPDATE families SET settings = '{\"map\":{\"labels\":true},\"x\":1}' WHERE id = $1", [ctx.familyId]);
      // The oldest set has no style; the next one's style is kept, not the newest's.
      await c.query(
        `INSERT INTO map_sets (family_id, name, style_url, created_at) VALUES
           ($1, 'first', NULL, '2020-01-01'), ($1, 'styled', 'https://tiles.example/a.json', '2021-01-01'),
           ($1, 'later', 'https://tiles.example/b.json', '2022-01-01'), ($2, 'plain', '', '2020-01-01')`,
        [ctx.familyId, other],
      );

      await c.query(await sql("0003_one_map.sql"));

      const settings = async (id: string) => (await c.query("SELECT settings FROM families WHERE id = $1", [id])).rows[0].settings;
      expect(await settings(ctx.familyId)).toEqual({ map: { labels: true, styleUrl: "https://tiles.example/a.json" }, x: 1 });
      expect((await settings(other)).map).toBeUndefined();
      expect((await c.query("SELECT to_regclass('map_sets') AS t, to_regclass('map_set_visits') AS v")).rows[0]).toEqual({ t: null, v: null });
    } finally {
      await c.query("ROLLBACK");
    }
  });
});
