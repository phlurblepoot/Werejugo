import type { FastifyInstance } from "fastify";
import { DOMParser } from "@xmldom/xmldom";
import { gpx, kml } from "@tmcw/togeojson";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const MAX_FEATURES = 2000;

async function ownsMapSet(familyId: string, mapSetId: string): Promise<boolean> {
  const { rowCount } = await query("SELECT 1 FROM map_sets WHERE id = $1 AND family_id = $2", [
    mapSetId,
    familyId,
  ]);
  return Boolean(rowCount);
}

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

  app.post("/api/map-sets/:mapSetId/import", async (req, reply) => {
    const mapSetId = (req.params as { mapSetId: string }).mapSetId;
    if (!(await ownsMapSet(req.user.familyId, mapSetId))) {
      return reply.code(404).send({ error: "Map set not found" });
    }
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "No file provided" });
    const text = (await part.toBuffer()).toString("utf8");

    let features: Feature[];
    try {
      features = parseToFeatures(text, part.filename);
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
          const lines = g.coordinates as number[][][];
          if (lines[0]) {
            geom = { type: "LineString", coordinates: lines[0] };
            kind = "drive";
          }
        }
        if (!geom) {
          skipped++;
          continue;
        }
        await client.query(
          `INSERT INTO items (map_set_id, kind, title, geom, created_by)
           VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5)`,
          [mapSetId, kind, title, JSON.stringify(geom), req.user.id],
        );
        imported++;
      }
    });

    return { imported, skipped };
  });
}
