/** Immich versions Werejugo is built and tested against (contract tests run 3.2.2). */
export const MIN_SUPPORTED = { major: 3, minor: 2 } as const;
export const BELOW_MAJOR = 4;
export const SUPPORTED_RANGE = `${MIN_SUPPORTED.major}.${MIN_SUPPORTED.minor} or newer, before ${BELOW_MAJOR}.0`;

export interface ImmichVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string | number | null;
}

export function isSupported(v: ImmichVersion): boolean {
  if (v.major >= BELOW_MAJOR) return false;
  if (v.major !== MIN_SUPPORTED.major) return v.major > MIN_SUPPORTED.major;
  return v.minor >= MIN_SUPPORTED.minor;
}

export function formatVersion(v: ImmichVersion): string {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease ? `-${v.prerelease}` : ""}`;
}
