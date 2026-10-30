import type {
  AttendanceSessionDto,
  DayAttendanceDto,
} from "../types/api.js";
import { getDatabase } from "../database/client.js";
import { Where, type Queryable } from "../database/queryable.js";


const SESSION_COLUMNS = `
  a.id, a.employee_id,
  to_char(a.work_date, 'YYYY-MM-DD') AS work_date,
  a.check_in_at AS check_in,
  a.check_out_at AS check_out,
  a.working_duration_minutes,
  CASE a.status WHEN 'OPEN' THEN 'CHECKED_IN' ELSE 'COMPLETED' END AS status,
  a.is_late_arrival, a.is_early_checkout, a.correction_reason
`;

const DAY_COLUMNS = `
  to_char(d.work_date, 'YYYY-MM-DD') AS work_date,
  d.classification::text AS classification,
  d.total_working_minutes,
  d.payable_day_fraction::text AS payable_day_fraction,
  d.is_scheduled_working_day
`;

export async function findEmployeeStatus(
  db: Queryable,
  employeeId: string
): Promise<"ACTIVE" | "INACTIVE" | null> {
  const r = await db.query(`SELECT status::text AS status FROM employee WHERE id = $1`, [
    employeeId,
  ]);
  return r.rows[0]?.status ?? null;
}

/** Opens a session at the database clock; the unique index rejects a second open one. */
export async function insertOpenSession(
  db: Queryable,
  employeeId: string
): Promise<string> {
  const r = await db.query(
    `
      INSERT INTO attendance_session (
        employee_id, check_in_at, status, check_in_source, work_date
      )
      VALUES ($1, CURRENT_TIMESTAMP, 'OPEN', 'MANUAL', CURRENT_DATE)
      RETURNING id
    `,
    [employeeId]
  );
  return r.rows[0].id;
}

export async function findOpenSessionId(
  db: Queryable,
  employeeId: string
): Promise<string | null> {
  const r = await db.query(
    `SELECT id FROM attendance_session WHERE employee_id = $1 AND status = 'OPEN'`,
    [employeeId]
  );
  return r.rows[0]?.id ?? null;
}

/** Delegates to the SQL function (duration, classification, day upsert). */
export async function completeCheckout(
  db: Queryable,
  sessionId: string
): Promise<DayAttendanceDto> {
  const r = await db.query(
    `
      SELECT ${DAY_COLUMNS}
      FROM complete_attendance_checkout($1) d
    `,
    [sessionId]
  );
  return r.rows[0];
}

export async function getSession(
  db: Queryable,
  id: string
): Promise<AttendanceSessionDto | null> {
  const r = await db.query(
    `SELECT ${SESSION_COLUMNS} FROM attendance_session a WHERE a.id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function listSessionsForToday(
  db: Queryable,
  employeeId: string
): Promise<AttendanceSessionDto[]> {
  const r = await db.query(
    `
      SELECT ${SESSION_COLUMNS}
      FROM attendance_session a
      WHERE a.employee_id = $1 AND a.work_date = CURRENT_DATE
      ORDER BY a.check_in_at
    `,
    [employeeId]
  );
  return r.rows;
}

export async function getTodayDay(
  db: Queryable,
  employeeId: string
): Promise<DayAttendanceDto | null> {
  const r = await db.query(
    `
      SELECT ${DAY_COLUMNS}
      FROM employee_day_attendance d
      WHERE d.employee_id = $1 AND d.work_date = CURRENT_DATE
    `,
    [employeeId]
  );
  return r.rows[0] ?? null;
}

export async function todayDate(db: Queryable): Promise<string> {
  const r = await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`);
  return r.rows[0].d;
}

export interface LockedSession {
  id: string;
  employee_id: string;
  work_date: string;
  status: "OPEN" | "COMPLETED";
  check_in_at: Date;
  check_out_at: Date | null;
}

export async function lockSession(
  db: Queryable,
  id: string
): Promise<LockedSession | null> {
  const r = await db.query(
    `
      SELECT id, employee_id, to_char(work_date, 'YYYY-MM-DD') AS work_date,
             status::text AS status, check_in_at, check_out_at
      FROM attendance_session WHERE id = $1 FOR UPDATE
    `,
    [id]
  );
  return r.rows[0] ?? null;
}

