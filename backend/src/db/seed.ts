import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

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

export async function seed(): Promise<void> {
  await seedReference();
  await seedThemes();
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
