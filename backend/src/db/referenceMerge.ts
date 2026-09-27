/**
 * Merging the world's port lists into one (used by scripts/build-reference-data.ts).
 *
 * Sources, best name first: our own cruise ports ("curated"), the World Port
 * Index, UN/LOCODE, searoute's ports. Two records are one port when they're
 * within 10 km with the same name, or in the same country within 1.5 km.
 */

export type PortSource = "curated" | "wpi" | "unlocode" | "searoute" | "cruisemapper";

export interface PortRecord {
  name: string;
  country: string | null;
  locode: string | null;
  lat: number;
  lng: number;
  source: PortSource;
  aliases: string[];
}

const NAME_RANK: Record<PortSource, number> = { curated: 0, cruisemapper: 1, wpi: 2, unlocode: 3, searoute: 4 };
// How precise each source's coordinates are: searoute has 6 decimals, the
// World Port Index 2 (~1 km), UN/LOCODE whole minutes (~2 km).
const COORD_RANK: Record<PortSource, number> = { curated: 0, cruisemapper: 1, searoute: 2, wpi: 3, unlocode: 4 };

const SAME_SPOT_KM = 1.5;
const SAME_NAME_KM = 10;
const CELL = 0.2;

export const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function portSearchText(p: { name: string; aliases: string[] }): string {
  return [p.name, ...p.aliases].map(fold).filter(Boolean).join(" ");
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "2031N 08656W" (degrees and minutes) → decimal degrees, 4 places. */
export function parseLocodeCoords(s: string): { lat: number; lng: number } | null {
  const m = s.trim().match(/^(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])$/);
  if (!m) return null;
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === "S" ? -1 : 1);
  const lng = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === "W" ? -1 : 1);
  return { lat: round(lat), lng: round(lng) };
}

const SMALL = new Set(["de", "del", "la", "las", "los", "le", "les", "da", "do", "dos", "das", "di", "du", "of", "the", "and", "y", "et", "van", "der"]);

/** Title-cases a name written in capitals ("SAN MIGUEL DE COZUMEL"); leaves mixed case alone. */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  let first = true;
  return s.toLowerCase().replace(/[\p{L}']+/gu, (w) => {
    const out = !first && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1);
    first = false;
    return out;
  });
}

const COUNTRY_ALIASES: Record<string, string> = {
  "usa": "US", "u s a": "US", "united states of america": "US", "u s": "US",
  "bonaire sint eustatius and saba": "BQ", "curacao": "CW", "cote d ivoire": "CI", "ivory coast": "CI",
  "korea south": "KR", "south korea": "KR", "korea republic of": "KR", "korea north": "KP", "north korea": "KP",
  "russia": "RU", "russian federation": "RU", "vietnam": "VN", "viet nam": "VN", "iran": "IR", "syria": "SY",
  "burma": "MM", "myanmar": "MM", "macau": "MO", "macao": "MO", "hong kong": "HK", "taiwan": "TW",
  "congo": "CG", "republic of the congo": "CG", "democratic republic of the congo": "CD", "congo democratic republic of the": "CD",
  "st kitts and nevis": "KN", "saint kitts and nevis": "KN", "st lucia": "LC", "saint lucia": "LC",
  "st vincent and the grenadines": "VC", "saint vincent and the grenadines": "VC", "st pierre and miquelon": "PM",
  "saint pierre and miquelon": "PM", "st helena": "SH", "saint helena": "SH", "st barthelemy": "BL", "saint barthelemy": "BL",
  "st martin": "MF", "saint martin": "MF", "sint maarten": "SX", "virgin islands u s": "VI", "u s virgin islands": "VI",
  "virgin islands british": "VG", "british virgin islands": "VG", "falkland islands": "FK", "falkland islands islas malvinas": "FK",
  "micronesia": "FM", "federated states of micronesia": "FM", "brunei": "BN", "cape verde": "CV", "cabo verde": "CV",
  "east timor": "TL", "timor leste": "TL", "turkey": "TR", "turkiye": "TR", "the bahamas": "BS", "bahamas the": "BS",
  "gambia the": "GM", "the gambia": "GM", "north macedonia": "MK", "czech republic": "CZ", "eswatini": "SZ", "swaziland": "SZ",
  "wallis and futuna": "WF", "reunion": "RE", "man isle of": "IM", "isle of man": "IM", "palestine": "PS", "gaza strip": "PS",
  "west bank": "PS", "western sahara": "EH", "svalbard": "SJ", "jan mayen": "SJ", "heard island and mcdonald islands": "HM",
  "french southern and antarctic lands": "TF", "antarctica": "AQ", "laos": "LA", "moldova": "MD", "bolivia": "BO",
  "venezuela": "VE", "tanzania": "TZ", "united kingdom": "GB", "uk": "GB", "great britain": "GB",
  "netherlands antilles": "CW", "aruba": "AW", "greenland": "GL", "faroe islands": "FO", "guernsey": "GG", "jersey": "JE",
  "cocos keeling islands": "CC", "christmas island": "CX", "norfolk island": "NF", "pitcairn islands": "PN", "tokelau": "TK",
  "niue": "NU", "cook islands": "CK", "american samoa": "AS", "guam": "GU", "northern mariana islands": "MP",
  "puerto rico": "PR", "wake island": "UM", "midway islands": "UM", "johnston atoll": "UM", "navassa island": "UM",
  "midway island": "UM", "u a e": "AE", "cook is": "CK", "u k": "GB", "st vincent": "VC", "cape verde is": "CV",
  "turks and caicos is": "TC", "marshall is": "MH", "ascension": "SH", "virgin is u s a": "VI", "congo d r": "CD",
  "comoros is": "KM", "pitcairn is": "PN", "virgin is u k": "VG", "azores": "PT", "madeira": "PT", "canary islands": "ES",
  "british indian ocean territory": "IO", "south georgia and the south sandwich islands": "GS", "bouvet island": "BV",
};

