import { getDatabase } from "../database/client.js";
import { Where, type Queryable } from "../database/queryable.js";

const RUN_SELECT = `
  SELECT
    r.id,
    to_char(r.period_start, 'YYYY-MM-DD') AS period_start,
    to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
    r.status::text AS status,
    r.payroll_policy_id, r.overtime_rate_config_id, r.initiated_by_user_id,
    r.finalized_at, r.created_at,
    (SELECT COUNT(*)::int FROM payroll_record pr WHERE pr.payroll_run_id = r.id) AS record_count,
    (SELECT COALESCE(SUM(pr.gross_pay), 0)::text FROM payroll_record pr WHERE pr.payroll_run_id = r.id) AS total_gross,
    (SELECT COALESCE(SUM(pr.net_pay), 0)::text FROM payroll_record pr WHERE pr.payroll_run_id = r.id) AS total_net
  FROM payroll_run r
`;

const RECORD_SELECT = `
  SELECT
    pr.id, pr.payroll_run_id, pr.employee_id, e.employee_code,
    e.first_name, e.last_name,
    to_char(r.period_start, 'YYYY-MM-DD') AS period_start,
    to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
    pr.monthly_base_salary::text AS monthly_base_salary,
    pr.working_days_in_policy::text AS working_days_in_policy,
    pr.one_day_salary::text AS one_day_salary,
    pr.attendance_adjusted_pay::text AS attendance_adjusted_pay,
    pr.overtime_pay::text AS overtime_pay,
    pr.bonus_total::text AS bonus_total,
    pr.deduction_total::text AS deduction_total,
    pr.gross_pay::text AS gross_pay,
    pr.net_pay::text AS net_pay,
    pr.status::text AS status, pr.created_at
  FROM payroll_record pr
  JOIN payroll_run r ON r.id = pr.payroll_run_id
  JOIN employee e ON e.id = pr.employee_id
`;

// ---- policies -------------------------------------------------------------

export async function getPolicy(db: Queryable, id?: string) {
  const r = id
    ? await db.query(
        `SELECT id, working_days_method::text AS method FROM payroll_policy WHERE id = $1 AND status = 'ACTIVE'`,
        [id]
      )
    : await db.query(
        `SELECT id, working_days_method::text AS method FROM payroll_policy
         WHERE is_default AND status = 'ACTIVE' LIMIT 1`
      );
  return r.rows[0] ?? null;
}

export async function getOvertimeConfigId(db: Queryable, id?: string) {
  const r = id
    ? await db.query(`SELECT id FROM overtime_rate_config WHERE id = $1 AND status = 'ACTIVE'`, [id])
    : await db.query(`SELECT id FROM overtime_rate_config WHERE is_default AND status = 'ACTIVE' LIMIT 1`);
  return (r.rows[0]?.id as string | undefined) ?? null;
}

// ---- runs -----------------------------------------------------------------

export async function hasOverlappingRun(db: Queryable, start: string, end: string) {
  const r = await db.query(
    `SELECT 1 FROM payroll_run WHERE status <> 'FAILED' AND period_start <= $2 AND period_end >= $1 LIMIT 1`,
    [start, end]
  );
  return r.rowCount! > 0;
}

export async function insertRun(
  db: Queryable,
  start: string,
  end: string,
  policyId: string,
  overtimeConfigId: string,
  userId: string
): Promise<string> {
  const r = await db.query(
    `INSERT INTO payroll_run (period_start, period_end, status, payroll_policy_id, overtime_rate_config_id, initiated_by_user_id)
     VALUES ($1, $2, 'DRAFT', $3, $4, $5) RETURNING id`,
    [start, end, policyId, overtimeConfigId, userId]
  );
  return r.rows[0].id;
}

