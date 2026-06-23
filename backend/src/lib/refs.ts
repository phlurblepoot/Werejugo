export const CORE_TYPES = ["visit", "trip", "person", "media", "document"] as const;
export type CoreType = (typeof CORE_TYPES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EntityRef {
  type: CoreType;
  id: string;
}

/** Parse "type:uuid" into a validated ref, or null if invalid. */
export function parseRef(raw: string): EntityRef | null {
  const idx = raw.indexOf(":");
  if (idx === -1) return null;
  const type = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (!(CORE_TYPES as readonly string[]).includes(type)) return null;
  if (!UUID_RE.test(id)) return null;
  return { type: type as CoreType, id };
}

/** DB table name for a core type. */
export const TABLE_FOR: Record<CoreType, string> = {
  visit: "visits",
  trip: "trips",
  person: "people",
  media: "media",
  document: "documents",
};
