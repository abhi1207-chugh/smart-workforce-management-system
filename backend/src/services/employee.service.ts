import { DatabaseError } from "pg";
import type { EmployeeDetailDto, EmployeeDto } from "../types/api.js";
import { hashPassword } from "../auth/password.js";
import { getDatabase } from "../database/client.js";
import { badRequest, conflict, notFound } from "../errors/app-error.js";
import {
  deactivateEmployeeRow,
  findEmployeeById,
  insertEmployee,
  insertEmployeeUser,
  insertInitialLeaveBalances,
  listEmployees,
  updateEmployeeRow,
  type ListEmployeesFilters,
} from "../repositories/employee.repository.js";
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
} from "../validation/employees.validation.js";

export async function getEmployees(
  filters: ListEmployeesFilters = {}
): Promise<EmployeeDto[]> {
  return listEmployees(filters);
}

export async function getEmployee(id: string): Promise<EmployeeDetailDto> {
  const employee = await findEmployeeById(id);
  if (!employee) throw notFound("Employee not found");
  return employee;
}

/** Maps constraint violations on employee/user writes to client errors. */
function translateDbError(error: unknown): never {
  if (error instanceof DatabaseError) {
    if (error.code === "23505") {
      const field = error.constraint?.includes("code") ? "employee code" : "email";
      throw conflict(`An employee or user with this ${field} already exists`);
    }
    if (error.code === "23503") {
      throw badRequest("Referenced department or shift does not exist");
    }
  }
  throw error;
}

export async function createEmployee(
  input: CreateEmployeeInput
): Promise<EmployeeDetailDto> {
  const passwordHash = await hashPassword(input.password);
  try {
    const id = await getDatabase().withTransaction(async (client) => {
      const employeeId = await insertEmployee(client, input);
      await insertEmployeeUser(client, employeeId, input.email, passwordHash);
      await insertInitialLeaveBalances(client, employeeId);
      return employeeId;
    });
    return await getEmployee(id);
  } catch (error) {
    translateDbError(error);
  }
}

export async function updateEmployee(
  id: string,
  input: UpdateEmployeeInput
): Promise<EmployeeDetailDto> {
  try {
    const updated = await getDatabase().withTransaction((client) =>
      updateEmployeeRow(client, id, input)
    );
    if (!updated) throw notFound("Employee not found");
  } catch (error) {
    translateDbError(error);
  }
  return getEmployee(id);
}

export async function deactivateEmployee(
  id: string
): Promise<EmployeeDetailDto> {
  const done = await getDatabase().withTransaction((client) =>
    deactivateEmployeeRow(client, id)
  );
  if (!done) throw notFound("Employee not found");
  return getEmployee(id);
}
