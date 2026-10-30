import { getDatabase } from "../database/client.js";
import { Where } from "../database/queryable.js";

export async function attendanceSummary(f: {
  from: string;
  to: string;
  employeeId?: string;
  departmentId?: string;
}) {
  const w = new Where()
    .add("v.work_date >= ?", f.from)
    .add("v.work_date <= ?", f.to)
    .add("v.employee_id = ?", f.employeeId)
    .add("e.department_id = ?", f.departmentId);
  const fromIdx = w.params.length + 1;
  w.params.push(f.from, f.to);
  const r = await getDatabase().query(
    `
      SELECT
        v.employee_id, v.employee_code, v.first_name, v.last_name,
        COUNT(*) FILTER (WHERE v.classification = 'FULL_DAY')::int AS full_days,
        COUNT(*) FILTER (WHERE v.classification = 'HALF_DAY')::int AS half_days,
        COUNT(*) FILTER (WHERE v.classification = 'LEAVE')::int AS leave_days,
        COUNT(*) FILTER (WHERE v.classification = 'ABSENT')::int AS absent_days,
        COALESCE(SUM(v.total_working_minutes), 0)::int AS total_working_minutes,
        COALESCE(SUM(v.payable_day_fraction), 0)::text AS payable_days,
        (SELECT COUNT(*)::int FROM attendance_session s
          WHERE s.employee_id = v.employee_id AND s.status = 'COMPLETED' AND s.is_late_arrival
            AND s.work_date BETWEEN $${fromIdx} AND $${fromIdx + 1}) AS late_arrivals,
        (SELECT COUNT(*)::int FROM attendance_session s
          WHERE s.employee_id = v.employee_id AND s.status = 'COMPLETED' AND s.is_early_checkout
            AND s.work_date BETWEEN $${fromIdx} AND $${fromIdx + 1}) AS early_checkouts
      FROM v_employee_attendance_summary v
      JOIN employee e ON e.id = v.employee_id
      ${w.sql}
      GROUP BY v.employee_id, v.employee_code, v.first_name, v.last_name
      ORDER BY v.employee_code
    `,
    w.params
  );
  return r.rows;
}

export async function leaveBalanceReport(f: { employeeId?: string; leaveTypeCode?: string }) {
  const w = new Where()
    .add("employee_id = ?", f.employeeId)
    .add("leave_type_code = ?", f.leaveTypeCode);
  const r = await getDatabase().query(
    `SELECT employee_id, employee_code, first_name, last_name, leave_type_code, leave_type_name,
            balance_days::text AS balance_days
     FROM v_leave_balance_report ${w.sql} ORDER BY employee_code, leave_type_code`,
    w.params
  );
  return r.rows;
}

export async function payrollRegister(runId: string) {
  const db = getDatabase();
  const run = await db.query(
    `SELECT id, to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end, status::text AS status
     FROM payroll_run WHERE id = $1`,
    [runId]
  );
  if (!run.rows[0]) return null;
  const rows = await db.query(
    `SELECT payroll_record_id, employee_id, employee_code, first_name, last_name,
            one_day_salary::text AS one_day_salary,
            attendance_adjusted_pay::text AS attendance_adjusted_pay,
            overtime_pay::text AS overtime_pay, bonus_total::text AS bonus_total,
            deduction_total::text AS deduction_total, gross_pay::text AS gross_pay,
            net_pay::text AS net_pay, record_status::text AS status
     FROM v_payroll_register WHERE payroll_run_id = $1 ORDER BY employee_code`,
    [runId]
  );
  const totals = await db.query(
    `SELECT COUNT(*)::int AS employees,
            COALESCE(SUM(attendance_adjusted_pay), 0)::text AS attendance_adjusted_pay,
            COALESCE(SUM(overtime_pay), 0)::text AS overtime_pay,
            COALESCE(SUM(bonus_total), 0)::text AS bonus_total,
            COALESCE(SUM(deduction_total), 0)::text AS deduction_total,
            COALESCE(SUM(gross_pay), 0)::text AS gross_pay,
            COALESCE(SUM(net_pay), 0)::text AS net_pay
     FROM payroll_record WHERE payroll_run_id = $1`,
    [runId]
  );
  return { run: run.rows[0], rows: rows.rows, totals: totals.rows[0] };
}

