import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const PREFIX = `T5R${Date.now().toString(36)}`.toUpperCase();

/** 128-d vector with a single non-zero component. */
const unit = (i: number, scale = 1): number[] =>
  Array.from({ length: 128 }, (_, k) => (k === i ? scale : 0));

describe("Stage 5: face registration endpoints", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });
  let admin: string;
  let employee: string;
  let departmentId: string;
  let shiftId: string;
  let emp1: string;
  let emp2: string;
  let inactiveEmp: string;

  const url = (id: string, suffix = "") => `/api/v1/employees/${id}/face${suffix}`;
  const register = (id: string, body: object, auth = admin) =>
    req(app).post(url(id, "/register")).set("Authorization", auth).send(body);

  beforeAll(async () => {
    initDatabase(databaseUrl);
    const adminId = await ensureFixtureAdmin();
    admin = bearer({ id: adminId, email: "fixture-admin@example.test", role: "ADMIN", employee_id: null });
    employee = bearer({ id: NIL, email: "emp@example.test", role: "EMPLOYEE", employee_id: NIL });
    const ds = await makeDepartmentAndShift(PREFIX);
    departmentId = ds.department;
    shiftId = ds.shift;
    emp1 = await makeEmployee(PREFIX, "1", departmentId, shiftId);
    emp2 = await makeEmployee(PREFIX, "2", departmentId, shiftId);
    inactiveEmp = await makeEmployee(PREFIX, "3", departmentId, shiftId, { status: "INACTIVE" });
  });

  afterAll(async () => {
    const db = getDatabase();
    const ids = [emp1, emp2, inactiveEmp];
    await db.query(`DELETE FROM face_embedding WHERE employee_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM face_registration_metadata WHERE employee_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM employee WHERE id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM shift WHERE id = $1`, [shiftId]);
    await db.query(`DELETE FROM department WHERE id = $1`, [departmentId]);
  });

  describe("auth", () => {
    it("returns 401 without a token on all three endpoints", async () => {
      expect((await req(app).post(url(emp1, "/register")).send({ embedding: unit(0) })).status).toBe(401);
      expect((await req(app).delete(url(emp1))).status).toBe(401);
      expect((await req(app).get(url(emp1, "/status"))).status).toBe(401);
    });

    it("returns 403 for EMPLOYEE on all three endpoints", async () => {
      expect((await register(emp1, { embedding: unit(0) }, employee)).status).toBe(403);
      expect((await req(app).delete(url(emp1)).set("Authorization", employee)).status).toBe(403);
      expect((await req(app).get(url(emp1, "/status")).set("Authorization", employee)).status).toBe(403);
    });
  });

  describe("POST /employees/:id/face/register", () => {
    it("registers a face, flips face_registered, and never returns the embedding", async () => {
      const res = await register(emp1, { embedding: unit(0), model_version: "tiny-1" });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        employee_id: emp1,
        model_version: "tiny-1",
        replaced: false,
      });
      expect(JSON.stringify(res.body)).not.toContain("embedding");

      const detail = await req(app).get(`/api/v1/employees/${emp1}`).set("Authorization", admin);
      expect(detail.body.data.face_registered).toBe(true);

      const stored = await getDatabase().query(
        `SELECT m.vector_record_id, e.id, m.registered_by_user_id
           FROM face_registration_metadata m JOIN face_embedding e ON e.registration_id = m.id
          WHERE m.employee_id = $1 AND m.status = 'ACTIVE'`,
        [emp1]
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0].vector_record_id).toBe(stored.rows[0].id);
    });

    it("defaults model_version when omitted", async () => {
      const res = await register(emp2, { embedding: unit(1) });
      expect(res.status).toBe(201);
      expect(res.body.data.model_version).toBe("1");
    });

    it("re-registration supersedes the old face (one ACTIVE, old vector deleted) and audits", async () => {
      const res = await register(emp1, { embedding: unit(5) });
      expect(res.status).toBe(201);
      expect(res.body.data.replaced).toBe(true);

      const db = getDatabase();
      const rows = await db.query(
        `SELECT status::text AS status FROM face_registration_metadata WHERE employee_id = $1 ORDER BY registered_at`,
        [emp1]
      );
      expect(rows.rows.map((r: any) => r.status)).toEqual(["SUPERSEDED", "ACTIVE"]);
      const vectors = await db.query(`SELECT 1 FROM face_embedding WHERE employee_id = $1`, [emp1]);
      expect(vectors.rowCount).toBe(1);

      const audit = await db.query(
        `SELECT action FROM audit_log
          WHERE entity_type = 'face_registration' AND metadata->>'employee_id' = $1
          ORDER BY created_at`,
        [emp1]
      );
      expect(audit.rows.map((r: any) => r.action)).toEqual(["FACE_REGISTERED", "FACE_REREGISTERED"]);
    });

    it("409 for an INACTIVE employee and writes nothing", async () => {
      const res = await register(inactiveEmp, { embedding: unit(2) });
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      const rows = await getDatabase().query(
        `SELECT 1 FROM face_registration_metadata WHERE employee_id = $1`,
        [inactiveEmp]
      );
      expect(rows.rowCount).toBe(0);
    });

    it("404 for an unknown employee", async () => {
      expect((await register(NIL, { embedding: unit(0) })).status).toBe(404);
    });

    it("400 for a malformed id", async () => {
      expect((await register("not-a-uuid", { embedding: unit(0) })).status).toBe(400);
    });

    it("400 for invalid embeddings and bodies", async () => {
      const bad: object[] = [
        {},
        { embedding: "nope" },
        { embedding: unit(0).slice(0, 127) },
        { embedding: [...unit(0), 0] },
        { embedding: unit(0).map((x, i) => (i === 3 ? "x" : x)) },
        { embedding: unit(0).map((x, i) => (i === 3 ? null : x)) },
        { embedding: unit(0, 1e6) },
        { embedding: Array(128).fill(0) },
        { embedding: unit(0), model_version: "" },
        { embedding: unit(0), employee_id: NIL },
      ];
      for (const body of bad) {
        const res = await register(emp2, body);
        expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
        expect(res.body.error.code).toBeDefined();
      }
    });
  });

  describe("GET /employees/:id/face/status", () => {
    it("reports a registered employee", async () => {
      const res = await req(app).get(url(emp1, "/status")).set("Authorization", admin);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        employee_id: emp1,
        is_registered: true,
        model_name: "face-api.js",
      });
      expect(typeof res.body.data.registered_at).toBe("string");
    });

    it("reports an unregistered employee", async () => {
      const res = await req(app).get(url(inactiveEmp, "/status")).set("Authorization", admin);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ is_registered: false, registered_at: null });
    });

    it("404 for an unknown employee, 400 for a bad id", async () => {
      expect((await req(app).get(url(NIL, "/status")).set("Authorization", admin)).status).toBe(404);
      expect((await req(app).get(url("x", "/status")).set("Authorization", admin)).status).toBe(400);
    });
  });

  describe("DELETE /employees/:id/face", () => {
    it("revokes the face, removes the vector, audits, and flips face_registered", async () => {
      const res = await req(app).delete(url(emp2)).set("Authorization", admin);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ employee_id: emp2, is_registered: false });

      const db = getDatabase();
      expect((await db.query(`SELECT 1 FROM face_embedding WHERE employee_id = $1`, [emp2])).rowCount).toBe(0);
      const meta = await db.query(
        `SELECT status::text AS status, revoked_at FROM face_registration_metadata WHERE employee_id = $1`,
        [emp2]
      );
      expect(meta.rows[0].status).toBe("REVOKED");
      expect(meta.rows[0].revoked_at).not.toBeNull();

      const detail = await req(app).get(`/api/v1/employees/${emp2}`).set("Authorization", admin);
      expect(detail.body.data.face_registered).toBe(false);

      const audit = await db.query(
        `SELECT 1 FROM audit_log WHERE action = 'FACE_REVOKED' AND metadata->>'employee_id' = $1`,
        [emp2]
      );
      expect(audit.rowCount).toBe(1);
    });

    it("404 when there is nothing to revoke (second delete) or the employee is unknown", async () => {
      expect((await req(app).delete(url(emp2)).set("Authorization", admin)).status).toBe(404);
      expect((await req(app).delete(url(NIL)).set("Authorization", admin)).status).toBe(404);
    });

    it("allows registering again after a revoke", async () => {
      const res = await register(emp2, { embedding: unit(7) });
      expect(res.status).toBe(201);
      expect(res.body.data.replaced).toBe(false);
    });
  });

  it("concurrent registrations for one employee leave exactly one ACTIVE face", async () => {
    const results = await Promise.all([
      register(emp1, { embedding: unit(10) }),
      register(emp1, { embedding: unit(11) }),
      register(emp1, { embedding: unit(12) }),
    ]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const active = await getDatabase().query(
      `SELECT 1 FROM face_registration_metadata WHERE employee_id = $1 AND status = 'ACTIVE'`,
      [emp1]
    );
    expect(active.rowCount).toBe(1);
    const vectors = await getDatabase().query(`SELECT 1 FROM face_embedding WHERE employee_id = $1`, [emp1]);
    expect(vectors.rowCount).toBe(1);
  });
});
