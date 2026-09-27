/** "The Smiths" — who added something that isn't my family's (shared trips). */
export function ByFamily({ name, prefix = "", title }: { name?: string | null; prefix?: string; title?: string }) {
  if (!name) return null;
  return <span className="by-family" title={title ?? `Added by ${name}`}>{prefix}{name}</span>;
}

/** The family name to show, or null when it's my family's own. */
export const otherFamily = (item: { familyId?: string | null; familyName?: string | null }, myFamilyId?: string | null) =>
  item.familyId && myFamilyId && item.familyId !== myFamilyId ? item.familyName ?? null : null;
