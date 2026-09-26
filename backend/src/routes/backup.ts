import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile, cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import * as tar from "tar";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { config } from "../config.js";
import { BACKUP_TABLES, dumpDatabase, restoreDatabase } from "../lib/archive.js";
import { tx } from "../db/pool.js";

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Replace everything inside `dest` with the contents of `src`, keeping `dest`
 *  itself — in Docker it is a volume mount point and can't be removed. */
async function replaceContents(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(dest)) await rm(join(dest, entry), { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
}

/** Everything wrong with an extracted archive, checked before anything is touched. */
async function archiveProblem(work: string): Promise<{ error: string } | { db: Record<string, unknown[]> }> {
  let manifest: { app?: unknown; tables?: unknown };
  let db: unknown;
  try {
    manifest = JSON.parse(await readFile(join(work, "manifest.json"), "utf8"));
    db = JSON.parse(await readFile(join(work, "db.json"), "utf8"));
  } catch {
    return { error: "Archive is missing db.json or manifest.json" };
  }
  if (manifest?.app !== "werejugo" || !Array.isArray(manifest.tables)) return { error: "Unrecognized backup archive" };
  if (!db || typeof db !== "object" || Array.isArray(db)) return { error: "db.json is not a table dump" };
  const known = new Set<string>(BACKUP_TABLES);
  for (const [table, rows] of Object.entries(db)) {
    if (!known.has(table)) return { error: `Archive contains an unknown table: ${table}` };
    if (!Array.isArray(rows)) return { error: `Table ${table} is not a list of rows` };
  }
  if (!(await isDir(join(work, "storage")))) return { error: "Archive is missing its storage/ folder" };
  return { db: db as Record<string, unknown[]> };
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  // A backup holds every family on the server, so only server admins may make or restore one.
  const guard = { preHandler: [requireAuth, requireAdmin] };

  app.get("/api/backup", guard, async (req, reply) => {
    await audit({ actorId: req.user.id, action: "backup.downloaded" });
    const stage = await mkdtemp(join(tmpdir(), "wj-backup-"));
    const db = await dumpDatabase();
    await writeFile(join(stage, "db.json"), JSON.stringify(db));
    await writeFile(join(stage, "manifest.json"), JSON.stringify({
      version: 2,
      app: "werejugo",
      createdAt: new Date().toISOString(),
      tables: BACKUP_TABLES,
      counts: Object.fromEntries(BACKUP_TABLES.map((t) => [t, db[t].length])),
      files: ["storage", "uploads"],
    }));
    // storage/: photos, videos, documents. uploads/: custom pin icons, map overlays.
    await mkdir(join(stage, "storage"), { recursive: true });
    await cp(config.storageDir, join(stage, "storage"), { recursive: true });
    await mkdir(join(stage, "uploads"), { recursive: true });
    if (await isDir(config.uploadsDir)) await cp(config.uploadsDir, join(stage, "uploads"), { recursive: true });

    const archive = join(stage, "werejugo-backup.tar.gz");
    await tar.c({ gzip: true, file: archive, cwd: stage }, ["db.json", "manifest.json", "storage", "uploads"]);

    reply.header("Content-Type", "application/gzip");
    reply.header("Content-Disposition", `attachment; filename="werejugo-backup.tar.gz"`);
    const stream = createReadStream(archive);
    stream.on("close", () => { void rm(stage, { recursive: true, force: true }); });
    return reply.send(stream);
  });

  app.post("/api/restore", guard, async (req, reply) => {
    const data = await req.file({ limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: "No archive uploaded" });

    const work = await mkdtemp(join(tmpdir(), "wj-restore-"));
    try {
      const tgz = join(work, "upload.tar.gz");
      await pipeline(data.file, createWriteStream(tgz));
      try {
        await tar.x({ file: tgz, cwd: work });
      } catch {
        return reply.code(400).send({ error: "Archive is not a valid .tar.gz" });
      }

      // Validate everything before touching the database or files.
      const checked = await archiveProblem(work);
      if ("error" in checked) return reply.code(400).send({ error: checked.error });

      const counts = await tx((client) => restoreDatabase(client, checked.db));
      await replaceContents(join(work, "storage"), config.storageDir);
      // Archives made before uploads were included simply leave UPLOADS_DIR as is.
      if (await isDir(join(work, "uploads"))) await replaceContents(join(work, "uploads"), config.uploadsDir);
      // The audit log itself was replaced; record the restore in the new one.
      await audit({ actorId: null, action: "backup.restored", details: { by: req.user.id, counts } });

      return { ok: true, counts };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}
