import * as cheerio from "cheerio";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { fold } from "../db/referenceMerge.js";
import { HttpError } from "../lib/errors.js";
import { cached, DAY } from "../lib/lookupCache.js";
import { findPort, findPortDb } from "./places.js";

/**
 * CruiseMapper, read like a browser would (it has no API): cruise lines and
 * their ships (autocomplete), a ship's upcoming sailings and ports, and one
 * sailing's day-by-day ports and track.
 *
 * - Everything goes through `lookup_cache`: lines and ships for a week, a ship's
 *   page for a day, a sailing for 90 days (it doesn't change once published).
 * - CRUISE_LOOKUP_ENABLED=false turns all of it off (CruiseLookupError "off").
 * - A block or no answer (Cloudflare's challenge, 403/429/503, a network error)
 *   is CruiseLookupError "blocked", and isn't cached.
 * - Port times are the ship's local wall-clock times, written as UTC ("08:00"
 *   in Cozumel is 08:00Z): shown as they are, never converted.
 */

/** Turned off (a 409), or CruiseMapper not answering (a 503 with `blocked`: the editor offers Try again). */
export class CruiseLookupError extends HttpError {
  constructor(public readonly reason: "off" | "blocked", message: string) {
    super(reason === "off" ? 409 : 503, message, reason === "blocked" ? { blocked: true } : undefined);
  }
}
const OFF = "Cruise lookup is turned off on this server. Add the ports yourself.";
const BLOCKED = "CruiseMapper isn't answering right now. Try again in a few minutes, or add the ports yourself.";

const base = () => config.cruiseMapperUrl;
const abs = (href: string) => (/^https?:/.test(href) ? href : `${base()}${href.startsWith("/") ? "" : "/"}${href}`);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");
// Hosts the diagnostic may fetch: CruiseMapper, and a site with past port schedules.
const diagnoseHosts = () => [hostOf(base()), "cruisetimetables.com"];

function ensureOn(): void {
  if (!config.cruiseLookupEnabled) throw new CruiseLookupError("off", OFF);
}

