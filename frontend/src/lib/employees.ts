import { ApiError } from "./api";
import type { EmployeeDetail } from "./types";

export interface EmployeeFormValues {
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  department_id: string;
  shift_id: string;
  monthly_base_salary: string;
  hire_date: string;
  password: string;
}

export const emptyEmployeeForm: EmployeeFormValues = {
  employee_code: "",
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  department_id: "",
  shift_id: "",
  monthly_base_salary: "",
  hire_date: "",
  password: "",
};

export function formFromEmployee(e: EmployeeDetail): EmployeeFormValues {
  return {
    employee_code: e.employee_code,
    first_name: e.first_name,
    last_name: e.last_name,
    email: e.email,
    phone: e.phone ?? "",
    department_id: e.department_id,
    shift_id: e.shift_id,
    monthly_base_salary: e.monthly_base_salary,
    hire_date: e.hire_date ?? "",
    password: "",
  };
}

/** Body shared by POST /employees and PATCH /employees/:id (blank optionals become null). */
export function employeePayload(v: EmployeeFormValues) {
  return {
    employee_code: v.employee_code.trim(),
    first_name: v.first_name.trim(),
    last_name: v.last_name.trim(),
    email: v.email.trim(),
    phone: v.phone.trim() || null,
    department_id: v.department_id,
    shift_id: v.shift_id,
    monthly_base_salary: Number(v.monthly_base_salary),
    hire_date: v.hire_date || null,
  };
}

/** Client-side checks that mirror the server rules; the server stays authoritative. */
export function validateEmployeeForm(v: EmployeeFormValues, mode: "create" | "edit") {
  const errors: Partial<Record<keyof EmployeeFormValues, string>> = {};
  if (!v.employee_code.trim()) errors.employee_code = "Required";
  if (!v.first_name.trim()) errors.first_name = "Required";
  if (!v.last_name.trim()) errors.last_name = "Required";
  if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) errors.email = "Enter a valid email";
  if (!v.department_id) errors.department_id = "Choose a department";
  if (!v.shift_id) errors.shift_id = "Choose a shift";
  const salary = Number(v.monthly_base_salary);
  if (v.monthly_base_salary.trim() === "" || !Number.isFinite(salary) || salary < 0) {
    errors.monthly_base_salary = "Enter an amount of 0 or more";
  }
  if (mode === "create" && v.password.length < 8) errors.password = "At least 8 characters";
  return errors;
}

/** Maps server validation issues ({ path: [...], message }) onto form fields. */
export function serverFieldErrors(err: unknown): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  if (err instanceof ApiError && Array.isArray(err.details)) {
    for (const d of err.details as { path?: unknown[]; message?: string }[]) {
      const key = d?.path?.[0];
      if (typeof key === "string" && d.message && !out[key]) out[key] = d.message;
    }
  }
  return out;
}
