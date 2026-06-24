import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile, cp, mkdir, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import * as tar from "tar";
import { requireAuth } from "../lib/auth.js";
import { config } from "../config.js";
import { BACKUP_TABLES, dumpDatabase } from "../lib/archive.js";
import { tx } from "../db/pool.js";
import { restoreDatabase } from "../lib/archive.js";

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/backup", { preHandler: requireAuth }, async (req, reply) => {
    const stage = await mkdtemp(join(tmpdir(), "wj-backup-"));
    const db = await dumpDatabase();
    await writeFile(join(stage, "db.json"), JSON.stringify(db));
    await writeFile(join(stage, "manifest.json"), JSON.stringify({
      version: 1,
      app: "werejugo",
      createdAt: new Date().toISOString(),
      tables: BACKUP_TABLES,
      counts: Object.fromEntries(BACKUP_TABLES.map((t) => [t, db[t].length])),
    }));
    // include the storage tree as storage/ (copy so we can tar from one cwd)
    await mkdir(join(stage, "storage"), { recursive: true });
    await cp(config.storageDir, join(stage, "storage"), { recursive: true });

    const archive = join(stage, "werejugo-backup.tar.gz");
    await tar.c({ gzip: true, file: archive, cwd: stage }, ["db.json", "manifest.json", "storage"]);

    reply.header("Content-Type", "application/gzip");
    reply.header("Content-Disposition", `attachment; filename="werejugo-backup.tar.gz"`);
    const stream = createReadStream(archive);
    stream.on("close", () => { void rm(stage, { recursive: true, force: true }); });
    return reply.send(stream);
  });

  app.post("/api/restore", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.role !== "owner") return reply.code(403).send({ error: "Only an owner can restore a backup" });

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

      let manifest: any;
      let db: Record<string, unknown[]>;
      try {
        manifest = JSON.parse(await readFile(join(work, "manifest.json"), "utf8"));
        db = JSON.parse(await readFile(join(work, "db.json"), "utf8"));
      } catch {
        return reply.code(400).send({ error: "Archive is missing db.json or manifest.json" });
      }
      if (manifest?.app !== "werejugo" || !Array.isArray(manifest.tables)) {
        return reply.code(400).send({ error: "Unrecognized backup archive" });
      }

      const counts = await tx((client) => restoreDatabase(client, db));

      // replace the storage tree
      await rm(config.storageDir, { recursive: true, force: true });
      await mkdir(config.storageDir, { recursive: true });
      await cp(join(work, "storage"), config.storageDir, { recursive: true });

      return { ok: true, counts };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}
