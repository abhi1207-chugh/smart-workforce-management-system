import { beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import type { Router } from "express";
import { NIL, bearer, ensureFixtureAdmin, req } from "./helpers.js";
import { createApp } from "../src/app.js";
import * as routes from "../src/routes/index.js";
import { initDatabase } from "../src/database/client.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
if (!databaseUrl || !jwtSecret) {
  throw new Error("DATABASE_URL and JWT_SECRET are required for tests");
}

const auth = { jwtSecret, jwtExpiresIn: "1h" };
const PUBLIC = new Set(["GET /health", "POST /auth/login", "POST /kiosk/session"]);

/** Every route registered by every router, discovered from the Express stacks. */
function allRoutes(): { method: string; path: string }[] {
  const routers: Router[] = [
    routes.createHealthRouter(),
    routes.createAuthRouter(auth),
    routes.createEmployeeRouter(auth),
    routes.createFaceRouter(auth),
    routes.createKioskRouter(auth),
    routes.createReferenceRouter(auth),
    routes.createAttendanceRouter(auth),
    routes.createLeaveRouter(auth),
    routes.createOvertimeRouter(auth),
    routes.createPayrollRouter(auth),
    routes.createReportsRouter(auth),
  ];
  const out: { method: string; path: string }[] = [];
  for (const r of routers) {
    for (const layer of (r as any).stack) {
      if (!layer.route) continue;
      for (const m of Object.keys(layer.route.methods)) {
        out.push({ method: m.toUpperCase(), path: layer.route.path });
      }
    }
  }
  return out;
}

const concrete = (path: string) => path.replace(/:[a-z_]+/gi, NIL);

describe("Stage 6: security", () => {
  const app = createApp(auth);
  let adminId: string;
  beforeAll(async () => {
    initDatabase(databaseUrl);
    adminId = await ensureFixtureAdmin();
  });

  const found = allRoutes();

  it("discovers the full route table (guards against the sweep silently shrinking)", () => {
    expect(found.length).toBeGreaterThan(50);
  });

  describe("authentication bypass", () => {
    const protectedRoutes = found.filter((r) => !PUBLIC.has(`${r.method} ${r.path}`));

    it.each(protectedRoutes.map((r) => [`${r.method} ${r.path}`, r]))(
      "%s -> 401 without a token",
      async (_name, r: any) => {
        const res = await req(app)[r.method.toLowerCase() as "get"](`/api/v1${concrete(r.path)}`).send({});
        expect(res.status).toBe(401);
      }
    );

    const bad: Record<string, () => string> = {
      "wrong secret": () => jwt.sign({ sub: NIL, email: "a@b.c", role: "ADMIN", employee_id: null }, "z".repeat(40)),
      "alg none": () =>
        `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(
          JSON.stringify({ sub: NIL, email: "a@b.c", role: "ADMIN", employee_id: null })
        ).toString("base64url")}.`,
      expired: () =>
        jwt.sign({ sub: NIL, email: "a@b.c", role: "ADMIN", employee_id: null }, jwtSecret, { expiresIn: -10 }),
      "role not in enum": () => jwt.sign({ sub: NIL, email: "a@b.c", role: "SUPERUSER", employee_id: null }, jwtSecret),
      "no subject": () => jwt.sign({ email: "a@b.c", role: "ADMIN" }, jwtSecret),
    };
    it.each(Object.keys(bad))("rejects a %s token on an admin route", async (name) => {
      const res = await req(app).get("/api/v1/employees").set("Authorization", `Bearer ${bad[name]()}`);
      expect(res.status).toBe(401);
    });

    it.each(["Bearer", "Basic abc", "bearer abc", "Bearer a b", "Token abc"])(
      "rejects malformed Authorization header %j",
      async (h) => {
        expect((await req(app).get("/api/v1/auth/me").set("Authorization", h)).status).toBe(401);
      }
    );
  });

  describe("kiosk account is least-privilege", () => {
    const KIOSK_ALLOWED = new Set([
      "POST /face/recognize",
      "POST /attendance/check-in",
      "POST /attendance/check-out",
      "GET /auth/me",
    ]);
    const kioskToken = bearer({ id: NIL, email: "kiosk@example.test", role: "KIOSK", employee_id: null });
    const others = found.filter((r) => !PUBLIC.has(`${r.method} ${r.path}`) && !KIOSK_ALLOWED.has(`${r.method} ${r.path}`));

    it.each(others.map((r) => [`${r.method} ${r.path}`, r]))("%s -> 403 for a KIOSK token", async (_n, r: any) => {
      const res = await req(app)[r.method.toLowerCase() as "get"](`/api/v1${concrete(r.path)}`).set("Authorization", kioskToken).send({});
      expect(res.status).toBe(403);
    });
  });

  describe("authorization", () => {
    const employee = bearer({ id: NIL, email: "e@example.test", role: "EMPLOYEE", employee_id: NIL });
    const adminOnly: [string, string][] = [
      ["GET", "/employees"],
      ["POST", "/employees"],
      ["GET", "/payroll/runs"],
      ["POST", "/payroll/runs"],
      ["POST", `/payroll/runs/${NIL}/finalize`],
      ["GET", "/bonuses"],
      ["POST", "/deductions"],
      ["GET", "/payments"],
      ["GET", "/audit-logs"],
      ["GET", "/reports/dashboard"],
      ["GET", "/reports/attendance-summary"],
      ["POST", `/leave/requests/${NIL}/approve`],
      ["POST", "/leave/balances/adjust"],
      ["POST", `/overtime/${NIL}/approve`],
      ["PATCH", `/attendance/${NIL}`],
      ["POST", `/employees/${NIL}/face/register`],
      ["DELETE", `/employees/${NIL}/face`],
    ];
    it.each(adminOnly)("%s %s -> 403 for an EMPLOYEE token", async (method, path) => {
      const res = await req(app)[method.toLowerCase() as "get"](`/api/v1${path}`).set("Authorization", employee).send({});
      expect(res.status).toBe(403);
    });

    it("an EMPLOYEE cannot read another employee's records by id (404, not 403/200)", async () => {
      for (const p of [`/payroll/records/${NIL}`, `/payroll/records/${NIL}/payslip`, `/leave/requests/${NIL}`]) {
        expect((await req(app).get(`/api/v1${p}`).set("Authorization", employee)).status).toBe(404);
      }
    });
  });

  describe("injection", () => {
    const admin = () => bearer({ id: adminId, email: "fixture-admin@example.test", role: "ADMIN", employee_id: null });
    const payloads = ["' OR '1'='1", "1; DROP TABLE employee;--", "x' UNION SELECT password_hash FROM \"user\"--", "%00", "../../etc/passwd"];

    it.each(payloads)("query/path params reject %j with 400 (never 500)", async (p) => {
      const enc = encodeURIComponent(p);
      for (const path of [
        `/attendance?employee_id=${enc}`,
        `/attendance?from=${enc}`,
        `/leave/requests?status=${enc}`,
        `/payroll/records?employee_id=${enc}`,
        `/audit-logs?entity_type=${enc}&actor_id=${enc}`,
        `/employees/${enc}`,
        `/employees?status=${enc}`,
      ]) {
        const res = await req(app).get(`/api/v1${path}`).set("Authorization", admin());
        expect([400, 404], `${path} -> ${res.status}`).toContain(res.status);
      }
    });

    it.each(payloads)("login treats %j as an ordinary failed credential", async (p) => {
      const fresh = createApp(auth);
      const res = await req(fresh).post("/api/v1/auth/login").send({ email: p, password: p });
      expect([400, 401]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toMatch(/syntax|pg_|relation|SELECT/i);
    });

    it("rejects an oversized request body (413) instead of buffering it", async () => {
      const res = await req(app)
        .post("/api/v1/auth/login")
        .send({ email: "a@b.c", password: "x".repeat(200_000) });
      expect(res.status).toBe(413);
    });
  });

  describe("information disclosure", () => {
    it("unknown email and wrong password give the same response", async () => {
      const fresh = createApp(auth);
      const a = await req(fresh).post("/api/v1/auth/login").send({ email: "nobody@example.test", password: "Wrong-pass-1" });
      const b = await req(fresh).post("/api/v1/auth/login").send({ email: "test-attendance-admin@example.test", password: "Wrong-pass-1" });
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(a.body).toEqual(b.body);
    });

    it("malformed JSON gives a clean error, no stack trace or internals", async () => {
      const res = await req(app).post("/api/v1/auth/login").set("Content-Type", "application/json").send("{bad json");
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(JSON.stringify(res.body)).not.toMatch(/node_modules|\.ts:|at \w+ \(/);
    });

    it("sets hardening headers and hides the framework", async () => {
      const res = await req(app).get("/api/v1/health");
      expect(res.headers["x-powered-by"]).toBeUndefined();
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("never returns password hashes or embeddings from auth/employee reads", async () => {
      const token = bearer({ id: adminId, email: "fixture-admin@example.test", role: "ADMIN", employee_id: null });
      for (const p of ["/auth/me", "/employees"]) {
        const res = await req(app).get(`/api/v1${p}`).set("Authorization", token);
        expect(JSON.stringify(res.body)).not.toMatch(/password_hash|embedding/i);
      }
    });
  });
});
