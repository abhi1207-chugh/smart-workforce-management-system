import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { req } from "./helpers.js";
import { createApp } from "../src/app.js";
import { initDatabase, getDatabase } from "../src/database/client.js";
import { signToken } from "../src/auth/token.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for backend tests");
}

const adminAuth = `Bearer ${signToken(
  {
    id: "00000000-0000-0000-0000-000000000001",
    email: "test-admin@example.local",
    role: "ADMIN",
    employee_id: null,
  },
  process.env.JWT_SECRET ?? "",
  "1h"
)}`;

describe("Backend foundation", () => {
  const app = createApp();

  beforeAll(() => {
    initDatabase(databaseUrl);
  });

  afterAll(async () => {
    await getDatabase().close();
  });

  it("starts successfully and exposes the API", async () => {
    const response = await req(app).get("/api/v1/health");
    expect(response.status).toBe(200);
  });
});

describe("GET /api/v1/health", () => {
  const app = createApp();

  beforeAll(() => {
    initDatabase(databaseUrl);
  });

  afterAll(async () => {
    await getDatabase().close();
  });

  it("returns backend healthy with postgres check", async () => {
    const response = await req(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        status: "ok",
        postgres: "ok",
        vector_db: "degraded",
      },
    });
  });

  it("verifies PostgreSQL with an actual query", async () => {
    const result = await getDatabase().query("SELECT 1::int AS ok");
    expect(result.rows[0]?.ok).toBe(1);
  });
});

describe("GET /api/v1/employees", () => {
  const app = createApp();
  let departmentId = "";
  let shiftId = "";

  beforeAll(async () => {
    initDatabase(databaseUrl);

    const dept = await getDatabase().query<{ id: string }>(
      `INSERT INTO department (code, name, status)
       VALUES ('TST-BE', 'Backend Test Dept', 'ACTIVE')
       RETURNING id`
    );
    departmentId = dept.rows[0].id;

    const shift = await getDatabase().query<{ id: string }>(
      `INSERT INTO shift (name, start_time, end_time, scheduled_duration_minutes, status)
       VALUES ('Backend Test Shift', '09:00', '18:00', 540, 'ACTIVE')
       RETURNING id`
    );
    shiftId = shift.rows[0].id;

    await getDatabase().query(
      `INSERT INTO employee (
         employee_code, first_name, last_name, email,
         department_id, shift_id, monthly_base_salary, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        "BE-EMP-001",
        "Backend",
        "Tester",
        "backend-tester@example.local",
        departmentId,
        shiftId,
        45000,
        "ACTIVE",
      ]
    );
  });

  afterAll(async () => {
    await getDatabase().query(
      `DELETE FROM employee WHERE employee_code = $1`,
      ["BE-EMP-001"]
    );
    await getDatabase().query(`DELETE FROM shift WHERE id = $1`, [shiftId]);
    await getDatabase().query(`DELETE FROM department WHERE id = $1`, [
      departmentId,
    ]);
    await getDatabase().close();
  });

  it("queries PostgreSQL and returns structured employee JSON", async () => {
    const response = await req(app).get("/api/v1/employees").set("Authorization", adminAuth);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);

    const employee = response.body.data.find(
      (row: { employee_code: string }) => row.employee_code === "BE-EMP-001"
    );

    expect(employee).toMatchObject({
      employee_code: "BE-EMP-001",
      first_name: "Backend",
      last_name: "Tester",
      email: "backend-tester@example.local",
      department_id: departmentId,
      shift_id: shiftId,
      status: "ACTIVE",
      face_registered: false,
    });
    expect(employee).not.toHaveProperty("monthly_base_salary");
    expect(employee).not.toHaveProperty("password_hash");
  });

  it("validates optional status query parameter", async () => {
    const valid = await req(app).get("/api/v1/employees?status=ACTIVE").set("Authorization", adminAuth);
    expect(valid.status).toBe(200);

    const invalid = await req(app).get("/api/v1/employees?status=INVALID").set("Authorization", adminAuth);
    expect(invalid.status).toBe(400);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("Database configuration and error handling", () => {
  it("fails safely with invalid database configuration", async () => {
    const { Database } = await import("../src/database/client.js");
    const badDb = new Database(
      "postgres://invalid_user:invalid_pass@localhost:5432/nonexistent_db?sslmode=disable"
    );

    const healthy = await badDb.healthCheck();
    expect(healthy).toBe(false);
    await badDb.close();
  });

  it("does not expose raw PostgreSQL errors to API clients", async () => {
    const { Database } = await import("../src/database/client.js");
    const badDb = new Database(
      "postgres://invalid_user:invalid_pass@localhost:5432/nonexistent_db?sslmode=disable"
    );

    const app = createApp();
    const { initDatabase, getDatabase } = await import("../src/database/client.js");

    initDatabase(
      "postgres://invalid_user:invalid_pass@localhost:5432/nonexistent_db?sslmode=disable"
    );

    const response = await req(app).get("/api/v1/employees").set("Authorization", adminAuth);

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toBe("A database error occurred");
    expect(JSON.stringify(response.body)).not.toMatch(/password/i);
    expect(JSON.stringify(response.body)).not.toMatch(/invalid_user/i);

    await getDatabase().close();
    await badDb.close();
  });
});

describe("Parameterized SQL", () => {
  it("uses query parameters for filter values", async () => {
    const { listEmployees } = await import(
      "../src/repositories/employee.repository.js"
    );

    initDatabase(databaseUrl);

    await expect(
      listEmployees({ status: "ACTIVE" })
    ).resolves.toBeInstanceOf(Array);

    await getDatabase().close();
  });
});
