import { PgBoss } from "pg-boss";
import { config } from "../config.js";
import { connectedFamilies, syncFamily } from "./immich/sync.js";
import { syncFaces } from "./immich/faces.js";
import { syncAlbums } from "./immich/albums.js";
import { cleanupUploads, handOff } from "./media/uploads.js";

/**
 * Background jobs (pg-boss, in its own `pgboss` schema on the same database).
 * The server starts them; tests and scripts don't, and then `enqueue…` runs the
 * work right away in the background instead (see `settleJobs`).
 */

interface Log { info: (msg: string) => void; warn: (o: object, msg: string) => void }

const Q = {
  syncTick: "immich-sync-tick",
  reconcileTick: "immich-reconcile-tick",
  syncFamily: "immich-sync-family",
  handoff: "media-upload-handoff",
  uploadsCleanup: "media-uploads-cleanup",
} as const;

/** A hand-off to Immich is tried again this many times (30 s, 60 s, 120 s later) before the upload fails. */
const HANDOFF_RETRIES = 3;

let boss: PgBoss | null = null;
const inline = new Set<Promise<unknown>>();

export async function startJobs(log: Log): Promise<void> {
  const b = new PgBoss({ connectionString: config.databaseUrl, schema: "pgboss" });
  b.on("error", (err) => log.warn({ err: err instanceof Error ? err.message : err }, "job queue error"));
  await b.start();
  await b.createQueue(Q.syncTick, { policy: "exclusive" });
  await b.createQueue(Q.reconcileTick, { policy: "exclusive" });
  // At most one waiting and one running sync per family.
  await b.createQueue(Q.syncFamily, { policy: "stately", retryLimit: 2, retryDelay: 60 });

  await b.createQueue(Q.handoff, { retryLimit: HANDOFF_RETRIES, retryDelay: 30, retryBackoff: true, expireInSeconds: 3 * 3600 });
  await b.createQueue(Q.uploadsCleanup, { policy: "exclusive" });

  await b.schedule(Q.syncTick, "*/5 * * * *");
  await b.schedule(Q.reconcileTick, "17 3 * * *");
  await b.schedule(Q.uploadsCleanup, "41 4 * * *");

  await b.work(Q.syncTick, async () => {
    for (const familyId of await connectedFamilies()) await send(b, familyId, false);
  });
  await b.work(Q.reconcileTick, async () => {
    for (const familyId of await connectedFamilies()) await send(b, familyId, true);
  });
  await b.work<{ familyId: string; full: boolean }>(Q.syncFamily, async ([job]) => {
    const r = await syncFamily(job.data.familyId, { full: job.data.full });
    if (!r.skipped && (r.upserted || r.removed)) log.info(`Immich sync ${r.full ? "(full) " : ""}for ${r.familyId}: ${r.upserted} added/updated, ${r.removed} removed`);
    if (r.skipped) return;
    // Then the faces: who's in the photos (a problem here doesn't undo the photos).
    const f = await syncFaces(job.data.familyId, { full: job.data.full }).catch((err) => {
      log.warn({ err: err instanceof Error ? err.message : err }, "face sync failed");
      return null;
    });
    if (f && (f.tagged || f.untagged)) log.info(`Faces for ${r.familyId}: ${f.tagged} photos tagged, ${f.untagged} untagged`);
    // Then the trips' albums, both ways.
    const a = await syncAlbums(job.data.familyId, { full: job.data.full }).catch((err) => {
      log.warn({ err: err instanceof Error ? err.message : err }, "album sync failed");
      return null;
    });
    if (a && (a.created || a.added || a.removed || a.joined || a.left || a.deleted || a.errors)) {
      log.info(`Albums for ${r.familyId}: ${a.created} made, ${a.added} added, ${a.removed} removed, ${a.joined} put in trips, ${a.left} taken out, ${a.deleted} deleted, ${a.errors} failed`);
    }
  });
  await b.work<{ uploadId: string }>(Q.handoff, async ([job]) => {
    await handOff(job.data.uploadId, { finalAttempt: job.retryCount >= HANDOFF_RETRIES });
  });
  await b.work(Q.uploadsCleanup, async () => {
    const r = await cleanupUploads();
    if (r.removed || r.orphans) log.info(`Upload cleanup: ${r.removed} old uploads, ${r.orphans} stray files removed`);
  });
  boss = b;
  log.info("Background jobs started");
}

export async function stopJobs(): Promise<void> {
  await boss?.stop({ graceful: true });
  boss = null;
}

const send = (b: PgBoss, familyId: string, full: boolean) =>
  b.send(Q.syncFamily, { familyId, full }, { singletonKey: `${familyId}:${full ? "full" : "inc"}` });

/** Sync a family's library soon (full = every asset, removing what's gone). */
export async function enqueueFamilySync(familyId: string, full = false): Promise<void> {
  if (boss) {
    await send(boss, familyId, full);
    return;
  }
  const p: Promise<unknown> = syncFamily(familyId, { full })
    .then(async (r) => {
      if (r.skipped) return;
      await syncFaces(familyId, { full }).catch(() => {});
      await syncAlbums(familyId, { full });
    })
    .catch(() => {}).finally(() => inline.delete(p));
  inline.add(p);
}

const albumsAsked = new Set<string>();
/**
 * Bring these families' trip albums up to date straight away, after something
 * in Werejugo changed a photo's trip or a trip. Asks already waiting are merged;
 * one that's missed is caught by the next sync (the triggers mark the albums).
 */
export function enqueueAlbumSync(...familyIds: Array<string | null | undefined>): void {
  for (const familyId of new Set(familyIds)) {
    if (!familyId || albumsAsked.has(familyId)) continue;
    albumsAsked.add(familyId);
    const p: Promise<unknown> = syncAlbums(familyId, { onStart: () => albumsAsked.delete(familyId) })
      .catch(() => {}).finally(() => inline.delete(p));
    inline.add(p);
  }
}

/** Hand a fully received upload to Immich soon. */
export async function enqueueHandoff(uploadId: string): Promise<void> {
  if (boss) {
    await boss.send(Q.handoff, { uploadId });
    return;
  }
  const p: Promise<unknown> = handOff(uploadId, { finalAttempt: true }).catch(() => {}).finally(() => inline.delete(p));
  inline.add(p);
}

/** Tests: wait for work started without the queue. */
export async function settleJobs(): Promise<void> {
  while (inline.size) await Promise.allSettled([...inline]);
}
