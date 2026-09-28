import { pool } from "./pool.js";
import { hashPassword } from "../lib/auth.js";
import { loadReferenceData, type Loaded } from "./reference.js";


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
  const { airports, ports } = await loadReferenceData();
  const said = (n: Loaded, what: string) => (n === "unchanged" ? `${what} unchanged` : `${n} ${what}`);
  console.log(`[seed] reference data: ${said(airports, "airports")}, ${said(ports, "ports")}`);
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
  // Safe to run on every start: only seeds an empty demo.
  if ((await pool.query("SELECT 1 FROM users WHERE email = 'demo@werejugo.dev'")).rowCount) {
    console.log("[seed] dev data already present");
    return;
  }
  const pass = await hashPassword("password123");
  const one = async (sql: string, params: unknown[]) => (await pool.query<{ id: string }>(sql, params)).rows[0].id;
  const point = (lng: number, lat: number) => `ST_SetSRID(ST_MakePoint(${lng},${lat}),4326)`;

  // Family 1: the Wanderers (their owner is also the server admin, as after setup).
  const familyId = await one("INSERT INTO families (name) VALUES ('The Wanderers') RETURNING id", []);
  const userId = await one(
    `INSERT INTO users (family_id, email, display_name, password_hash, role, is_admin, color)
     VALUES ($1,'demo@werejugo.dev','Demo',$2,'owner',true,'#0f766e') RETURNING id`, [familyId, pass]);
  const italy = await one("INSERT INTO trips (family_id, name, start_date, status, created_by) VALUES ($1,'Italy 2024','2024-06-01','done',$2) RETURNING id", [familyId, userId]);
  await one(
    `INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom, created_by)
     VALUES ($1,$2,'place','Colosseum','2024-06-02', ${point(12.4924, 41.8902)}, $3) RETURNING id`, [familyId, italy, userId]);
  await one(
    `INSERT INTO visits (family_id, kind, title, occurred_on, geom, created_by)
     VALUES ($1,'food','Joe''s Pizza','2024-03-10', ${point(-73.99, 40.73)}, $2) RETURNING id`, [familyId, userId]);
  const grandma = await one("INSERT INTO people (family_id, display_name, relationship) VALUES ($1,'Grandma Rose','Grandmother') RETURNING id", [familyId]);

  // Family 2: the Smiths, who share a trip with the Wanderers.
  const smithsId = await one("INSERT INTO families (name) VALUES ('The Smiths') RETURNING id", []);
  const smithId = await one(
    `INSERT INTO users (family_id, email, display_name, password_hash, role, color)
     VALUES ($1,'smith@werejugo.dev','Sam Smith',$2,'owner','#b45309') RETURNING id`, [smithsId, pass]);
  const rose = await one("INSERT INTO people (family_id, display_name, relationship) VALUES ($1,'Rose','Grandma') RETURNING id", [smithsId]);

  // A trip hosted by the Wanderers; the Smiths contribute to it.
  const tahoe = await one(
    "INSERT INTO trips (family_id, name, start_date, end_date, status, color, created_by) VALUES ($1,'Lake Tahoe 2025','2025-07-10','2025-07-17','booked','#0e7490',$2) RETURNING id",
    [familyId, userId]);
  await pool.query("INSERT INTO trip_members (trip_id, family_id, role, invited_by) VALUES ($1,$2,'contributor',$3)", [tahoe, smithsId, userId]);
  await one(
    `INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom, created_by)
     VALUES ($1,$2,'stay','Lakeside cabin','2025-07-10', ${point(-120.0324, 39.0968)}, $3) RETURNING id`, [familyId, tahoe, userId]);
  const beach = await one(
    `INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom, created_by)
     VALUES ($1,$2,'place','Sand Harbor beach day','2025-07-12', ${point(-119.9307, 39.1982)}, $3) RETURNING id`, [smithsId, tahoe, smithId]);
  await pool.query(
    `INSERT INTO itinerary_items (family_id, trip_id, title, scheduled_on, seq, created_by) VALUES
       ($1,$3,'Kayak Emerald Bay','2025-07-11',0,$4),
       ($2,$3,'Heavenly gondola','2025-07-13',1,$5),
       ($2,$3,'Try the fish tacos at Sprouts',NULL,2,$5)`, [familyId, smithsId, tahoe, userId, smithId]);
  await pool.query(
    "INSERT INTO activity (trip_id, family_id, user_id, kind, target_type, target_id, summary) VALUES ($1,$2,$3,'member.joined','',NULL,'contributor'), ($1,$2,$3,'visit.added','visit',$4,'Sand Harbor beach day')",
    [tahoe, smithsId, smithId, beach]);
  // Each family's Grandma is the same person.
  await pool.query("INSERT INTO person_links (person_a, person_b, status, requested_by, responded_at) VALUES ($1,$2,'accepted',$3, now())", [grandma, rose, userId]);
  await pool.query("INSERT INTO links (family_id, from_type, from_id, to_type, to_id) VALUES ($1,'person',$2,'trip',$3), ($4,'person',$5,'trip',$3)",
    [familyId, grandma, tahoe, smithsId, rose]);

  console.log("[seed] dev data created (logins: demo@werejugo.dev and smith@werejugo.dev, password password123)");
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
