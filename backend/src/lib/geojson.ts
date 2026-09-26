import { z } from "zod";

/** [lng, lat] (an optional elevation is accepted and dropped). */
export const position = z
  .array(z.number().finite())
  .min(2)
  .max(3)
  .refine(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90, "Coordinates are out of range")
  .transform(([lng, lat]) => [lng, lat] as [number, number]);

/** The geometries a visit can have: a spot, or a route. */
export const visitGeometry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: position }),
  z.object({ type: z.literal("LineString"), coordinates: z.array(position).min(2).max(20000) }),
]);

export const lng = z.number().finite().min(-180).max(180);
export const lat = z.number().finite().min(-90).max(90);
