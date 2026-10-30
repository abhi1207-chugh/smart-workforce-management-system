import type { QueryResultRow } from "pg";
import { getDatabase } from "../database/client.js";
import type { EmployeeDetailDto, EmployeeDto } from "../types/api.js";
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
} from "../validation/employees.validation.js";
import type { Queryable } from "../database/queryable.js";

interface EmployeeRow extends QueryResultRow {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  department_id: string;
  shift_id: string;
  status: "ACTIVE" | "INACTIVE";
  face_registered: boolean;
}

export interface ListEmployeesFilters {
  status?: "ACTIVE" | "INACTIVE";
}

export async function listEmployees(
  filters: ListEmployeesFilters = {}
): Promise<EmployeeDto[]> {
  const params: unknown[] = [];
  let whereClause = "";

  if (filters.status) {
    params.push(filters.status);
    whereClause = `WHERE e.status = $${params.length}`;
  }

  const result = await getDatabase().query<EmployeeRow>(
    `
      SELECT
        e.id,
        e.employee_code,
        e.first_name,
        e.last_name,
        e.email,
        e.department_id,
        e.shift_id,
        e.status::text AS status,
        EXISTS (
          SELECT 1
          FROM face_registration_metadata frm
          WHERE frm.employee_id = e.id
            AND frm.status = 'ACTIVE'
        ) AS face_registered
      FROM employee e
      ${whereClause}
      ORDER BY e.employee_code ASC
    `,
    params
  );

  return result.rows;
}


const DETAIL_SELECT = `
  SELECT
    e.id, e.employee_code, e.first_name, e.last_name, e.email, e.phone,
    e.department_id, e.shift_id,
    e.monthly_base_salary::text AS monthly_base_salary,
    to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date,
    e.status::text AS status,
    EXISTS (
      SELECT 1 FROM face_registration_metadata frm
      WHERE frm.employee_id = e.id AND frm.status = 'ACTIVE'
    ) AS face_registered,
    e.created_at, e.updated_at
  FROM employee e
`;

export async function findEmployeeById(
  id: string,
  db: Queryable = getDatabase()
): Promise<EmployeeDetailDto | null> {
  const result = await db.query(`${DETAIL_SELECT} WHERE e.id = $1`, [id]);
  return (result.rows[0] as EmployeeDetailDto | undefined) ?? null;
}

/** Inserts the employee row; must run inside the caller's transaction. */
export async function insertEmployee(
  db: Queryable,
  input: CreateEmployeeInput
): Promise<string> {
  const result = await db.query(
    `
      INSERT INTO employee (
        employee_code, first_name, last_name, email, phone,
        department_id, shift_id, monthly_base_salary, hire_date, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
      RETURNING id
    `,
    [
      input.employee_code,
      input.first_name,
      input.last_name,
      input.email,
      input.phone ?? null,
      input.department_id,
      input.shift_id,
      input.monthly_base_salary,
      input.hire_date ?? null,
    ]
  );
  return result.rows[0].id as string;
}

export async function insertEmployeeUser(
  db: Queryable,
  employeeId: string,
  email: string,
  passwordHash: string
): Promise<void> {
  await db.query(
    `
      INSERT INTO "user" (email, password_hash, role, employee_id, status)
      VALUES ($1, $2, 'EMPLOYEE', $3, 'ACTIVE')
    `,
    [email, passwordHash, employeeId]
  );
}

/** Creates a balance row for every active leave type at its annual entitlement. */
export async function insertInitialLeaveBalances(
  db: Queryable,
  employeeId: string
): Promise<void> {
  await db.query(
    `
      INSERT INTO leave_balance (employee_id, leave_type_id, balance_days)
      SELECT $1, lt.id, lt.annual_entitlement_days
      FROM leave_type lt
      WHERE lt.status = 'ACTIVE'
    `,
    [employeeId]
  );
}

const UPDATABLE_COLUMNS = [
  "employee_code",
  "first_name",
  "last_name",
  "email",
  "phone",
  "department_id",
  "shift_id",
  "monthly_base_salary",
  "hire_date",
] as const;

/** Updates employee fields; the linked login email is kept in sync. */
export async function updateEmployeeRow(
  db: Queryable,
  id: string,
  input: UpdateEmployeeInput
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const column of UPDATABLE_COLUMNS) {
    if (input[column] !== undefined) {
      params.push(input[column]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  params.push(id);
  const result = await db.query(
    `UPDATE employee SET ${sets.join(", ")} WHERE id = $${params.length}`,
    params
  );
  if (result.rowCount === 0) return false;

  if (input.email !== undefined) {
    await db.query(`UPDATE "user" SET email = $1 WHERE employee_id = $2`, [
      input.email,
      id,
    ]);
  }
  return true;
}

export async function deactivateEmployeeRow(
  db: Queryable,
  id: string
): Promise<boolean> {
  const result = await db.query(
    `UPDATE employee SET status = 'INACTIVE' WHERE id = $1`,
    [id]
  );
  if (result.rowCount === 0) return false;
  await db.query(`UPDATE "user" SET status = 'INACTIVE' WHERE employee_id = $1`, [
    id,
  ]);
  return true;
}
