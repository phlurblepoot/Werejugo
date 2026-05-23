import * as cheerio from "cheerio";
import { config } from "../config.js";
import { greatCirclePath, type LngLat } from "../lib/geo.js";
import { findPort } from "./places.js";
import type { LookupResult, LookupWaypoint } from "./flightLookup.js";

/**
 * Build a cruise route from an ordered list of port names. This is the reliable
 * path: each port is resolved against the bundled ports dataset (with a geocoder
 * fallback), and the legs are connected as smooth arcs.
 *
 * Note: cruise ships follow sea lanes, not straight lines. Without a marine
 * routing engine we approximate each leg as a great-circle arc, which is good
 * enough to visualise the itinerary. Users can drag waypoints / edit later.
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

  const path =
    waypoints.length >= 2 ? greatCirclePath(waypoints.map((w) => [w.lng, w.lat] as LngLat)) : [];
  const title =
    waypoints.length >= 2
      ? `Cruise: ${waypoints[0].label} → ${waypoints[waypoints.length - 1].label}`
      : `Cruise: ${waypoints[0].label}`;
  return { title, waypoints, path, warnings };
}

/**
 * Best-effort: look up a ship's itinerary on CruiseMapper by scraping public
 * pages. CruiseMapper has no public API, so this is inherently fragile and may
 * break when their site changes — it is offered as a convenience and always
 * falls back to manual port entry.
 */
export async function lookupCruiseByShip(ship: string): Promise<LookupResult> {
  if (!config.cruiseLookupEnabled) {
    return { title: "", waypoints: [], path: [], warnings: ["Cruise lookup is disabled. Enter ports manually."] };
  }
  try {
    const searchUrl = `https://www.cruisemapper.com/search?q=${encodeURIComponent(ship)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { "User-Agent": config.nominatimUserAgent },
    });
    if (!searchRes.ok) {
      return manualHint(`CruiseMapper returned HTTP ${searchRes.status}.`);
    }
    const $search = cheerio.load(await searchRes.text());
    const shipHref = $search('a[href*="/ships/"]').first().attr("href");
    if (!shipHref) {
      return manualHint("Could not find that ship on CruiseMapper.");
    }
    const shipUrl = shipHref.startsWith("http") ? shipHref : `https://www.cruisemapper.com${shipHref}`;
    const shipRes = await fetch(shipUrl, { headers: { "User-Agent": config.nominatimUserAgent } });
    if (!shipRes.ok) {
      return manualHint(`Could not load the ship page (HTTP ${shipRes.status}).`);
    }
    const $ship = cheerio.load(await shipRes.text());

    // Heuristic: port links on the page reference /ports/ pages. Collect their
    // text in document order, de-duplicating consecutive repeats.
    const portNames: string[] = [];
    $ship('a[href*="/ports/"]').each((_i, el) => {
      const text = $ship(el).text().trim();
      if (text && text.length < 60 && portNames[portNames.length - 1] !== text) {
        portNames.push(text);
      }
    });

    const unique = [...new Set(portNames)];
    if (unique.length < 2) {
      return manualHint("Found the ship but could not parse a clear itinerary. Enter ports manually.");
    }

    const result = await lookupCruiseByPorts(unique);
    result.title = `Cruise — ${ship}`;
    result.warnings.unshift(
      "Itinerary auto-detected from CruiseMapper (best-effort) — please review the ports.",
    );
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
    warnings: [reason, "Tip: type the ports of call in order and we'll plot them precisely."],
  };
}
