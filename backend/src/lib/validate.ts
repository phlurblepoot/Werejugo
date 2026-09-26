import { z } from "zod";

/** A UUID (ids in bodies and query strings). */
export const uuid = z.string().uuid("Not a valid id");

/** A real calendar date as "YYYY-MM-DD" (rejects 2024-02-30). */
export const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2024-06-01").refine((v) => {
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}, "That date doesn't exist");

/** An optional date where "" and null both mean "no date". */
export const optionalYmd = z.preprocess((v) => (v === "" ? null : v), ymd.nullish());

/** True when both dates are set and the end is before the start. */
export const endsBeforeStart = (start: string | null | undefined, end: string | null | undefined) =>
  !!start && !!end && end < start;

/** Escape a user's text for use inside an ILIKE pattern (so % and _ are literal). */
export const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
