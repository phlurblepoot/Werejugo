import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encrypts secrets Werejugo has to store (Immich API keys now, document files
 * in 3.3) with AES-256-GCM under a key derived from ENCRYPTION_KEY. Sealed
 * values look like `v1:<base64 iv|tag|ciphertext>`; a wrong key or any change
 * to the value makes `open` throw SecretUnreadable.
 */
export class SecretUnreadable extends Error {
  constructor() {
    super("A stored secret can't be read: ENCRYPTION_KEY has changed or the value was altered");
  }
}

const PLACEHOLDERS = new Set(["change-me", "changeme", "change-me-in-production", "secret"]);
const MIN_LENGTH = 32;
const HOW = "Generate one with: openssl rand -hex 32";

/** Why this ENCRYPTION_KEY can't be used, or null if it can. */
export function encryptionKeyProblem(value: string | undefined): string | null {
  if (!value) return `ENCRYPTION_KEY is not set. ${HOW}`;
  if (PLACEHOLDERS.has(value)) return `ENCRYPTION_KEY is still a placeholder value. ${HOW}`;
  if (value.length < MIN_LENGTH) return `ENCRYPTION_KEY must be at least ${MIN_LENGTH} characters. ${HOW}`;
  return null;
}

export interface SecretBox {
  /** A usable ENCRYPTION_KEY is configured. */
  ready: boolean;
  /** Why not, when it isn't. */
  problem: string | null;
  seal(plain: string): string;
  open(sealed: string): string;
}

export function createSecretBox(encryptionKey: string | undefined): SecretBox {
  const problem = encryptionKeyProblem(encryptionKey);
  const key = problem
    ? null
    : Buffer.from(hkdfSync("sha256", encryptionKey!, "werejugo", "secretbox-v1", 32));
  const need = () => {
    if (!key) throw new Error(problem!);
    return key;
  };
  return {
    ready: !problem,
    problem,
    seal(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", need(), iv);
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
    },
    open(sealed) {
      const k = need();
      if (!sealed.startsWith("v1:")) throw new SecretUnreadable();
      const raw = Buffer.from(sealed.slice(3), "base64");
      if (raw.length < 29) throw new SecretUnreadable();
      try {
        const decipher = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
      } catch {
        throw new SecretUnreadable();
      }
    },
  };
}
