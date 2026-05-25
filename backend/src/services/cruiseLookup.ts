import * as cheerio from "cheerio";
import { config } from "../config.js";
import { greatCirclePath, type LngLat } from "../lib/geo.js";
import { findPort, findPortDb } from "./places.js";
import type { LookupResult, LookupWaypoint } from "./flightLookup.js";

const BASE = "https://www.cruisemapper.com";
const abs = (href: string) => (href.startsWith("http") ? href : `${BASE}${href}`);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

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
  sailings: CruiseSailing[];
  ports: Array<{ label: string; lng: number | null; lat: number | null }>;
  warnings: string[];
}

const emptyFind = (warnings: string[]): CruiseFindResult => ({
  shipName: "",
  shipUrl: null,
  image: null,
  sailings: [],
  ports: [],
  warnings,
});

interface NamedUrl {
  name: string;
  url: string;
}

// --- Autocomplete caches (CruiseMapper changes rarely) ---
let linesCache: { at: number; lines: NamedUrl[] } | null = null;
const shipsByLine = new Map<string, { at: number; ships: NamedUrl[] }>();
const LINES_TTL = 6 * 60 * 60 * 1000;
const SHIPS_TTL = 60 * 60 * 1000;

async function getLines(): Promise<NamedUrl[]> {
  if (linesCache && Date.now() - linesCache.at < LINES_TTL) return linesCache.lines;
  const r = await cruiseFetch(`${BASE}/cruise-lines`);
  if (looksBlocked(r.status, r.html)) return linesCache?.lines ?? [];
  const $ = cheerio.load(r.html);
  const seen = new Set<string>();
  const lines: NamedUrl[] = [];
  $('a[href*="/cruise-lines/"]').each((_i, el) => {
    const raw = $(el).attr("href");
    if (!raw) return;
    const url = abs(raw.split(/[?#]/)[0]);
    if (seen.has(url) || /\/cruise-lines\/?$/.test(url)) return; // skip the index link itself
    seen.add(url);
    const name = $(el).text().trim();
    if (name && name.length >= 2 && name.length < 60) lines.push({ name, url });
  });
  if (lines.length) linesCache = { at: Date.now(), lines };
  return lines;
}

async function getShipsForLine(lineUrl: string): Promise<NamedUrl[]> {
  const cached = shipsByLine.get(lineUrl);
  if (cached && Date.now() - cached.at < SHIPS_TTL) return cached.ships;
  const r = await cruiseFetch(lineUrl);
  if (looksBlocked(r.status, r.html)) return cached?.ships ?? [];
  const $ = cheerio.load(r.html);
  const seen = new Set<string>();
  const ships: NamedUrl[] = [];
  $('a[href*="/ships/"]').each((_i, el) => {
    const raw = $(el).attr("href");
    if (!raw) return;
    const url = abs(raw.split(/[?#]/)[0]);
    if (seen.has(url)) return;
    seen.add(url);
    const slug = url.split("/ships/")[1] ?? "";
    const fromSlug = slug.replace(/-\d+$/, "").replace(/-/g, " ");
    const text = $(el).text().trim();
    const name = text.length >= 3 ? text : fromSlug;
    if (name) ships.push({ name, url });
  });
  if (ships.length) shipsByLine.set(lineUrl, { at: Date.now(), ships });
  return ships;
}

export async function searchCruiseLines(q: string): Promise<NamedUrl[]> {
  const lines = await getLines();
  const n = norm(q);
  if (!n) return lines.slice(0, 12);
  return lines.filter((l) => norm(l.name).includes(n)).slice(0, 12);
}

export async function searchCruiseShips(q: string, lineName?: string): Promise<NamedUrl[]> {
  let lineUrl: string | null = null;
  if (lineName && lineName.trim()) {
    const lines = await getLines();
    const target = norm(lineName);
    const match = lines.find((l) => norm(l.name).includes(target) || target.includes(norm(l.name)));
    lineUrl = match?.url ?? null;
  }
  if (!lineUrl) return []; // ship autocomplete needs a known cruise line
  const ships = await getShipsForLine(lineUrl);
  const n = norm(q);
  if (!n) return ships.slice(0, 15);
  return ships.filter((s) => norm(s.name).includes(n)).slice(0, 15);
}

async function findLineUrl(line: string): Promise<string | null> {
  const r = await cruiseFetch(`${BASE}/cruise-lines`);
  if (looksBlocked(r.status, r.html)) return null;
  const $ = cheerio.load(r.html);
  const target = norm(line);
  const candidates: Array<{ url: string; score: number }> = [];
  $('a[href*="/cruise-lines/"]').each((_i, el) => {
    const href = $(el).attr("href");
    const n = norm($(el).text());
    if (!href || !n) return;
    if (n.includes(target) || target.includes(n)) {
      candidates.push({ url: abs(href.split(/[?#]/)[0]), score: Math.abs(n.length - target.length) });
    }
  });
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.url ?? null;
}

async function findShipUrl(pageUrl: string, ship: string): Promise<string | null> {
  const r = await cruiseFetch(pageUrl);
  if (looksBlocked(r.status, r.html)) return null;
  const $ = cheerio.load(r.html);
  const target = norm(ship);
  const seen = new Set<string>();
  const candidates: Array<{ url: string; score: number }> = [];
  $('a[href*="/ships/"]').each((_i, el) => {
    const raw = $(el).attr("href");
    if (!raw) return;
    const href = abs(raw.split(/[?#]/)[0]);
    if (seen.has(href)) return;
    seen.add(href);
    const slug = href.split("/ships/")[1] ?? "";
    const fromSlug = slug.replace(/-\d+$/, "").replace(/-/g, " ");
    const text = $(el).text().trim();
    const n = norm(text.length >= 3 ? text : fromSlug);
    if (!n) return;
    if (n.includes(target) || target.includes(n)) {
      candidates.push({ url: href, score: Math.abs(n.length - target.length) });
    }
  });
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.url ?? null;
}

async function parseShipPage(shipUrl: string) {
  const r = await cruiseFetch(shipUrl);
  if (looksBlocked(r.status, r.html)) return null;
  const $ = cheerio.load(r.html);
  const shipName = $("h1").first().text().trim() || $("title").text().split("|")[0].trim();
  const ogImage = $('meta[property="og:image"]').attr("content");
  const image = ogImage ? abs(ogImage) : null;

  const sailings: CruiseSailing[] = [];
  $("table.shipTableCruise tbody tr").each((_i, tr) => {
    const id = $(tr).attr("data-row") ?? "";
    const dateText = $(tr).find(".cruiseDatetime").text().trim();
    const title = $(tr).find(".cruiseTitle").text().trim();
    const departurePort = $(tr).find(".cruiseDeparture").text().trim();
    const price = $(tr).find(".cruisePrice").text().trim();
    if (!dateText && !title) return;
    const d = new Date(dateText);
    const dateISO = Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    sailings.push({ id, dateISO, dateText, title, departurePort, price });
  });

  const seen = new Set<string>();
  const ports: string[] = [];
  $('a[href*="/ports/"]').each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.includes("?")) return; // skip sub-links like ?tab=hotels
    const clean = $(el).text().trim().split(/[(,]/)[0].trim();
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      ports.push(clean);
    }
  });

  return { shipName, image, sailings, ports };
}

/**
 * Find a ship on CruiseMapper (via its cruise line) and return its sailing
 * schedule + ports of call. The exact day-by-day ports for one sailing are not
 * in the static HTML, so the UI lets the user assemble the route from these ports.
 */
export async function findCruise({
  line,
  ship,
  shipUrl: directUrl,
}: {
  line?: string;
  ship?: string;
  shipUrl?: string;
}): Promise<CruiseFindResult> {
  if (!config.cruiseLookupEnabled) return emptyFind(["Cruise lookup is disabled. Add ports manually."]);
  const warnings: string[] = [];
  try {
    let shipUrl: string | null = null;
    // Exact URL chosen from autocomplete — use it directly (validate host).
    if (directUrl) {
      try {
        if (/(^|\.)cruisemapper\.com$/.test(new URL(directUrl).hostname)) shipUrl = directUrl;
      } catch {
        /* ignore bad url */
      }
    }
    if (!shipUrl && ship && line && line.trim()) {
      const lineUrl = await findLineUrl(line.trim());
      if (lineUrl) shipUrl = await findShipUrl(lineUrl, ship);
      else warnings.push(`Couldn't find cruise line "${line}" on CruiseMapper.`);
    }
    if (!shipUrl && ship) shipUrl = await findShipUrl(`${BASE}/ships`, ship);
    if (!shipUrl) {
      return emptyFind([...warnings, `Couldn't find "${ship ?? "that ship"}". Try the exact ship name and cruise line, or add ports manually.`]);
    }
    const page = await parseShipPage(shipUrl);
    if (!page) return emptyFind([...warnings, "CruiseMapper blocked the ship page. Add ports manually."]);

    const ports = await Promise.all(
      page.ports.slice(0, 40).map(async (label) => {
        const p = await findPortDb(label);
        return { label, lng: p?.lng ?? null, lat: p?.lat ?? null };
      }),
    );
    if (!page.sailings.length) warnings.push("No upcoming sailings listed; you can still build the route from the ports below.");
    return { shipName: page.shipName || ship || "", shipUrl, image: page.image, sailings: page.sailings, ports, warnings };
  } catch {
    return emptyFind(["Cruise lookup failed (network or parsing error). Add ports manually."]);
  }
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": config.cruiseUserAgent,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.cruisemapper.com/",
};

interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  html: string;
}

/** Fetch a CruiseMapper page with browser-like headers. */
export async function cruiseFetch(url: string): Promise<FetchResult> {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
  const html = await res.text();
  return {
    url: res.url || url,
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    html,
  };
}

function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const h = html.toLowerCase();
  return h.includes("just a moment") || h.includes("cf-chl") || h.includes("cf-browser-verification") || h.includes("attention required");
}

/**
 * Diagnostic: fetch a CruiseMapper URL (or a search for a query) and report what
 * the server actually receives. Used to ground the scraper in the real HTML —
 * run it on the host where the backend lives and share the output.
 */
export async function diagnoseCruise(opts: {
  url?: string;
  query?: string;
  selector?: string;
  raw?: boolean;
  maxLen?: number;
}): Promise<unknown> {
  let url = opts.url;
  if (!url && opts.query) url = `https://www.cruisemapper.com/search?q=${encodeURIComponent(opts.query)}`;
  if (!url) url = "https://www.cruisemapper.com/";

  // Only allow probing CruiseMapper itself (avoid SSRF).
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { error: "Invalid URL" };
  }
  if (!/(^|\.)cruisemapper\.com$/.test(host)) {
    return { error: "Only cruisemapper.com URLs may be probed" };
  }

  let r: FetchResult;
  try {
    r = await cruiseFetch(url);
  } catch (e) {
    return { url, error: e instanceof Error ? e.message : "fetch failed" };
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

  // Forms reveal the real search endpoint + parameter name.
  const forms = $("form")
    .slice(0, 10)
    .map((_i, f) => ({
      action: $(f).attr("action") ?? "",
      method: ($(f).attr("method") ?? "get").toLowerCase(),
      inputs: $(f)
        .find("input,select")
        .slice(0, 15)
        .map((_j, el) => ({ name: $(el).attr("name"), type: $(el).attr("type") ?? (el as { tagName?: string }).tagName }))
        .get(),
    }))
    .get();

  // A de-duplicated sample of every link on the page, to discover URL patterns.
  const seen = new Set<string>();
  const linkSample: Array<{ href: string; text: string }> = [];
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);
    if (linkSample.length < 60) linkSample.push({ href, text: $(el).text().trim().slice(0, 50) });
  });

  // Optional drill-down once we know where to look.
  const maxLen = Math.min(opts.maxLen ?? 4000, 20000);
  const selectorMatches = opts.selector
    ? $(opts.selector).slice(0, 8).map((_i, el) => $.html(el).replace(/\s+/g, " ").slice(0, maxLen)).get()
    : undefined;

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
    selectorMatches,
    rawHtml: opts.raw ? r.html.slice(0, 6000) : undefined,
    snippet: $("body").text().replace(/\s+/g, " ").trim().slice(0, 800),
  };
}

/**
 * Build a cruise route from an ordered list of port names. This is the reliable
 * path: each port is resolved against the bundled dataset (geocoder fallback),
 * and legs are connected as great-circle arcs.
 */
export async function lookupCruiseByPorts(portNames: string[]): Promise<LookupResult> {
  const warnings: string[] = [];
  const waypoints: LookupWaypoint[] = [];

  for (let i = 0; i < portNames.length; i++) {
    const name = portNames[i].trim();
    if (!name) continue;
    const place = await findPort(name);
    if (!place) {
      warnings.push(`Could not locate port: ${name}`);
      continue;
    }
    waypoints.push({
      label: place.label,
      lng: place.lng,
      lat: place.lat,
      kind: i === 0 ? "origin" : i === portNames.length - 1 ? "destination" : "stop",
    });
  }

  if (waypoints.length < 1) {
    return { title: "", waypoints: [], path: [], warnings: [...warnings, "No ports could be located."] };
  }
  const path = waypoints.length >= 2 ? greatCirclePath(waypoints.map((w) => [w.lng, w.lat] as LngLat)) : [];
  const title =
    waypoints.length >= 2
      ? `Cruise: ${waypoints[0].label} → ${waypoints[waypoints.length - 1].label}`
      : `Cruise: ${waypoints[0].label}`;
  return { title, waypoints, path, warnings };
}

/**
 * Best-effort: resolve a ship's itinerary on CruiseMapper. CruiseMapper has no
 * API and may block server-side requests, so this is inherently fragile and
 * always falls back to manual port entry. Run the diagnostic endpoint to see
 * what your server actually receives.
 */
export async function lookupCruiseByShip(ship: string): Promise<LookupResult> {
  if (!config.cruiseLookupEnabled) {
    return manualHint("Cruise lookup is disabled. Enter ports manually.");
  }
  try {
    const search = await cruiseFetch(`https://www.cruisemapper.com/search?q=${encodeURIComponent(ship)}`);
    if (looksBlocked(search.status, search.html)) {
      return manualHint(`CruiseMapper blocked the request (HTTP ${search.status}). Enter ports manually.`);
    }
    const $search = cheerio.load(search.html);
    const shipHref = $search('a[href*="/ships/"]').first().attr("href");
    if (!shipHref) return manualHint("Could not find that ship on CruiseMapper.");

    const shipUrl = shipHref.startsWith("http") ? shipHref : `https://www.cruisemapper.com${shipHref}`;
    const shipPage = await cruiseFetch(shipUrl);
    if (looksBlocked(shipPage.status, shipPage.html)) {
      return manualHint(`CruiseMapper blocked the ship page (HTTP ${shipPage.status}).`);
    }
    const $ship = cheerio.load(shipPage.html);
    const ogImage = $ship('meta[property="og:image"]').attr("content") ?? null;

    const portNames: string[] = [];
    $ship('a[href*="/ports/"]').each((_i, el) => {
      const text = $ship(el).text().trim();
      if (text && text.length < 60 && portNames[portNames.length - 1] !== text) portNames.push(text);
    });
    const unique = [...new Set(portNames)];
    if (unique.length < 2) {
      return manualHint("Found the ship but couldn't parse a clear itinerary. Enter ports manually.");
    }

    const result = await lookupCruiseByPorts(unique);
    result.title = `Cruise — ${ship}`;
    result.image = ogImage;
    result.warnings.unshift("Itinerary auto-detected from CruiseMapper (best-effort) — please review the ports.");
    return result;
  } catch {
    return manualHint("Cruise lookup failed (network or parsing error).");
  }
}

export interface SailingDetail {
  ports: Array<{ label: string; lng: number; lat: number; kind: "origin" | "port" | "destination"; dateISO: string | null }>;
  path: number[][];
  warnings: string[];
}

interface MapJson {
  points?: number[][];
  ports?: Array<{ poi?: string; lat?: string; lon?: string; dep_datetime?: string | null }>;
}

/**
 * Fetch a single sailing's full itinerary by its id (the schedule row's data-row):
 *  - /map/cruise.json?id=   → the real sailed route (`points`) + port coordinates
 *  - /ships/cruise.json?id= → { result: <html> } day-by-day ports with names + dates
 */
export async function getSailingDetail(id: string): Promise<SailingDetail> {
  const warnings: string[] = [];
  let mapJson: MapJson = {};
  try {
    const r = await cruiseFetch(`${BASE}/map/cruise.json?id=${encodeURIComponent(id)}`);
    if (!looksBlocked(r.status, r.html)) mapJson = JSON.parse(r.html) as MapJson;
  } catch {
    warnings.push("Couldn't read the sailing route map.");
  }

  // poi id → coordinates, and the cruise year (for dating the HTML rows).
  const poiCoord = new Map<string, { lng: number; lat: number }>();
  let year = new Date().getFullYear();
  for (const p of mapJson.ports ?? []) {
    if (p.poi && p.lat && p.lon) poiCoord.set(String(p.poi), { lng: Number(p.lon), lat: Number(p.lat) });
    if (p.dep_datetime) {
      const y = Number(p.dep_datetime.slice(0, 4));
      if (y > 2000) year = y;
    }
  }

  let html = "";
  try {
    const r = await cruiseFetch(`${BASE}/ships/cruise.json?id=${encodeURIComponent(id)}`);
    if (!looksBlocked(r.status, r.html)) html = (JSON.parse(r.html) as { result?: string }).result ?? "";
  } catch {
    warnings.push("Couldn't read the sailing's port list.");
  }

  const ports: SailingDetail["ports"] = [];
  if (html) {
    const $ = cheerio.load(html);
    const rows = $("table.cruiseExpand tbody tr").toArray();
    for (const tr of rows) {
      const anchors = $(tr).find('td.text a[href*="/ports/"]').toArray();
      const portA = anchors.find((el) => !($(el).attr("href") ?? "").includes("?"));
      if (!portA) continue; // sea day / no port
      const href = $(portA).attr("href") ?? "";
      const portId = href.match(/-port-(\d+)/)?.[1] ?? null;
      const label = $(portA).text().trim().split(/[(,]/)[0].trim();
      const dateText = $(tr).find("td.date").text().trim().split(/\s+/).slice(0, 2).join(" ");
      const d = new Date(`${dateText} ${year}`);
      const dateISO = Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);

      let coord = portId ? poiCoord.get(portId) : undefined;
      if (!coord) {
        const p = await findPort(label);
        if (p) coord = { lng: p.lng, lat: p.lat };
      }
      if (coord) ports.push({ label, lng: coord.lng, lat: coord.lat, kind: "port", dateISO });
    }
  }
  ports.forEach((p, i) => {
    p.kind = i === 0 ? "origin" : i === ports.length - 1 ? "destination" : "port";
  });

  const path = Array.isArray(mapJson.points) ? mapJson.points.filter((c) => Array.isArray(c) && c.length === 2) : [];
  if (!ports.length) warnings.push("Couldn't parse this sailing's ports — add them manually below.");
  return { ports, path, warnings };
}

function manualHint(reason: string): LookupResult {
  return {
    title: "",
    waypoints: [],
    path: [],
    warnings: [reason, "Tip: add the ports of call in order below and we'll plot them precisely."],
  };
}
