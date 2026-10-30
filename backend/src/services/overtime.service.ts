import type { AuthUser } from "../auth/types.js";
import { getDatabase } from "../database/client.js";
import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { findEmployeeStatus } from "../repositories/attendance.repository.js";
import {
  decideOvertime,
  deriveOvertimeMinutes,
  getOvertime,
  hasActiveOvertime,
  insertOvertime,
  latestCompletedSessionId,
  listOvertime,
  lockOvertimeStatus,
} from "../repositories/overtime.repository.js";
import type { CreateOvertimeInput } from "../validation/overtime.validation.js";
import { scopeEmployee } from "./scope.js";

/**
 * EMPLOYEE submits for themself and minutes are always derived from attendance.
 * ADMIN names the employee and may override the minutes.
 */
export async function submitOvertime(user: AuthUser, input: CreateOvertimeInput) {
  let employeeId: string;
  if (user.role === "ADMIN") {
    if (!input.employee_id) throw badRequest("employee_id is required");
    employeeId = input.employee_id;
  } else {
    if (input.overtime_minutes !== undefined) {
      throw forbidden("Only an admin can set overtime minutes");
    }
    employeeId = scopeEmployee(user, input.employee_id)!;
  }

  const db = getDatabase();
  const status = await findEmployeeStatus(db, employeeId);
  if (!status) throw notFound("Employee not found");
  if (status !== "ACTIVE") throw conflict("Employee is inactive");

  return db.withTransaction(async (client) => {
    if (await hasActiveOvertime(client, employeeId, input.work_date)) {
      throw conflict("An overtime record already exists for this employee and date");
    }
    const derived = await deriveOvertimeMinutes(client, employeeId, input.work_date);
    const minutes = input.overtime_minutes ?? derived;
    if (minutes <= 0) {
      throw conflict("No overtime worked on this date beyond the shift duration");
    }
    const sessionId = await latestCompletedSessionId(client, employeeId, input.work_date);
    const id = await insertOvertime(
      client,
      employeeId,
      input.work_date,
      minutes,
      sessionId,
      input.notes ?? null
    );
    return getOvertime(client, id);
  });
}

export function listRecords(
  user: AuthUser,
  q: { employee_id?: string; status?: string; from?: string; to?: string; limit: number; offset: number }
) {
  return listOvertime({
    employeeId: scopeEmployee(user, q.employee_id),
    status: q.status,
    from: q.from,
    to: q.to,
    limit: q.limit,
    offset: q.offset,
  });
}

export async function decide(id: string, status: "APPROVED" | "REJECTED", userId: string) {
  return getDatabase().withTransaction(async (client) => {
    const row = await lockOvertimeStatus(client, id);
    if (!row) throw notFound("Overtime record not found");
    if (row.status !== "PENDING") throw conflict(`Overtime record is already ${row.status}`);
    await decideOvertime(client, id, status, userId);
    return getOvertime(client, id);
  });
}
