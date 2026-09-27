import { expect, test } from "vitest";
import { isOnMount, parseMountPoints } from "./storage-check.js";

// Trimmed /proc/self/mountinfo from a container with /app/storage mounted.
const MOUNTINFO = [
  "561 489 0:52 / / rw,relatime master:245 - overlay overlay rw,lowerdir=/x",
  "562 561 0:55 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw",
  "580 561 8:1 /var/lib/docker/volumes/werejugo_storage/_data /app/storage rw,relatime - ext4 /dev/sda1 rw",
  "581 561 8:1 /var/lib/docker/containers/abc/hosts /etc/hosts rw,relatime - ext4 /dev/sda1 rw",
  "582 561 8:1 /mnt/user/appdata/with\\040space /app/with\\040space rw - ext4 /dev/sda1 rw",
].join("\n");

test("parses mount points, decoding octal escapes", () => {
  expect(parseMountPoints(MOUNTINFO)).toEqual(["/", "/proc", "/app/storage", "/etc/hosts", "/app/with space"]);
});

test("a mounted directory (or anything below it) is on a mount", () => {
  const mounts = parseMountPoints(MOUNTINFO);
  expect(isOnMount("/app/storage", mounts)).toBe(true);
  expect(isOnMount("/app/storage/trips", mounts)).toBe(true);
  expect(isOnMount("/app/with space/x", mounts)).toBe(true);
});

test("the container root filesystem does not count as a mount", () => {
  const mounts = parseMountPoints(MOUNTINFO);
  expect(isOnMount("/app/uploads", mounts)).toBe(false);
  expect(isOnMount("/app/storage-old", mounts)).toBe(false);
});
