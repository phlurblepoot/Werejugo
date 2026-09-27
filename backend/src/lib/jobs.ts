import { PgBoss } from "pg-boss";
import { config } from "../config.js";
import { connectedFamilies, syncFamily } from "./immich/sync.js";
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
  const p: Promise<unknown> = syncFamily(familyId, { full }).catch(() => {}).finally(() => inline.delete(p));
  inline.add(p);
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