export async function getRun(db: Queryable, id: string) {
  const r = await db.query(`${RUN_SELECT} WHERE r.id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function listRuns(f: { status?: string; limit: number; offset: number }) {
  const w = new Where().add("r.status = ?", f.status);
  const page = w.page(f.limit, f.offset);
  const r = await getDatabase().query(
    `${RUN_SELECT} ${w.sql} ORDER BY r.period_start DESC, r.created_at DESC ${page}`,
    w.params
  );
  return r.rows;
}

export async function lockRunStatus(db: Queryable, id: string) {
  const r = await db.query(
    `SELECT id, status::text AS status FROM payroll_run WHERE id = $1 FOR UPDATE`,
    [id]
  );
  return r.rows[0] ?? null;
}

/** Computes a DRAFT record for every active employee via the SQL function. */
export async function computeAllRecords(db: Queryable, runId: string): Promise<void> {
  await db.query(
    `SELECT compute_employee_payroll_record($1, e.id) FROM employee e WHERE e.status = 'ACTIVE'`,
    [runId]
  );
}

export async function finalizeRunInDb(db: Queryable, runId: string): Promise<void> {
  await db.query(`SELECT finalize_payroll_run($1)`, [runId]);
}

// ---- records / payslips ---------------------------------------------------

export async function listRecords(f: {
  runId?: string;
  employeeId?: string;
  status?: string;
  statuses?: string[];
  limit: number;
  offset: number;
}) {
  const w = new Where()
    .add("pr.payroll_run_id = ?", f.runId)
    .add("pr.employee_id = ?", f.employeeId)
    .add("pr.status = ?", f.status)
    .add("pr.status = ANY(?::payroll_record_status[])", f.statuses);
  const page = w.page(f.limit, f.offset);
  const r = await getDatabase().query(
    `${RECORD_SELECT} ${w.sql} ORDER BY r.period_start DESC, e.employee_code ${page}`,
    w.params
  );
  return r.rows;
}

export async function getRecord(db: Queryable, id: string) {
  const r = await db.query(`${RECORD_SELECT} WHERE pr.id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function getPayslipExtras(db: Queryable, record: { employee_id: string; payroll_run_id: string; id: string }) {
  const emp = await db.query(
    `SELECT e.employee_code, e.first_name, e.last_name, e.email, d.name AS department
     FROM employee e JOIN department d ON d.id = e.department_id WHERE e.id = $1`,
    [record.employee_id]
  );
  const att = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE d.classification = 'FULL_DAY')::int AS full_days,
       COUNT(*) FILTER (WHERE d.classification = 'HALF_DAY')::int AS half_days,
       COUNT(*) FILTER (WHERE d.classification = 'LEAVE')::int AS leave_days,
       COUNT(*) FILTER (WHERE d.classification = 'ABSENT')::int AS absent_days,
       COALESCE(SUM(d.total_working_minutes), 0)::int AS total_working_minutes
     FROM employee_day_attendance d
     JOIN payroll_run r ON r.id = $2
     WHERE d.employee_id = $1 AND d.work_date BETWEEN r.period_start AND r.period_end`,
    [record.employee_id, record.payroll_run_id]
  );
  const pay = await db.query(
    `SELECT id, paid_at, reference, notes FROM payment WHERE payroll_record_id = $1 ORDER BY paid_at DESC LIMIT 1`,
    [record.id]
  );
  return { employee: emp.rows[0], attendance: att.rows[0], payment: pay.rows[0] ?? null };
}

// ---- bonuses / deductions -------------------------------------------------

export async function hasFinalizedRunOverlap(db: Queryable, start: string, end: string) {
  const r = await db.query(
    `SELECT 1 FROM payroll_run WHERE status = 'FINALIZED' AND period_start <= $2 AND period_end >= $1 LIMIT 1`,
    [start, end]
  );
  return r.rowCount! > 0;
}

export async function insertAudit(
  db: Queryable,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: object
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorUserId, action, entityType, entityId, JSON.stringify(metadata)]
  );
}

const ADJ_COLUMNS = `
  x.id, x.employee_id, e.employee_code, x.payroll_run_id,
  to_char(x.period_start, 'YYYY-MM-DD') AS period_start,
  to_char(x.period_end, 'YYYY-MM-DD') AS period_end,
  x.amount::text AS amount, x.reason, x.created_by_user_id, x.created_at`;

export async function insertBonus(db: Queryable, userId: string, v: {
  employee_id: string; period_start: string; period_end: string; amount: number; reason: string;
}): Promise<string> {
  const r = await db.query(
    `INSERT INTO bonus (employee_id, period_start, period_end, amount, reason, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [v.employee_id, v.period_start, v.period_end, v.amount, v.reason, userId]
  );
  return r.rows[0].id;
}

export async function insertDeduction(db: Queryable, userId: string, v: {
  employee_id: string; period_start: string; period_end: string; amount: number; reason: string; deduction_type: string;
}): Promise<string> {
  const r = await db.query(
    `INSERT INTO deduction (employee_id, period_start, period_end, deduction_type, amount, reason, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [v.employee_id, v.period_start, v.period_end, v.deduction_type, v.amount, v.reason, userId]
  );
  return r.rows[0].id;
}

export async function getBonus(db: Queryable, id: string) {
  const r = await db.query(
    `SELECT ${ADJ_COLUMNS} FROM bonus x JOIN employee e ON e.id = x.employee_id WHERE x.id = $1`,
    [id]
  );
  return r.rows[0];
}

export async function getDeduction(db: Queryable, id: string) {
  const r = await db.query(
    `SELECT ${ADJ_COLUMNS}, x.deduction_type FROM deduction x JOIN employee e ON e.id = x.employee_id WHERE x.id = $1`,
    [id]
  );
  return r.rows[0];
}

export async function listAdjustments(
  table: "bonus" | "deduction",
  f: { employeeId?: string; runId?: string; limit: number; offset: number }
) {
  const w = new Where().add("x.employee_id = ?", f.employeeId).add("x.payroll_run_id = ?", f.runId);
  const page = w.page(f.limit, f.offset);
  const extra = table === "deduction" ? ", x.deduction_type" : "";
  const r = await getDatabase().query(
    `SELECT ${ADJ_COLUMNS}${extra} FROM ${table} x JOIN employee e ON e.id = x.employee_id
     ${w.sql} ORDER BY x.created_at DESC, x.id ${page}`,
    w.params
  );
  return r.rows;
}

// ---- payments -------------------------------------------------------------

export async function lockRecordForPayment(db: Queryable, id: string) {
  const r = await db.query(
    `SELECT id, status::text AS status FROM payroll_record WHERE id = $1 FOR UPDATE`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function insertPayment(db: Queryable, userId: string, v: {
  payroll_record_id: string; paid_at?: string; reference?: string; notes?: string;
}): Promise<string> {
  const r = await db.query(
    `INSERT INTO payment (payroll_record_id, paid_at, reference, notes, recorded_by_user_id)
     VALUES ($1, COALESCE($2::timestamptz, CURRENT_TIMESTAMP), $3, $4, $5) RETURNING id`,
    [v.payroll_record_id, v.paid_at ?? null, v.reference ?? null, v.notes ?? null, userId]
  );
  return r.rows[0].id;
}

export async function markRecordPaid(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE payroll_record SET status = 'PAID' WHERE id = $1`, [id]);
}

const PAYMENT_SELECT = `
  SELECT p.id, p.payroll_record_id, pr.employee_id, e.employee_code,
         pr.net_pay::text AS net_pay, p.paid_at, p.reference, p.notes,
         p.recorded_by_user_id, p.created_at
  FROM payment p
  JOIN payroll_record pr ON pr.id = p.payroll_record_id
  JOIN employee e ON e.id = pr.employee_id`;

export async function getPayment(db: Queryable, id: string) {
  const r = await db.query(`${PAYMENT_SELECT} WHERE p.id = $1`, [id]);
  return r.rows[0];
}

export async function listPayments(f: { recordId?: string; employeeId?: string; limit: number; offset: number }) {
  const w = new Where().add("p.payroll_record_id = ?", f.recordId).add("pr.employee_id = ?", f.employeeId);
  const page = w.page(f.limit, f.offset);
  const r = await getDatabase().query(
    `${PAYMENT_SELECT} ${w.sql} ORDER BY p.paid_at DESC, p.id ${page}`,
    w.params
  );
  return r.rows;
}
