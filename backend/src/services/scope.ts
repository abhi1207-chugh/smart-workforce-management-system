import type { AuthUser } from "../auth/types.js";
import { forbidden } from "../errors/app-error.js";

/**
 * Resolves the employee a list/read request is limited to. ADMIN may pass any
 * employee (or none = all); EMPLOYEE is always pinned to themself.
 */
export function scopeEmployee(
  user: AuthUser,
  requested?: string
): string | undefined {
  if (user.role === "ADMIN") return requested;
  if (!user.employee_id || (requested && requested !== user.employee_id)) {
    throw forbidden("You can only access your own records");
  }
  return user.employee_id;
}

/** The employee an EMPLOYEE-only action is performed for. */
export function ownEmployeeId(user: AuthUser): string {
  if (!user.employee_id) throw forbidden("No employee profile is linked to this account");
  return user.employee_id;
}
