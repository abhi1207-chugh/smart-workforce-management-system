import { getDatabase } from "../database/client.js";
import { Where, type Queryable } from "../database/queryable.js";

const SELECT = `
  SELECT
    ot.id, ot.employee_id, e.employee_code, e.first_name, e.last_name,
    to_char(ot.work_date, 'YYYY-MM-DD') AS work_date,
    ot.overtime_minutes, ot.status::text AS status,
    ot.attendance_session_id, ot.approved_by_user_id, ot.approved_at, ot.notes,
    ot.created_at
  FROM overtime_record ot
  JOIN employee e ON e.id = ot.employee_id
`;

/** Minutes worked beyond the shift's scheduled duration (BR-OT-02). */
export async function deriveOvertimeMinutes(
  db: Queryable,
  employeeId: string,
  workDate: string
): Promise<number> {
  const r = await db.query(`SELECT derive_overtime_minutes($1, $2) AS m`, [
    employeeId,
    workDate,
  ]);
  return r.rows[0].m ?? 0;
}

export async function latestCompletedSessionId(
  db: Queryable,
  employeeId: string,
  workDate: string
): Promise<string | null> {
  const r = await db.query(
    `SELECT id FROM attendance_session
     WHERE employee_id = $1 AND work_date = $2 AND status = 'COMPLETED'
     ORDER BY check_out_at DESC LIMIT 1`,
    [employeeId, workDate]
  );
  return r.rows[0]?.id ?? null;
}

export async function hasActiveOvertime(
  db: Queryable,
  employeeId: string,
  workDate: string
): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM overtime_record
     WHERE employee_id = $1 AND work_date = $2 AND status IN ('PENDING', 'APPROVED') LIMIT 1`,
    [employeeId, workDate]
  );
  return r.rowCount! > 0;
}

export async function insertOvertime(
  db: Queryable,
  employeeId: string,
  workDate: string,
  minutes: number,
  sessionId: string | null,
  notes: string | null
): Promise<string> {
  const r = await db.query(
    `INSERT INTO overtime_record (employee_id, work_date, overtime_minutes, status, attendance_session_id, notes)
     VALUES ($1, $2, $3, 'PENDING', $4, $5) RETURNING id`,
    [employeeId, workDate, minutes, sessionId, notes]
  );
  return r.rows[0].id;
}

export async function getOvertime(db: Queryable, id: string) {
  const r = await db.query(`${SELECT} WHERE ot.id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function listOvertime(f: {
  employeeId?: string;
  status?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}) {
  const w = new Where()
    .add("ot.employee_id = ?", f.employeeId)
    .add("ot.status = ?", f.status)
    .add("ot.work_date >= ?", f.from)
    .add("ot.work_date <= ?", f.to);
  const page = w.page(f.limit, f.offset);
  const r = await getDatabase().query(
    `${SELECT} ${w.sql} ORDER BY ot.work_date DESC, ot.id ${page}`,
    w.params
  );
  return r.rows;
}

export async function lockOvertimeStatus(db: Queryable, id: string) {
  const r = await db.query(
    `SELECT id, status::text AS status FROM overtime_record WHERE id = $1 FOR UPDATE`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function decideOvertime(
  db: Queryable,
  id: string,
  status: "APPROVED" | "REJECTED",
  userId: string
): Promise<void> {
  await db.query(
    `UPDATE overtime_record SET status = $2, approved_by_user_id = $3, approved_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, status, userId]
  );
}
