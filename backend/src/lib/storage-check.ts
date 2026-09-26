import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Mount points listed in /proc/self/mountinfo (field 5, octal escapes decoded). */
export function parseMountPoints(mountinfo: string): string[] {
  return mountinfo
    .split("\n")
    .map((line) => line.split(" ")[4])
    .filter((p): p is string => Boolean(p))
    .map((p) => p.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8))));
}

/** True when `path` is a mount point other than `/`, or lies below one. */
export function isOnMount(path: string, mounts: string[]): boolean {
  const target = resolve(path);
  return mounts.some((m) => m !== "/" && (target === m || target.startsWith(`${m}/`)));
}

/**
 * In a production container, warn loudly for each data directory that is not a
 * mounted volume: its files live in the container layer and are lost when the
 * container is recreated (e.g. on an Unraid update).
 */
export function ephemeralDataDirs(dirs: Array<{ name: string; path: string }>): string[] {
  if (process.env.NODE_ENV !== "production" || !existsSync("/.dockerenv")) return [];
  let mounts: string[];
  try {
    mounts = parseMountPoints(readFileSync("/proc/self/mountinfo", "utf8"));
  } catch {
    return [];
  }
  return dirs
    .filter((d) => !isOnMount(d.path, mounts))
    .map((d) => `${d.name} (${d.path}) is not a mounted volume — files written there are LOST when the container is recreated. Map it to a host path or Docker volume.`);
}
