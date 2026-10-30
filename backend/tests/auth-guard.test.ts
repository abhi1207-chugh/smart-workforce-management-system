import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { req } from "./helpers.js";
import { createApp } from "../src/app.js";
import { initDatabase, getDatabase } from "../src/database/client.js";
import { signToken } from "../src/auth/token.js";
import type { AuthUser } from "../src/auth/types.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
if (!databaseUrl || !jwtSecret) {
  throw new Error("DATABASE_URL and JWT_SECRET are required for auth tests");
}

const admin: AuthUser = {
  id: "00000000-0000-0000-0000-0000000000aa",
  email: "guard-admin@example.local",
  role: "ADMIN",
  employee_id: null,
};
const employee: AuthUser = {
  id: "00000000-0000-0000-0000-0000000000bb",
  email: "guard-employee@example.local",
  role: "EMPLOYEE",
  employee_id: "00000000-0000-0000-0000-0000000000cc",
};

const bearer = (u: AuthUser) => `Bearer ${signToken(u, jwtSecret, "1h")}`;

describe("route protection", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });

  beforeAll(() => {
    initDatabase(databaseUrl);
  });
  afterAll(async () => {
    await getDatabase().close();
  });

  it("GET /employees without a token returns 401", async () => {
    const res = await req(app).get("/api/v1/employees");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a malformed Authorization header", async () => {
    const res = await req(app)
      .get("/api/v1/employees")
      .set("Authorization", "Token abc");
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = jwt.sign(
      { sub: admin.id, email: admin.email, role: "ADMIN" },
      "x".repeat(40)
    );
    const res = await req(app)
      .get("/api/v1/employees")
      .set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const expired = jwt.sign(
      { sub: admin.id, email: admin.email, role: "ADMIN" },
      jwtSecret,
      { expiresIn: -10 }
    );
    const res = await req(app)
      .get("/api/v1/employees")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("GET /employees as EMPLOYEE returns 403", async () => {
    const res = await req(app)
      .get("/api/v1/employees")
      .set("Authorization", bearer(employee));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("GET /employees as ADMIN returns 200", async () => {
    const res = await req(app)
      .get("/api/v1/employees")
      .set("Authorization", bearer(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("health stays public", async () => {
    const res = await req(app).get("/api/v1/health");
    expect(res.status).toBe(200);
  });

  it("GET /auth/me returns the token's user, and 401 without one", async () => {
    const ok = await req(app)
      .get("/api/v1/auth/me")
      .set("Authorization", bearer(employee));
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual(employee);

    const no = await req(app).get("/api/v1/auth/me");
    expect(no.status).toBe(401);
  });
});
