import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  NIL,
  bearer,
  ensureFixtureAdmin,
  makeDepartmentAndShift,
  makeEmployee,
  req,
} from "./helpers.js";
import { createApp } from "../src/app.js";
import { getDatabase, initDatabase } from "../src/database/client.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
if (!databaseUrl || !jwtSecret) {
  throw new Error("DATABASE_URL and JWT_SECRET are required for tests");
}

const PREFIX = `T5K${Date.now().toString(36)}`.toUpperCase();
// Dimensions 30-39 are unique to this file.
const vec = (k: number): number[] => Array.from({ length: 128 }, (_, i) => (i === k ? 1 : 0));

describe("Stage 5: shared kiosk account", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });
  let adminId: string;
  let admin: string;
  let kiosk: string;
  let departmentId: string;
  let shiftId: string;
  let emp: string;
  const created: string[] = [];

  const post = (path: string, auth: string, body: object = {}) =>
    req(app).post(`/api/v1${path}`).set("Authorization", auth).send(body);

  /** What the admin portal + kiosk page do: launch (ADMIN) then redeem the code. */
  async function activateKiosk(): Promise<string> {
    const launch = await post("/kiosk/launch", admin);
    const session = await req(app).post("/api/v1/kiosk/session").send({ code: launch.body.data.code });
    return `Bearer ${session.body.data.token}`;
  }

  beforeAll(async () => {
    initDatabase(databaseUrl);
    const db = getDatabase();
    adminId = await ensureFixtureAdmin();
    admin = bearer({ id: adminId, email: "fixture-admin@example.test", role: "ADMIN", employee_id: null });
    kiosk = await activateKiosk();
    const ds = await makeDepartmentAndShift(PREFIX);
    departmentId = ds.department;
    shiftId = ds.shift;
    emp = await makeEmployee(PREFIX, "K", departmentId, shiftId);
    created.push(emp);
    expect((await post(`/employees/${emp}/face/register`, admin, { embedding: vec(30) })).status).toBe(201);
  });

  afterAll(async () => {
    const db = getDatabase();
    await db.query(`DELETE FROM employee_day_attendance WHERE employee_id = ANY($1::uuid[])`, [created]);
    await db.query(`DELETE FROM attendance_session WHERE employee_id = ANY($1::uuid[])`, [created]);
    await db.query(`DELETE FROM face_embedding WHERE employee_id = ANY($1::uuid[])`, [created]);
    await db.query(`DELETE FROM face_registration_metadata WHERE employee_id = ANY($1::uuid[])`, [created]);
    await db.query(`DELETE FROM employee WHERE id = ANY($1::uuid[])`, [created]);
    await db.query(`DELETE FROM shift WHERE id = $1`, [shiftId]);
    await db.query(`DELETE FROM department WHERE id = $1`, [departmentId]);
  });

  describe("admin launch -> kiosk session", () => {
    it("launch is ADMIN-only", async () => {
      expect((await req(app).post("/api/v1/kiosk/launch")).status).toBe(401);
      const e = bearer({ id: NIL, email: "e@example.test", role: "EMPLOYEE", employee_id: emp });
      expect((await post("/kiosk/launch", e)).status).toBe(403);
      expect((await post("/kiosk/launch", kiosk)).status).toBe(403);
    });

    it("a launch code is exchanged once for a KIOSK token, and audited to the admin", async () => {
      const launch = await post("/kiosk/launch", admin);
      expect(launch.status).toBe(201);
      expect(launch.body.data).toMatchObject({ expires_in_seconds: 60 });
      const first = await req(app).post("/api/v1/kiosk/session").send({ code: launch.body.data.code });
      expect(first.status).toBe(200);
      expect(first.body.data.user).toMatchObject({ role: "KIOSK", employee_id: null });
      const me = await req(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${first.body.data.token}`);
      expect(me.body.data.role).toBe("KIOSK");
      const audit = await getDatabase().query(
        `SELECT actor_user_id FROM audit_log WHERE action = 'KIOSK_ACTIVATED' AND entity_id = $1`,
        [first.body.data.user.id]
      );
      expect(audit.rows[0].actor_user_id).toBe(adminId);
      // single use
      const again = await req(app).post("/api/v1/kiosk/session").send({ code: launch.body.data.code });
      expect(again.status).toBe(401);
    });

    it("rejects unknown, malformed and expired codes", async () => {
      const s = (body: object) => req(app).post("/api/v1/kiosk/session").send(body);
      expect((await s({ code: "x".repeat(43) })).status).toBe(401);
      expect((await s({ code: "short" })).status).toBe(400);
      expect((await s({})).status).toBe(400);
      expect((await s({ code: "x".repeat(43), extra: 1 })).status).toBe(400);

      const launch = await post("/kiosk/launch", admin);
      const realNow = Date.now();
      const spy = vi.spyOn(Date, "now").mockReturnValue(realNow + 61_000);
      const expired = await s({ code: launch.body.data.code });
      spy.mockRestore();
      expect(expired.status).toBe(401);
    });

    it("the old shared-password login can no longer produce a kiosk session", async () => {
      const db = getDatabase();
      const { hashPassword } = await import("../src/auth/password.js");
      await db.query(
        `INSERT INTO "user" (email, password_hash, role, status) VALUES ('test-kiosk-legacy@example.test', $1, 'KIOSK', 'ACTIVE')
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [await hashPassword("Legacy-kiosk-pass-1")]
      );
      const res = await req(createApp({ jwtSecret, jwtExpiresIn: "1h" }))
        .post("/api/v1/auth/login")
        .send({ email: "test-kiosk-legacy@example.test", password: "Legacy-kiosk-pass-1" });
      await db.query(`DELETE FROM "user" WHERE email = 'test-kiosk-legacy@example.test'`);
      expect(res.status).toBe(401);
    });
  });

  it("recognize returns the display name and today's status for a match", async () => {
    const res = await post("/face/recognize", kiosk, { embedding: vec(30) });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      matched: true,
      employee_id: emp,
      employee: { employee_code: `${PREFIX}-K`, first_name: "T", last_name: "K" },
      today_status: "NOT_CHECKED_IN",
    });
  });

  it("recognize reports no employee details when there is no match", async () => {
    const res = await post("/face/recognize", kiosk, { embedding: vec(39) });
    expect(res.body.data).toMatchObject({ matched: false, employee: null, today_status: null });
  });

  it("kiosk can check in and out with a face proof, and today_status follows", async () => {
    const proof = async () => (await post("/face/recognize", kiosk, { embedding: vec(30) })).body.data;
    const p1 = await proof();
    const inRes = await post("/attendance/check-in", kiosk, {
      employee_id: emp, source: "FACE_RECOGNITION", recognition_token: p1.recognition_token,
    });
    expect(inRes.status).toBe(201);
    expect((await proof()).today_status).toBe("CHECKED_IN");
    const p2 = await proof();
    const outRes = await post("/attendance/check-out", kiosk, {
      employee_id: emp, source: "FACE_RECOGNITION", recognition_token: p2.recognition_token,
    });
    expect(outRes.status).toBe(200);
    expect((await proof()).today_status).toBe("CHECKED_OUT");
  });

  it("kiosk cannot punch MANUALLY (403), with or without a source", async () => {
    for (const body of [{ employee_id: emp }, { employee_id: emp, source: "MANUAL" }]) {
      expect((await post("/attendance/check-in", kiosk, body)).status).toBe(403);
      expect((await post("/attendance/check-out", kiosk, body)).status).toBe(403);
    }
  });

  it("a proof issued to the admin cannot be used by the kiosk", async () => {
    const adminProof = (await post("/face/recognize", admin, { embedding: vec(30) })).body.data.recognition_token;
    const res = await post("/attendance/check-in", kiosk, {
      employee_id: emp, source: "FACE_RECOGNITION", recognition_token: adminProof,
    });
    expect(res.status).toBe(403);
  });

  it("an EMPLOYEE token cannot call recognize", async () => {
    const e = bearer({ id: NIL, email: "e@example.test", role: "EMPLOYEE", employee_id: emp });
    expect((await post("/face/recognize", e, { embedding: vec(30) })).status).toBe(403);
  });

  it("kiosk cannot read attendance, employees or payroll", async () => {
    for (const p of [`/attendance/today?employee_id=${emp}`, "/attendance", "/employees", `/employees/${emp}`, "/payroll/records", "/reports/dashboard"]) {
      expect((await req(app).get(`/api/v1${p}`).set("Authorization", kiosk)).status).toBe(403);
    }
  });
});
