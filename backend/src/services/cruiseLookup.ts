import * as cheerio from "cheerio";
import { config } from "../config.js";
import { greatCirclePath, type LngLat } from "../lib/geo.js";
import { findPort } from "./places.js";
import type { LookupResult, LookupWaypoint } from "./flightLookup.js";

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

function manualHint(reason: string): LookupResult {
  return {
    title: "",
    waypoints: [],
    path: [],
    warnings: [reason, "Tip: add the ports of call in order below and we'll plot them precisely."],
  };
}
