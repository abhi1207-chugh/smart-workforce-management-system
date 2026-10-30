import type { Express } from "express";
import inject from "light-my-request";
import { getDatabase } from "../src/database/client.js";
import { signToken } from "../src/auth/token.js";
import type { AuthUser } from "../src/auth/types.js";

export const jwtSecret = process.env.JWT_SECRET ?? "";
export const NIL = "11111111-1111-4111-8111-111111111111";

export const bearer = (u: AuthUser) => `Bearer ${signToken(u, jwtSecret, "1h")}`;

/**
 * Persistent fixture admin. audit_log is append-only, so a user who has
 * authored an audit entry can never be deleted; tests reuse this one row.
 */
export async function ensureFixtureAdmin(): Promise<string> {
  const r = await getDatabase().query<{ id: string }>(
    `INSERT INTO "user" (email, password_hash, role, status)
     VALUES ('test-attendance-admin@example.test', 'x', 'ADMIN', 'INACTIVE')
     ON CONFLICT (email) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING id`
  );
  return r.rows[0].id;
}

export async function makeDepartmentAndShift(prefix: string) {
  const db = getDatabase();
  const department = (
    await db.query<{ id: string }>(
      `INSERT INTO department (code, name, status) VALUES ($1, 'T', 'ACTIVE') RETURNING id`,
      [prefix]
    )
  ).rows[0].id;
  const shift = (
    await db.query<{ id: string }>(
      `INSERT INTO shift (name, start_time, end_time, scheduled_duration_minutes, status)
       VALUES ($1, '09:00', '18:00', 540, 'ACTIVE') RETURNING id`,
      [prefix]
    )
  ).rows[0].id;
  return { department, shift };
}

export async function makeEmployee(
  prefix: string,
  n: string,
  department: string,
  shift: string,
  opts: { salary?: number; status?: string } = {}
): Promise<string> {
  const r = await getDatabase().query<{ id: string }>(
    `INSERT INTO employee (employee_code, first_name, last_name, email, department_id, shift_id, monthly_base_salary, status)
     VALUES ($1, 'T', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      `${prefix}-${n}`,
      n,
      `${prefix}-${n}@example.test`.toLowerCase(),
      department,
      shift,
      opts.salary ?? 30000,
      opts.status ?? "ACTIVE",
    ]
  );
  return r.rows[0].id;
}

type Method = "get" | "post" | "patch" | "put" | "delete";

interface TestResponse {
  status: number;
  body: any;
  headers: Record<string, unknown>;
}

/** Minimal supertest-style request builder: `.set(k, v).send(body)`, awaitable. */
class InjectedRequest implements PromiseLike<TestResponse> {
  private readonly headers: Record<string, string> = {};
  private payload: object | undefined;

  constructor(
    private readonly app: Express,
    private readonly method: Method,
    private readonly url: string
  ) {}

  set(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  send(body: object): this {
    this.payload = body;
    return this;
  }

  then<R1 = TestResponse, R2 = never>(
    onfulfilled?: ((value: TestResponse) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return inject(this.app, {
      method: this.method.toUpperCase() as "GET",
      url: this.url,
      headers: this.headers,
      payload: this.payload as any,
    })
      .then((res) => {
        let body: any = {};
        try {
          body = res.payload ? JSON.parse(res.payload) : {};
        } catch {
          body = {};
        }
        return { status: res.statusCode, body, headers: res.headers } as TestResponse;
      })
      .then(onfulfilled, onrejected);
  }
}

/**
 * In-process HTTP for tests. supertest opens real sockets on ephemeral ports,
 * which can collide with other local listeners and return another server's
 * response; injection never touches the network.
 */
export function req(app: Express) {
  const make = (method: Method) => (url: string) => new InjectedRequest(app, method, url);
  return {
    get: make("get"),
    post: make("post"),
    patch: make("patch"),
    put: make("put"),
    delete: make("delete"),
  };
}
