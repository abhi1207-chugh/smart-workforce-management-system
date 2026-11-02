import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  NIL,
  bearer,
  ensureFixtureAdmin,
  makeDepartmentAndShift,
  makeEmployee,
  req,
} from "./helpers.js";
import { createApp } from "../src/app.js";
import { loadFaceConfig, type FaceConfig } from "../src/config/env.js";
import { getDatabase, initDatabase } from "../src/database/client.js";
import { verifyRecognitionProof } from "../src/auth/recognition-proof.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
if (!databaseUrl || !jwtSecret) {
  throw new Error("DATABASE_URL and JWT_SECRET are required for tests");
}

const PREFIX = `T5C${Date.now().toString(36)}`.toUpperCase();

/**
 * Basis-vector arithmetic keeps cosine similarities exact. This file only uses
 * dimensions >= 100; face-registration.test.ts uses dimensions <= 12, so the two
 * files can run in parallel without matching each other's faces (cosine = 0).
 */
const vec = (parts: Record<number, number>): number[] =>
  Array.from({ length: 128 }, (_, k) => parts[k] ?? 0);
const unitVec = (parts: Record<number, number>): number[] => {
  const v = vec(parts);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
};

const STRICT: FaceConfig = { matchThreshold: 0.9, ambiguityMargin: 0.03, proofTtlSeconds: 30 };
const LOOSE: FaceConfig = { matchThreshold: 0.6, ambiguityMargin: 0.03, proofTtlSeconds: 30 };

