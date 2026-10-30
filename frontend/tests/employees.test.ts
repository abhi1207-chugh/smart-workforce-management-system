import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api";
import {
  emptyEmployeeForm,
  employeePayload,
  serverFieldErrors,
  validateEmployeeForm,
} from "../src/lib/employees";

const valid = {
  ...emptyEmployeeForm,
  employee_code: " E1 ",
  first_name: "Asha",
  last_name: "Rao",
  email: "asha@example.com",
  department_id: "d",
  shift_id: "s",
  monthly_base_salary: "30000.50",
  password: "longenough",
};

describe("employee form helpers", () => {
  it("accepts a valid create form", () => {
    expect(validateEmployeeForm(valid, "create")).toEqual({});
  });
  it("flags missing and malformed fields", () => {
    const errs = validateEmployeeForm({ ...emptyEmployeeForm, email: "nope", monthly_base_salary: "-1" }, "create");
    expect(Object.keys(errs).sort()).toEqual(
      ["department_id", "email", "employee_code", "first_name", "last_name", "monthly_base_salary", "password", "shift_id"]
    );
  });
  it("does not require a password when editing", () => {
    expect(validateEmployeeForm({ ...valid, password: "" }, "edit")).toEqual({});
  });
  it("builds a trimmed payload with null optionals and numeric salary", () => {
    expect(employeePayload(valid)).toEqual({
      employee_code: "E1", first_name: "Asha", last_name: "Rao", email: "asha@example.com",
      phone: null, department_id: "d", shift_id: "s", monthly_base_salary: 30000.5, hire_date: null,
    });
    expect(employeePayload({ ...valid, phone: " 99 ", hire_date: "2024-01-02" })).toMatchObject({
      phone: "99", hire_date: "2024-01-02",
    });
  });
  it("maps server validation issues to fields", () => {
    const err = new ApiError(400, "VALIDATION_ERROR", "bad", [
      { path: ["email"], message: "Invalid email" },
      { path: ["email"], message: "second ignored" },
      { path: [], message: "no field" },
    ]);
    expect(serverFieldErrors(err)).toEqual({ email: "Invalid email" });
    expect(serverFieldErrors(new Error("x"))).toEqual({});
  });
});
