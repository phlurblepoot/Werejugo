import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import * as tar from "tar";
import { requireAuth } from "../lib/auth.js";
import { config } from "../config.js";
import { BACKUP_TABLES, dumpDatabase } from "../lib/archive.js";

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
}
