import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { NIL, bearer, ensureFixtureAdmin, req } from "./helpers.js";
import { createApp } from "../src/app.js";
import type { RateLimitConfig } from "../src/config/env.js";
import { initDatabase } from "../src/database/client.js";
import { createRateLimiter } from "../src/middleware/rate-limit.js";
import { errorHandler } from "../src/middleware/error-handler.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
if (!databaseUrl || !jwtSecret) {
  throw new Error("DATABASE_URL and JWT_SECRET are required for tests");
}

const win = 60_000;
const LIMITS: RateLimitConfig = {
  loginPerAccount: { max: 2, windowMs: win },
  loginPerIp: { max: 5, windowMs: win },
  recognize: { max: 2, windowMs: win },
};
const face = { matchThreshold: 0.9, ambiguityMargin: 0.03, proofTtlSeconds: 30 };
const unit = Array.from({ length: 128 }, (_, i) => (i === 40 ? 1 : 0));

describe("Stage 6: rate limiting", () => {
  let adminId: string;
  beforeAll(async () => {
    initDatabase(databaseUrl);
    adminId = await ensureFixtureAdmin();
  });

  const login = (app: ReturnType<typeof createApp>, email: string) =>
    req(app).post("/api/v1/auth/login").send({ email, password: "wrong-password" });

  it("limits login attempts per account and returns 429 + Retry-After", async () => {
    const app = createApp({ jwtSecret, jwtExpiresIn: "1h" }, face, LIMITS);
    expect((await login(app, "rl-a@example.test")).status).toBe(401);
    expect((await login(app, "RL-A@example.test")).status).toBe(401); // case-insensitive key
    const limited = await login(app, "rl-a@example.test");
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ success: false, error: { code: "RATE_LIMITED" } });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    // another account from the same IP is still allowed
    expect((await login(app, "rl-b@example.test")).status).toBe(401);
  });

  it("limits login attempts per IP across different accounts", async () => {
    const app = createApp({ jwtSecret, jwtExpiresIn: "1h" }, face, LIMITS);
    for (let i = 0; i < 5; i++) {
      expect((await login(app, `rl-ip-${i}@example.test`)).status).toBe(401);
    }
    expect((await login(app, "rl-ip-new@example.test")).status).toBe(429);
  });

  it("limits face recognition per authenticated user, not per IP", async () => {
    const app = createApp({ jwtSecret, jwtExpiresIn: "1h" }, face, LIMITS);
    const kiosk = bearer({ id: adminId, email: "fixture-admin@example.test", role: "ADMIN", employee_id: null });
    const other = bearer({ id: NIL, email: "o@example.test", role: "ADMIN", employee_id: null });
    const call = (auth: string) =>
      req(app).post("/api/v1/face/recognize").set("Authorization", auth).send({ embedding: unit });
    expect((await call(kiosk)).status).toBe(200);
    expect((await call(kiosk)).status).toBe(200);
    const limited = await call(kiosk);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect((await call(other)).status).toBe(200);
  });

  it("does not rate-limit unauthenticated recognize before auth (401 stays 401)", async () => {
    const app = createApp({ jwtSecret, jwtExpiresIn: "1h" }, face, LIMITS);
    for (let i = 0; i < 4; i++) {
      expect((await req(app).post("/api/v1/face/recognize").send({ embedding: unit })).status).toBe(401);
    }
  });

  it("resets after the window", async () => {
    let t = 1_000;
    const app = express();
    app.get("/x", createRateLimiter({ max: 1, windowMs: 1000 }, () => "k", () => t), (_q, r) => {
      r.json({ ok: true });
    });
    app.use(errorHandler);
    expect((await req(app).get("/x")).status).toBe(200);
    expect((await req(app).get("/x")).status).toBe(429);
    t += 1001;
    expect((await req(app).get("/x")).status).toBe(200);
  });
});