/**
 * Applies an admin correction. Duration and shift flags are recomputed with the
 * SQL helpers; the audit trigger records the change.
 */
export async function applyCorrection(
  db: Queryable,
  id: string,
  userId: string,
  reason: string,
  checkIn: string | null,
  checkOut: string | null
): Promise<void> {
  await db.query(
    `
      UPDATE attendance_session SET
        check_in_at = COALESCE($3::timestamptz, check_in_at),
        check_out_at = COALESCE($4::timestamptz, check_out_at),
        work_date = COALESCE($3::timestamptz, check_in_at)::date,
        check_in_source = CASE WHEN $3::timestamptz IS NULL THEN check_in_source ELSE 'CORRECTION' END,
        check_out_source = CASE WHEN $4::timestamptz IS NULL THEN check_out_source ELSE 'CORRECTION' END,
        status = CASE WHEN COALESCE($4::timestamptz, check_out_at) IS NULL THEN 'OPEN'::attendance_session_status ELSE 'COMPLETED'::attendance_session_status END,
        corrected_by_user_id = $2,
        correction_reason = $5
      WHERE id = $1
    `,
    [id, userId, checkIn, checkOut, reason]
  );
  await db.query(
    `
      UPDATE attendance_session a SET
        working_duration_minutes = CASE WHEN a.check_out_at IS NULL THEN NULL
          ELSE compute_working_duration_minutes(a.check_in_at, a.check_out_at) END,
        is_late_arrival = COALESCE((SELECT f.is_late_arrival FROM derive_shift_timing_flags(
          a.employee_id, a.check_in_at, COALESCE(a.check_out_at, a.check_in_at)) f), false),
        is_early_checkout = CASE WHEN a.check_out_at IS NULL THEN false ELSE
          COALESCE((SELECT f.is_early_checkout FROM derive_shift_timing_flags(
            a.employee_id, a.check_in_at, a.check_out_at) f), false) END
      WHERE a.id = $1
    `,
    [id]
  );
}

/**
 * Rebuilds the per-day row from completed sessions after a correction. Removes
 * the row when no completed time remains (unless a leave request owns it).
 */
export async function rebuildDay(
  db: Queryable,
  employeeId: string,
  workDate: string
): Promise<void> {
  const sum = await db.query(
    `
      SELECT COALESCE(SUM(working_duration_minutes), 0)::int AS total,
             COUNT(*)::int AS n
      FROM attendance_session
      WHERE employee_id = $1 AND work_date = $2 AND status = 'COMPLETED'
    `,
    [employeeId, workDate]
  );
  const { total, n } = sum.rows[0];
  if (n === 0) {
    await db.query(
      `DELETE FROM employee_day_attendance
       WHERE employee_id = $1 AND work_date = $2 AND leave_request_id IS NULL`,
      [employeeId, workDate]
    );
    return;
  }
  await db.query(
    `
      INSERT INTO employee_day_attendance (
        employee_id, work_date, classification, total_working_minutes,
        is_scheduled_working_day, payable_day_fraction
      )
      SELECT $1, $2::date, c.classification, $3,
             is_scheduled_working_day($1, $2::date), c.payable_day_fraction
      FROM classify_day_from_minutes($3) c
      ON CONFLICT (employee_id, work_date) DO UPDATE SET
        classification = EXCLUDED.classification,
        total_working_minutes = EXCLUDED.total_working_minutes,
        is_scheduled_working_day = EXCLUDED.is_scheduled_working_day,
        payable_day_fraction = EXCLUDED.payable_day_fraction
    `,
    [employeeId, workDate, total]
  );
}

export async function listSessions(f: {
  employeeId?: string;
  departmentId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}): Promise<AttendanceSessionDto[]> {
  const w = new Where()
    .add("a.employee_id = ?", f.employeeId)
    .add("e.department_id = ?", f.departmentId)
    .add("a.work_date >= ?", f.from)
    .add("a.work_date <= ?", f.to);
  const page = w.page(f.limit, f.offset);
  const r = await getDatabase().query(
    `SELECT ${SESSION_COLUMNS}, e.employee_code, e.first_name, e.last_name
     FROM attendance_session a JOIN employee e ON e.id = a.employee_id
     ${w.sql} ORDER BY a.check_in_at DESC, a.id ${page}`,
    w.params
  );
  return r.rows as AttendanceSessionDto[];
}
