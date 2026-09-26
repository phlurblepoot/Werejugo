import { Readable } from "node:stream";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { assertRefs, loadEditable, scopeOf, type Scope } from "../lib/access.js";
import { badRequest, notFound } from "../lib/errors.js";
import { signFileUrl } from "../lib/filesign.js";
import { documentDirFor, saveDocumentUpload, deleteStored } from "../lib/storage.js";
import { reconcileDocument } from "../lib/reconcile.js";
import { likeEscape, optionalYmd, uuid } from "../lib/validate.js";

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
  LEFT JOIN people p ON p.id = d.owner_person_id AND p.family_id = d.family_id
  LEFT JOIN trips t ON t.id = d.owner_trip_id`;

async function loadDoc(familyId: string, id: string): Promise<DocRow> {
  const { rows } = await query<DocRow>(`${SELECT} WHERE d.family_id = $1 AND d.id = $2`, [familyId, id]);
  if (!rows[0]) throw notFound("Document not found");
  return rows[0];
}

const fieldsSchema = z.object({
  title: z.string().min(1).max(200),
  docType: z.enum(["passport", "visa", "booking", "insurance", "other"]),
  ownerPersonId: z.preprocess((v) => (v === "" ? null : v), uuid.nullish()),
  ownerTripId: z.preprocess((v) => (v === "" ? null : v), uuid.nullish()),
  issuedOn: optionalYmd,
  expiresOn: optionalYmd,
  reminderLeadDays: z.coerce.number().int().min(0).max(3650).optional(),
  notes: z.string().max(4000).optional(),
});

const TWO_OWNERS = "A document belongs to one person or one trip, not both";

/**
 * The owners a document will have after this change: setting one kind of
 * owner clears the other, so a document can never end up with two.
 */
function mergedOwners(
  current: { person: string | null; trip: string | null },
  b: { ownerPersonId?: string | null; ownerTripId?: string | null },
): { person: string | null; trip: string | null } {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  if (b.ownerPersonId && b.ownerTripId) throw badRequest(TWO_OWNERS);
  if (b.ownerPersonId) return { person: b.ownerPersonId, trip: null };
  if (b.ownerTripId) return { person: null, trip: b.ownerTripId };
  return { person: has("ownerPersonId") ? null : current.person, trip: has("ownerTripId") ? null : current.trip };
}

/** The storage folder for a document with these (already checked) owners. */
async function ownerDir(scope: Scope, owners: { person: string | null; trip: string | null }): Promise<string> {
  if (owners.person) {
    const p = await query<{ display_name: string }>("SELECT display_name FROM people WHERE id = $1 AND family_id = $2", [owners.person, scope.familyId]);
    return documentDirFor(scope.familyId, null, { personName: p.rows[0].display_name });
  }
  if (owners.trip) {
    const t = await query<{ name: string; start: string | null }>(
      // Checked by assertRefs already: ours, or a trip shared with us (our booking for it stays private).
      "SELECT name, to_char(start_date,'YYYY-MM-DD') AS start FROM trips WHERE id = $1", [owners.trip]);
    return documentDirFor(scope.familyId, { tripName: t.rows[0].name, tripStart: t.rows[0].start }, null);
  }
  return documentDirFor(scope.familyId, null, null);
}

async function saveOrReject(filename: string, file: NodeJS.ReadableStream, dir: string) {
  try {
    return await saveDocumentUpload({ filename, file }, dir);
  } catch (err) {
    if (err instanceof Error && err.message === "UNSUPPORTED_TYPE") throw badRequest("Unsupported file type");
    throw err;
  }
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/documents", async (req, reply) => {
    // Accept either JSON (no file) or multipart (with file). Collect fields + optional file.
    let body: Record<string, string> = {};
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

    const scope = scopeOf(req);
    const b = fieldsSchema.parse(body);
    const owners = mergedOwners({ person: null, trip: null }, b);
    // A document is private: its person is ours; its trip may be one shared with us.
    await assertRefs(scope, { person: owners.person }, { mode: "own" });
    await assertRefs(scope, { trip: owners.trip });
    const saved = pendingFile
      ? await saveOrReject(pendingFile.filename, Readable.from(pendingFile.buf), await ownerDir(scope, owners))
      : null;

    let id: string;
    try {
      const ins = await query<{ id: string }>(
        `INSERT INTO documents (family_id, title, doc_type, owner_person_id, owner_trip_id,
          issued_on, expires_on, reminder_lead_days, notes, rel_path, original_name, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [scope.familyId, b.title, b.docType, owners.person, owners.trip,
         b.issuedOn ?? null, b.expiresOn ?? null, b.reminderLeadDays ?? 30, b.notes ?? "",
         saved?.relPath ?? null, saved?.originalName ?? "", scope.userId],
      );
      id = ins.rows[0].id;
    } catch (err) {
      // Don't leave the uploaded file behind if the row couldn't be saved.
      await deleteStored(saved?.relPath ?? null);
      throw err;
    }
    return reply.code(201).send(toDto(await loadDoc(scope.familyId, id)));
  });

  app.get("/api/documents/due-count", async (req) => {
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM documents
       WHERE family_id = $1 AND expires_on IS NOT NULL
         AND expires_on <= CURRENT_DATE + make_interval(days => reminder_lead_days)`,
      [req.user.familyId]);
    return { count: Number(rows[0].count) };
  });

  app.get("/api/documents", async (req) => {
    const q = z.object({
      docType: z.string().max(40).optional(),
      q: z.string().max(200).optional(),
      owner: z.string().regex(/^(person|trip):[0-9a-f-]{36}$/i, "Use person:<id> or trip:<id>").optional(),
      due: z.string().optional(),
    }).parse(req.query);
    const where: string[] = ["d.family_id = $1"];
    const params: unknown[] = [req.user.familyId];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (q.docType) where.push(`d.doc_type = ${add(q.docType)}`);
    if (q.q) where.push(`d.title ILIKE ${add(`%${likeEscape(q.q)}%`)}`);
    if (q.owner) {
      const [kind, id] = q.owner.split(":");
      uuid.parse(id);
      where.push(kind === "person" ? `d.owner_person_id = ${add(id)}` : `d.owner_trip_id = ${add(id)}`);
    }
    if (q.due === "1") where.push(`d.expires_on IS NOT NULL AND d.expires_on <= CURRENT_DATE + make_interval(days => d.reminder_lead_days)`);

    const { rows } = await query<DocRow>(
      `${SELECT} WHERE ${where.join(" AND ")} ORDER BY d.expires_on ASC NULLS LAST, d.created_at DESC`,
      params);
    return rows.map(toDto);
  });

  app.get("/api/documents/:id", async (req) => toDto(await loadDoc(req.user.familyId, (req.params as { id: string }).id)));

  const patchSchema = fieldsSchema.partial();

  app.patch("/api/documents/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    const existing = await loadDoc(scope.familyId, id);
    const b = patchSchema.parse(req.body);
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    const ownersChange = has("ownerPersonId") || has("ownerTripId");
    const owners = mergedOwners({ person: existing.owner_person_id, trip: existing.owner_trip_id }, b);
    await assertRefs(scope, { person: owners.person }, { mode: "own" });
    await assertRefs(scope, { trip: owners.trip });

    await tx(async (client) => {
      await client.query(
        `UPDATE documents SET
           title = COALESCE($3, title), doc_type = COALESCE($4, doc_type),
           owner_person_id = $5, owner_trip_id = $6,
           issued_on  = CASE WHEN $7::boolean THEN $8 ELSE issued_on END,
           expires_on = CASE WHEN $9::boolean THEN $10 ELSE expires_on END,
           reminder_lead_days = COALESCE($11, reminder_lead_days),
           notes = COALESCE($12, notes)
         WHERE id = $1 AND family_id = $2`,
        [id, scope.familyId, b.title ?? null, b.docType ?? null, owners.person, owners.trip,
         has("issuedOn"), b.issuedOn ?? null, has("expiresOn"), b.expiresOn ?? null,
         b.reminderLeadDays ?? null, b.notes ?? null]);
      if (ownersChange) await reconcileDocument(client, id);
    });
    return toDto(await loadDoc(scope.familyId, id));
  });

  app.post("/api/documents/:id/file", async (req) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    const existing = await loadDoc(scope.familyId, id);
    const part = await req.file();
    if (!part) throw badRequest("No file provided");
    const dir = await ownerDir(scope, { person: existing.owner_person_id, trip: existing.owner_trip_id });
    const saved = await saveOrReject(part.filename, part.file, dir);
    const { rowCount } = await query(
      "UPDATE documents SET rel_path = $1, original_name = $2 WHERE id = $3 AND family_id = $4",
      [saved.relPath, saved.originalName, id, scope.familyId]);
    if (!rowCount) {
      await deleteStored(saved.relPath);
      throw notFound("Document not found");
    }
    // Only now that the new file is recorded, remove the old one.
    await deleteStored(existing.rel_path);
    return toDto(await loadDoc(scope.familyId, id));
  });

  app.delete("/api/documents/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    const existing = await loadEditable<{ rel_path: string | null }>("document", id, scope);
    await query("DELETE FROM documents WHERE id = $1 AND family_id = $2", [id, scope.familyId]);
    await deleteStored(existing.rel_path);
    return reply.code(204).send();
  });
}
