import { z } from "zod";
import { badRequest } from "../errors/app-error.js";
import { parseWith } from "./parse.js";

export const listEmployeesQuerySchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;

export function parseListEmployeesQuery(
  query: Record<string, unknown>
): ListEmployeesQuery {
  const parsed = listEmployeesQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw badRequest("Invalid query parameters", parsed.error.issues);
  }
  return parsed.data;
}

const employeeFields = {
  employee_code: z.string().trim().min(1).max(50),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().max(255).pipe(z.email()),
  phone: z.string().trim().min(1).max(50).nullable(),
  department_id: z.uuid(),
  shift_id: z.uuid(),
  monthly_base_salary: z.number().min(0).max(9_999_999_999.99),
  hire_date: z.iso.date().nullable(),
};

export const createEmployeeSchema = z
  .object({
    ...employeeFields,
    phone: employeeFields.phone.optional(),
    hire_date: employeeFields.hire_date.optional(),
    /** Initial password for the employee's login account. */
    password: z.string().min(8).max(128),
  })
  .strict();

export const updateEmployeeSchema = z
  .object({
    ...employeeFields,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

export const idParamSchema = z.object({ id: z.uuid() });

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const parseCreateEmployeeBody = (body: unknown) =>
  parseWith(createEmployeeSchema, body, "request body");
export const parseUpdateEmployeeBody = (body: unknown) =>
  parseWith(updateEmployeeSchema, body, "request body");
export const parseIdParam = (params: unknown): string =>
  parseWith(idParamSchema, params, "id parameter").id;
