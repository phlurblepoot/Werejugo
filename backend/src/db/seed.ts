import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";
import { hashPassword } from "../lib/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");

interface Airport {
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
}

interface Port {
  name: string;
  country: string | null;
  lat: number;
  lng: number;
}

const BUILTIN_THEMES = [
  { name: "Place", kind: "place", icon: "pin", color: "#2563eb", line_color: "#2563eb" },
  { name: "Food & Drink", kind: "food", icon: "utensils", color: "#ea580c", line_color: "#ea580c" },
  { name: "Flight", kind: "flight", icon: "plane", color: "#0ea5e9", line_color: "#0ea5e9" },
  { name: "Cruise", kind: "cruise", icon: "ship", color: "#0d9488", line_color: "#0d9488" },
  { name: "Road Trip", kind: "drive", icon: "car", color: "#7c3aed", line_color: "#7c3aed" },
  { name: "Home", kind: "place", icon: "home", color: "#16a34a", line_color: "#16a34a" },
  { name: "Camera", kind: "place", icon: "camera", color: "#db2777", line_color: "#db2777" },
  { name: "Star", kind: "place", icon: "star", color: "#ca8a04", line_color: "#ca8a04" },
];

async function seedReference(): Promise<void> {
  const airports: Airport[] = JSON.parse(await readFile(join(dataDir, "airports.json"), "utf8"));
  const ports: Port[] = JSON.parse(await readFile(join(dataDir, "ports.json"), "utf8"));

  await pool.query("TRUNCATE airports");
  for (const a of airports) {
    await pool.query(
      "INSERT INTO airports (iata, icao, name, city, country, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [a.iata, a.icao, a.name, a.city, a.country, a.lat, a.lng],
    );
  }

  await pool.query("TRUNCATE ports");
  for (const p of ports) {
    await pool.query("INSERT INTO ports (name, country, lat, lng) VALUES ($1,$2,$3,$4)", [
      p.name,
      p.country,
      p.lat,
      p.lng,
    ]);
  }
  console.log(`[seed] reference data: ${airports.length} airports, ${ports.length} ports`);
}

async function seedThemes(): Promise<void> {
  for (const t of BUILTIN_THEMES) {
    await pool.query(
      `INSERT INTO themes (family_id, name, kind, icon, color, line_color, is_builtin)
       SELECT NULL, $1, $2, $3, $4, $5, true
       WHERE NOT EXISTS (
         SELECT 1 FROM themes WHERE family_id IS NULL AND name = $1
       )`,
      [t.name, t.kind, t.icon, t.color, t.line_color],
    );
  }
  console.log(`[seed] built-in themes ensured (${BUILTIN_THEMES.length})`);
}

const BUILTIN_PACKING: { name: string; items: { label: string; category: string }[] }[] = [
  { name: "Carry-on essentials", items: [
    { label: "Passport", category: "Documents" }, { label: "Wallet", category: "Documents" },
    { label: "Phone charger", category: "Electronics" }, { label: "Headphones", category: "Electronics" },
    { label: "Toothbrush", category: "Toiletries" }, { label: "Medications", category: "Toiletries" },
  ] },
  { name: "Beach trip", items: [
    { label: "Swimsuit", category: "Clothes" }, { label: "Sandals", category: "Clothes" },
    { label: "Sunscreen", category: "Toiletries" }, { label: "Sunglasses", category: "Misc" },
    { label: "Beach towel", category: "Misc" },
  ] },
  { name: "Winter", items: [
    { label: "Heavy coat", category: "Clothes" }, { label: "Gloves", category: "Clothes" },
    { label: "Thermal layers", category: "Clothes" }, { label: "Lip balm", category: "Toiletries" },
  ] },
];

export async function seedPacking(): Promise<void> {
  for (const tpl of BUILTIN_PACKING) {
    const existing = await pool.query("SELECT id FROM packing_lists WHERE family_id IS NULL AND is_builtin = true AND name = $1", [tpl.name]);
    if (existing.rowCount) continue;
    const ins = await pool.query<{ id: string }>(
      "INSERT INTO packing_lists (family_id, trip_id, name, is_builtin) VALUES (NULL, NULL, $1, true) RETURNING id", [tpl.name]);
    const listId = ins.rows[0].id;
    for (let i = 0; i < tpl.items.length; i++) {
      await pool.query("INSERT INTO packing_items (list_id, label, category, seq) VALUES ($1,$2,$3,$4)", [listId, tpl.items[i].label, tpl.items[i].category, i]);
    }
  }
  console.log(`[seed] built-in packing templates ensured (${BUILTIN_PACKING.length})`);
}

async function seedDevData(): Promise<void> {
  if (process.env.SEED_DEV_DATA !== "true") return;
  const fam = await pool.query<{ id: string }>(
    "INSERT INTO families (name, invite_code) VALUES ('The Wanderers', 'wander-1') RETURNING id");
  const familyId = fam.rows[0].id;
  const pass = await hashPassword("password123");
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (family_id, email, display_name, password_hash, role)
     VALUES ($1,'demo@werejugo.dev','Demo',$2,'owner') RETURNING id`, [familyId, pass]);
  const userId = user.rows[0].id;
  const ms = await pool.query<{ id: string }>(
    "INSERT INTO map_sets (family_id, name, created_by) VALUES ($1,'Our Travels',$2) RETURNING id",
    [familyId, userId]);
  const trip = await pool.query<{ id: string }>(
    "INSERT INTO trips (family_id, name, start_date, created_by) VALUES ($1,'Italy 2024','2024-06-01',$2) RETURNING id",
    [familyId, userId]);
  const v1 = await pool.query<{ id: string }>(
    `INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom, created_by)
     VALUES ($1,$2,'place','Colosseum','2024-06-02', ST_SetSRID(ST_MakePoint(12.4924,41.8902),4326), $3) RETURNING id`,
    [familyId, trip.rows[0].id, userId]);
  await pool.query(
    `INSERT INTO visits (family_id, kind, title, occurred_on, geom, created_by)
     VALUES ($1,'food','Joe''s Pizza','2024-03-10', ST_SetSRID(ST_MakePoint(-73.99,40.73),4326), $2)`,
    [familyId, userId]);
  await pool.query("INSERT INTO map_set_visits (map_set_id, visit_id) VALUES ($1,$2)", [ms.rows[0].id, v1.rows[0].id]);
  console.log("[seed] dev data created (login: demo@werejugo.dev / password123)");
}

export async function seed(): Promise<void> {
  await seedReference();
  await seedThemes();
  await seedPacking();
  await seedDevData();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