let byName: Map<string, string> | null = null;

/** A country's ISO 3166 code from its English name, or null. */
export function countryCode(name: string | null | undefined): string | null {
  if (!name) return null;
  if (!byName) {
    byName = new Map(Object.entries(COUNTRY_ALIASES));
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    const A = "A".charCodeAt(0);
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j);
        const n = names.of(code);
        if (n && n !== code && !byName.has(fold(n))) byName.set(fold(n.replace(/&/g, "and")), code);
      }
    }
  }
  const key = fold(name.replace(/&/g, "and"));
  return byName.get(key) ?? null;
}

interface Merged extends PortRecord {
  nameRank: number;
  coordRank: number;
  keys: Set<string>;
}

const cellOf = (lat: number, lng: number) => [Math.floor(lat / CELL), Math.floor(lng / CELL)] as const;

/** Merges port records from every source into one list (see the file comment for the rules). */
export function mergePorts(records: PortRecord[]): PortRecord[] {
  const sorted = [...records].sort((a, b) => NAME_RANK[a.source] - NAME_RANK[b.source]);
  const merged: Merged[] = [];
  const grid = new Map<string, Merged[]>();

  for (const r of sorted) {
    const keys = new Set([r.name, ...r.aliases].map(fold).filter(Boolean));
    const [cy, cx] = cellOf(r.lat, r.lng);
    let hit: Merged | null = null;
    let hitSameName = false;
    let best = Infinity;
    for (let dy = -1; dy <= 1 && !hit; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const m of grid.get(`${cy + dy}|${cx + dx}`) ?? []) {
          const d = distanceKm(m, r);
          const sameName = [...keys].some((k) => m.keys.has(k));
          // Another country only with the same name close by: a source's wrong code.
          const sameCountry = !m.country || !r.country || m.country === r.country;
          const close = sameCountry ? d <= SAME_SPOT_KM || (sameName && d <= SAME_NAME_KM) : sameName && d <= SAME_NAME_KM;
          if (close && d < best) {
            hit = m;
            hitSameName = sameName;
            best = d;
          }
        }
      }
    }
    if (!hit) {
      const m: Merged = {
        ...r, aliases: [], nameRank: NAME_RANK[r.source], coordRank: COORD_RANK[r.source], keys: new Set([fold(r.name)]),
      };
      addAliases(m, r.aliases);
      merged.push(m);
      const k = `${cy}|${cx}`;
      grid.set(k, [...(grid.get(k) ?? []), m]);
      continue;
    }
    addAliases(hit, [r.name, ...r.aliases]);
    hit.country ??= r.country;
    // A code only from the same port under the same name: a neighbour's is another place's.
    if (hitSameName && hit.country === r.country) hit.locode ??= r.locode;
    if (COORD_RANK[r.source] < hit.coordRank) {
      hit.lat = r.lat;
      hit.lng = r.lng;
      hit.coordRank = COORD_RANK[r.source];
    }
  }

  return merged
    .map(({ name, country, locode, lat, lng, source, aliases }) => ({ name, country, locode, lat, lng, source, aliases }))
    .sort((a, b) => (a.country ?? "").localeCompare(b.country ?? "") || a.name.localeCompare(b.name));
}

function addAliases(m: Merged, names: string[]) {
  for (const n of names) {
    const k = fold(n);
    if (!k || m.keys.has(k)) continue;
    m.keys.add(k);
    m.aliases.push(n);
  }
}
