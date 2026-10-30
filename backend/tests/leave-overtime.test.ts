import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { initDatabase, getDatabase } from "../src/database/client.js";
import {
  NIL,
  bearer,
  ensureFixtureAdmin,
  jwtSecret,
  makeDepartmentAndShift,
  makeEmployee,
  req,
} from "./helpers.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !jwtSecret) throw new Error("DATABASE_URL and JWT_SECRET are required");

const PREFIX = `T2C${Date.now().toString(36)}`;

describe("Stage 2c: leave and overtime", () => {
  const app = createApp({ jwtSecret, jwtExpiresIn: "1h" });
  let department: string, shift: string, leaveTypeId: string, unpaidTypeId: string;
  let adminId: string, admin: string;
  let empA: string, empB: string, authA: string, authB: string;

  const call = (method: "get" | "post", path: string, auth?: string, body?: object) => {
    const r = req(app)[method](`/api/v1${path}`);
    const withAuth = auth ? r.set("Authorization", auth) : r;
    return body ? withAuth.send(body) : withAuth;
  };

  beforeAll(async () => {
    initDatabase(databaseUrl);
    const db = getDatabase();
    ({ department, shift } = await makeDepartmentAndShift(PREFIX));
    adminId = await ensureFixtureAdmin();
    admin = bearer({ id: adminId, email: "a@example.test", role: "ADMIN", employee_id: null });
    leaveTypeId = (
      await db.query(
        `INSERT INTO leave_type (code, name, annual_entitlement_days, is_paid, status)
         VALUES ($1, 'Paid', 3, true, 'ACTIVE') RETURNING id`,
        [`${PREFIX}P`]
      )
    ).rows[0].id;
    unpaidTypeId = (
      await db.query(
        `INSERT INTO leave_type (code, name, annual_entitlement_days, is_paid, status)
         VALUES ($1, 'Unpaid', 10, false, 'ACTIVE') RETURNING id`,
        [`${PREFIX}U`]
      )
    ).rows[0].id;
    empA = await makeEmployee(PREFIX, "a", department, shift);
    empB = await makeEmployee(PREFIX, "b", department, shift);
    for (const e of [empA, empB]) {
      await db.query(
        `INSERT INTO leave_balance (employee_id, leave_type_id, balance_days)
         VALUES ($1, $2, 3), ($1, $3, 10)`,
        [e, leaveTypeId, unpaidTypeId]
      );
    }
    authA = bearer({ id: NIL, email: "a@x.test", role: "EMPLOYEE", employee_id: empA });
    authB = bearer({ id: NIL, email: "b@x.test", role: "EMPLOYEE", employee_id: empB });
  });

  afterAll(async () => {
    const db = getDatabase();
    const ids = `(SELECT id FROM employee WHERE employee_code LIKE $1)`;
    const like = [`${PREFIX}-%`];
    await db.query(`DELETE FROM overtime_record WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM employee_day_attendance WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM leave_request WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM leave_balance WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM attendance_session WHERE employee_id IN ${ids}`, like);
    await db.query(`DELETE FROM employee WHERE employee_code LIKE $1`, like);
    await db.query(`DELETE FROM leave_type WHERE id IN ($1, $2)`, [leaveTypeId, unpaidTypeId]);
    await db.query(`DELETE FROM shift WHERE id = $1`, [shift]);
    await db.query(`DELETE FROM department WHERE id = $1`, [department]);
    await db.close();
  });

  describe("leave", () => {
    it("requires authentication; submit is EMPLOYEE-only", async () => {
      expect((await call("get", "/leave/requests")).status).toBe(401);
      expect((await call("get", "/leave/types")).status).toBe(401);
      const body = { leave_type_id: leaveTypeId, start_date: "2031-01-10", end_date: "2031-01-10" };
      expect((await call("post", "/leave/requests", undefined, body)).status).toBe(401);
      expect((await call("post", "/leave/requests", admin, body)).status).toBe(403);
    });

    it("lists active leave types", async () => {
      const res = await call("get", "/leave/types", authA);
      expect(res.status).toBe(200);
      expect(res.body.data.find((t: { id: string }) => t.id === leaveTypeId)).toMatchObject({ is_paid: true });
    });

    it("validates submissions", async () => {
      const bad = [
        { leave_type_id: leaveTypeId, start_date: "2031-01-10", end_date: "2031-01-09" },
        { leave_type_id: "x", start_date: "2031-01-10", end_date: "2031-01-10" },
        { leave_type_id: leaveTypeId, start_date: "10/01/2031", end_date: "2031-01-10" },
        { leave_type_id: leaveTypeId, start_date: "2031-01-10", end_date: "2031-01-10", status: "APPROVED" },
        {},
      ];
      for (const b of bad) expect((await call("post", "/leave/requests", authA, b)).status).toBe(400);
      const unknownType = { leave_type_id: NIL, start_date: "2031-01-10", end_date: "2031-01-10" };
      expect((await call("post", "/leave/requests", authA, unknownType)).status).toBe(400);
    });

    it("submit → pending; overlap rejected; scoping hides other employees", async () => {
      const created = await call("post", "/leave/requests", authA, {
        leave_type_id: leaveTypeId, start_date: "2031-02-03", end_date: "2031-02-04", reason: "trip",
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        employee_id: empA, status: "PENDING", days: 2, leave_type_code: `${PREFIX}P`,
      });
      const id = created.body.data.id;

      const overlap = await call("post", "/leave/requests", authA, {
        leave_type_id: unpaidTypeId, start_date: "2031-02-04", end_date: "2031-02-05",
      });
      expect(overlap.status).toBe(409);

      expect((await call("get", `/leave/requests/${id}`, authA)).status).toBe(200);
      expect((await call("get", `/leave/requests/${id}`, authB)).status).toBe(404);
      expect((await call("get", `/leave/requests/${id}`, admin)).status).toBe(200);
      expect((await call("get", `/leave/requests/${NIL}`, admin)).status).toBe(404);
      expect((await call("get", `/leave/requests/bad`, admin)).status).toBe(400);

      const mine = await call("get", "/leave/requests", authB);
      expect(mine.body.data.every((r: { employee_id: string }) => r.employee_id === empB)).toBe(true);
      expect((await call("get", `/leave/requests?employee_id=${empA}`, authB)).status).toBe(403);
      const all = await call("get", `/leave/requests?employee_id=${empA}&status=PENDING`, admin);
      expect(all.body.data.map((r: { id: string }) => r.id)).toContain(id);
      expect((await call("get", "/leave/requests?status=NOPE", admin)).status).toBe(400);
    });

    it("approve deducts balance, marks LEAVE days, and cannot be repeated", async () => {
      const created = await call("post", "/leave/requests", authA, {
        leave_type_id: leaveTypeId, start_date: "2031-03-03", end_date: "2031-03-04",
      });
      const id = created.body.data.id;

      expect((await call("post", `/leave/requests/${id}/approve`, authA)).status).toBe(403);
      expect((await call("post", `/leave/requests/${id}/approve`)).status).toBe(401);

      const ok = await call("post", `/leave/requests/${id}/approve`, admin);
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ status: "APPROVED", reviewed_by_user_id: adminId });

      const db = getDatabase();
      const bal = await db.query(
        `SELECT balance_days::text AS b FROM leave_balance WHERE employee_id = $1 AND leave_type_id = $2`,
        [empA, leaveTypeId]
      );
      expect(bal.rows[0].b).toBe("1.00");
      const days = await db.query(
        `SELECT classification::text AS c, payable_day_fraction::text AS f FROM employee_day_attendance
         WHERE employee_id = $1 AND leave_request_id = $2 ORDER BY work_date`,
        [empA, id]
      );
      expect(days.rows).toEqual([{ c: "LEAVE", f: "1.00" }, { c: "LEAVE", f: "1.00" }]);

      expect((await call("post", `/leave/requests/${id}/approve`, admin)).status).toBe(409);
      expect((await call("post", `/leave/requests/${id}/reject`, admin)).status).toBe(409);

      const balances = await call("get", "/leave/balances", authA);
      expect(balances.status).toBe(200);
      const paid = balances.body.data.find((b: { leave_type_id: string }) => b.leave_type_id === leaveTypeId);
      expect(paid.balance_days).toBe("1.00");
      expect(balances.body.data.every((b: { employee_id: string }) => b.employee_id === empA)).toBe(true);
      expect((await call("get", `/leave/balances?employee_id=${empB}`, authA)).status).toBe(403);
      expect((await call("get", `/leave/balances?employee_id=${empB}`, admin)).body.data.length).toBe(2);
    });

    it("rejects approval beyond balance, leaving state untouched", async () => {
      const created = await call("post", "/leave/requests", authB, {
        leave_type_id: leaveTypeId, start_date: "2031-04-01", end_date: "2031-04-05",
      });
      const id = created.body.data.id;
      const res = await call("post", `/leave/requests/${id}/approve`, admin);
      expect(res.status).toBe(409);
      expect((await call("get", `/leave/requests/${id}`, admin)).body.data.status).toBe("PENDING");
    });

    it("unpaid leave marks days with 0 payable fraction", async () => {
      const created = await call("post", "/leave/requests", authB, {
        leave_type_id: unpaidTypeId, start_date: "2031-05-01", end_date: "2031-05-01",
      });
      const id = created.body.data.id;
      expect((await call("post", `/leave/requests/${id}/approve`, admin)).status).toBe(200);
      const d = await getDatabase().query(
        `SELECT payable_day_fraction::text AS f FROM employee_day_attendance WHERE leave_request_id = $1`,
        [id]
      );
      expect(d.rows[0].f).toBe("0.00");
    });

    it("reject leaves balance alone and frees the dates", async () => {
      const body = { leave_type_id: leaveTypeId, start_date: "2031-06-02", end_date: "2031-06-02" };
      const id = (await call("post", "/leave/requests", authB, body)).body.data.id;
      const rej = await call("post", `/leave/requests/${id}/reject`, admin);
      expect(rej.status).toBe(200);
      expect(rej.body.data).toMatchObject({ status: "REJECTED", reviewed_by_user_id: adminId });
      expect((await call("post", `/leave/requests/${id}/reject`, authB)).status).toBe(403);
      const bal = await getDatabase().query(
        `SELECT balance_days::text AS b FROM leave_balance WHERE employee_id = $1 AND leave_type_id = $2`,
        [empB, leaveTypeId]
      );
      expect(bal.rows[0].b).toBe("3.00");
      expect((await call("post", "/leave/requests", authB, body)).status).toBe(201);
      expect((await call("post", `/leave/requests/${NIL}/reject`, admin)).status).toBe(404);
    });
  });

  describe("overtime", () => {
    const addSession = (employeeId: string, date: string, minutes: number) =>
      getDatabase().query(
        `INSERT INTO attendance_session (employee_id, check_in_at, check_out_at, working_duration_minutes,
           status, check_in_source, work_date)
         VALUES ($1, $2::date + time '09:00', $2::date + time '09:00' + $3::int * interval '1 minute',
           $3::int, 'COMPLETED', 'MANUAL', $2)`,
        [employeeId, date, minutes]
      );

    it("requires authentication; approve/reject are ADMIN-only", async () => {
      expect((await call("get", "/overtime")).status).toBe(401);
      expect((await call("post", "/overtime", undefined, { work_date: "2031-01-01" })).status).toBe(401);
      expect((await call("post", `/overtime/${NIL}/approve`, authA)).status).toBe(403);
      expect((await call("post", `/overtime/${NIL}/reject`, authA)).status).toBe(403);
    });

    it("employee submits derived overtime; duplicates and no-overtime are 409", async () => {
      await addSession(empA, "2031-07-01", 600); // 540 scheduled -> 60 overtime
      const res = await call("post", "/overtime", authA, { work_date: "2031-07-01", notes: "release" });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        employee_id: empA, overtime_minutes: 60, status: "PENDING", work_date: "2031-07-01", notes: "release",
      });
      expect(res.body.data.attendance_session_id).not.toBeNull();

      expect((await call("post", "/overtime", authA, { work_date: "2031-07-01" })).status).toBe(409);

      await addSession(empA, "2031-07-02", 480);
      expect((await call("post", "/overtime", authA, { work_date: "2031-07-02" })).status).toBe(409);
    });

    it("employee cannot set minutes or act for others; admin must name employee", async () => {
      expect((await call("post", "/overtime", authA, { work_date: "2031-07-03", overtime_minutes: 30 })).status).toBe(403);
      expect((await call("post", "/overtime", authA, { work_date: "2031-07-03", employee_id: empB })).status).toBe(403);
      expect((await call("post", "/overtime", admin, { work_date: "2031-07-03" })).status).toBe(400);
      expect((await call("post", "/overtime", admin, { employee_id: empB, work_date: "bad" })).status).toBe(400);
      expect((await call("post", "/overtime", admin, { employee_id: empB, work_date: "2031-07-03", overtime_minutes: 0 })).status).toBe(400);
      expect((await call("post", "/overtime", admin, { employee_id: NIL, work_date: "2031-07-03", overtime_minutes: 30 })).status).toBe(404);
    });

    it("admin can record explicit minutes, then approve; decisions are final", async () => {
      const made = await call("post", "/overtime", admin, { employee_id: empB, work_date: "2031-07-04", overtime_minutes: 90 });
      expect(made.status).toBe(201);
      const id = made.body.data.id;
      expect(made.body.data.overtime_minutes).toBe(90);

      const ok = await call("post", `/overtime/${id}/approve`, admin);
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ status: "APPROVED", approved_by_user_id: adminId });
      expect((await call("post", `/overtime/${id}/approve`, admin)).status).toBe(409);
      expect((await call("post", `/overtime/${id}/reject`, admin)).status).toBe(409);
      expect((await call("post", `/overtime/${NIL}/approve`, admin)).status).toBe(404);
    });

    it("rejected overtime frees the date; list is scoped", async () => {
      const first = await call("post", "/overtime", admin, { employee_id: empB, work_date: "2031-07-05", overtime_minutes: 45 });
      const rej = await call("post", `/overtime/${first.body.data.id}/reject`, admin);
      expect(rej.body.data.status).toBe("REJECTED");
      expect((await call("post", "/overtime", admin, { employee_id: empB, work_date: "2031-07-05", overtime_minutes: 45 })).status).toBe(201);

      const mine = await call("get", "/overtime", authB);
      expect(mine.status).toBe(200);
      expect(mine.body.data.length).toBeGreaterThanOrEqual(3);
      expect(mine.body.data.every((r: { employee_id: string }) => r.employee_id === empB)).toBe(true);
      expect((await call("get", `/overtime?employee_id=${empA}`, authB)).status).toBe(403);

      const filtered = await call("get", `/overtime?employee_id=${empB}&status=APPROVED&from=2031-07-01&to=2031-07-31`, admin);
      expect(filtered.body.data.map((r: { status: string }) => r.status)).toEqual(["APPROVED"]);
    });
  });
});