describe("Stage 5: POST /face/recognize", () => {
  const auth = { jwtSecret, jwtExpiresIn: "1h" };
  const app = createApp(auth, STRICT);
  const looseApp = createApp(auth, LOOSE);

  let adminId: string;
  let admin: string;
  let employeeToken: string;
  let departmentId: string;
  let shiftId: string;
  let empA: string;
  let empB: string;
  let empInactive: string;
  let empRevoked: string;
  let empDeactivate: string;
  const created: string[] = [];

  const register = (id: string, embedding: number[]) =>
    req(app)
      .post(`/api/v1/employees/${id}/face/register`)
      .set("Authorization", admin)
      .send({ embedding });
  const recognize = (embedding: number[], a = app, token = admin) =>
    req(a).post("/api/v1/face/recognize").set("Authorization", token).send({ embedding });

  beforeAll(async () => {
    initDatabase(databaseUrl);
    adminId = await ensureFixtureAdmin();
    admin = bearer({ id: adminId, email: "fixture-admin@example.test", role: "ADMIN", employee_id: null });
    employeeToken = bearer({ id: NIL, email: "emp@example.test", role: "EMPLOYEE", employee_id: NIL });
    const ds = await makeDepartmentAndShift(PREFIX);
    departmentId = ds.department;
    shiftId = ds.shift;
    const mk = async (n: string) => {
      const id = await makeEmployee(PREFIX, n, departmentId, shiftId);
      created.push(id);
      return id;
    };
    empA = await mk("A");
    empB = await mk("B");
    empInactive = await mk("I");
    empRevoked = await mk("R");
    empDeactivate = await mk("D");

    expect((await register(empA, vec({ 100: 1 }))).status).toBe(201);
    expect((await register(empB, vec({ 101: 1 }))).status).toBe(201);
    expect((await register(empInactive, vec({ 102: 1 }))).status).toBe(201);
    expect((await register(empRevoked, vec({ 103: 1 }))).status).toBe(201);
    expect((await register(empDeactivate, vec({ 104: 1 }))).status).toBe(201);
    // Deactivate behind the API's back so the embedding is still present: search must still skip it.
    await getDatabase().query(`UPDATE employee SET status = 'INACTIVE' WHERE id = $1`, [empInactive]);
    expect(
      (await req(app).delete(`/api/v1/employees/${empRevoked}/face`).set("Authorization", admin)).status
    ).toBe(200);
  });

  afterAll(async () => {
    const db = getDatabase();
    await db.query(`DELETE FROM face_embedding WHERE employee_id = ANY($1::uuid[])`, [created]);
    await db.query(`DELETE FROM face_registration_metadata WHERE employee_id = ANY($1::uuid[])`, [created]);
    await db.query(`DELETE FROM employee WHERE id = ANY($1::uuid[])`, [created]);
    await db.query(`DELETE FROM shift WHERE id = $1`, [shiftId]);
    await db.query(`DELETE FROM department WHERE id = $1`, [departmentId]);
  });

  describe("auth and validation", () => {
    it("401 without a token", async () => {
      const res = await req(app).post("/api/v1/face/recognize").send({ embedding: vec({ 100: 1 }) });
      expect(res.status).toBe(401);
    });

    it("401 when a recognition proof is used as a login token", async () => {
      const ok = await recognize(vec({ 100: 1 }));
      const res = await req(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${ok.body.data.recognition_token}`);
      expect(res.status).toBe(401);
    });

    it("any authenticated role may call it (kiosk)", async () => {
      expect((await recognize(vec({ 100: 1 }), app, employeeToken)).status).toBe(200);
    });

    it("400 for invalid bodies", async () => {
      const bad: object[] = [
        {},
        { embedding: [1, 2, 3] },
        { embedding: Array(128).fill(0) },
        { embedding: Array(128).fill("a") },
        { embedding: vec({ 100: 1 }), employee_id: NIL },
        { embedding: vec({ 100: 1 }), confidence: 1 },
      ];
      for (const body of bad) {
        const res = await req(app).post("/api/v1/face/recognize").set("Authorization", admin).send(body);
        expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      }
    });
  });

  describe("matching", () => {
    it("matches the registered employee with confidence 1 and a verifiable proof", async () => {
      const res = await recognize(vec({ 100: 1 }));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        matched: true,
        employee_id: empA,
        confidence: 1,
        threshold: 0.9,
        reason: null,
        expires_in_seconds: 30,
      });
      const proof = verifyRecognitionProof(res.body.data.recognition_token, jwtSecret);
      expect(proof).toEqual({ employee_id: empA, confidence: 1, user_id: adminId });
      expect(() => verifyRecognitionProof(res.body.data.recognition_token, "x".repeat(40))).toThrow();
      expect(() => verifyRecognitionProof(res.body.data.recognition_token + "x", jwtSecret)).toThrow();
    });

    it("is scale invariant and tolerates small noise", async () => {
      const scaled = await recognize(vec({ 100: 7 }));
      expect(scaled.body.data).toMatchObject({ matched: true, employee_id: empA, confidence: 1 });

      const noisy = await recognize(unitVec({ 100: 1, 105: 0.2 }));
      expect(noisy.body.data.matched).toBe(true);
      expect(noisy.body.data.employee_id).toBe(empA);
      expect(noisy.body.data.confidence).toBeGreaterThan(0.9);
      expect(noisy.body.data.confidence).toBeLessThan(1);
    });

    it("returns no match below the threshold (contract shape, no token)", async () => {
      const res = await recognize(unitVec({ 100: 0.8, 105: 0.6 }));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        matched: false,
        employee_id: null,
        confidence: 0,
        threshold: 0.9,
        reason: "NO_MATCH",
        recognition_token: null,
        expires_in_seconds: null,
      });
    });

    it("returns no match for an unknown face", async () => {
      const res = await recognize(vec({ 120: 1 }));
      expect(res.body.data.matched).toBe(false);
      expect(res.body.data.employee_id).toBeNull();
    });

    it("rejects an ambiguous match (two employees above threshold within the margin)", async () => {
      const res = await recognize(unitVec({ 100: 1, 101: 1 }), looseApp);
      expect(res.body.data).toMatchObject({ matched: false, reason: "AMBIGUOUS", employee_id: null });
      expect(res.body.data.recognition_token).toBeNull();
    });

    it("accepts a clear winner even when a runner-up also passes a loose threshold", async () => {
      const res = await recognize(unitVec({ 100: 0.75, 101: 0.66 }), looseApp);
      expect(res.body.data).toMatchObject({ matched: true, employee_id: empA });
    });

    it("never matches an INACTIVE employee even if the embedding row exists", async () => {
      const res = await recognize(vec({ 102: 1 }));
      expect(res.body.data.matched).toBe(false);
    });

    it("never matches a revoked face", async () => {
      const res = await recognize(vec({ 103: 1 }));
      expect(res.body.data.matched).toBe(false);
    });
  });

  it("does not create attendance", async () => {
    const db = getDatabase();
    const count = async () =>
      (
        await db.query(
          `SELECT (SELECT count(*) FROM attendance_session WHERE employee_id = ANY($1::uuid[]))::int
                + (SELECT count(*) FROM employee_day_attendance WHERE employee_id = ANY($1::uuid[]))::int AS n`,
          [created]
        )
      ).rows[0].n as number;
    const before = await count();
    expect((await recognize(vec({ 100: 1 }))).body.data.matched).toBe(true);
    expect((await recognize(vec({ 120: 1 }))).body.data.matched).toBe(false);
    expect(await count()).toBe(before);
  });

  describe("deactivating an employee revokes the face", () => {
    it("POST /employees/:id/deactivate revokes the registration and deletes the embedding", async () => {
      const res = await req(app).post(`/api/v1/employees/${empDeactivate}/deactivate`).set("Authorization", admin);
      expect(res.status).toBe(200);
      expect(res.body.data.face_registered).toBe(false);

      const db = getDatabase();
      expect((await db.query(`SELECT 1 FROM face_embedding WHERE employee_id = $1`, [empDeactivate])).rowCount).toBe(0);
      expect(
        (
          await db.query(
            `SELECT status::text AS status FROM face_registration_metadata WHERE employee_id = $1`,
            [empDeactivate]
          )
        ).rows[0].status
      ).toBe("REVOKED");
      expect(
        (
          await db.query(
            `SELECT 1 FROM audit_log
              WHERE action = 'FACE_REVOKED' AND metadata->>'employee_id' = $1 AND metadata->>'reason' = 'EMPLOYEE_DEACTIVATED'`,
            [empDeactivate]
          )
        ).rowCount
      ).toBe(1);

      expect((await recognize(vec({ 104: 1 }))).body.data.matched).toBe(false);
    });

    it("deactivating an employee without a face still works", async () => {
      const res = await req(app).post(`/api/v1/employees/${empB}/deactivate`).set("Authorization", admin);
      expect(res.status).toBe(200);
    });
  });

  describe("GET /health vector_db", () => {
    it("reports ok when pgvector and face_embedding are available", async () => {
      const res = await req(app).get("/api/v1/health");
      expect(res.body.data.vector_db).toBe("ok");
    });
  });
});

describe("loadFaceConfig", () => {
  const keys = ["FACE_MATCH_THRESHOLD", "FACE_AMBIGUITY_MARGIN", "FACE_PROOF_TTL_SECONDS"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("uses safe defaults when unset", () => {
    for (const k of keys) delete process.env[k];
    expect(loadFaceConfig()).toEqual({ matchThreshold: 0.9, ambiguityMargin: 0.03, proofTtlSeconds: 30 });
  });

  it("reads overrides and rejects nonsense", () => {
    process.env.FACE_MATCH_THRESHOLD = "0.95";
    expect(loadFaceConfig().matchThreshold).toBe(0.95);
    process.env.FACE_MATCH_THRESHOLD = "abc";
    expect(() => loadFaceConfig()).toThrow(/FACE_MATCH_THRESHOLD/);
    process.env.FACE_MATCH_THRESHOLD = "0.1";
    expect(() => loadFaceConfig()).toThrow(/FACE_MATCH_THRESHOLD/);
  });
});
