/**
 * Builds the bundled reference data: src/data/ports.json and src/data/airports.json.
 *
 *   npx tsx scripts/build-reference-data.ts
 *
 * Sources (pinned, so a rebuild gives the same files):
 * - Ports: our cruise ports (scripts/curated-ports.json); the World Port Index
 *   (NGA Pub. 150, public domain) via the MIT-licensed tayljordan/ports; UN/LOCODE
 *   (UNECE) ports with coordinates, via datasets/un-locode; and searoute-ts's ports.
 * - Airports: OurAirports (public domain), every airport with an IATA code.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTS as SEAROUTE_PORTS } from "searoute-ts/ports";
import { countryCode, mergePorts, parseLocodeCoords, titleCase, type PortRecord } from "../src/db/referenceMerge.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "data");

const WPI = "https://raw.githubusercontent.com/tayljordan/ports/201f6f4bf77112b469c4454d8f69aeaea7195902/ports.json";
const LOCODE = "https://raw.githubusercontent.com/datasets/un-locode/b1309b37edea63334a819a78c22b8967f61c37ad/data/code-list.csv";
const AIRPORTS = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/ab572a1a7180033a35091b41862e097a8d2535dd/airports.csv";

async function get(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

/** A small RFC 4180 CSV reader (quoted fields, doubled quotes). */
function csv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

async function ports(): Promise<PortRecord[]> {
  const records: PortRecord[] = [];

  const curated = JSON.parse(await readFile(join(here, "curated-ports.json"), "utf8")) as Array<{ name: string; country: string; lat: number; lng: number }>;
  for (const p of curated) records.push({ ...p, locode: null, source: "curated", aliases: [] });

  const wpi = JSON.parse(await get(WPI)) as { ports: Array<{ wpi_port_name: string | null; point_of_interest: string | null; country: string | null; latitude: number; longitude: number }> };
  const unknownCountries = new Set<string>();
  for (const p of wpi.ports) {
    const official = p.wpi_port_name ? titleCase(p.wpi_port_name) : null;
    const name = p.point_of_interest || official;
    if (!name) continue;
    const country = countryCode(p.country);
    if (p.country && !country) unknownCountries.add(p.country);
    records.push({
      name, country, locode: null, lat: p.latitude, lng: p.longitude, source: "wpi",
      aliases: official && official !== name ? [official] : [],
    });
  }
  if (unknownCountries.size) console.warn("World Port Index countries without a code:", [...unknownCountries].join("; "));

  for (const r of csv(await get(LOCODE))) {
    if (r.Function[0] !== "1") continue; // 1 = port
    const at = parseLocodeCoords(r.Coordinates);
    if (!at) continue;
    records.push({
      name: r.Name, country: r.Country, locode: `${r.Country}${r.Location}`, ...at, source: "unlocode",
      aliases: r.NameWoDiacritics && r.NameWoDiacritics !== r.Name ? [r.NameWoDiacritics] : [],
    });
  }

  for (const [locode, p] of Object.entries(SEAROUTE_PORTS as Record<string, { name: string; coordinates: [number, number] }>)) {
    records.push({ name: p.name, country: locode.slice(0, 2), locode, lat: p.coordinates[1], lng: p.coordinates[0], source: "searoute", aliases: [] });
  }

  console.log(`ports in: ${records.length}`);
  return mergePorts(records);
}

async function airports() {
  const TYPES: Record<string, string> = { large_airport: "large", medium_airport: "medium", small_airport: "small", seaplane_base: "seaplane" };
  return csv(await get(AIRPORTS))
    .filter((a) => a.iata_code && TYPES[a.type])
    .map((a) => ({
      iata: a.iata_code,
      icao: a.icao_code || (/^[A-Z]{4}$/.test(a.gps_code) ? a.gps_code : null),
      name: a.name,
      city: a.municipality || null,
      country: a.iso_country || null,
      lat: Math.round(Number(a.latitude_deg) * 1e5) / 1e5,
      lng: Math.round(Number(a.longitude_deg) * 1e5) / 1e5,
      type: TYPES[a.type],
    }))
    .sort((a, b) => a.iata.localeCompare(b.iata));
}

const [p, a] = await Promise.all([ports(), airports()]);
// One record per line: small diffs when a source changes.
const lines = (rows: unknown[]) => `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;
await writeFile(join(out, "ports.json"), lines(p));
await writeFile(join(out, "airports.json"), lines(a));
console.log(`wrote ${p.length} ports, ${a.length} airports`);
