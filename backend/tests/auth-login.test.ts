import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { req } from "./helpers.js";
import { createApp } from "../src/app.js";
import { initDatabase, getDatabase } from "../src/database/client.js";
import { hashPassword } from "../src/auth/password.js";
import { verifyToken } from "../src/auth/token.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
if (!databaseUrl || !jwtSecret) {
  throw new Error("DATABASE_URL and JWT_SECRET are required for auth tests");
}

const ADMIN_EMAIL = "test.admin.login@example.com";
const DISABLED_EMAIL = "test.disabled.login@example.com";
const PASSWORD = "Test-Password-123";

describe("POST /api/v1/auth/login", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });

  beforeAll(async () => {
    initDatabase(databaseUrl);
    const hash = await hashPassword(PASSWORD);
    await getDatabase().query(
      `DELETE FROM "user" WHERE email IN ($1, $2)`,
      [ADMIN_EMAIL, DISABLED_EMAIL]
    );
    await getDatabase().query(
      `INSERT INTO "user" (email, password_hash, role, status)
       VALUES ($1, $3, 'ADMIN', 'ACTIVE'), ($2, $3, 'ADMIN', 'INACTIVE')`,
      [ADMIN_EMAIL, DISABLED_EMAIL, hash]
    );
  });

  afterAll(async () => {
    await getDatabase().query(
      `DELETE FROM "user" WHERE email IN ($1, $2)`,
      [ADMIN_EMAIL, DISABLED_EMAIL]
    );
    await getDatabase().close();
  });

  it("returns a verifiable token and user for valid credentials", async () => {
    const res = await req(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      email: ADMIN_EMAIL,
      role: "ADMIN",
      employee_id: null,
    });
    expect(res.body.data.user.password_hash).toBeUndefined();
    expect(verifyToken(res.body.data.token, jwtSecret).email).toBe(ADMIN_EMAIL);
  });

  it("matches email case-insensitively", async () => {
    const res = await req(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong password with 401", async () => {
    const res = await req(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an unknown email with the same 401 message", async () => {
    const wrongPw = await req(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: "wrong-password" });
    const unknown = await req(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrongPw.body.error.message);
  });

  it("rejects an inactive user", async () => {
    const res = await req(app)
      .post("/api/v1/auth/login")
      .send({ email: DISABLED_EMAIL, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("rejects malformed bodies with 400", async () => {
    const res = await req(app).post("/api/v1/auth/login").send({ email: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
