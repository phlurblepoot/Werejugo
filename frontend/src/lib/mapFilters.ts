import type { Item, ItemKind } from "../api/client";
import { ITEM_KINDS } from "./style";

/** Everything the map can be filtered by. Stored in the URL, so a view can be bookmarked or linked. */
export interface MapFilters {
  q: string;
  kinds: ItemKind[];
  /** A trip id, "none" (no trip) or "" (all). */
  trip: string;
  person: string;
  year: string;
  /** "mine" = added by my family, "others" = added by other families on shared trips. */
  family: "" | "mine" | "others";
}

export function readFilters(p: URLSearchParams): MapFilters {
  const family = p.get("family");
  return {
    q: p.get("q") ?? "",
    kinds: (p.get("kind") ?? "").split(",").filter((k): k is ItemKind => (ITEM_KINDS as string[]).includes(k)),
    trip: p.get("trip") ?? "",
    person: p.get("person") ?? "",
    year: /^\d{4}$/.test(p.get("year") ?? "") ? p.get("year")! : "",
    family: family === "mine" || family === "others" ? family : "",
  };
}

/** The same params with these filters changed (other params, like ?visit=, are kept). */
export function writeFilters(p: URLSearchParams, change: Partial<MapFilters>): URLSearchParams {
  const next = new URLSearchParams(p);
  const set = (key: string, value: string) => (value ? next.set(key, value) : next.delete(key));
  if (change.q !== undefined) set("q", change.q);
  if (change.kinds !== undefined) set("kind", change.kinds.join(","));
  if (change.trip !== undefined) set("trip", change.trip);
  if (change.person !== undefined) set("person", change.person);
  if (change.year !== undefined) set("year", change.year);
  if (change.family !== undefined) set("family", change.family);
  return next;
}

export const activeFilterCount = (f: MapFilters) =>
  [f.q, f.trip, f.person, f.year, f.family].filter(Boolean).length + (f.kinds.length ? 1 : 0);

/** A place belongs to my family unless it says otherwise. */
export const isMine = (i: Pick<Item, "familyId">, myFamilyId?: string | null) => !i.familyId || !myFamilyId || i.familyId === myFamilyId;

export function applyFilters(items: Item[], f: MapFilters, myFamilyId?: string | null): Item[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((i) => {
    if (q && !`${i.title} ${i.notes}`.toLowerCase().includes(q)) return false;
    if (f.kinds.length && !f.kinds.includes(i.kind)) return false;
    if (f.trip === "none" && i.tripId) return false;
    if (f.trip && f.trip !== "none" && i.tripId !== f.trip) return false;
    if (f.person && !(i.personIds ?? []).includes(f.person)) return false;
    if (f.year && !(i.occurredOn ?? "").startsWith(f.year)) return false;
    if (f.family === "mine" && !isMine(i, myFamilyId)) return false;
    if (f.family === "others" && isMine(i, myFamilyId)) return false;
    return true;
  });
}

/** Years that have places, newest first. */
export function yearsOf(items: Item[]): string[] {
  return [...new Set(items.map((i) => i.occurredOn?.slice(0, 4)).filter((y): y is string => !!y))].sort().reverse();
}