export async function personalSummary(employeeId: string, from: string | undefined, to: string | undefined) {
  const db = getDatabase();
  const range = await db.query(
    `SELECT to_char(COALESCE($1::date, date_trunc('month', CURRENT_DATE)::date), 'YYYY-MM-DD') AS from,
            to_char(COALESCE($2::date, CURRENT_DATE), 'YYYY-MM-DD') AS to`,
    [from ?? null, to ?? null]
  );
  const { from: f, to: t } = range.rows[0];
  const attendance = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE classification = 'FULL_DAY')::int AS full_days,
       COUNT(*) FILTER (WHERE classification = 'HALF_DAY')::int AS half_days,
       COUNT(*) FILTER (WHERE classification = 'LEAVE')::int AS leave_days,
       COUNT(*) FILTER (WHERE classification = 'ABSENT')::int AS absent_days,
       COALESCE(SUM(total_working_minutes), 0)::int AS total_working_minutes
     FROM employee_day_attendance WHERE employee_id = $1 AND work_date BETWEEN $2 AND $3`,
    [employeeId, f, t]
  );
  const overtime = await db.query(
    `SELECT COALESCE(SUM(overtime_minutes) FILTER (WHERE status = 'APPROVED'), 0)::int AS approved_minutes,
            COALESCE(SUM(overtime_minutes) FILTER (WHERE status = 'PENDING'), 0)::int AS pending_minutes
     FROM overtime_record WHERE employee_id = $1 AND work_date BETWEEN $2 AND $3`,
    [employeeId, f, t]
  );
  const balances = await db.query(
    `SELECT leave_type_code, leave_type_name, balance_days::text AS balance_days
     FROM v_leave_balance_report WHERE employee_id = $1 ORDER BY leave_type_code`,
    [employeeId]
  );
  const payroll = await db.query(
    `SELECT pr.id, to_char(r.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
            pr.net_pay::text AS net_pay, pr.status::text AS status
     FROM payroll_record pr JOIN payroll_run r ON r.id = pr.payroll_run_id
     WHERE pr.employee_id = $1 AND pr.status IN ('FINALIZED', 'PAID')
     ORDER BY r.period_end DESC LIMIT 1`,
    [employeeId]
  );
  return {
    employee_id: employeeId,
    period: { from: f, to: t },
    attendance: attendance.rows[0],
    overtime: overtime.rows[0],
    leave_balances: balances.rows,
    latest_payroll: payroll.rows[0] ?? null,
  };
}

export async function queryAuditLogs(f: {
  from?: string;
  to?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  limit: number;
  offset: number;
}) {
  const w = new Where()
    .add("a.created_at >= ?::date", f.from)
    .add("a.created_at < (?::date + 1)", f.to)
    .add("a.entity_type = ?", f.entityType)
    .add("a.entity_id = ?", f.entityId)
    .add("a.actor_user_id = ?", f.actorId);
  const page = w.page(f.limit, f.offset);
  const r = await getDatabase().query(
    `SELECT a.id, a.actor_user_id, u.email AS actor_email, a.action, a.entity_type,
            a.entity_id, a.metadata, a.created_at
     FROM audit_log a LEFT JOIN "user" u ON u.id = a.actor_user_id
     ${w.sql} ORDER BY a.created_at DESC, a.id ${page}`,
    w.params
  );
  return r.rows;
}

/** Headline counts for the admin dashboard ("today" = database CURRENT_DATE). */
export async function dashboardSummary() {
  const db = getDatabase();
  const counts = await db.query(
    `SELECT
       to_char(CURRENT_DATE, 'YYYY-MM-DD') AS work_date,
       (SELECT COUNT(*)::int FROM employee WHERE status = 'ACTIVE') AS active_employees,
       (SELECT COUNT(DISTINCT employee_id)::int FROM attendance_session
         WHERE work_date = CURRENT_DATE) AS present_today,
       (SELECT COUNT(DISTINCT employee_id)::int FROM attendance_session
         WHERE work_date = CURRENT_DATE AND status = 'OPEN') AS checked_in_now,
       (SELECT COUNT(DISTINCT employee_id)::int FROM attendance_session
         WHERE work_date = CURRENT_DATE AND is_late_arrival) AS late_today,
       (SELECT COUNT(DISTINCT employee_id)::int FROM leave_request
         WHERE status = 'APPROVED' AND CURRENT_DATE BETWEEN start_date AND end_date) AS on_leave_today,
       (SELECT COUNT(*)::int FROM leave_request WHERE status = 'PENDING') AS pending_leave_requests,
       (SELECT COUNT(*)::int FROM overtime_record WHERE status = 'PENDING') AS pending_overtime`
  );
  const run = await db.query(
    `SELECT id, to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end, status::text AS status
     FROM payroll_run WHERE status <> 'FAILED'
     ORDER BY period_start DESC, created_at DESC LIMIT 1`
  );
  return { ...counts.rows[0], latest_payroll_run: run.rows[0] ?? null };
}
