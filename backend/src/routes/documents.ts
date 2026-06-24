import { Readable } from "node:stream";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { signFileUrl } from "../lib/filesign.js";
import { documentDirFor, saveDocumentUpload } from "../lib/storage.js";

interface DocRow {
  id: string; title: string; doc_type: string;
  owner_person_id: string | null; owner_trip_id: string | null;
  owner_person_name: string | null; owner_trip_name: string | null;
  issued_on: string | null; expires_on: string | null; reminder_lead_days: number;
  notes: string; rel_path: string | null; original_name: string; created_at: string;
  status: string; days_until: number | null;
}

function toDto(r: DocRow) {
  return {
    id: r.id, title: r.title, docType: r.doc_type,
    ownerPersonId: r.owner_person_id, ownerPersonName: r.owner_person_name,
    ownerTripId: r.owner_trip_id, ownerTripName: r.owner_trip_name,
    issuedOn: r.issued_on, expiresOn: r.expires_on, reminderLeadDays: r.reminder_lead_days,
    notes: r.notes, fileUrl: r.rel_path ? signFileUrl(r.rel_path) : null, originalName: r.original_name,
    createdAt: r.created_at, status: r.status, daysUntilExpiry: r.days_until,
  };
}

// The shared SELECT with owner joins + computed status. Append a WHERE.
const SELECT = `
  SELECT d.id, d.title, d.doc_type, d.owner_person_id, d.owner_trip_id,
         p.display_name AS owner_person_name, t.name AS owner_trip_name,
         to_char(d.issued_on,'YYYY-MM-DD') AS issued_on,
         to_char(d.expires_on,'YYYY-MM-DD') AS expires_on,
         d.reminder_lead_days, d.notes, d.rel_path, d.original_name, d.created_at,
         CASE WHEN d.expires_on IS NULL THEN 'none'
              WHEN d.expires_on < CURRENT_DATE THEN 'overdue'
              WHEN d.expires_on <= CURRENT_DATE + make_interval(days => d.reminder_lead_days) THEN 'upcoming'
              ELSE 'ok' END AS status,
         (d.expires_on - CURRENT_DATE) AS days_until
  FROM documents d
  LEFT JOIN people p ON p.id = d.owner_person_id
  LEFT JOIN trips t ON t.id = d.owner_trip_id`;

async function loadDoc(familyId: string, id: string): Promise<DocRow | null> {
  const { rows } = await query<DocRow>(`${SELECT} WHERE d.family_id = $1 AND d.id = $2`, [familyId, id]);
  return rows[0] ?? null;
}

const fieldsSchema = z.object({
  title: z.string().min(1).max(200),
  docType: z.enum(["passport", "visa", "booking", "insurance", "other"]),
  ownerPersonId: z.string().uuid().nullish(),
  ownerTripId: z.string().uuid().nullish(),
  issuedOn: z.string().nullish(),
  expiresOn: z.string().nullish(),
  reminderLeadDays: z.coerce.number().int().min(0).max(3650).optional(),
  notes: z.string().max(4000).optional(),
});

/** Validate the owner is one-of and belongs to the family; return its storage dir. */
async function ownerDir(familyId: string, personId?: string | null, tripId?: string | null):
  Promise<{ ok: true; dir: string } | { ok: false; error: string }> {
  if (personId && tripId) return { ok: false, error: "A document has at most one owner" };
  if (personId) {
    const p = await query<{ display_name: string }>("SELECT display_name FROM people WHERE id = $1 AND family_id = $2", [personId, familyId]);
    if (!p.rows[0]) return { ok: false, error: "Person not found" };
    return { ok: true, dir: documentDirFor(null, { personName: p.rows[0].display_name }) };
  }
  if (tripId) {
    const t = await query<{ name: string; start: string | null }>("SELECT name, to_char(start_date,'YYYY-MM-DD') AS start FROM trips WHERE id = $1 AND family_id = $2", [tripId, familyId]);
    if (!t.rows[0]) return { ok: false, error: "Trip not found" };
    return { ok: true, dir: documentDirFor({ tripName: t.rows[0].name, tripStart: t.rows[0].start }, null) };
  }
  return { ok: true, dir: documentDirFor(null, null) };
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/documents", async (req, reply) => {
    // Accept either JSON (no file) or multipart (with file). Collect fields + optional file.
    let body: Record<string, string> = {};
    let saved: { relPath: string; originalName: string } | null = null;
    let pendingFile: { filename: string; buf: Buffer } | null = null;

    if (req.isMultipart()) {
      // Buffer the file in-loop (consuming its stream) while collecting fields —
      // a deferred read would hang/destroy the part once the iterator advances.
      for await (const part of req.parts()) {
        if (part.type === "file") pendingFile = { filename: part.filename, buf: await part.toBuffer() };
        else if (typeof part.value === "string") body[part.fieldname] = part.value;
      }
    } else {
      body = (req.body ?? {}) as Record<string, string>;
    }

    const parsed = fieldsSchema.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const dir = await ownerDir(req.user.familyId, b.ownerPersonId, b.ownerTripId);
    if (!dir.ok) return reply.code(dir.error.includes("one owner") ? 400 : 404).send({ error: dir.error });

    if (pendingFile) {
      try {
        saved = await saveDocumentUpload({ filename: pendingFile.filename, file: Readable.from(pendingFile.buf) }, dir.dir);
      } catch {
        return reply.code(400).send({ error: "Unsupported file type" });
      }
    }

    const ins = await query<{ id: string }>(
      `INSERT INTO documents (family_id, title, doc_type, owner_person_id, owner_trip_id,
        issued_on, expires_on, reminder_lead_days, notes, rel_path, original_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [req.user.familyId, b.title, b.docType, b.ownerPersonId ?? null, b.ownerTripId ?? null,
       b.issuedOn || null, b.expiresOn || null, b.reminderLeadDays ?? 30, b.notes ?? "",
       saved?.relPath ?? null, saved?.originalName ?? "", req.user.id],
    );
    const row = await loadDoc(req.user.familyId, ins.rows[0].id);
    return reply.code(201).send(toDto(row!));
  });

  app.get("/api/documents/:id", async (req, reply) => {
    const row = await loadDoc(req.user.familyId, (req.params as { id: string }).id);
    if (!row) return reply.code(404).send({ error: "Not found" });
    return toDto(row);
  });
}
