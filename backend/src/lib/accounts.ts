import type pg from "pg";
import { hashPassword, type Role } from "./auth.js";

export interface UserRow {
  id: string;
  family_id: string;
  email: string;
  display_name: string;
  role: Role;
  color: string;
  is_admin: boolean;
  token_version: number;
}

export const USER_COLUMNS = "id, family_id, email, display_name, role, color, is_admin, token_version";

export class EmailTakenError extends Error {
  constructor() { super("Email already registered"); }
}

/** Same palette as the web app's avatars, so new people don't all look alike. */
export const PERSON_COLORS = ["#0f766e", "#b45309", "#7c3aed", "#be185d", "#1d4ed8", "#15803d", "#c2410c", "#0e7490"];

/** Create a user in a family. Throws EmailTakenError if the email is in use. */
export async function createUser(
  client: pg.PoolClient,
  u: {
    familyId: string; email: string; displayName: string; password: string; role: Role; isAdmin?: boolean;
    /** They get a session straight away (setup, accepting an invite). */
    signedIn?: boolean;
  },
): Promise<UserRow> {
  const email = u.email.trim().toLowerCase();
  const taken = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
  if (taken.rowCount) throw new EmailTakenError();
  const hash = await hashPassword(u.password);
  // The first colour nobody in the family has yet (or round-robin once all are used).
  const used = (await client.query<{ color: string }>("SELECT color FROM users WHERE family_id = $1", [u.familyId])).rows.map((r) => r.color);
  const color = PERSON_COLORS.find((c) => !used.includes(c)) ?? PERSON_COLORS[used.length % PERSON_COLORS.length];
  const { rows } = await client.query<UserRow>(
    `INSERT INTO users (family_id, email, display_name, password_hash, role, is_admin, color, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() END) RETURNING ${USER_COLUMNS}`,
    [u.familyId, email, u.displayName.trim(), hash, u.role, u.isAdmin ?? false, color, u.signedIn ?? false],
  );
  return rows[0];
}

/** Create a family with its first owner. */
export async function createFamilyWithOwner(
  client: pg.PoolClient,
  f: { familyName: string; displayName: string; email: string; password: string; isAdmin?: boolean; signedIn?: boolean },
): Promise<UserRow> {
  const fam = await client.query<{ id: string }>("INSERT INTO families (name) VALUES ($1) RETURNING id", [f.familyName.trim()]);
  const user = await createUser(client, {
    familyId: fam.rows[0].id, email: f.email, displayName: f.displayName, password: f.password, role: "owner", isAdmin: f.isAdmin,
    signedIn: f.signedIn,
  });
  return user;
}

export function publicUser(u: Pick<UserRow, "id" | "family_id" | "email" | "display_name" | "role" | "color" | "is_admin">) {
  return {
    id: u.id,
    familyId: u.family_id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    color: u.color,
    isAdmin: u.is_admin,
  };
}
