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

test("0013: pin and trail styles the editor filled in from the defaults are cleared, so the defaults apply", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("UPDATE families SET settings = $2 WHERE id = $1", [ctx.familyId, {
        pin: { default: { borderColor: "#000000" }, byKind: { food: { color: "#111111", size: 34 } }, byLine: { "Royal Caribbean": { color: "#222222" } } },
        path: { byKind: { drive: { style: "tire" } } },
      }]);
      const theme = (await c.query<{ id: string }>(
        "INSERT INTO themes (family_id, name, kind, icon, color, line_color) VALUES ($1, 'Beach', 'place', 'umbrella', '#333333', '#333333') RETURNING id",
        [ctx.familyId],
      )).rows[0].id;
      const add = async (kind: string, color: string | null, icon: string | null, properties: object, themeId: string | null = null) =>
        (await c.query<{ id: string }>(
          "INSERT INTO visits (family_id, kind, title, color, icon, properties, theme_id) VALUES ($1, $2, 'x', $3, $4, $5, $6) RETURNING id",
          [ctx.familyId, kind, color, icon, properties, themeId],
        )).rows[0].id;

      // Everything the editor would have saved from the defaults.
      const place = await add("place", "#2563EB", "pin", { pin: { size: 28, shape: "circle", borderWidth: 2, borderColor: "#000000" }, note: "kept" });
      const food = await add("food", "#111111", "utensils", { pin: { size: 34, shape: "circle", borderWidth: 2, borderColor: "#000000" } });
      const cruise = await add("cruise", "#222222", "ship", {
        cruiseLine: "Royal Caribbean", pin: { size: 28, shape: "circle", borderWidth: 2, borderColor: "#000000" },
        path: { style: "solid", color: "#0d9488", width: 3 },
      });
      const drive = await add("drive", "#7c3aed", "car", { path: { style: "tire", color: "#7c3aed", width: 9 } });
      const themed = await add("place", "#333333", "umbrella", {}, theme);
      // Choices of the person's own stay.
      const chosen = await add("place", "#ff0000", "star", {
        pin: { size: 40, shape: "square", borderWidth: 2, borderColor: "#000000" }, path: { style: "dashed" },
      });

      await c.query(await sql("0013_inherit_styles.sql"));

      const row = async (id: string) => (await c.query("SELECT color, icon, properties FROM visits WHERE id = $1", [id])).rows[0];
      expect(await row(place)).toEqual({ color: null, icon: null, properties: { note: "kept" } });
      expect(await row(food)).toEqual({ color: null, icon: null, properties: {} });
      expect(await row(cruise)).toEqual({ color: null, icon: null, properties: { cruiseLine: "Royal Caribbean" } });
      expect(await row(drive)).toEqual({ color: null, icon: null, properties: {} });
      expect(await row(themed)).toEqual({ color: null, icon: null, properties: {} });
      expect(await row(chosen)).toEqual({
        color: "#ff0000", icon: "star", properties: { pin: { size: 40, shape: "square" }, path: { style: "dashed" } },
      });
    } finally {
      await c.query("ROLLBACK");
    }
  });
});
