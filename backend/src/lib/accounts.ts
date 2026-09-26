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

/** Create a user in a family. Throws EmailTakenError if the email is in use. */
export async function createUser(
  client: pg.PoolClient,
  u: { familyId: string; email: string; displayName: string; password: string; role: Role; isAdmin?: boolean },
): Promise<UserRow> {
  const email = u.email.trim().toLowerCase();
  const taken = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
  if (taken.rowCount) throw new EmailTakenError();
  const hash = await hashPassword(u.password);
  const { rows } = await client.query<UserRow>(
    `INSERT INTO users (family_id, email, display_name, password_hash, role, is_admin)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${USER_COLUMNS}`,
    [u.familyId, email, u.displayName.trim(), hash, u.role, u.isAdmin ?? false],
  );
  return rows[0];
}

/** Create a family with its first owner (and the starter map set it expects). */
export async function createFamilyWithOwner(
  client: pg.PoolClient,
  f: { familyName: string; displayName: string; email: string; password: string; isAdmin?: boolean },
): Promise<UserRow> {
  const fam = await client.query<{ id: string }>("INSERT INTO families (name) VALUES ($1) RETURNING id", [f.familyName.trim()]);
  const user = await createUser(client, {
    familyId: fam.rows[0].id, email: f.email, displayName: f.displayName, password: f.password, role: "owner", isAdmin: f.isAdmin,
  });
  await client.query(
    "INSERT INTO map_sets (family_id, name, description, created_by) VALUES ($1, 'Our Map', 'Where we have been', $2)",
    [fam.rows[0].id, user.id],
  );
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
