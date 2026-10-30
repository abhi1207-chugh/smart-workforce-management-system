import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { initDatabase, getDatabase } from "../src/database/client.js";
import {
  NIL,
  bearer,
  ensureFixtureAdmin,
  jwtSecret,
  makeDepartmentAndShift,
  makeEmployee,
  req,
} from "./helpers.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !jwtSecret) throw new Error("DATABASE_URL and JWT_SECRET are required");

const PREFIX = `T3${Date.now().toString(36)}`;
// An isolated year so real payroll data is never touched.
const YEAR = String(1000 + (Date.now() % 8000)).padStart(4, "0");

describe("Stage 3: closed SQL gaps", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });
  let department: string, shift: string, leaveTypeId: string, otConfigId: string;
  let adminId: string, admin: string, empAuth: string;
  let emp: string;
  const policyIds: string[] = [];

  const call = (method: "get" | "post", path: string, auth?: string, body?: object) => {
    const r = req(app)[method](`/api/v1${path}`);
    const withAuth = auth ? r.set("Authorization", auth) : r;
    return body ? withAuth.send(body) : withAuth;
  };
  const newPolicy = async (method: string, divisor: number | null) => {
    const id = (
      await getDatabase().query(
        `INSERT INTO payroll_policy (name, working_days_method, fixed_divisor, is_default, status)
         VALUES ($1, $2, $3, false, 'ACTIVE') RETURNING id`,
        [`${PREFIX}-${method}`, method, divisor]
      )
    ).rows[0].id;
    policyIds.push(id);
    return id as string;
  };
  const newRun = (policy: string, start: string, end: string) =>
    call("post", "/payroll/runs", admin, {
      period_start: start, period_end: end, payroll_policy_id: policy, overtime_rate_config_id: otConfigId,
    });

  beforeAll(async () => {
    initDatabase(databaseUrl);
    const db = getDatabase();
    ({ department, shift } = await makeDepartmentAndShift(PREFIX));
    adminId = await ensureFixtureAdmin();
    admin = bearer({ id: adminId, email: "a@example.test", role: "ADMIN", employee_id: null });
    leaveTypeId = (
      await db.query(
        `INSERT INTO leave_type (code, name, annual_entitlement_days, is_paid, status)
         VALUES ($1, 'Paid', 3, true, 'ACTIVE') RETURNING id`,
        [`${PREFIX}P`]
      )
    ).rows[0].id;
    otConfigId = (
      await db.query(
        `INSERT INTO overtime_rate_config (name, multiplier, is_default, status)
         VALUES ($1, 2.0, false, 'ACTIVE') RETURNING id`,
        [PREFIX]
      )
    ).rows[0].id;
    emp = await makeEmployee(PREFIX, "a", department, shift, { salary: 31000 });
    empAuth = bearer({ id: NIL, email: "e@x.test", role: "EMPLOYEE", employee_id: emp });
  });

  afterAll(async () => {
    const db = getDatabase();
    const ids = `(SELECT id FROM employee WHERE employee_code LIKE $1)`;
    const like = [`${PREFIX}-%`];
    const runs = `(SELECT id FROM payroll_run WHERE payroll_policy_id = ANY($1))`;
    await db.query(`DELETE FROM payroll_record WHERE payroll_run_id IN ${runs}`, [policyIds]);
    await db.query(`DELETE FROM deduction WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM payroll_run WHERE payroll_policy_id = ANY($1)`, [policyIds]);
    await db.query(`DELETE FROM payroll_policy WHERE id = ANY($1)`, [policyIds]);
    await db.query(`DELETE FROM overtime_rate_config WHERE id = $1`, [otConfigId]);
    await db.query(`DELETE FROM employee_day_attendance WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM leave_balance WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM leave_type WHERE id = $1`, [leaveTypeId]);
    await db.query(`DELETE FROM employee WHERE employee_code LIKE $1`, like);
    await db.query(`DELETE FROM shift_weekly_off WHERE shift_id = $1`, [shift]);
    await db.query(`DELETE FROM shift WHERE id = $1`, [shift]);
    await db.query(`DELETE FROM department WHERE id = $1`, [department]);
    await db.close();
  });

  describe("lateness grace period", () => {
    const isLate = async (time: string) =>
      (
        await getDatabase().query(
          `SELECT is_late_arrival AS late FROM derive_shift_timing_flags(
             $1, ('2024-01-02 ' || $2)::timestamp::timestamptz, '2024-01-02 18:30'::timestamp::timestamptz)`,
          [emp, time]
        )
      ).rows[0].late;

    it("with no grace, any check-in after the shift start is late", async () => {
      expect(await isLate("09:00")).toBe(false);
      expect(await isLate("09:01")).toBe(true);
    });

    it("tolerates check-ins up to start_time + grace_period_minutes", async () => {
      await getDatabase().query(`UPDATE shift SET grace_period_minutes = 15 WHERE id = $1`, [shift]);
      expect(await isLate("09:10")).toBe(false);
      expect(await isLate("09:15")).toBe(false);
      expect(await isLate("09:16")).toBe(true);
    });

    it("rejects an out-of-range grace period", async () => {
      for (const v of [-1, 241]) {
        await expect(
          getDatabase().query(`UPDATE shift SET grace_period_minutes = $1 WHERE id = $2`, [v, shift])
        ).rejects.toThrow();
      }
    });

    it("GET /shifts exposes grace_period_minutes", async () => {
      const res = await call("get", "/shifts", admin);
      expect(res.status).toBe(200);
      const mine = res.body.data.find((s: { id: string }) => s.id === shift);
      expect(mine.grace_period_minutes).toBe(15);
    });
  });

  describe("POST /leave/balances/adjust", () => {
    const url = "/leave/balances/adjust";
    const valid = () => ({ employee_id: emp, leave_type_id: leaveTypeId, balance_days: 7.5, reason: "carry-over" });

    it("requires authentication and the ADMIN role", async () => {
      expect((await call("post", url, undefined, valid())).status).toBe(401);
      expect((await call("post", url, empAuth, valid())).status).toBe(403);
    });

    it("rejects invalid bodies", async () => {
      const bad = [
        {},
        { ...valid(), reason: "  " },
        { ...valid(), reason: undefined },
        { ...valid(), balance_days: -1 },
        { ...valid(), balance_days: "5" },
        { ...valid(), balance_days: 1.234 },
        { ...valid(), employee_id: "x" },
        { ...valid(), extra: true },
      ];
      for (const b of bad) expect((await call("post", url, admin, b)).status).toBe(400);
    });

    it("returns 404 for an unknown employee and 400 for an unknown leave type", async () => {
      expect((await call("post", url, admin, { ...valid(), employee_id: NIL })).status).toBe(404);
      expect((await call("post", url, admin, { ...valid(), leave_type_id: NIL })).status).toBe(400);
    });

    it("sets the balance (creating the row if needed) and writes an audit entry", async () => {
      const first = await call("post", url, admin, valid());
      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({ employee_id: emp, balance_days: "7.50" });

      const second = await call("post", url, admin, { ...valid(), balance_days: 2, reason: "correction" });
      expect(second.body.data.balance_days).toBe("2.00");

      const audit = await getDatabase().query(
        `SELECT metadata FROM audit_log
         WHERE entity_type = 'leave_balance' AND metadata->>'employee_id' = $1
         ORDER BY created_at`,
        [emp]
      );
      expect(audit.rows.map((r) => r.metadata)).toMatchObject([
        { old_balance: null, new_balance: 7.5, reason: "carry-over" },
        { old_balance: 7.5, new_balance: 2, reason: "correction" },
      ]);
      const listed = await call("get", `/leave/balances?employee_id=${emp}`, admin);
      expect(listed.body.data[0].balance_days).toBe("2.00");
    });

    it("the SQL function refuses a non-admin actor", async () => {
      await expect(
        getDatabase().query(`SELECT adjust_leave_balance($1, $2, 1, $3, 'x')`, [emp, leaveTypeId, NIL])
      ).rejects.toThrow(/ADMIN/);
    });
  });

  describe("CALENDAR_WORKING_DAYS payroll policy", () => {
    it("divides by the scheduled working days in the period (weekly-offs excluded)", async () => {
      const db = getDatabase();
      await db.query(`INSERT INTO shift_weekly_off (shift_id, day_of_week) VALUES ($1, 0)`, [shift]);
      const start = `${YEAR}-01-01`;
      const end = `${YEAR}-01-31`;
      const expectedDays = (
        await db.query(
          `SELECT COUNT(*)::int AS n FROM generate_series($1::date, $2::date, '1 day') d
           WHERE EXTRACT(DOW FROM d) <> 0`,
          [start, end]
        )
      ).rows[0].n;

      const run = await newRun(await newPolicy("CALENDAR_WORKING_DAYS", null), start, end);
      expect(run.status).toBe(201);
      expect((await call("post", `/payroll/runs/${run.body.data.id}/compute`, admin)).status).toBe(200);

      const rec = (
        await db.query(
          `SELECT working_days_in_policy::float AS days, one_day_salary::float AS one_day
           FROM payroll_record WHERE payroll_run_id = $1 AND employee_id = $2`,
          [run.body.data.id, emp]
        )
      ).rows[0];
      expect(rec.days).toBe(expectedDays);
      expect(rec.one_day).toBe(Math.round((31000 / expectedDays) * 100) / 100);
    });

    it("still honours FIXED_DIVISOR policies", async () => {
      const db = getDatabase();
      const run = await newRun(await newPolicy("FIXED_DIVISOR", 20), `${YEAR}-03-01`, `${YEAR}-03-31`);
      expect(run.status).toBe(201);
      await call("post", `/payroll/runs/${run.body.data.id}/compute`, admin);
      const rec = (
        await db.query(
          `SELECT working_days_in_policy::float AS days, one_day_salary::float AS one_day
           FROM payroll_record WHERE payroll_run_id = $1 AND employee_id = $2`,
          [run.body.data.id, emp]
        )
      ).rows[0];
      expect(rec).toEqual({ days: 20, one_day: 1550 });
    });
  });

  describe("deduction cap (net_pay >= 0)", () => {
    it("caps deductions at gross pay and never produces negative net pay", async () => {
      const db = getDatabase();
      const start = `${YEAR}-02-01`;
      const end = `${YEAR}-02-10`;
      // 2 full days at 31000/31 = 1000 => gross 2000
      await db.query(
        `INSERT INTO employee_day_attendance (employee_id, work_date, classification, total_working_minutes, is_scheduled_working_day, payable_day_fraction)
         VALUES ($1, $2, 'FULL_DAY', 480, true, 1.0), ($1, $3, 'FULL_DAY', 480, true, 1.0)`,
        [emp, `${YEAR}-02-02`, `${YEAR}-02-03`]
      );
      const ded = await call("post", "/deductions", admin, {
        employee_id: emp, period_start: start, period_end: end, amount: 5000,
        reason: "loan recovery", deduction_type: "LOAN",
      });
      expect(ded.status).toBe(201);

      const run = await newRun(await newPolicy("FIXED_DIVISOR", 31), start, end);
      expect(run.status).toBe(201);
      expect((await call("post", `/payroll/runs/${run.body.data.id}/compute`, admin)).status).toBe(200);

      const rec = (
        await db.query(
          `SELECT gross_pay::text AS gross, deduction_total::text AS ded, net_pay::text AS net
           FROM payroll_record WHERE payroll_run_id = $1 AND employee_id = $2`,
          [run.body.data.id, emp]
        )
      ).rows[0];
      expect(rec).toEqual({ gross: "2000.00", ded: "2000.00", net: "0.00" });
    });

    it("the database rejects a payroll record with negative net pay", async () => {
      const db = getDatabase();
      const runId = (await db.query(`SELECT id FROM payroll_run WHERE payroll_policy_id = ANY($1) LIMIT 1`, [policyIds]))
        .rows[0].id;
      await expect(
        db.query(
          `INSERT INTO payroll_record (payroll_run_id, employee_id, monthly_base_salary, working_days_in_policy,
             one_day_salary, attendance_adjusted_pay, overtime_pay, bonus_total, deduction_total, gross_pay, net_pay, status)
           SELECT $1, id, 1000, 30, 33.33, 0, 0, 0, 100, 0, -100, 'DRAFT'
           FROM employee WHERE employee_code = $2`,
          [runId, `${PREFIX}-a`]
        )
      ).rejects.toThrow(/net_pay_non_negative/);
    });
  });
});
