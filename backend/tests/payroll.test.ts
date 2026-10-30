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

const PREFIX = `T2D${Date.now().toString(36)}`;
// An isolated period in a distant year so real payroll data is never touched.
const YEAR = String(1000 + (Date.now() % 8000)).padStart(4, "0");
const START = `${YEAR}-01-01`;
const END = `${YEAR}-01-31`;

describe("Stage 2d: payroll", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });
  let department: string, shift: string, policyId: string, otConfigId: string;
  let adminId: string, admin: string;
  let empX: string, empY: string, authX: string, authY: string;
  let runId: string;
  let recordX: string;

  const call = (method: "get" | "post", path: string, auth?: string, body?: object) => {
    const r = req(app)[method](`/api/v1${path}`);
    const withAuth = auth ? r.set("Authorization", auth) : r;
    return body ? withAuth.send(body) : withAuth;
  };

  beforeAll(async () => {
    initDatabase(databaseUrl);
    const db = getDatabase();
    ({ department, shift } = await makeDepartmentAndShift(PREFIX));
    adminId = await ensureFixtureAdmin();
    admin = bearer({ id: adminId, email: "a@example.test", role: "ADMIN", employee_id: null });
    policyId = (
      await db.query(
        `INSERT INTO payroll_policy (name, working_days_method, fixed_divisor, is_default, status)
         VALUES ($1, 'FIXED_DIVISOR', 30, false, 'ACTIVE') RETURNING id`,
        [PREFIX]
      )
    ).rows[0].id;
    otConfigId = (
      await db.query(
        `INSERT INTO overtime_rate_config (name, multiplier, is_default, status)
         VALUES ($1, 2.0, false, 'ACTIVE') RETURNING id`,
        [PREFIX]
      )
    ).rows[0].id;
    empX = await makeEmployee(PREFIX, "x", department, shift, { salary: 30000 });
    empY = await makeEmployee(PREFIX, "y", department, shift, { salary: 15000 });
    authX = bearer({ id: NIL, email: "x@x.test", role: "EMPLOYEE", employee_id: empX });
    authY = bearer({ id: NIL, email: "y@x.test", role: "EMPLOYEE", employee_id: empY });

    // X: 20 full days + 2 half days => 20*1000 + 2*500 = 21000. 90 min approved OT.
    await db.query(
      `INSERT INTO employee_day_attendance (employee_id, work_date, classification, total_working_minutes, is_scheduled_working_day, payable_day_fraction)
       SELECT $1, ($2::date + g), (CASE WHEN g < 20 THEN 'FULL_DAY' ELSE 'HALF_DAY' END)::day_classification,
              CASE WHEN g < 20 THEN 480 ELSE 120 END, true, CASE WHEN g < 20 THEN 1.0 ELSE 0.5 END
       FROM generate_series(0, 21) g`,
      [empX, START]
    );
    await db.query(
      `INSERT INTO overtime_record (employee_id, work_date, overtime_minutes, status)
       VALUES ($1, $2, 90, 'APPROVED'), ($1, $3, 600, 'PENDING')`,
      [empX, `${YEAR}-01-05`, `${YEAR}-01-06`]
    );
  });

  afterAll(async () => {
    const db = getDatabase();
    const ids = `(SELECT id FROM employee WHERE employee_code LIKE $1)`;
    const like = [`${PREFIX}-%`];
    const runs = `(SELECT id FROM payroll_run WHERE payroll_policy_id = $1)`;
    await db.query(`DELETE FROM payment WHERE payroll_record_id IN (SELECT id FROM payroll_record WHERE payroll_run_id IN ${runs})`, [policyId]);
    await db.query(`DELETE FROM payroll_record WHERE payroll_run_id IN ${runs}`, [policyId]);
    await db.query(`DELETE FROM bonus WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM deduction WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM payroll_run WHERE payroll_policy_id = $1`, [policyId]);
    await db.query(`DELETE FROM payroll_policy WHERE id = $1`, [policyId]);
    await db.query(`DELETE FROM overtime_rate_config WHERE id = $1`, [otConfigId]);
    await db.query(`DELETE FROM overtime_record WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM employee_day_attendance WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM employee WHERE employee_code LIKE $1`, like);
    await db.query(`DELETE FROM shift WHERE id = $1`, [shift]);
    await db.query(`DELETE FROM department WHERE id = $1`, [department]);
    await db.close();
  });

  it("every payroll endpoint requires auth; admin-only ones reject EMPLOYEE", async () => {
    const adminOnly: ["get" | "post", string][] = [
      ["get", "/payroll/runs"], ["post", "/payroll/runs"], ["get", `/payroll/runs/${NIL}`],
      ["post", `/payroll/runs/${NIL}/compute`], ["post", `/payroll/runs/${NIL}/finalize`],
      ["get", "/bonuses"], ["post", "/bonuses"], ["get", "/deductions"], ["post", "/deductions"],
      ["get", "/payments"], ["post", "/payments"],
    ];
    for (const [m, path] of adminOnly) {
      expect((await call(m, path)).status, `${m} ${path} unauth`).toBe(401);
      expect((await call(m, path, authX, {})).status, `${m} ${path} employee`).toBe(403);
    }
    for (const path of ["/payroll/records", `/payroll/records/${NIL}`, `/payroll/records/${NIL}/payslip`]) {
      expect((await call("get", path)).status).toBe(401);
    }
  });

  describe("runs", () => {
    it("validates the request body", async () => {
      const bad = [
        {}, { period_start: START },
        { period_start: END, period_end: START },
        { period_start: "nope", period_end: END },
        { period_start: START, period_end: END, payroll_policy_id: "x" },
        { period_start: START, period_end: END, status: "FINALIZED" },
      ];
      for (const b of bad) expect((await call("post", "/payroll/runs", admin, b)).status).toBe(400);
      const unknownPolicy = { period_start: START, period_end: END, payroll_policy_id: NIL };
      expect((await call("post", "/payroll/runs", admin, unknownPolicy)).status).toBe(400);
    });

    it("creates a DRAFT run; overlapping period is 409", async () => {
      const res = await call("post", "/payroll/runs", admin, {
        period_start: START, period_end: END, payroll_policy_id: policyId, overtime_rate_config_id: otConfigId,
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        status: "DRAFT", period_start: START, period_end: END, record_count: 0, initiated_by_user_id: adminId,
      });
      runId = res.body.data.id;

      const overlap = await call("post", "/payroll/runs", admin, {
        period_start: `${YEAR}-01-15`, period_end: `${YEAR}-02-15`, payroll_policy_id: policyId, overtime_rate_config_id: otConfigId,
      });
      expect(overlap.status).toBe(409);

      expect((await call("get", `/payroll/runs/${runId}`, admin)).body.data.id).toBe(runId);
      expect((await call("get", `/payroll/runs/${NIL}`, admin)).status).toBe(404);
      expect((await call("get", "/payroll/runs/bad", admin)).status).toBe(400);
      const list = await call("get", "/payroll/runs?status=DRAFT", admin);
      expect(list.body.data.map((r: { id: string }) => r.id)).toContain(runId);
    });
  });

  describe("bonuses and deductions", () => {
    it("validates and rejects unknown employees", async () => {
      const base = { employee_id: empX, period_start: START, period_end: END, amount: 1, reason: "r" };
      for (const b of [
        { ...base, amount: 0 }, { ...base, amount: -5 }, { ...base, amount: 1.005 },
        { ...base, reason: "" }, { ...base, extra: 1 }, { ...base, employee_id: "x" },
      ]) {
        expect((await call("post", "/bonuses", admin, b)).status).toBe(400);
      }
      expect((await call("post", "/deductions", admin, base)).status).toBe(400); // type missing
      expect((await call("post", "/bonuses", admin, { ...base, employee_id: NIL })).status).toBe(404);
    });

    it("creates a bonus and deduction with audit entries, and lists them", async () => {
      const bonus = await call("post", "/bonuses", admin, {
        employee_id: empX, period_start: START, period_end: END, amount: 500, reason: "great month",
      });
      expect(bonus.status).toBe(201);
      expect(bonus.body.data).toMatchObject({ amount: "500.00", payroll_run_id: null, created_by_user_id: adminId });

      const ded = await call("post", "/deductions", admin, {
        employee_id: empX, period_start: START, period_end: END, amount: 200, reason: "advance", deduction_type: "ADVANCE",
      });
      expect(ded.status).toBe(201);
      expect(ded.body.data).toMatchObject({ amount: "200.00", deduction_type: "ADVANCE" });

      const audit = await getDatabase().query(
        `SELECT entity_type FROM audit_log WHERE entity_id = ANY($1::uuid[]) AND action = 'CREATE' ORDER BY entity_type`,
        [[bonus.body.data.id, ded.body.data.id]]
      );
      expect(audit.rows.map((r) => r.entity_type)).toEqual(["bonus", "deduction"]);

      expect((await call("get", `/bonuses?employee_id=${empX}`, admin)).body.data).toHaveLength(1);
      expect((await call("get", `/deductions?employee_id=${empX}`, admin)).body.data).toHaveLength(1);
      expect((await call("get", "/bonuses?employee_id=bad", admin)).status).toBe(400);
    });
  });

  describe("compute, finalize, payslip, payment", () => {
    it("compute creates DRAFT records with the expected amounts, hidden from employees", async () => {
      const res = await call("post", `/payroll/runs/${runId}/compute`, admin);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("DRAFT");
      expect(res.body.data.record_count).toBeGreaterThanOrEqual(2);

      const recs = await call("get", `/payroll/records?payroll_run_id=${runId}&employee_id=${empX}`, admin);
      expect(recs.body.data).toHaveLength(1);
      const r = recs.body.data[0];
      recordX = r.id;
      expect(r).toMatchObject({
        status: "DRAFT",
        one_day_salary: "1000.00",
        attendance_adjusted_pay: "21000.00",
        overtime_pay: "333.33", // 1.5h x (1000 / 9h) x 2.0 — the pending OT is excluded
        bonus_total: "500.00",
        deduction_total: "200.00",
        gross_pay: "21833.33",
        net_pay: "21633.33",
      });

      expect((await call("get", "/payroll/records", authX)).body.data).toEqual([]);
      expect((await call("get", `/payroll/records/${recordX}`, authX)).status).toBe(404);
      expect((await call("get", `/payroll/records/${recordX}/payslip`, authX)).status).toBe(404);

      // computing again is stable
      expect((await call("post", `/payroll/runs/${runId}/compute`, admin)).status).toBe(200);
      expect((await call("get", `/payroll/records/${recordX}`, admin)).body.data.net_pay).toBe("21633.33");
    });

    it("cannot pay a DRAFT record", async () => {
      expect((await call("post", "/payments", admin, { payroll_record_id: recordX })).status).toBe(409);
    });

    it("finalize locks the run and records; repeating is 409", async () => {
      const res = await call("post", `/payroll/runs/${runId}/finalize`, admin);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("FINALIZED");
      expect(res.body.data.finalized_at).not.toBeNull();

      expect((await call("post", `/payroll/runs/${runId}/finalize`, admin)).status).toBe(409);
      expect((await call("post", `/payroll/runs/${runId}/compute`, admin)).status).toBe(409);
      expect((await call("post", `/payroll/runs/${NIL}/finalize`, admin)).status).toBe(404);

      expect((await call("get", `/payroll/records/${recordX}`, admin)).body.data.status).toBe("FINALIZED");
      const audit = await getDatabase().query(
        `SELECT 1 FROM audit_log WHERE entity_type = 'payroll_run' AND entity_id = $1 AND action = 'FINALIZE'`,
        [runId]
      );
      expect(audit.rowCount).toBe(1);

      const late = await call("post", "/bonuses", admin, {
        employee_id: empX, period_start: START, period_end: END, amount: 5, reason: "late",
      });
      expect(late.status).toBe(409);
    });

    it("employees see their own finalized records and payslip only", async () => {
      const mine = await call("get", "/payroll/records", authX);
      expect(mine.status).toBe(200);
      expect(mine.body.data.map((r: { id: string }) => r.id)).toEqual([recordX]);
      expect((await call("get", `/payroll/records?employee_id=${empY}`, authX)).status).toBe(403);
      expect((await call("get", `/payroll/records?status=DRAFT`, authX)).body.data).toEqual([]);
      expect((await call("get", `/payroll/records/${recordX}`, authX)).status).toBe(200);
      expect((await call("get", `/payroll/records/${recordX}`, authY)).status).toBe(404);

      const slip = await call("get", `/payroll/records/${recordX}/payslip`, authX);
      expect(slip.status).toBe(200);
      expect(slip.body.data.record.net_pay).toBe("21633.33");
      expect(slip.body.data.employee).toMatchObject({ employee_code: `${PREFIX}-x` });
      expect(slip.body.data.attendance).toMatchObject({ full_days: 20, half_days: 2, total_working_minutes: 20 * 480 + 2 * 120 });
      expect(slip.body.data.payment).toBeNull();
      expect(slip.body.data.period).toEqual({ start: START, end: END });
    });

    it("records a payment once, marks the record PAID, and keeps it immutable", async () => {
      expect((await call("post", "/payments", admin, { payroll_record_id: "bad" })).status).toBe(400);
      expect((await call("post", "/payments", admin, { payroll_record_id: NIL })).status).toBe(404);

      const res = await call("post", "/payments", admin, {
        payroll_record_id: recordX, reference: "TXN-1", notes: "bank transfer",
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        payroll_record_id: recordX, employee_id: empX, reference: "TXN-1", net_pay: "21633.33", recorded_by_user_id: adminId,
      });

      expect((await call("post", "/payments", admin, { payroll_record_id: recordX })).status).toBe(409);
      expect((await call("get", `/payroll/records/${recordX}`, admin)).body.data.status).toBe("PAID");

      expect((await call("get", `/payments?employee_id=${empX}`, admin)).body.data).toHaveLength(1);
      const slip = await call("get", `/payroll/records/${recordX}/payslip`, authX);
      expect(slip.body.data.payment).toMatchObject({ reference: "TXN-1" });

      const audit = await getDatabase().query(
        `SELECT 1 FROM audit_log WHERE entity_type = 'payment' AND entity_id = $1 AND action = 'PAYMENT'`,
        [res.body.data.id]
      );
      expect(audit.rowCount).toBe(1);

      await expect(
        getDatabase().query(`UPDATE payroll_record SET net_pay = 1 WHERE id = $1`, [recordX])
      ).rejects.toThrow(/immutable/);
    });
  });
});
