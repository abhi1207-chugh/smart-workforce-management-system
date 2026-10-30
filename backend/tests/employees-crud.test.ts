import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { req } from "./helpers.js";
import { createApp } from "../src/app.js";
import { initDatabase, getDatabase } from "../src/database/client.js";
import { signToken } from "../src/auth/token.js";
import type { AuthUser } from "../src/auth/types.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
if (!databaseUrl || !jwtSecret) {
  throw new Error("DATABASE_URL and JWT_SECRET are required for tests");
}

const bearer = (u: AuthUser) => `Bearer ${signToken(u, jwtSecret, "1h")}`;
const admin = bearer({
  id: "00000000-0000-0000-0000-0000000000a1",
  email: "crud-admin@example.local",
  role: "ADMIN",
  employee_id: null,
});
const employeeAuth = bearer({
  id: "00000000-0000-0000-0000-0000000000b1",
  email: "crud-emp@example.local",
  role: "EMPLOYEE",
  employee_id: "00000000-0000-0000-0000-0000000000c1",
});

const RUN = Date.now().toString(36);
const PREFIX = `T2A${RUN}`;
const email = (n: string) => `${PREFIX}-${n}@example.test`.toLowerCase();

describe("Stage 2a: employees, departments, shifts", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });
  let departmentId: string;
  let shiftId: string;
  let leaveTypeId: string;
  let leaveTypeCode: string;

  const payload = (n: string, extra: Record<string, unknown> = {}) => ({
    employee_code: `${PREFIX}-${n}`,
    first_name: "Test",
    last_name: "Person",
    email: email(n),
    department_id: departmentId,
    shift_id: shiftId,
    monthly_base_salary: 50000,
    password: "Passw0rd!123",
    ...extra,
  });

  beforeAll(async () => {
    initDatabase(databaseUrl);
    const db = getDatabase();
    const dept = await db.query<{ id: string }>(
      `INSERT INTO department (code, name, status) VALUES ($1, 'Test Dept', 'ACTIVE') RETURNING id`,
      [PREFIX]
    );
    departmentId = dept.rows[0].id;
    const shift = await db.query<{ id: string }>(
      `INSERT INTO shift (name, start_time, end_time, scheduled_duration_minutes, status)
       VALUES ($1, '09:00', '18:00', 540, 'ACTIVE') RETURNING id`,
      [PREFIX]
    );
    shiftId = shift.rows[0].id;
    await db.query(
      `INSERT INTO shift_weekly_off (shift_id, day_of_week) VALUES ($1, 0), ($1, 6)`,
      [shiftId]
    );
    leaveTypeCode = PREFIX;
    const lt = await db.query<{ id: string }>(
      `INSERT INTO leave_type (code, name, annual_entitlement_days, is_paid, status)
       VALUES ($1, 'Test Leave', 7, true, 'ACTIVE') RETURNING id`,
      [leaveTypeCode]
    );
    leaveTypeId = lt.rows[0].id;
  });

  afterAll(async () => {
    const db = getDatabase();
    const emp = `(SELECT id FROM employee WHERE employee_code LIKE $1)`;
    const like = [`${PREFIX}-%`];
    await db.query(`DELETE FROM "user" WHERE employee_id IN ${emp}`, like);
    await db.query(`DELETE FROM leave_balance WHERE employee_id IN ${emp}`, like);
    await db.query(`DELETE FROM employee WHERE employee_code LIKE $1`, like);
    await db.query(`DELETE FROM leave_balance WHERE leave_type_id = $1`, [leaveTypeId]);
    await db.query(`DELETE FROM leave_type WHERE id = $1`, [leaveTypeId]);
    await db.query(`DELETE FROM shift_weekly_off WHERE shift_id = $1`, [shiftId]);
    await db.query(`DELETE FROM shift WHERE id = $1`, [shiftId]);
    await db.query(`DELETE FROM department WHERE id = $1`, [departmentId]);
    await db.close();
  });

  describe("POST /employees", () => {
    it("creates employee, login user and leave balances", async () => {
      const res = await req(app)
        .post("/api/v1/employees")
        .set("Authorization", admin)
        .send(payload("create", { phone: "555-0100", hire_date: "2024-01-15" }));

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        employee_code: `${PREFIX}-create`,
        email: email("create"),
        status: "ACTIVE",
        phone: "555-0100",
        hire_date: "2024-01-15",
        monthly_base_salary: "50000.00",
        face_registered: false,
      });
      expect(res.body.data).not.toHaveProperty("password");

      const id = res.body.data.id;
      const db = getDatabase();
      const user = await db.query(
        `SELECT role::text AS role, status::text AS status, password_hash FROM "user" WHERE employee_id = $1`,
        [id]
      );
      expect(user.rows).toHaveLength(1);
      expect(user.rows[0].role).toBe("EMPLOYEE");
      expect(user.rows[0].status).toBe("ACTIVE");
      expect(user.rows[0].password_hash).not.toBe("Passw0rd!123");

      const bal = await db.query(
        `SELECT balance_days::text AS d FROM leave_balance WHERE employee_id = $1 AND leave_type_id = $2`,
        [id, leaveTypeId]
      );
      expect(bal.rows).toHaveLength(1);
      expect(bal.rows[0].d).toBe("7.00");

      // the new login works
      const login = await req(app)
        .post("/api/v1/auth/login")
        .send({ email: email("create"), password: "Passw0rd!123" });
      expect(login.status).toBe(200);
    });

    it("returns 401 without a token and 403 for EMPLOYEE", async () => {
      const noAuth = await req(app).post("/api/v1/employees").send(payload("x"));
      expect(noAuth.status).toBe(401);
      const emp = await req(app)
        .post("/api/v1/employees")
        .set("Authorization", employeeAuth)
        .send(payload("x"));
      expect(emp.status).toBe(403);
    });

    it("returns 400 on invalid body", async () => {
      const bad = [
        payload("v1", { email: "not-an-email" }),
        payload("v2", { password: "short" }),
        payload("v3", { monthly_base_salary: -1 }),
        payload("v4", { department_id: "nope" }),
        payload("v5", { role: "ADMIN" }), // unknown key rejected
        {},
      ];
      for (const body of bad) {
        const res = await req(app)
          .post("/api/v1/employees")
          .set("Authorization", admin)
          .send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("returns 409 on duplicate code or email, leaving no partial rows", async () => {
      const first = await req(app)
        .post("/api/v1/employees")
        .set("Authorization", admin)
        .send(payload("dup"));
      expect(first.status).toBe(201);

      const sameCode = await req(app)
        .post("/api/v1/employees")
        .set("Authorization", admin)
        .send(payload("dup", { email: email("dup-other") }));
      expect(sameCode.status).toBe(409);
      expect(sameCode.body.error.code).toBe("CONFLICT");

      const sameEmail = await req(app)
        .post("/api/v1/employees")
        .set("Authorization", admin)
        .send(payload("dup2", { email: email("dup") }));
      expect(sameEmail.status).toBe(409);

      const left = await getDatabase().query(
        `SELECT 1 FROM employee WHERE employee_code IN ($1, $2)`,
        [`${PREFIX}-dup2`, `${PREFIX}-dup-other`]
      );
      expect(left.rowCount).toBe(0);
    });

    it("returns 400 for a non-existent department or shift", async () => {
      const res = await req(app)
        .post("/api/v1/employees")
        .set("Authorization", admin)
        .send(payload("fk", { department_id: "11111111-1111-4111-8111-111111111111" }));
      expect(res.status).toBe(400);
    });
  });

  describe("GET /employees/:id", () => {
    it("returns the employee, 404 for unknown, 400 for bad id", async () => {
      const created = await req(app)
        .post("/api/v1/employees")
        .set("Authorization", admin)
        .send(payload("get"));
      const id = created.body.data.id;

      const ok = await req(app).get(`/api/v1/employees/${id}`).set("Authorization", admin);
      expect(ok.status).toBe(200);
      expect(ok.body.data.id).toBe(id);

      const missing = await req(app)
        .get("/api/v1/employees/11111111-1111-4111-8111-111111111111")
        .set("Authorization", admin);
      expect(missing.status).toBe(404);

      const bad = await req(app).get("/api/v1/employees/abc").set("Authorization", admin);
      expect(bad.status).toBe(400);

      expect((await req(app).get(`/api/v1/employees/${id}`)).status).toBe(401);
      expect(
        (await req(app).get(`/api/v1/employees/${id}`).set("Authorization", employeeAuth)).status
      ).toBe(403);
    });
  });

  describe("PATCH /employees/:id", () => {
    it("updates fields and syncs the login email", async () => {
      const created = await req(app)
        .post("/api/v1/employees")
        .set("Authorization", admin)
        .send(payload("patch"));
      const id = created.body.data.id;

      const res = await req(app)
        .patch(`/api/v1/employees/${id}`)
        .set("Authorization", admin)
        .send({ first_name: "Renamed", email: email("patched"), monthly_base_salary: 61000.5, phone: null });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        first_name: "Renamed",
        email: email("patched"),
        monthly_base_salary: "61000.50",
        phone: null,
      });

      const user = await getDatabase().query(`SELECT email FROM "user" WHERE employee_id = $1`, [id]);
      expect(user.rows[0].email).toBe(email("patched"));
    });

    it("validates: empty body, status change, unknown id, duplicate", async () => {
      const a = await req(app).post("/api/v1/employees").set("Authorization", admin).send(payload("pa"));
      await req(app).post("/api/v1/employees").set("Authorization", admin).send(payload("pb"));
      const id = a.body.data.id;

      const empty = await req(app).patch(`/api/v1/employees/${id}`).set("Authorization", admin).send({});
      expect(empty.status).toBe(400);

      const status = await req(app)
        .patch(`/api/v1/employees/${id}`)
        .set("Authorization", admin)
        .send({ status: "INACTIVE" });
      expect(status.status).toBe(400);

      const unknown = await req(app)
        .patch("/api/v1/employees/11111111-1111-4111-8111-111111111111")
        .set("Authorization", admin)
        .send({ first_name: "X" });
      expect(unknown.status).toBe(404);

      const dup = await req(app)
        .patch(`/api/v1/employees/${id}`)
        .set("Authorization", admin)
        .send({ employee_code: `${PREFIX}-pb` });
      expect(dup.status).toBe(409);

      expect(
        (await req(app).patch(`/api/v1/employees/${id}`).send({ first_name: "X" })).status
      ).toBe(401);
      expect(
        (await req(app).patch(`/api/v1/employees/${id}`).set("Authorization", employeeAuth).send({ first_name: "X" })).status
      ).toBe(403);
    });
  });

  describe("POST /employees/:id/deactivate", () => {
    it("deactivates the employee and disables their login", async () => {
      const created = await req(app)
        .post("/api/v1/employees")
        .set("Authorization", admin)
        .send(payload("deact"));
      const id = created.body.data.id;

      const res = await req(app)
        .post(`/api/v1/employees/${id}/deactivate`)
        .set("Authorization", admin);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("INACTIVE");

      const user = await getDatabase().query(`SELECT status::text AS s FROM "user" WHERE employee_id = $1`, [id]);
      expect(user.rows[0].s).toBe("INACTIVE");

      const login = await req(app)
        .post("/api/v1/auth/login")
        .send({ email: email("deact"), password: "Passw0rd!123" });
      expect(login.status).toBe(401);

      // idempotent
      const again = await req(app).post(`/api/v1/employees/${id}/deactivate`).set("Authorization", admin);
      expect(again.status).toBe(200);
    });

    it("404 for unknown, 401/403 for unauthorised", async () => {
      const unknown = await req(app)
        .post("/api/v1/employees/11111111-1111-4111-8111-111111111111/deactivate")
        .set("Authorization", admin);
      expect(unknown.status).toBe(404);
      const path = "/api/v1/employees/11111111-1111-4111-8111-111111111111/deactivate";
      expect((await req(app).post(path)).status).toBe(401);
      expect((await req(app).post(path).set("Authorization", employeeAuth)).status).toBe(403);
    });
  });

  describe("GET /departments and /shifts", () => {
    it("lists departments", async () => {
      const res = await req(app).get("/api/v1/departments").set("Authorization", admin);
      expect(res.status).toBe(200);
      const d = res.body.data.find((x: { id: string }) => x.id === departmentId);
      expect(d).toMatchObject({ code: PREFIX, status: "ACTIVE" });
    });

    it("lists shifts with named weekly-off days", async () => {
      const res = await req(app).get("/api/v1/shifts").set("Authorization", admin);
      expect(res.status).toBe(200);
      const s = res.body.data.find((x: { id: string }) => x.id === shiftId);
      expect(s).toMatchObject({
        start_time: "09:00",
        end_time: "18:00",
        weekly_off_days: ["SUNDAY", "SATURDAY"],
      });
    });

    it("requires ADMIN", async () => {
      for (const path of ["/api/v1/departments", "/api/v1/shifts"]) {
        expect((await req(app).get(path)).status).toBe(401);
        expect((await req(app).get(path).set("Authorization", employeeAuth)).status).toBe(403);
      }
    });
  });
});
