import { QueryResultRow } from "pg";
import { getDatabase } from "../database/client.js";
import type { UserRole } from "../auth/types.js";

export interface UserAuthRecord extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  employee_id: string | null;
  status: "ACTIVE" | "INACTIVE";
  employee_status: "ACTIVE" | "INACTIVE" | null;
}

/** Finds a user by email (case-insensitive) for login. */
export async function findUserByEmail(
  email: string
): Promise<UserAuthRecord | null> {
  const result = await getDatabase().query<UserAuthRecord>(
    `
      SELECT
        u.id,
        u.email,
        u.password_hash,
        u.role::text AS role,
        u.employee_id,
        u.status::text AS status,
        e.status::text AS employee_status
      FROM "user" u
      LEFT JOIN employee e ON e.id = u.employee_id
      WHERE lower(u.email) = lower($1)
      LIMIT 1
    `,
    [email]
  );

  return result.rows[0] ?? null;
}