export interface CruiseSailing {
  id: string;
  dateISO: string | null;
  dateText: string;
  title: string;
  departurePort: string;
  price: string;
}
export interface CruiseFindResult {
  shipName: string;
  shipUrl: string | null;
  image: string | null;
  lineName: string | null;
  lineLogo: string | null;
  sailings: CruiseSailing[];
  ports: Array<{ label: string; lng: number | null; lat: number | null }>;
  warnings: string[];
}
interface NamedUrl {
  name: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const BROWSER_HEADERS = (): Record<string, string> => ({
  "User-Agent": config.cruiseUserAgent,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${base()}/`,
});
// CruiseMapper's *.json only answers requests that look like a browser's XHR;
// others are redirected to HTML.
const XHR_HEADERS: Record<string, string> = {
  "X-Requested-With": "XMLHttpRequest",
  Accept: "application/json, text/javascript, */*; q=0.01",
};

interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  html: string;
}

/**
 * Fetch a page, following redirects only while they stay on `hosts` (so a
 * redirect can't send a request somewhere else). Throws a plain Error for a
 * redirect elsewhere, and on a network failure.
 */
async function fetchOn(url: string, hosts: string[], headers: Record<string, string> = {}): Promise<FetchResult> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const host = hostOf(current);
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      throw new Error(`Redirected away from CruiseMapper (to ${host})`);
    }
    const res = await fetch(current, { headers: { ...BROWSER_HEADERS(), ...headers }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return { url: current, status: res.status, contentType: res.headers.get("content-type") ?? "", html: await res.text() };
  }
  throw new Error("Too many redirects");
}

function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status >= 500) return true;
  const h = html.toLowerCase();
  return h.includes("just a moment") || h.includes("cf-chl") || h.includes("cf-browser-verification") || h.includes("attention required");
}

/** A CruiseMapper page (or JSON), or CruiseLookupError "blocked". */
async function cruiseGet(url: string, headers: Record<string, string> = {}): Promise<FetchResult> {
  let r: FetchResult;
  try {
    r = await fetchOn(url, [hostOf(base())], headers);
  } catch {
    throw new CruiseLookupError("blocked", BLOCKED);
  }
  if (looksBlocked(r.status, r.html)) throw new CruiseLookupError("blocked", BLOCKED);
  return r;
}

// ---------------------------------------------------------------------------
// Cruise lines and ships (autocomplete)
// ---------------------------------------------------------------------------

const isLineIndex = (url: string) => /\/cruise-lines\/?$/.test(url);
const lineNameFromUrl = (url: string) =>
  (url.split("/cruise-lines/")[1] ?? "").replace(/-\d+$/, "").replace(/-/g, " ").trim();
const nameFromShipUrl = (url: string) => (url.split("/ships/")[1] ?? "").replace(/-\d+$/, "").replace(/-/g, " ");

async function getLines(): Promise<NamedUrl[]> {
  return cached("cruisemapper:lines", 7 * DAY, async () => {
    const $ = cheerio.load((await cruiseGet(`${base()}/cruise-lines`)).html);
    const byUrl = new Map<string, string>();
    $('a[href*="/cruise-lines/"]').each((_i, el) => {
      const raw = $(el).attr("href");
      if (!raw) return;
      const url = abs(raw.split(/[?#]/)[0]);
      if (isLineIndex(url)) return;
      // Logo links have no text: the name comes from another link, or the slug.
      const text = $(el).text().trim();
      if (text.length >= 2 && text.length < 60) byUrl.set(url, text);
      else if (!byUrl.has(url)) byUrl.set(url, "");
    });
    return [...byUrl].map(([url, name]) => ({ name: name || lineNameFromUrl(url), url })).filter((l) => l.name.length >= 2);
  });
}

/** Ship links on a page (a cruise line's, or the index of all ships). */
async function shipsOn(pageUrl: string): Promise<NamedUrl[]> {
  return cached(`cruisemapper:ships:${pageUrl}`, 7 * DAY, async () => {
    const $ = cheerio.load((await cruiseGet(pageUrl)).html);
    const seen = new Set<string>();
    const ships: NamedUrl[] = [];
    $('a[href*="/ships/"]').each((_i, el) => {
      const raw = $(el).attr("href");
      if (!raw) return;
      const url = abs(raw.split(/[?#]/)[0]);
      if (seen.has(url) || url.endsWith(".json")) return;
      seen.add(url);
      const text = $(el).text().trim();
      const name = text.length >= 3 ? text : nameFromShipUrl(url);
      if (name) ships.push({ name, url });
    });
    return ships;
  });
}

export async function searchCruiseLines(q: string): Promise<NamedUrl[]> {
  ensureOn();
  const lines = await getLines();
  const n = norm(q);
  if (!n) return lines; // the whole list (the settings dropdown)
  return lines.filter((l) => norm(l.name).includes(n)).slice(0, 12);
}

async function findLineUrl(line: string): Promise<string | null> {
  const target = norm(line);
  if (!target) return null;
  const candidates = (await getLines())
    .filter((l) => norm(l.name).includes(target) || target.includes(norm(l.name)))
    .sort((a, b) => Math.abs(norm(a.name).length - target.length) - Math.abs(norm(b.name).length - target.length));
  return candidates[0]?.url ?? null;
}

/** The ships of a cruise line; empty when the line isn't known. */
export async function lineShips(lineName: string): Promise<NamedUrl[]> {
  const lineUrl = await findLineUrl(lineName);
  return lineUrl ? shipsOn(lineUrl) : [];
}

export async function searchCruiseShips(q: string, lineName?: string): Promise<NamedUrl[]> {
  ensureOn();
  if (!lineName?.trim()) return []; // ship autocomplete needs a cruise line
  const ships = await lineShips(lineName);
  const n = norm(q);
  if (!n) return ships.slice(0, 15);
  return ships.filter((s) => norm(s.name).includes(n)).slice(0, 15);
}

function bestShip(ships: NamedUrl[], ship: string): string | null {
  const target = norm(ship);
  return ships
    .map((s) => ({ url: s.url, n: norm(s.name) }))
    .filter(({ n }) => n && (n.includes(target) || target.includes(n)))
    .sort((a, b) => Math.abs(a.n.length - target.length) - Math.abs(b.n.length - target.length))[0]?.url ?? null;
}

// ---------------------------------------------------------------------------
// A ship's page: its upcoming sailings and ports
// ---------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "7 Nov 2026", "Nov 7, 2026", "2026-11-07"… → "2026-11-07" (no time zone involved), or null. */
export function parseDay(text: string): string | null {
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const year = text.match(/\b(\d{4})\b/)?.[1];
  const mon = text.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/)?.[1];
  const day = text.replace(/\b\d{4}\b/, "").match(/\b(\d{1,2})\b/)?.[1];
  if (!year || !mon || !day) return null;
  return `${year}-${String(MONTHS.indexOf(mon) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

interface ShipPage {
  shipName: string;
  image: string | null;
  lineName: string | null;
  lineLogo: string | null;
  sailings: CruiseSailing[];
  ports: string[];
}

async function shipPage(shipUrl: string): Promise<ShipPage> {
  return cached(`cruisemapper:ship:${shipUrl}`, DAY, async () => {
    const $ = cheerio.load((await cruiseGet(shipUrl)).html);
    const shipName = $("h1").first().text().trim() || $("title").text().split("|")[0].trim();
    const imgSrc = $('img[itemprop="image"]').attr("src") || $('meta[property="og:image"]').attr("content");
    // The ship's line link (/cruise-lines/Royal-Caribbean-1) gives the line's id,
    // whose logo is /images/lines/icons/<id>.png.
    const lineHref = $("a.shipCompanyLink").first().attr("href") || $('a[href*="/cruise-lines/"]').first().attr("href") || "";
    const lineId = lineHref.match(/\/cruise-lines\/[^/]*-(\d+)/)?.[1] ?? null;
    const sailings: CruiseSailing[] = [];
    $("table.shipTableCruise tbody tr").each((_i, tr) => {
      const dateText = $(tr).find(".cruiseDatetime").text().trim();
      const title = $(tr).find(".cruiseTitle").text().trim();
      if (!dateText && !title) return;
      sailings.push({
        id: $(tr).attr("data-row") ?? "",
        dateISO: parseDay(dateText),
        dateText,
        title,
        departurePort: $(tr).find(".cruiseDeparture").text().trim(),
        price: $(tr).find(".cruisePrice").text().trim(),
      });
    });
    const seen = new Set<string>();
    const ports: string[] = [];
    $('a[href*="/ports/"]').each((_i, el) => {
      if (($(el).attr("href") ?? "").includes("?")) return; // sub-links like ?tab=hotels
      const clean = $(el).text().trim().split(/[(,]/)[0].trim();
      if (clean && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        ports.push(clean);
      }
    });
    return {
      shipName,
      image: imgSrc ? abs(imgSrc) : null,
      lineName: $("a.shipCompanyLink").first().text().trim() || null,
      lineLogo: lineId ? `${base()}/images/lines/icons/${lineId}.png` : null,
      sailings,
      ports,
    };
  });
}

/**
 * Find a ship (by an exact URL from autocomplete, or by name within its line or
 * all ships) and return its upcoming sailings and the ports it visits.
 */
export async function findCruise({ line, ship, shipUrl: directUrl }: { line?: string; ship?: string; shipUrl?: string }): Promise<CruiseFindResult> {
  ensureOn();
  const warnings: string[] = [];
  let shipUrl: string | null = null;
  if (directUrl?.startsWith(`${base()}/ships/`)) shipUrl = directUrl;
  if (!shipUrl && ship && line?.trim()) {
    const ships = await lineShips(line.trim());
    if (!ships.length) warnings.push(`Couldn't find the cruise line "${line}" on CruiseMapper.`);
    shipUrl = bestShip(ships, ship);
  }
  if (!shipUrl && ship) shipUrl = bestShip(await shipsOn(`${base()}/ships`), ship);
  if (!shipUrl) {
    return {
      shipName: "", shipUrl: null, image: null, lineName: null, lineLogo: null, sailings: [], ports: [],
      warnings: [...warnings, `Couldn't find "${ship ?? "that ship"}". Try the exact ship name and cruise line, or add the ports yourself.`],
    };
  }
  const page = await shipPage(shipUrl);
  const ports = await Promise.all(
    page.ports.slice(0, 40).map(async (label) => {
      const p = await findPortDb(label);
      return { label, lng: p?.lng ?? null, lat: p?.lat ?? null };
    }),
  );
  if (!page.sailings.length) warnings.push("No upcoming sailings listed; you can still build the route from the ports below.");
  return {
    shipName: page.shipName || ship || "", shipUrl, image: page.image, lineName: page.lineName, lineLogo: page.lineLogo,
    sailings: page.sailings, ports, warnings,
  };
}

// ---------------------------------------------------------------------------
// One sailing: day-by-day ports and the track
// ---------------------------------------------------------------------------

export interface SailingDetail {
  ports: Array<{
    label: string;
    lng: number;
    lat: number;
    kind: "origin" | "port" | "destination";
    dateISO: string | null;
    arriveAt: string | null;
    departAt: string | null;
  }>;
  path: number[][];
  warnings: string[];
}

interface MapJson {
  points?: number[][];
  ports?: Array<{ poi?: string; lat?: string; lon?: string; dep_datetime?: string | null }>;
}

/**
 * One sailing's itinerary, by its id (a schedule row's data-row):
 *  - /map/cruise.json?id= → the track (`points`) and the ports' coordinates;
 *  - /ships/cruise.json?id= → { result: <html> }, the ports day by day.
 * `dateHint` (the sailing's first day, from its row) dates the rows when the
 * track doesn't say which year it is.
 */
export async function getSailingDetail(id: string, dateHint?: string | null): Promise<SailingDetail> {
  ensureOn();
  const detail = await cached(`cruisemapper:sailing:${id}`, 90 * DAY, async () => {
    const warnings: string[] = [];
    let mapJson: MapJson = {};
    const track = await cruiseGet(`${base()}/map/cruise.json?id=${encodeURIComponent(id)}`, XHR_HEADERS);
    try {
      mapJson = JSON.parse(track.html) as MapJson;
    } catch {
      warnings.push("Couldn't read the sailing's route map.");
    }

    // poi id → coordinates; the year the sailing starts.
    const poiCoord = new Map<string, { lng: number; lat: number }>();
    let startYear: number | null = dateHint ? Number(dateHint.slice(0, 4)) : null;
    for (const p of mapJson.ports ?? []) {
      if (p.poi && p.lat && p.lon) poiCoord.set(String(p.poi), { lng: Number(p.lon), lat: Number(p.lat) });
      if (p.dep_datetime && !startYear) {
        const y = Number(p.dep_datetime.slice(0, 4));
        if (y > 2000) startYear = y;
      }
    }
    let year = startYear ?? new Date().getUTCFullYear();

    let html = "";
    const days = await cruiseGet(`${base()}/ships/cruise.json?id=${encodeURIComponent(id)}`, XHR_HEADERS);
    try {
      html = (JSON.parse(days.html) as { result?: string }).result ?? "";
    } catch {
      warnings.push("Couldn't read the sailing's port list.");
    }

    const ports: Array<SailingDetail["ports"][number] & { fullName?: string }> = [];
    let lastMonth = -1;
    const $ = cheerio.load(html);
    for (const tr of $("table.cruiseExpand tbody tr").toArray()) {
      // "17 Jun 08:00 - 17:00": the day, and arrival/departure times.
      const dateCell = $(tr).find("td.date").text().trim();
      const dm = dateCell.match(/^(\d{1,2})\s+([A-Za-z]{3})/);
      const month = dm ? MONTHS.indexOf(dm[2].toLowerCase()) : -1;
      // December, then January: the next year.
      if (month >= 0 && lastMonth >= 0 && month < lastMonth - 6) year += 1;
      if (month >= 0) lastMonth = month;

      const anchors = $(tr).find('td.text a[href*="/ports/"]').toArray();
      const portA = anchors.find((el) => !($(el).attr("href") ?? "").includes("?"));
      if (!portA) continue; // a day at sea
      const portId = ($(portA).attr("href") ?? "").match(/-port-(\d+)/)?.[1] ?? null;
      const full = $(portA).text().trim();
      const label = full.split(/[(,]/)[0].trim();
      const times = dateCell.match(/\d{1,2}:\d{2}/g) ?? [];
      const rowText = $(tr).find("td.text").text();
      const day = dm && month >= 0 ? Date.UTC(year, month, Number(dm[1])) : NaN;
      // Wall-clock times at the port, written as UTC.
      const at = (time?: string): string | null => {
        if (Number.isNaN(day) || !time) return null;
        const [h, m] = time.split(":").map(Number);
        return new Date(day + (h * 60 + m) * 60_000).toISOString();
      };
      let arriveAt: string | null = null;
      let departAt: string | null = null;
      if (/Departing/i.test(rowText)) departAt = at(times[0]);
      else if (/Arriving/i.test(rowText)) arriveAt = at(times[0]);
      else {
        arriveAt = at(times[0]);
        departAt = at(times[1] ?? times[0]);
      }
      let coord = portId ? poiCoord.get(portId) : undefined;
      if (!coord) {
        const p = await findPort(label);
        if (p) coord = { lng: p.lng, lat: p.lat };
      }
      if (!coord) {
        warnings.push(`Couldn't place ${label} on the map; add it below.`);
        continue;
      }
      ports.push({
        label, lng: coord.lng, lat: coord.lat, kind: "port",
        dateISO: Number.isNaN(day) ? null : new Date(day).toISOString().slice(0, 10),
        arriveAt, departAt,
        ...(full !== label ? { fullName: full } : {}),
      });
    }
    ports.forEach((p, i) => {
      p.kind = i === 0 ? "origin" : i === ports.length - 1 ? "destination" : "port";
    });
    const path = Array.isArray(mapJson.points) ? mapJson.points.filter((c) => Array.isArray(c) && c.length === 2) : [];
    if (!ports.length) warnings.push("Couldn't read this sailing's ports. Add them below.");
    await rememberPorts(ports);
    return { ports: ports.map(({ fullName: _full, ...p }) => p), path, warnings };
  });
  return detail;
}

/**
 * Ports seen on a sailing that the ports list doesn't have (private islands such
 * as Labadee or CocoCay) are added to it, so they can be found by name later.
 */
async function rememberPorts(ports: Array<{ label: string; lng: number; lat: number; fullName?: string }>): Promise<void> {
  for (const p of ports) {
    const text = fold(p.label);
    if (!text) continue;
    const known = await query(
      `SELECT 1 FROM ports WHERE abs(lat - $1) < 0.3 AND abs(lng - $2) < 0.3 AND (search % $3 OR (' ' || search || ' ') LIKE $4) LIMIT 1`,
      [p.lat, p.lng, text, `% ${text} %`],
    );
    if (known.rowCount) continue;
    const aliases = p.fullName && p.fullName !== p.label ? [p.fullName] : [];
    await query(
      `INSERT INTO ports (name, country, lat, lng, source, aliases, search)
       VALUES ($1, NULL, $2, $3, 'cruisemapper', $4, $5)
       ON CONFLICT (lower(name), coalesce(country, '')) WHERE source = 'cruisemapper' DO NOTHING`,
      [p.label, p.lat, p.lng, aliases, [text, ...aliases.map(fold)].join(" ")],
    );
  }
}

// ---------------------------------------------------------------------------
// The diagnostic (server admin): what this server gets back from CruiseMapper
// ---------------------------------------------------------------------------

/**
 * Fetch a CruiseMapper URL (or a search) and report what this server receives,
 * to tune the parsing to the real pages. Only CruiseMapper (and
 * cruisetimetables.com), and only redirects that stay there.
 */
export async function diagnoseCruise(opts: { url?: string; query?: string; selector?: string; raw?: boolean; maxLen?: number }): Promise<unknown> {
  ensureOn();
  const url = opts.url ?? (opts.query ? `${base()}/search?q=${encodeURIComponent(opts.query)}` : `${base()}/`);
  const hosts = diagnoseHosts();
  let host: string;
  try {
    host = hostOf(url);
  } catch {
    return { error: "Invalid URL" };
  }
  if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return { error: `Only these hosts may be probed: ${hosts.join(", ")}` };

  let r: FetchResult;
  try {
    r = await fetchOn(url, hosts);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "fetch failed" };
  }

  const $ = cheerio.load(r.html);
  const jsonLd = $('script[type="application/ld+json"]')
    .map((_i, el) => {
      try {
        const parsed = JSON.parse($(el).contents().text());
        return Array.isArray(parsed) ? parsed.map((p) => p["@type"]).join(",") : parsed["@type"];
      } catch {
        return "unparseable";
      }
    })
    .get();
  const forms = $("form")
    .slice(0, 10)
    .map((_i, f) => ({
      action: $(f).attr("action") ?? "",
      method: ($(f).attr("method") ?? "get").toLowerCase(),
      inputs: $(f).find("input,select").slice(0, 15)
        .map((_j, el) => ({ name: $(el).attr("name"), type: $(el).attr("type") ?? (el as { tagName?: string }).tagName }))
        .get(),
    }))
    .get();
  const seen = new Set<string>();
  const linkSample: Array<{ href: string; text: string }> = [];
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);
    if (linkSample.length < 60) linkSample.push({ href, text: $(el).text().trim().slice(0, 50) });
  });
  const maxLen = Math.min(opts.maxLen ?? 4000, 20000);
  return {
    url: r.url,
    status: r.status,
    contentType: r.contentType,
    bytes: r.html.length,
    looksBlocked: looksBlocked(r.status, r.html),
    title: $("title").first().text().trim(),
    ogImage: $('meta[property="og:image"]').attr("content") ?? null,
    counts: {
      shipLinks: $('a[href*="/ships/"]').length,
      portLinks: $('a[href*="/ports/"]').length,
      cruiseLinks: $('a[href*="/cruises/"]').length,
      tables: $("table").length,
      jsonLdBlocks: jsonLd.length,
    },
    jsonLdTypes: jsonLd,
    forms,
    linkSample,
    selectorMatches: opts.selector
      ? $(opts.selector).slice(0, 8).map((_i, el) => $.html(el).replace(/\s+/g, " ").slice(0, maxLen)).get()
      : undefined,
    rawHtml: opts.raw ? r.html.slice(0, 6000) : undefined,
    snippet: $("body").text().replace(/\s+/g, " ").trim().slice(0, 800),
  };
}

// ---------------------------------------------------------------------------
// Past cruises: the same itinerary on another sailing
// ---------------------------------------------------------------------------

export interface ItineraryPort { name?: string; lng: number; lat: number }
export interface ItineraryMatch {
  sailing: { id: string; title: string; dateISO: string | null; ship: string; shipUrl: string };
  ports: SailingDetail["ports"];
  path: number[][];
  /** 1 = the same ports in the same order; less = fewer of them in that order. */
  score: number;
  /** Days from the sailing's start to the person's (negative: earlier). */
  shiftDays: number;
}

const MATCH_KM = 30;
const MIN_SCORE = 0.5;
const MAX_SISTERS = 8;
const MAX_DETAILS = 10;

const nightsOf = (title: string) => Number(title.match(/(\d+)[\s-]*nights?/i)?.[1] ?? NaN);
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
/** Days apart in the year, ignoring the year (itineraries follow the seasons). */
const seasonGap = (a: string, b: string) => {
  const d = Math.abs(dayNumber(`2001${a.slice(4)}`) - dayNumber(`2001${b.slice(4)}`));
  return Math.min(d, 365 - d);
};

function kmBetween(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function samePort(a: ItineraryPort, b: { label: string; lng: number; lat: number }): boolean {
  if (kmBetween(a, b) <= MATCH_KM) return true;
  const x = fold(a.name ?? "");
  const y = fold(b.label);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/** How many of `mine` the sailing visits in the same order (longest common subsequence). */
function inOrder(mine: ItineraryPort[], theirs: SailingDetail["ports"]): number {
  const t = Array.from({ length: mine.length + 1 }, () => new Array<number>(theirs.length + 1).fill(0));
  for (let i = 1; i <= mine.length; i++) {
    for (let j = 1; j <= theirs.length; j++) {
      t[i][j] = samePort(mine[i - 1], theirs[j - 1]) ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
    }
  }
  return t[mine.length][theirs.length];
}

/**
 * A past cruise: CruiseMapper lists only upcoming sailings, but ships sail the
 * same itineraries for years. Look through the ship's sailings, then (unless one
 * matches exactly) its sister ships' on the same line, for the same ports in the
 * same order. With no ports, sailings of the same length from the same port
 * count, nearest in season first. Best matches first, each with its track and
 * the days to move it by to the person's date.
 */
export async function matchItinerary(opts: {
  ship?: string; shipUrl?: string; line?: string; ports?: ItineraryPort[]; departurePort?: string; nights?: number; date: string;
}): Promise<{ matches: ItineraryMatch[]; warnings: string[] }> {
  ensureOn();
  const found = await findCruise({ ship: opts.ship, shipUrl: opts.shipUrl, line: opts.line });
  if (!found.shipUrl) return { matches: [], warnings: found.warnings };
  const ports = (opts.ports ?? []).filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat));
  const departure = opts.departurePort ?? ports[0]?.name ?? null;

  type Candidate = { sailing: CruiseSailing; ship: string; shipUrl: string; own: boolean };
  const candidatesOf = (list: CruiseSailing[], ship: string, shipUrl: string, own: boolean): Candidate[] =>
    list
      .filter((s) => s.id && s.dateISO)
      .filter((s) => !departure || !s.departurePort || samePortName(departure, s.departurePort))
      .filter((s) => !opts.nights || !Number.isFinite(nightsOf(s.title)) || Math.abs(nightsOf(s.title) - opts.nights) <= 1)
      .map((sailing) => ({ sailing, ship, shipUrl, own }));

  const scored: ItineraryMatch[] = [];
  let fetched = 0;
  async function score(cands: Candidate[]) {
    // Nearest in season first, so the most likely ones are the ones fetched.
    cands.sort((a, b) => Number(b.own) - Number(a.own) || seasonGap(a.sailing.dateISO!, opts.date) - seasonGap(b.sailing.dateISO!, opts.date));
    for (const c of cands) {
      if (fetched >= MAX_DETAILS) break;
      fetched++;
      const detail = await getSailingDetail(c.sailing.id, c.sailing.dateISO);
      const s = ports.length >= 2
        ? Math.round((inOrder(ports, detail.ports) / Math.max(ports.length, detail.ports.length)) * 100) / 100
        : 0.5; // no ports to compare: only the length and departure port matched
      if (s < MIN_SCORE) continue;
      scored.push({
        sailing: { id: c.sailing.id, title: c.sailing.title, dateISO: c.sailing.dateISO, ship: c.ship, shipUrl: c.shipUrl },
        ports: detail.ports, path: detail.path, score: s,
        shiftDays: Math.round(dayNumber(opts.date) - dayNumber(c.sailing.dateISO!)),
      });
    }
  }

  await score(candidatesOf(found.sailings, found.shipName, found.shipUrl, true));
  if (!scored.some((m) => m.score >= 0.99)) {
    const line = found.lineName ?? opts.line;
    const sisters = line ? (await lineShips(line)).filter((s) => s.url !== found.shipUrl).slice(0, MAX_SISTERS) : [];
    const cands: Candidate[] = [];
    for (const s of sisters) cands.push(...candidatesOf((await shipPage(s.url)).sailings, s.name, s.url, false));
    await score(cands);
  }

  scored.sort((a, b) => b.score - a.score || seasonGap(a.sailing.dateISO!, opts.date) - seasonGap(b.sailing.dateISO!, opts.date));
  const matches = scored.slice(0, 5);
  return {
    matches,
    warnings: matches.length ? [] : [`No sailing of ${found.shipName || "that ship"} or its sister ships goes to these ports. Build the route from the ports instead.`],
  };
}

function samePortName(a: string, b: string): boolean {
  const x = fold(a.split(/[(,]/)[0]);
  const y = fold(b.split(/[(,]/)[0]);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}
