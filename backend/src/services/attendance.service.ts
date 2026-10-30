import { DatabaseError } from "pg";
import type { AuthUser } from "../auth/types.js";
import { getDatabase } from "../database/client.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../errors/app-error.js";
import {
  applyCorrection,
  completeCheckout,
  findEmployeeStatus,
  findOpenSessionId,
  getSession,
  getTodayDay,
  insertOpenSession,
  listSessions,
  listSessionsForToday,
  lockSession,
  rebuildDay,
  todayDate,
} from "../repositories/attendance.repository.js";
import type {
  AttendanceSessionDto,
  CheckOutResultDto,
  TodayStatusDto,
} from "../types/api.js";
import { scopeEmployee } from "./scope.js";
import {
  assertNotFuture,
  type CorrectionInput,
} from "../validation/attendance.validation.js";

/**
 * ADMIN may act for any employee (kiosk/manual); EMPLOYEE only for themself,
 * and `employee_id` defaults to their own.
 */
export function resolveEmployeeId(user: AuthUser, requested?: string): string {
  if (user.role === "ADMIN") {
    if (!requested) throw badRequest("employee_id is required");
    return requested;
  }
  if (!user.employee_id || (requested && requested !== user.employee_id)) {
    throw forbidden("You can only record attendance for yourself");
  }
  return user.employee_id;
}

export async function checkIn(employeeId: string): Promise<AttendanceSessionDto> {
  const db = getDatabase();
  const status = await findEmployeeStatus(db, employeeId);
  if (!status) throw notFound("Employee not found");
  if (status !== "ACTIVE") throw conflict("Employee is inactive and cannot check in");

  try {
    const id = await insertOpenSession(db, employeeId);
    return (await getSession(db, id))!;
  } catch (error) {
    if (error instanceof DatabaseError && error.code === "23505") {
      throw conflict("Employee already has an open attendance session");
    }
    throw error;
  }
}

export async function checkOut(employeeId: string): Promise<CheckOutResultDto> {
  const db = getDatabase();
  const status = await findEmployeeStatus(db, employeeId);
  if (!status) throw notFound("Employee not found");

  return db.withTransaction(async (client) => {
    const sessionId = await findOpenSessionId(client, employeeId);
    if (!sessionId) throw conflict("Employee has no open attendance session");
    const lock = await lockSession(client, sessionId);
    if (!lock || lock.status !== "OPEN") {
      throw conflict("Employee has no open attendance session");
    }
    const day = await completeCheckout(client, sessionId);
    const session = (await getSession(client, sessionId))!;
    return { ...session, classification: day.classification, day };
  });
}

export async function getTodayStatus(employeeId: string): Promise<TodayStatusDto> {
  const db = getDatabase();
  if (!(await findEmployeeStatus(db, employeeId))) {
    throw notFound("Employee not found");
  }
  const [sessions, day, workDate] = await Promise.all([
    listSessionsForToday(db, employeeId),
    getTodayDay(db, employeeId),
    todayDate(db),
  ]);
  const status = sessions.some((s) => s.status === "CHECKED_IN")
    ? "CHECKED_IN"
    : sessions.length > 0
      ? "CHECKED_OUT"
      : "NOT_CHECKED_IN";
  return { employee_id: employeeId, work_date: workDate, status, sessions, day };
}

export async function correctSession(
  sessionId: string,
  input: CorrectionInput,
  adminUserId: string
): Promise<AttendanceSessionDto> {
  assertNotFuture(input.check_in, input.check_out);

  return getDatabase().withTransaction(async (client) => {
    const before = await lockSession(client, sessionId);
    if (!before) throw notFound("Attendance session not found");

    const newIn = input.check_in ? new Date(input.check_in) : before.check_in_at;
    const newOut = input.check_out
      ? new Date(input.check_out)
      : before.check_out_at;
    if (newOut && newOut < newIn) {
      throw badRequest("check_out must not be before check_in");
    }

    await applyCorrection(
      client,
      sessionId,
      adminUserId,
      input.reason,
      input.check_in ?? null,
      input.check_out ?? null
    );

    const after = (await getSession(client, sessionId))!;
    await rebuildDay(client, before.employee_id, before.work_date);
    if (after.work_date !== before.work_date) {
      await rebuildDay(client, before.employee_id, after.work_date);
    }
    return after;
  });
}

/** ADMIN: any filters. EMPLOYEE: always limited to their own sessions. */
export function listAttendance(
  user: AuthUser,
  q: {
    employee_id?: string;
    department_id?: string;
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  }
) {
  return listSessions({
    employeeId: scopeEmployee(user, q.employee_id),
    departmentId: user.role === "ADMIN" ? q.department_id : undefined,
    from: q.from,
    to: q.to,
    limit: q.limit,
    offset: q.offset,
  });
}
