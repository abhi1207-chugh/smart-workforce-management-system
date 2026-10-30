/**
 * Development seed data. Safe to run repeatedly: existing rows are left alone.
 *
 *   npm run seed
 *
 * Passwords can be overridden with SEED_ADMIN_PASSWORD / SEED_EMPLOYEE_PASSWORD.
 * Refuses to run when NODE_ENV=production.
 */
import { loadConfig } from "../config/env.js";
import { initDatabase } from "../database/client.js";
import { hashPassword } from "../auth/password.js";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";
const EMPLOYEE_PASSWORD = process.env.SEED_EMPLOYEE_PASSWORD ?? "Employee@12345";

const departments = [
  { code: "ENG", name: "Engineering" },
  { code: "HR", name: "Human Resources" },
  { code: "OPS", name: "Operations" },
];

// day_of_week: 0 = Sunday ... 6 = Saturday (matches EXTRACT(DOW ...))
const shifts = [
  { name: "General Shift", start: "09:00", end: "18:00", minutes: 540, weeklyOff: [0, 6] },
  { name: "Early Shift", start: "07:00", end: "16:00", minutes: 540, weeklyOff: [0] },
];

const employees = [
  { code: "EMP001", first: "Aarav", last: "Sharma", dept: "ENG", shift: "General Shift", salary: 60000, hired: "2022-01-10", login: true },
  { code: "EMP002", first: "Diya", last: "Patel", dept: "ENG", shift: "General Shift", salary: 55000, hired: "2022-03-15", login: true },
  { code: "EMP003", first: "Rohan", last: "Mehta", dept: "HR", shift: "General Shift", salary: 48000, hired: "2021-07-01", login: true },
  { code: "EMP004", first: "Isha", last: "Verma", dept: "HR", shift: "General Shift", salary: 45000, hired: "2023-02-20", login: false },
  { code: "EMP005", first: "Kabir", last: "Singh", dept: "OPS", shift: "Early Shift", salary: 38000, hired: "2022-09-05", login: false },
  { code: "EMP006", first: "Meera", last: "Nair", dept: "OPS", shift: "Early Shift", salary: 36000, hired: "2023-06-12", login: false },
  { code: "EMP007", first: "Vivaan", last: "Gupta", dept: "ENG", shift: "General Shift", salary: 70000, hired: "2020-11-23", login: false },
  { code: "EMP008", first: "Ananya", last: "Rao", dept: "OPS", shift: "General Shift", salary: 42000, hired: "2024-01-08", login: false },
];

const leaveTypes = [
  { code: "ANNUAL", name: "Annual Leave", days: 12, paid: true },
  { code: "SICK", name: "Sick Leave", days: 8, paid: true },
  { code: "CASUAL", name: "Casual Leave", days: 6, paid: true },
  { code: "UNPAID", name: "Unpaid Leave", days: 0, paid: false },
];

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.nodeEnv === "production") {
    throw new Error("Refusing to seed a production database");
  }

  const db = initDatabase(config.databaseUrl);
  const adminHash = await hashPassword(ADMIN_PASSWORD);
  const employeeHash = await hashPassword(EMPLOYEE_PASSWORD);

  await db.withTransaction(async (client) => {
    for (const d of departments) {
      await client.query(
        `INSERT INTO department (code, name, status) VALUES ($1, $2, 'ACTIVE')
         ON CONFLICT (code) DO NOTHING`,
        [d.code, d.name]
      );
    }

    for (const s of shifts) {
      await client.query(
        `INSERT INTO shift (name, start_time, end_time, scheduled_duration_minutes, status)
         SELECT $1::varchar, $2::time, $3::time, $4::int, 'ACTIVE'
         WHERE NOT EXISTS (SELECT 1 FROM shift WHERE name = $1::varchar)`,
        [s.name, s.start, s.end, s.minutes]
      );
      for (const day of s.weeklyOff) {
        await client.query(
          `INSERT INTO shift_weekly_off (shift_id, day_of_week)
           SELECT id, $2::smallint FROM shift WHERE name = $1::varchar
           ON CONFLICT (shift_id, day_of_week) DO NOTHING`,
          [s.name, day]
        );
      }
    }

    for (const e of employees) {
      const email = `${e.first}.${e.last}@example.com`.toLowerCase();
      await client.query(
        `INSERT INTO employee (
           employee_code, first_name, last_name, email,
           department_id, shift_id, monthly_base_salary, status, hire_date
         )
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, d.id, s.id, $7::numeric, 'ACTIVE', $8::date
         FROM department d, shift s
         WHERE d.code = $5::varchar AND s.name = $6::varchar
         ON CONFLICT (employee_code) DO NOTHING`,
        [e.code, e.first, e.last, email, e.dept, e.shift, e.salary, e.hired]
      );
      if (e.login) {
        await client.query(
          `INSERT INTO "user" (email, password_hash, role, employee_id, status)
           SELECT $1::varchar, $2::varchar, 'EMPLOYEE', emp.id, 'ACTIVE'
           FROM employee emp WHERE emp.employee_code = $3::varchar
           ON CONFLICT (email) DO NOTHING`,
          [email, employeeHash, e.code]
        );
      }
    }

    await client.query(
      `INSERT INTO "user" (email, password_hash, role, status)
       VALUES ($1, $2, 'ADMIN', 'ACTIVE')
       ON CONFLICT (email) DO NOTHING`,
      [ADMIN_EMAIL, adminHash]
    );

    for (const lt of leaveTypes) {
      await client.query(
        `INSERT INTO leave_type (code, name, annual_entitlement_days, is_paid, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         ON CONFLICT (code) DO NOTHING`,
        [lt.code, lt.name, lt.days, lt.paid]
      );
    }

    await client.query(
      `INSERT INTO leave_balance (employee_id, leave_type_id, balance_days)
       SELECT e.id, lt.id, lt.annual_entitlement_days
       FROM employee e CROSS JOIN leave_type lt
       ON CONFLICT (employee_id, leave_type_id) DO NOTHING`
    );

    await client.query(
      `INSERT INTO overtime_rate_config (name, multiplier, is_default, status)
       SELECT 'Standard Overtime', 1.5, TRUE, 'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM overtime_rate_config WHERE name = 'Standard Overtime')`
    );
    await client.query(
      `INSERT INTO overtime_rate_config (name, multiplier, is_default, status)
       SELECT 'Holiday Overtime', 2.0, FALSE, 'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM overtime_rate_config WHERE name = 'Holiday Overtime')`
    );

    await client.query(
      `INSERT INTO payroll_policy (name, working_days_method, fixed_divisor, is_default, status)
       SELECT 'Default Policy (26 days)', 'FIXED_DIVISOR', 26, TRUE, 'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM payroll_policy WHERE name = 'Default Policy (26 days)')`
    );
  });

  const counts = await db.query<{ table_name: string; n: string }>(
    `SELECT 'department' AS table_name, count(*)::text AS n FROM department
     UNION ALL SELECT 'shift', count(*)::text FROM shift
     UNION ALL SELECT 'employee', count(*)::text FROM employee
     UNION ALL SELECT 'user', count(*)::text FROM "user"
     UNION ALL SELECT 'leave_type', count(*)::text FROM leave_type
     UNION ALL SELECT 'leave_balance', count(*)::text FROM leave_balance`
  );
  console.log("Seed complete. Row counts:");
  for (const row of counts.rows) console.log(`  ${row.table_name}: ${row.n}`);
  console.log(`\nAdmin login:    ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`Employee login: aarav.sharma@example.com / ${EMPLOYEE_PASSWORD}`);
  console.log("(existing users keep their current passwords)");

  await db.close();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
