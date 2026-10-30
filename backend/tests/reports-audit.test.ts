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

const PREFIX = `T2E${Date.now().toString(36)}`;
const YEAR = String(1000 + (Date.now() % 8000)).padStart(4, "0");
const FROM = `${YEAR}-03-01`;
const TO = `${YEAR}-03-31`;

describe("Stage 2e: reports and audit logs", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });
  let department: string, shift: string, policyId: string, otConfigId: string, runId: string;
  let adminId: string, admin: string;
  let empA: string, empB: string, authA: string, authB: string, leaveTypeId: string;

  const get = (path: string, auth?: string) => {
    const r = req(app).get(`/api/v1${path}`);
    return auth ? r.set("Authorization", auth) : r;
  };

  beforeAll(async () => {
    initDatabase(databaseUrl);
    const db = getDatabase();
    ({ department, shift } = await makeDepartmentAndShift(PREFIX));
    adminId = await ensureFixtureAdmin();
    admin = bearer({ id: adminId, email: "a@example.test", role: "ADMIN", employee_id: null });
    empA = await makeEmployee(PREFIX, "a", department, shift);
    empB = await makeEmployee(PREFIX, "b", department, shift);
    authA = bearer({ id: NIL, email: "a@x.test", role: "EMPLOYEE", employee_id: empA });
    authB = bearer({ id: NIL, email: "b@x.test", role: "EMPLOYEE", employee_id: empB });

    // A: 3 full days, 1 half day, 1 leave day, 1 absent day; 2 late arrivals, 1 early checkout.
    await db.query(
      `INSERT INTO employee_day_attendance (employee_id, work_date, classification, total_working_minutes, is_scheduled_working_day, payable_day_fraction)
       VALUES ($1, $2::date,     'FULL_DAY', 480, true, 1.0),
              ($1, $2::date + 1, 'FULL_DAY', 500, true, 1.0),
              ($1, $2::date + 2, 'FULL_DAY', 470, true, 1.0),
              ($1, $2::date + 3, 'HALF_DAY', 200, true, 0.5),
              ($1, $2::date + 4, 'LEAVE',      0, true, 1.0),
              ($1, $2::date + 5, 'ABSENT',     0, true, 0.0)`,
      [empA, FROM]
    );
    await db.query(
      `INSERT INTO attendance_session (employee_id, check_in_at, check_out_at, working_duration_minutes, status,
         check_in_source, work_date, is_late_arrival, is_early_checkout)
       VALUES ($1, $2::date + time '09:30', $2::date + time '17:30', 480, 'COMPLETED', 'MANUAL', $2, true, true),
              ($1, ($2::date + 1) + time '09:15', ($2::date + 1) + time '18:00', 525, 'COMPLETED', 'MANUAL', $2::date + 1, true, false)`,
      [empA, FROM]
    );
    await db.query(
      `INSERT INTO overtime_record (employee_id, work_date, overtime_minutes, status)
       VALUES ($1, $2, 60, 'APPROVED'), ($1, $2::date + 1, 30, 'PENDING')`,
      [empA, FROM]
    );
    leaveTypeId = (
      await db.query(
        `INSERT INTO leave_type (code, name, annual_entitlement_days, is_paid, status)
         VALUES ($1, 'Rep', 5, true, 'ACTIVE') RETURNING id`,
        [PREFIX]
      )
    ).rows[0].id;
    await db.query(`INSERT INTO leave_balance (employee_id, leave_type_id, balance_days) VALUES ($1, $3, 4), ($2, $3, 2)`, [
      empA, empB, leaveTypeId,
    ]);

    policyId = (
      await db.query(
        `INSERT INTO payroll_policy (name, working_days_method, fixed_divisor, is_default, status)
         VALUES ($1, 'FIXED_DIVISOR', 30, false, 'ACTIVE') RETURNING id`,
        [PREFIX]
      )
    ).rows[0].id;
    otConfigId = (
      await db.query(
        `INSERT INTO overtime_rate_config (name, multiplier, is_default, status) VALUES ($1, 1.5, false, 'ACTIVE') RETURNING id`,
        [PREFIX]
      )
    ).rows[0].id;
    runId = (
      await db.query(
        `INSERT INTO payroll_run (period_start, period_end, status, payroll_policy_id, overtime_rate_config_id, initiated_by_user_id)
         VALUES ($1, $2, 'DRAFT', $3, $4, $5) RETURNING id`,
        [FROM, TO, policyId, otConfigId, adminId]
      )
    ).rows[0].id;
    // A has a FINALIZED record (visible in the personal summary); B only a DRAFT.
    await db.query(
      `INSERT INTO payroll_record (payroll_run_id, employee_id, monthly_base_salary, working_days_in_policy, one_day_salary,
         attendance_adjusted_pay, overtime_pay, bonus_total, deduction_total, gross_pay, net_pay, status)
       VALUES ($1, $2, 30000, 30, 1000, 3500, 100, 50, 25, 3650, 3625, 'FINALIZED'),
              ($1, $3, 15000, 30, 500,  1000,   0,  0,  0, 1000, 1000, 'DRAFT')`,
      [runId, empA, empB]
    );
  });

  afterAll(async () => {
    const db = getDatabase();
    const ids = `(SELECT id FROM employee WHERE employee_code LIKE $1)`;
    const like = [`${PREFIX}-%`];
    await db.query(`DELETE FROM payroll_record WHERE payroll_run_id = $1`, [runId]);
    await db.query(`DELETE FROM payroll_run WHERE id = $1`, [runId]);
    await db.query(`DELETE FROM payroll_policy WHERE id = $1`, [policyId]);
    await db.query(`DELETE FROM overtime_rate_config WHERE id = $1`, [otConfigId]);
    await db.query(`DELETE FROM bonus WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM overtime_record WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM employee_day_attendance WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM attendance_session WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM leave_balance WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM leave_type WHERE id = $1`, [leaveTypeId]);
    await db.query(`DELETE FROM employee WHERE employee_code LIKE $1`, like);
    await db.query(`DELETE FROM shift WHERE id = $1`, [shift]);
    await db.query(`DELETE FROM department WHERE id = $1`, [department]);
    await db.close();
  });

  it("requires auth; admin reports reject EMPLOYEE; personal summary rejects ADMIN", async () => {
    const adminPaths = [
      `/reports/attendance-summary?from=${FROM}&to=${TO}`,
      "/reports/leave-balances",
      `/reports/payroll-register?period_id=${NIL}`,
      "/audit-logs",
    ];
    for (const path of adminPaths) {
      expect((await get(path)).status, path).toBe(401);
      expect((await get(path, authA)).status, path).toBe(403);
    }
    expect((await get("/reports/me/summary")).status).toBe(401);
    expect((await get("/reports/me/summary", admin)).status).toBe(403);
  });

  describe("attendance summary", () => {
    it("validates from/to", async () => {
      for (const q of [
        "", `?from=${FROM}`, `?from=${TO}&to=${FROM}`, `?from=${YEAR}-01-01&to=${Number(YEAR) + 2}-01-01`,
        `?from=bad&to=${TO}`, `?from=${FROM}&to=${TO}&employee_id=x`, `?from=${FROM}&to=${TO}&foo=1`,
      ]) {
        expect((await get(`/reports/attendance-summary${q}`, admin)).status, q).toBe(400);
      }
    });

    it("aggregates per employee, including late and early counts", async () => {
      const res = await get(`/reports/attendance-summary?from=${FROM}&to=${TO}&department_id=${department}`, admin);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1); // only A has attendance rows
      expect(res.body.data[0]).toMatchObject({
        employee_id: empA, employee_code: `${PREFIX}-a`,
        full_days: 3, half_days: 1, leave_days: 1, absent_days: 1,
        total_working_minutes: 480 + 500 + 470 + 200,
        payable_days: "4.50",
        late_arrivals: 2, early_checkouts: 1,
      });
    });

    it("respects the date range and employee filter", async () => {
      const narrow = await get(`/reports/attendance-summary?from=${FROM}&to=${FROM}&employee_id=${empA}`, admin);
      expect(narrow.body.data[0]).toMatchObject({ full_days: 1, half_days: 0, late_arrivals: 1, early_checkouts: 1 });
      const none = await get(`/reports/attendance-summary?from=${FROM}&to=${TO}&employee_id=${empB}`, admin);
      expect(none.body.data).toEqual([]);
    });
  });

  describe("leave balances report", () => {
    it("lists balances with filters", async () => {
      const all = await get(`/reports/leave-balances?leave_type_code=${PREFIX}`, admin);
      expect(all.status).toBe(200);
      expect(all.body.data.map((r: { balance_days: string }) => r.balance_days).sort()).toEqual(["2.00", "4.00"]);
      const one = await get(`/reports/leave-balances?leave_type_code=${PREFIX}&employee_id=${empB}`, admin);
      expect(one.body.data).toHaveLength(1);
      expect(one.body.data[0]).toMatchObject({ employee_code: `${PREFIX}-b`, balance_days: "2.00" });
      expect((await get("/reports/leave-balances?employee_id=bad", admin)).status).toBe(400);
    });
  });

  describe("payroll register", () => {
    it("returns rows and totals for a run; 404 unknown; 400 missing/invalid", async () => {
      const res = await get(`/reports/payroll-register?period_id=${runId}`, admin);
      expect(res.status).toBe(200);
      expect(res.body.data.run).toMatchObject({ id: runId, period_start: FROM, period_end: TO, status: "DRAFT" });
      expect(res.body.data.rows.map((r: { employee_code: string }) => r.employee_code)).toEqual([`${PREFIX}-a`, `${PREFIX}-b`]);
      expect(res.body.data.rows[0]).toMatchObject({ gross_pay: "3650.00", net_pay: "3625.00", status: "FINALIZED" });
      expect(res.body.data.totals).toMatchObject({
        employees: 2, gross_pay: "4650.00", net_pay: "4625.00", overtime_pay: "100.00", deduction_total: "25.00",
      });
      expect((await get(`/reports/payroll-register?period_id=${NIL}`, admin)).status).toBe(404);
      expect((await get("/reports/payroll-register", admin)).status).toBe(400);
      expect((await get("/reports/payroll-register?period_id=x", admin)).status).toBe(400);
    });
  });

  describe("personal summary", () => {
    it("summarises the caller's own data over a range", async () => {
      const res = await get(`/reports/me/summary?from=${FROM}&to=${TO}`, authA);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        employee_id: empA,
        period: { from: FROM, to: TO },
        attendance: { full_days: 3, half_days: 1, leave_days: 1, absent_days: 1, total_working_minutes: 1650 },
        overtime: { approved_minutes: 60, pending_minutes: 30 },
        latest_payroll: { period_start: FROM, period_end: TO, net_pay: "3625.00", status: "FINALIZED" },
      });
      const bal = res.body.data.leave_balances.find((b: { leave_type_code: string }) => b.leave_type_code === PREFIX);
      expect(bal.balance_days).toBe("4.00");
    });

    it("never exposes another employee's data or draft payroll", async () => {
      const res = await get(`/reports/me/summary?from=${FROM}&to=${TO}`, authB);
      expect(res.body.data.employee_id).toBe(empB);
      expect(res.body.data.attendance.full_days).toBe(0);
      expect(res.body.data.latest_payroll).toBeNull();
      expect((await get(`/reports/me/summary?employee_id=${empA}`, authB)).status).toBe(400);
    });

    it("defaults to the current month and validates the range", async () => {
      const res = await get("/reports/me/summary", authA);
      expect(res.status).toBe(200);
      expect(res.body.data.period.from).toMatch(/^\d{4}-\d{2}-01$/);
      expect((await get(`/reports/me/summary?from=${TO}&to=${FROM}`, authA)).status).toBe(400);
    });
  });

  describe("GET /audit-logs", () => {
    it("returns entries filtered by entity, actor and dates", async () => {
      const bonus = await req(app)
        .post("/api/v1/bonuses")
        .set("Authorization", admin)
        .send({ employee_id: empA, period_start: FROM, period_end: TO, amount: 10, reason: "audit test" });
      expect(bonus.status).toBe(201);
      const entityId = bonus.body.data.id;

      const res = await get(`/audit-logs?entity_type=bonus&entity_id=${entityId}`, admin);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        action: "CREATE", entity_type: "bonus", entity_id: entityId, actor_user_id: adminId,
        actor_email: "test-attendance-admin@example.test",
      });
      expect(res.body.data[0].metadata).toMatchObject({ amount: 10, reason: "audit test" });

      const byActor = await get(`/audit-logs?actor_id=${adminId}&entity_type=bonus&limit=500`, admin);
      expect(byActor.body.data.map((r: { entity_id: string }) => r.entity_id)).toContain(entityId);
      const otherActor = await get(`/audit-logs?actor_id=${NIL}&entity_id=${entityId}`, admin);
      expect(otherActor.body.data).toEqual([]);

      const today = new Date().toISOString().slice(0, 10);
      const inRange = await get(`/audit-logs?entity_id=${entityId}&from=${today}&to=${today}`, admin);
      expect(inRange.body.data).toHaveLength(1);
      const past = await get(`/audit-logs?entity_id=${entityId}&to=2000-01-01`, admin);
      expect(past.body.data).toEqual([]);
    });

    it("paginates and validates parameters", async () => {
      const page = await get("/audit-logs?limit=2&offset=0", admin);
      expect(page.status).toBe(200);
      expect(page.body.data.length).toBeLessThanOrEqual(2);
      for (const q of ["?limit=0", "?limit=501", "?offset=-1", "?actor_id=x", "?from=2030-02-01&to=2030-01-01", "?bogus=1"]) {
        expect((await get(`/audit-logs${q}`, admin)).status, q).toBe(400);
      }
    });
  });
});
