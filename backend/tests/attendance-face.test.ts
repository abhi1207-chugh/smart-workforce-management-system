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
import type { FaceConfig } from "../src/config/env.js";
import { getDatabase, initDatabase } from "../src/database/client.js";
import { signRecognitionProof } from "../src/auth/recognition-proof.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
if (!databaseUrl || !jwtSecret) {
  throw new Error("DATABASE_URL and JWT_SECRET are required for tests");
}

const PREFIX = `T5A${Date.now().toString(36)}`.toUpperCase();
// Dimensions 20-29 are unique to this file (see face-recognition.test.ts note).
const vec = (k: number): number[] => Array.from({ length: 128 }, (_, i) => (i === k ? 1 : 0));
const FACE: FaceConfig = { matchThreshold: 0.9, ambiguityMargin: 0.03, proofTtlSeconds: 30 };

describe("Stage 5: attendance with source FACE_RECOGNITION", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" }, FACE);
  let adminId: string;
  let admin: string;
  let otherAdmin: string;
  let departmentId: string;
  let shiftId: string;
  let empA: string;
  let empB: string;
  let empNoFace: string;
  const created: string[] = [];

  const mk = async (n: string) => {
    const id = await makeEmployee(PREFIX, n, departmentId, shiftId);
    created.push(id);
    return id;
  };
  const registerFace = (id: string, dim: number) =>
    req(app).post(`/api/v1/employees/${id}/face/register`).set("Authorization", admin).send({ embedding: vec(dim) });
  const recognize = (dim: number) =>
    req(app).post("/api/v1/face/recognize").set("Authorization", admin).send({ embedding: vec(dim) });
  const proofFor = async (dim: number): Promise<string> => (await recognize(dim)).body.data.recognition_token;
  const punch = (kind: "check-in" | "check-out", body: object, auth = admin) =>
    req(app).post(`/api/v1/attendance/${kind}`).set("Authorization", auth).send(body);
  const sources = async (id: string) =>
    (
      await getDatabase().query(
        `SELECT check_in_source::text AS i, check_out_source::text AS o FROM attendance_session WHERE employee_id = $1`,
        [id]
      )
    ).rows;
  const clearSessions = (id: string) =>
    getDatabase().query(`DELETE FROM attendance_session WHERE employee_id = $1`, [id]);

  beforeAll(async () => {
    initDatabase(databaseUrl);
    adminId = await ensureFixtureAdmin();
    admin = bearer({ id: adminId, email: "fixture-admin@example.test", role: "ADMIN", employee_id: null });
    otherAdmin = bearer({ id: NIL, email: "other@example.test", role: "ADMIN", employee_id: null });
    const ds = await makeDepartmentAndShift(PREFIX);
    departmentId = ds.department;
    shiftId = ds.shift;
    empA = await mk("A");
    empB = await mk("B");
    empNoFace = await mk("N");
    expect((await registerFace(empA, 20)).status).toBe(201);
    expect((await registerFace(empB, 21)).status).toBe(201);
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

  it("valid proof: check-in then check-out store FACE_RECOGNITION", async () => {
    const inRes = await punch("check-in", {
      employee_id: empA,
      source: "FACE_RECOGNITION",
      recognition_token: await proofFor(20),
    });
    expect(inRes.status).toBe(201);
    expect(inRes.body.data.status).toBe("CHECKED_IN");
    const outRes = await punch("check-out", {
      employee_id: empA,
      source: "FACE_RECOGNITION",
      recognition_token: await proofFor(20),
    });
    expect(outRes.status).toBe(200);
    expect(await sources(empA)).toEqual([{ i: "FACE_RECOGNITION", o: "FACE_RECOGNITION" }]);
    await clearSessions(empA);
  });

  it("mixed sources are recorded per direction", async () => {
    expect((await punch("check-in", { employee_id: empA })).status).toBe(201);
    const out = await punch("check-out", {
      employee_id: empA,
      source: "FACE_RECOGNITION",
      recognition_token: await proofFor(20),
    });
    expect(out.status).toBe(200);
    expect(await sources(empA)).toEqual([{ i: "MANUAL", o: "FACE_RECOGNITION" }]);
    await clearSessions(empA);
  });

  it("MANUAL still works and stores MANUAL", async () => {
    expect((await punch("check-in", { employee_id: empA, source: "MANUAL" })).status).toBe(201);
    expect((await punch("check-out", { employee_id: empA })).status).toBe(200);
    expect(await sources(empA)).toEqual([{ i: "MANUAL", o: "MANUAL" }]);
    await clearSessions(empA);
  });

  it("400 when the token and source disagree or extra fields are sent", async () => {
    const token = await proofFor(20);
    expect((await punch("check-in", { employee_id: empA, source: "FACE_RECOGNITION" })).status).toBe(400);
    expect((await punch("check-in", { employee_id: empA, recognition_token: token })).status).toBe(400);
    expect((await punch("check-in", { employee_id: empA, source: "MANUAL", recognition_token: token })).status).toBe(400);
    expect(
      (await punch("check-in", { employee_id: empA, source: "FACE_RECOGNITION", recognition_token: token, recognition_confidence: 1 })).status
    ).toBe(400);
    expect(await sources(empA)).toEqual([]);
  });

  it("401 for a forged, garbage or login token used as proof", async () => {
    const forged = signRecognitionProof({ employee_id: empA, confidence: 0.99, user_id: adminId }, "x".repeat(40), 30);
    for (const t of [forged, "g".repeat(40), admin.replace("Bearer ", "")]) {
      const res = await punch("check-in", { employee_id: empA, source: "FACE_RECOGNITION", recognition_token: t });
      expect(res.status).toBe(401);
    }
    expect(await sources(empA)).toEqual([]);
  });

  it("401 for an expired proof", async () => {
    const expired = signRecognitionProof({ employee_id: empA, confidence: 0.99, user_id: adminId }, jwtSecret, -5);
    const res = await punch("check-in", { employee_id: empA, source: "FACE_RECOGNITION", recognition_token: expired });
    expect(res.status).toBe(401);
  });

  it("403 when the proof is for another employee", async () => {
    const res = await punch("check-in", {
      employee_id: empB,
      source: "FACE_RECOGNITION",
      recognition_token: await proofFor(20), // A's proof, B's id
    });
    expect(res.status).toBe(403);
    expect(await sources(empB)).toEqual([]);
  });

  it("403 when the proof was issued to a different user", async () => {
    const res = await punch(
      "check-in",
      { employee_id: empA, source: "FACE_RECOGNITION", recognition_token: await proofFor(20) },
      otherAdmin
    );
    expect(res.status).toBe(403);
  });

  it("400 when the proof confidence is below the current threshold", async () => {
    const weak = signRecognitionProof({ employee_id: empA, confidence: 0.5, user_id: adminId }, jwtSecret, 30);
    const res = await punch("check-in", { employee_id: empA, source: "FACE_RECOGNITION", recognition_token: weak });
    expect(res.status).toBe(400);
  });

  it("409 when the face was revoked after recognition", async () => {
    const token = await proofFor(21);
    expect((await req(app).delete(`/api/v1/employees/${empB}/face`).set("Authorization", admin)).status).toBe(200);
    const res = await punch("check-in", { employee_id: empB, source: "FACE_RECOGNITION", recognition_token: token });
    expect(res.status).toBe(409);
    expect(await sources(empB)).toEqual([]);
  });

  it("409 when the employee never had a face registration", async () => {
    const proof = signRecognitionProof({ employee_id: empNoFace, confidence: 0.99, user_id: adminId }, jwtSecret, 30);
    const res = await punch("check-in", { employee_id: empNoFace, source: "FACE_RECOGNITION", recognition_token: proof });
    expect(res.status).toBe(409);
  });

  it("409 when the employee was deactivated after recognition", async () => {
    const token = await proofFor(20);
    await getDatabase().query(`UPDATE employee SET status = 'INACTIVE' WHERE id = $1`, [empA]);
    const res = await punch("check-in", { employee_id: empA, source: "FACE_RECOGNITION", recognition_token: token });
    expect(res.status).toBe(409);
    await getDatabase().query(`UPDATE employee SET status = 'ACTIVE' WHERE id = $1`, [empA]);
  });

  it("409 on a duplicate open session and when checking out without one", async () => {
    const send = async (kind: "check-in" | "check-out") =>
      punch(kind, { employee_id: empA, source: "FACE_RECOGNITION", recognition_token: await proofFor(20) });
    expect((await send("check-out")).status).toBe(409);
    expect((await send("check-in")).status).toBe(201);
    expect((await send("check-in")).status).toBe(409);
    await clearSessions(empA);
  });

  it("an EMPLOYEE token cannot use a proof for someone else", async () => {
    const empAuth = bearer({ id: NIL, email: "emp@example.test", role: "EMPLOYEE", employee_id: empB });
    const res = await punch(
      "check-in",
      { source: "FACE_RECOGNITION", recognition_token: await proofFor(20) },
      empAuth
    );
    expect(res.status).toBe(403);
  });
});
