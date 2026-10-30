import { getDatabase } from "../database/client.js";
import { Where, type Queryable } from "../database/queryable.js";

const REQUEST_SELECT = `
  SELECT
    lr.id, lr.employee_id, e.employee_code, e.first_name, e.last_name,
    lr.leave_type_id, lt.code AS leave_type_code,
    to_char(lr.start_date, 'YYYY-MM-DD') AS start_date,
    to_char(lr.end_date, 'YYYY-MM-DD') AS end_date,
    (lr.end_date - lr.start_date + 1) AS days,
    lr.reason, lr.status::text AS status, lr.requested_at,
    lr.reviewed_by_user_id, lr.reviewed_at
  FROM leave_request lr
  JOIN employee e ON e.id = lr.employee_id
  JOIN leave_type lt ON lt.id = lr.leave_type_id
`;

export async function listLeaveTypes() {
  const r = await getDatabase().query(
    `SELECT id, code, name, annual_entitlement_days, is_paid
     FROM leave_type WHERE status = 'ACTIVE' ORDER BY code`
  );
  return r.rows;
}

export async function findActiveLeaveType(db: Queryable, id: string) {
  const r = await db.query(
    `SELECT id FROM leave_type WHERE id = $1 AND status = 'ACTIVE'`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function hasOverlappingRequest(
  db: Queryable,
  employeeId: string,
  start: string,
  end: string
): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM leave_request
     WHERE employee_id = $1 AND status IN ('PENDING', 'APPROVED')
       AND start_date <= $3 AND end_date >= $2 LIMIT 1`,
    [employeeId, start, end]
  );
  return r.rowCount! > 0;
}

export async function insertLeaveRequest(
  db: Queryable,
  employeeId: string,
  leaveTypeId: string,
  start: string,
  end: string,
  reason: string | null
): Promise<string> {
  const r = await db.query(
    `INSERT INTO leave_request (employee_id, leave_type_id, start_date, end_date, reason, status, requested_at)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', CURRENT_TIMESTAMP) RETURNING id`,
    [employeeId, leaveTypeId, start, end, reason]
  );
  return r.rows[0].id;
}

export async function getLeaveRequest(db: Queryable, id: string) {
  const r = await db.query(`${REQUEST_SELECT} WHERE lr.id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function listLeaveRequests(f: {
  employeeId?: string;
  status?: string;
  limit: number;
  offset: number;
}) {
  const w = new Where()
    .add("lr.employee_id = ?", f.employeeId)
    .add("lr.status = ?", f.status);
  const page = w.page(f.limit, f.offset);
  const r = await getDatabase().query(
    `${REQUEST_SELECT} ${w.sql} ORDER BY lr.requested_at DESC, lr.id ${page}`,
    w.params
  );
  return r.rows;
}

export async function lockLeaveRequest(db: Queryable, id: string) {
  const r = await db.query(
    `SELECT id, employee_id, leave_type_id, status::text AS status,
            (end_date - start_date + 1) AS days
     FROM leave_request WHERE id = $1 FOR UPDATE`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function hasSufficientBalance(
  db: Queryable,
  employeeId: string,
  leaveTypeId: string,
  days: number
): Promise<boolean> {
  const r = await db.query(`SELECT check_leave_balance($1, $2, $3) AS ok`, [
    employeeId,
    leaveTypeId,
    days,
  ]);
  return r.rows[0].ok === true;
}

/** Delegates to the SQL function: balance deduction + LEAVE day rows. */
export async function approveLeaveInDb(
  db: Queryable,
  id: string,
  reviewerUserId: string
): Promise<void> {
  await db.query(`SELECT approve_leave_request($1, $2)`, [id, reviewerUserId]);
}

export async function rejectLeaveInDb(
  db: Queryable,
  id: string,
  reviewerUserId: string
): Promise<void> {
  await db.query(
    `UPDATE leave_request SET status = 'REJECTED', reviewed_by_user_id = $2, reviewed_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, reviewerUserId]
  );
}

/** Delegates to the SQL function: absolute balance override plus audit entry. */
export async function adjustLeaveBalanceInDb(
  db: Queryable,
  employeeId: string,
  leaveTypeId: string,
  balanceDays: number,
  adminUserId: string,
  reason: string
) {
  const r = await db.query(
    `SELECT employee_id, leave_type_id, balance_days::text AS balance_days
     FROM adjust_leave_balance($1, $2, $3, $4, $5)`,
    [employeeId, leaveTypeId, balanceDays, adminUserId, reason]
  );
  return r.rows[0];
}

export async function listLeaveBalances(employeeId?: string) {
  const w = new Where().add("lb.employee_id = ?", employeeId);
  const r = await getDatabase().query(
    `SELECT lb.employee_id, e.employee_code, lb.leave_type_id,
            lt.code AS leave_type_code, lt.name AS leave_type_name,
            lb.balance_days::text AS balance_days
     FROM leave_balance lb
     JOIN employee e ON e.id = lb.employee_id
     JOIN leave_type lt ON lt.id = lb.leave_type_id
     ${w.sql}
     ORDER BY e.employee_code, lt.code`,
    w.params
  );
  return r.rows;
}
