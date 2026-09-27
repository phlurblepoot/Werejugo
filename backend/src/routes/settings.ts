import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAuth, requireOwner } from "../lib/auth.js";
import { badRequest, notFound } from "../lib/errors.js";

const KINDS = ["place", "food", "stay", "flight", "cruise", "drive", "custom"] as const;
const PATH_STYLES = [
  "solid", "dashed", "dotted", "arrows", "chevrons", "waves", "tire", "hearts", "stars", "paws", "palms",
  "planes", "anchors", "suns", "flowers", "balloons", "footprints", "image",
] as const;

const colour = z.string().max(40);
const pinStyle = z.object({
  color: colour.optional(),
  icon: z.string().max(300).optional(),
  size: z.number().min(8).max(96).optional(),
  shape: z.enum(["circle", "square", "rounded", "none"]).optional(),
  borderWidth: z.number().min(0).max(16).optional(),
  borderColor: colour.optional(),
}).strict();
const pathStyle = z.object({
  style: z.enum(PATH_STYLES).optional(),
  color: colour.optional(),
  width: z.number().min(1).max(40).optional(),
  imageUrl: z.string().max(500).optional(),
}).strict();
const byKind = <T extends z.ZodTypeAny>(s: T) => z.object(Object.fromEntries(KINDS.map((k) => [k, s.optional()])) as Record<(typeof KINDS)[number], z.ZodOptional<T>>).strict();

/** The family's map look (defaults for pins and trails, by kind and cruise line; the base map), checked. */
const settingsSchema = z.object({
  pin: z.object({ default: pinStyle.optional(), byKind: byKind(pinStyle).optional(), byLine: z.record(z.string().max(120), pinStyle).optional() }).strict().optional(),
  path: z.object({ default: pathStyle.optional(), byKind: byKind(pathStyle).optional(), byLine: z.record(z.string().max(120), pathStyle).optional() }).strict().optional(),
  map: z.object({ styleUrl: z.string().max(500).regex(/^(https?:\/\/|$)/, "The map style must be a web address").nullish() }).passthrough().optional(),
}).passthrough();

/** Per-family settings: the map's look. Everyone in the family reads them; owners change them. */
export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/settings", async (req) => {
    const { rows } = await query<{ settings: unknown }>("SELECT settings FROM families WHERE id = $1", [req.user.familyId]);
    return rows[0]?.settings ?? {};
  });

  app.put("/api/settings", { preHandler: requireOwner }, async (req) => {
    if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) throw badRequest("Settings must be a JSON object");
    const settings = settingsSchema.parse(req.body);
    const json = JSON.stringify(settings);
    if (json.length > 50_000) throw badRequest("Settings too large");
    const { rows } = await query<{ settings: unknown }>("UPDATE families SET settings = $2 WHERE id = $1 RETURNING settings", [req.user.familyId, json]);
    if (!rows[0]) throw notFound("Family not found");
    return rows[0].settings;
  });
}
