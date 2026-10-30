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
const PREFIX = `T2B${Date.now().toString(36)}`;
const NIL = "11111111-1111-4111-8111-111111111111";

describe("Stage 2b: attendance", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });
  let departmentId: string;
  let shiftId: string;
  let adminUserId: string;
  let adminAuth: string;
  let empA: string; // active
  let empB: string; // active, other
  let empInactive: string;
  let authA: string;
  let authB: string;

  async function makeEmployee(n: string, status = "ACTIVE"): Promise<string> {
    const r = await getDatabase().query<{ id: string }>(
      `INSERT INTO employee (employee_code, first_name, last_name, email, department_id, shift_id, monthly_base_salary, status)
       VALUES ($1, 'T', $2, $3, $4, $5, 30000, $6) RETURNING id`,
      [`${PREFIX}-${n}`, n, `${PREFIX}-${n}@example.test`.toLowerCase(), departmentId, shiftId, status]
    );
    return r.rows[0].id;
  }

  const post = (path: string, auth?: string, body: object = {}) => {
    const r = req(app).post(`/api/v1${path}`);
    return (auth ? r.set("Authorization", auth) : r).send(body);
  };

  beforeAll(async () => {
    initDatabase(databaseUrl);
    const db = getDatabase();
    departmentId = (
      await db.query<{ id: string }>(
        `INSERT INTO department (code, name, status) VALUES ($1, 'T', 'ACTIVE') RETURNING id`,
        [PREFIX]
      )
    ).rows[0].id;
    shiftId = (
      await db.query<{ id: string }>(
        `INSERT INTO shift (name, start_time, end_time, scheduled_duration_minutes, status)
         VALUES ($1, '09:00', '18:00', 540, 'ACTIVE') RETURNING id`,
        [PREFIX]
      )
    ).rows[0].id;
    // Persistent fixture: audit_log is append-only, so a user who authored an
    // audit entry can never be deleted (the FK's SET NULL is blocked). Reuse one.
    adminUserId = (
      await db.query<{ id: string }>(
        `INSERT INTO "user" (email, password_hash, role, status)
         VALUES ('test-attendance-admin@example.test', 'x', 'ADMIN', 'INACTIVE')
         ON CONFLICT (email) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
         RETURNING id`
      )
    ).rows[0].id;
    adminAuth = bearer({ id: adminUserId, email: "a@example.test", role: "ADMIN", employee_id: null });
    empA = await makeEmployee("a");
    empB = await makeEmployee("b");
    empInactive = await makeEmployee("inactive", "INACTIVE");
    authA = bearer({ id: NIL, email: "ea@example.test", role: "EMPLOYEE", employee_id: empA });
    authB = bearer({ id: NIL, email: "eb@example.test", role: "EMPLOYEE", employee_id: empB });
  });

  afterAll(async () => {
    const db = getDatabase();
    const ids = `(SELECT id FROM employee WHERE employee_code LIKE $1)`;
    const like = [`${PREFIX}-%`];
    await db.query(`DELETE FROM employee_day_attendance WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM attendance_session WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM employee WHERE employee_code LIKE $1`, like);
    await db.query(`DELETE FROM shift WHERE id = $1`, [shiftId]);
    await db.query(`DELETE FROM department WHERE id = $1`, [departmentId]);
    await db.close();
  });

  describe("auth and validation", () => {
    it("401 without token on every endpoint", async () => {
      expect((await post("/attendance/check-in")).status).toBe(401);
      expect((await post("/attendance/check-out")).status).toBe(401);
      expect((await req(app).get("/api/v1/attendance/today")).status).toBe(401);
      expect((await req(app).patch(`/api/v1/attendance/${NIL}`).send({})).status).toBe(401);
    });

    it("ADMIN must name an employee; EMPLOYEE cannot act for someone else", async () => {
      expect((await post("/attendance/check-in", adminAuth)).status).toBe(400);
      expect((await post("/attendance/check-in", authA, { employee_id: empB })).status).toBe(403);
      expect((await post("/attendance/check-out", authA, { employee_id: empB })).status).toBe(403);
      expect(
        (await req(app).get(`/api/v1/attendance/today?employee_id=${empB}`).set("Authorization", authA)).status
      ).toBe(403);
    });

    it("rejects client timestamps, unsupported sources and bad ids", async () => {
      expect((await post("/attendance/check-in", adminAuth, { employee_id: empA, timestamp: new Date().toISOString() })).status).toBe(400);
      expect((await post("/attendance/check-in", adminAuth, { employee_id: empA, source: "FACE_RECOGNITION" })).status).toBe(400);
      expect((await post("/attendance/check-in", adminAuth, { employee_id: "nope" })).status).toBe(400);
    });

    it("404 for unknown employee", async () => {
      expect((await post("/attendance/check-in", adminAuth, { employee_id: NIL })).status).toBe(404);
      expect((await post("/attendance/check-out", adminAuth, { employee_id: NIL })).status).toBe(404);
    });
  });

  describe("check-in / check-out / today", () => {
    it("runs the full flow for an employee acting on themself", async () => {
      const before = await req(app).get("/api/v1/attendance/today").set("Authorization", authA);
      expect(before.status).toBe(200);
      expect(before.body.data).toMatchObject({ employee_id: empA, status: "NOT_CHECKED_IN", sessions: [], day: null });

      const inRes = await post("/attendance/check-in", authA);
      expect(inRes.status).toBe(201);
      expect(inRes.body.data).toMatchObject({ employee_id: empA, status: "CHECKED_IN", check_out: null });

      const mid = await req(app).get("/api/v1/attendance/today").set("Authorization", authA);
      expect(mid.body.data.status).toBe("CHECKED_IN");

      const dup = await post("/attendance/check-in", authA);
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe("CONFLICT");

      const out = await post("/attendance/check-out", authA);
      expect(out.status).toBe(200);
      expect(out.body.data).toMatchObject({
        id: inRes.body.data.id,
        status: "COMPLETED",
        classification: "HALF_DAY", // seconds of work < 4h
        working_duration_minutes: 0,
      });
      expect(out.body.data.day).toMatchObject({ classification: "HALF_DAY", payable_day_fraction: "0.50" });

      const again = await post("/attendance/check-out", authA);
      expect(again.status).toBe(409);

      const after = await req(app).get("/api/v1/attendance/today").set("Authorization", authA);
      expect(after.body.data.status).toBe("CHECKED_OUT");
      expect(after.body.data.sessions).toHaveLength(1);
      expect(after.body.data.day).not.toBeNull();
    });

    it("admin can punch for an employee; check-out without check-in is 409", async () => {
      expect((await post("/attendance/check-out", adminAuth, { employee_id: empB })).status).toBe(409);
      expect((await post("/attendance/check-in", adminAuth, { employee_id: empB })).status).toBe(201);
      expect((await post("/attendance/check-out", adminAuth, { employee_id: empB })).status).toBe(200);
    });

    it("rejects check-in for an inactive employee", async () => {
      const res = await post("/attendance/check-in", adminAuth, { employee_id: empInactive });
      expect(res.status).toBe(409);
    });

    it("concurrent check-ins create exactly one open session", async () => {
      const emp = await makeEmployee("race");
      const results = await Promise.all(
        Array.from({ length: 5 }, () => post("/attendance/check-in", adminAuth, { employee_id: emp }))
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    });
  });

  describe("GET /attendance", () => {
    const list = (q: string, auth?: string) => {
      const r = req(app).get(`/api/v1/attendance${q}`);
      return auth ? r.set("Authorization", auth) : r;
    };

    it("401 without a token; validates query", async () => {
      expect((await list("")).status).toBe(401);
      expect((await list("?employee_id=x", adminAuth)).status).toBe(400);
      expect((await list("?from=2030-02-01&to=2030-01-01", adminAuth)).status).toBe(400);
      expect((await list("?limit=0", adminAuth)).status).toBe(400);
    });

    it("admin filters by employee and department; employee sees only own", async () => {
      await post("/attendance/check-in", adminAuth, { employee_id: empB });
      await post("/attendance/check-out", adminAuth, { employee_id: empB });

      const byEmp = await list(`?employee_id=${empB}`, adminAuth);
      expect(byEmp.status).toBe(200);
      expect(byEmp.body.data.length).toBeGreaterThan(0);
      expect(byEmp.body.data.every((s: { employee_id: string }) => s.employee_id === empB)).toBe(true);

      const byDept = await list(`?department_id=${departmentId}&limit=500`, adminAuth);
      const owners = new Set(byDept.body.data.map((s: { employee_id: string }) => s.employee_id));
      expect(owners.has(empB)).toBe(true);
      expect(owners.has(empA)).toBe(true);

      const mine = await list("", authB);
      expect(mine.body.data.every((s: { employee_id: string }) => s.employee_id === empB)).toBe(true);
      expect((await list(`?employee_id=${empA}`, authB)).status).toBe(403);

      const future = await list("?from=2999-01-01", adminAuth);
      expect(future.body.data).toEqual([]);
    });
  });

  describe("PATCH /attendance/:id (admin correction)", () => {
    let employeeId: string;
    let sessionId: string;
    const dayAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

    beforeAll(async () => {
      employeeId = await makeEmployee("corr");
      const s = await post("/attendance/check-in", adminAuth, { employee_id: employeeId });
      sessionId = s.body.data.id;
    });

    const patch = (id: string, auth: string | undefined, body: object) => {
      const r = req(app).patch(`/api/v1/attendance/${id}`);
      return (auth ? r.set("Authorization", auth) : r).send(body);
    };

    it("403 for EMPLOYEE", async () => {
      expect((await patch(sessionId, authA, { check_in: dayAgo(10), reason: "x" })).status).toBe(403);
    });

    it("400 for missing reason, no fields, out before in, future time", async () => {
      expect((await patch(sessionId, adminAuth, { check_in: dayAgo(10) })).status).toBe(400);
      expect((await patch(sessionId, adminAuth, { reason: "x" })).status).toBe(400);
      expect((await patch(sessionId, adminAuth, { check_in: dayAgo(1), check_out: dayAgo(2), reason: "x" })).status).toBe(400);
      expect(
        (await patch(sessionId, adminAuth, { check_out: new Date(Date.now() + 3600_000).toISOString(), reason: "x" })).status
      ).toBe(400);
      expect((await patch("bad", adminAuth, { check_in: dayAgo(1), reason: "x" })).status).toBe(400);
    });

    it("404 for unknown session", async () => {
      expect((await patch(NIL, adminAuth, { check_in: dayAgo(2), reason: "x" })).status).toBe(404);
    });

    it("400 when the stored check-in is after a new check-out", async () => {
      const res = await patch(sessionId, adminAuth, { check_out: dayAgo(48), reason: "x" });
      expect(res.status).toBe(400);
    });

    it("corrects times, recomputes duration/classification and writes an audit entry", async () => {
      const inAt = dayAgo(10);
      const outAt = dayAgo(1);
      const res = await patch(sessionId, adminAuth, { check_in: inAt, check_out: outAt, reason: "forgot to punch" });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: "COMPLETED",
        correction_reason: "forgot to punch",
        working_duration_minutes: 540,
      });

      const day = await getDatabase().query(
        `SELECT classification::text AS c, total_working_minutes AS m FROM employee_day_attendance
         WHERE employee_id = $1 AND work_date = $2`,
        [employeeId, res.body.data.work_date]
      );
      expect(day.rows[0]).toEqual({ c: "FULL_DAY", m: 540 });

      const audit = await getDatabase().query(
        `SELECT actor_user_id, action FROM audit_log WHERE entity_type = 'attendance_session' AND entity_id = $1`,
        [sessionId]
      );
      expect(audit.rows.length).toBeGreaterThan(0);
      expect(audit.rows.every((r) => r.action === "CORRECT" && r.actor_user_id === adminUserId)).toBe(true);
    });

    it("shortening a correction reclassifies the day", async () => {
      const res = await patch(sessionId, adminAuth, { check_out: new Date(Date.parse(dayAgo(10)) + 2 * 3600_000).toISOString(), reason: "left early" });
      expect(res.status).toBe(200);
      expect(res.body.data.working_duration_minutes).toBe(120);
      const day = await getDatabase().query(
        `SELECT classification::text AS c, total_working_minutes AS m FROM employee_day_attendance
         WHERE employee_id = $1 AND work_date = $2`,
        [employeeId, res.body.data.work_date]
      );
      expect(day.rows[0]).toEqual({ c: "HALF_DAY", m: 120 });
    });
  });
});
