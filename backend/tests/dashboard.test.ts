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

const PREFIX = `T4D${Date.now().toString(36)}`;

describe("GET /reports/dashboard", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });
  let department: string, shift: string, leaveTypeId: string;
  let admin: string, employee: string;
  const get = (auth?: string) => {
    const r = req(app).get("/api/v1/reports/dashboard");
    return auth ? r.set("Authorization", auth) : r;
  };

  beforeAll(async () => {
    initDatabase(databaseUrl);
    ({ department, shift } = await makeDepartmentAndShift(PREFIX));
    const adminId = await ensureFixtureAdmin();
    admin = bearer({ id: adminId, email: "a@example.test", role: "ADMIN", employee_id: null });
    employee = bearer({ id: NIL, email: "e@x.test", role: "EMPLOYEE", employee_id: NIL });
    leaveTypeId = (
      await getDatabase().query(
        `INSERT INTO leave_type (code, name, annual_entitlement_days, is_paid, status)
         VALUES ($1, 'D', 5, true, 'ACTIVE') RETURNING id`,
        [PREFIX]
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    const db = getDatabase();
    const ids = `(SELECT id FROM employee WHERE employee_code LIKE $1)`;
    const like = [`${PREFIX}-%`];
    await db.query(`DELETE FROM overtime_record WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM leave_request WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM attendance_session WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM employee WHERE employee_code LIKE $1`, like);
    await db.query(`DELETE FROM leave_type WHERE id = $1`, [leaveTypeId]);
    await db.query(`DELETE FROM shift WHERE id = $1`, [shift]);
    await db.query(`DELETE FROM department WHERE id = $1`, [department]);
    await db.close();
  });

  it("requires authentication and the ADMIN role", async () => {
    expect((await get()).status).toBe(401);
    expect((await get(employee)).status).toBe(403);
  });

  it("returns the expected shape", async () => {
    const res = await get(admin);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      work_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      active_employees: expect.any(Number),
      present_today: expect.any(Number),
      checked_in_now: expect.any(Number),
      late_today: expect.any(Number),
      on_leave_today: expect.any(Number),
      pending_leave_requests: expect.any(Number),
      pending_overtime: expect.any(Number),
    });
  });

  it("reflects today's activity (checked against a baseline)", async () => {
    const before = (await get(admin)).body.data;
    const db = getDatabase();
    const a = await makeEmployee(PREFIX, "a", department, shift);
    const b = await makeEmployee(PREFIX, "b", department, shift);
    const c = await makeEmployee(PREFIX, "c", department, shift);
    await makeEmployee(PREFIX, "i", department, shift, { status: "INACTIVE" });

    // a: open and late; b: completed on time.
    await db.query(
      `INSERT INTO attendance_session (employee_id, check_in_at, check_out_at, working_duration_minutes, status,
         check_in_source, work_date, is_late_arrival, is_early_checkout)
       VALUES ($1, now(), NULL, NULL, 'OPEN', 'MANUAL', CURRENT_DATE, true, false),
              ($2, now() - interval '1 minute', now(), 0, 'COMPLETED', 'MANUAL', CURRENT_DATE, false, false)`,
      [a, b]
    );
    await db.query(
      `INSERT INTO leave_request (employee_id, leave_type_id, start_date, end_date, status, requested_at)
       VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE, 'APPROVED', now()),
              ($3, $2, CURRENT_DATE + 30, CURRENT_DATE + 30, 'PENDING', now())`,
      [c, leaveTypeId, a]
    );
    await db.query(
      `INSERT INTO overtime_record (employee_id, work_date, overtime_minutes, status)
       VALUES ($1, CURRENT_DATE - 1, 30, 'PENDING')`,
      [a]
    );

    const after = (await get(admin)).body.data;
    const delta = (k: string) => after[k] - before[k];
    expect(delta("active_employees")).toBe(3);
    expect(delta("present_today")).toBe(2);
    expect(delta("checked_in_now")).toBe(1);
    expect(delta("late_today")).toBe(1);
    expect(delta("on_leave_today")).toBe(1);
    expect(delta("pending_leave_requests")).toBe(1);
    expect(delta("pending_overtime")).toBe(1);
  });
});
