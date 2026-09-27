import type { FastifyInstance } from "fastify";
import { DOMParser } from "@xmldom/xmldom";
import { gpx, kml } from "@tmcw/togeojson";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { visitGeometry } from "../lib/geojson.js";
import { assertRefs, scopeOf } from "../lib/access.js";
import { recordActivity } from "../lib/activity.js";
import { badRequest } from "../lib/errors.js";

const MAX_FEATURES = 2000;

interface Feature {
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, unknown> | null;
}

function parseToFeatures(text: string, filename: string): Feature[] {
  const ext = filename.toLowerCase().split(".").pop();
  let collection: { features?: Feature[] };
  if (ext === "gpx" || ext === "kml") {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    // @tmcw/togeojson accepts a DOM Document.
    collection = (ext === "gpx" ? gpx(doc as never) : kml(doc as never)) as { features?: Feature[] };
  } else {
    collection = JSON.parse(text);
  }
  return Array.isArray(collection.features) ? collection.features : [];
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Places from a GPX/KML/GeoJSON file onto the map — optionally onto a trip (form field `tripId`).
  app.post("/api/import", async (req, reply) => {
    const scope = scopeOf(req);
    let tripId: string | null = null;
    let file: { filename: string; text: string } | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file") file = { filename: part.filename, text: (await part.toBuffer()).toString("utf8") };
      else if (part.fieldname === "tripId" && typeof part.value === "string" && part.value) tripId = part.value;
    }
    if (!file) throw badRequest("No file provided");
    await assertRefs(scope, { trip: tripId });
    const { text, filename } = file;

    let features: Feature[];
    try {
      features = parseToFeatures(text, filename);
    } catch {
      return reply.code(400).send({ error: "Could not parse file (expected GPX, KML or GeoJSON)" });
    }
    if (!features.length) return reply.code(400).send({ error: "No features found in file" });

    let imported = 0;
    let skipped = 0;
    await tx(async (client) => {
      for (const f of features.slice(0, MAX_FEATURES)) {
        const g = f.geometry;
        if (!g) {
          skipped++;
          continue;
        }
        const props = f.properties ?? {};
        const title = String(props.name ?? props.title ?? "Imported").slice(0, 200);

        let geom: { type: string; coordinates: unknown } | null = null;
        let kind = "place";
        if (g.type === "Point") {
          geom = { type: "Point", coordinates: g.coordinates };
        } else if (g.type === "LineString") {
          geom = { type: "LineString", coordinates: g.coordinates };
          kind = "drive";
        } else if (g.type === "MultiLineString") {
          // A GPX track with several segments (pauses, signal loss): keep every
          // part, joined in order, as one drive.
          const points = (g.coordinates as number[][][]).flat();
          if (points.length >= 2) {
            geom = { type: "LineString", coordinates: points };
            kind = "drive";
          }
        }
        // Out-of-range or malformed coordinates: skip the feature, don't fail the import.
        if (!geom || !visitGeometry.safeParse(geom).success) {
          skipped++;
          continue;
        }
        await client.query(
          // GPX/KML usually carry elevation; visits store 2D geometry.
          `INSERT INTO visits (family_id, trip_id, kind, title, geom, created_by)
           VALUES ($1, $2, $3, $4, ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)), $6)`,
          [scope.familyId, tripId, kind, title, JSON.stringify(geom), scope.userId],
        );
        imported++;
      }
      if (imported) {
        await recordActivity({ tripId, familyId: scope.familyId, userId: scope.userId, kind: "visit.added",
          summary: `${imported} place${imported === 1 ? "" : "s"} from ${filename}` }, client);
      }
    });

    return { imported, skipped, truncated: Math.max(0, features.length - MAX_FEATURES) };
  });
}
