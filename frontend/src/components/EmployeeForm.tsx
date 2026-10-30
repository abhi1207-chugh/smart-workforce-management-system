"use client";

import { useState } from "react";
import { useApi } from "./useApi";
import { ApiError } from "@/lib/api";
import {
  type EmployeeFormValues,
  serverFieldErrors,
  validateEmployeeForm,
} from "@/lib/employees";
import type { Department, Shift } from "@/lib/types";

interface Props {
  mode: "create" | "edit";
  initial: EmployeeFormValues;
  submitLabel: string;
  onSubmit(values: EmployeeFormValues): Promise<void>;
}

export function EmployeeForm({ mode, initial, submitLabel, onSubmit }: Props) {
  const departments = useApi<Department[]>("/departments");
  const shifts = useApi<Shift[]>("/shifts");
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof EmployeeFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const local = validateEmployeeForm(values, mode);
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    setSaving(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(err instanceof ApiError ? err.message : "Could not save the employee");
      setSaving(false);
    }
  }

  const field = (k: keyof EmployeeFormValues, label: string, type = "text", extra: object = {}) => (
    <label>
      {label}
      <input type={type} value={values[k]} onChange={set(k)} aria-invalid={!!errors[k]} {...extra} />
      {errors[k] && <span className="error small">{errors[k]}</span>}
    </label>
  );

  const select = (k: "department_id" | "shift_id", label: string, options: { id: string; label: string }[]) => (
    <label>
      {label}
      <select value={values[k]} onChange={set(k)} aria-invalid={!!errors[k]}>
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      {errors[k] && <span className="error small">{errors[k]}</span>}
    </label>
  );

  return (
    <form className="card form-grid" onSubmit={submit} noValidate>
      {field("employee_code", "Employee code")}
      <span />
      {field("first_name", "First name")}
      {field("last_name", "Last name")}
      {field("email", "Email (also the login)", "email")}
      {field("phone", "Phone")}
      {select(
        "department_id",
        "Department",
        (departments.data ?? []).filter((d) => d.status === "ACTIVE" || d.id === values.department_id)
          .map((d) => ({ id: d.id, label: d.name }))
      )}
      {select(
        "shift_id",
        "Shift",
        (shifts.data ?? []).filter((s) => s.status === "ACTIVE" || s.id === values.shift_id)
          .map((s) => ({ id: s.id, label: `${s.name} (${s.start_time}–${s.end_time})` }))
      )}
      {field("monthly_base_salary", "Monthly base salary", "number", { min: 0, step: "0.01" })}
      {field("hire_date", "Hire date", "date")}
      {mode === "create" && field("password", "Initial password", "password", { autoComplete: "new-password" })}
      {(departments.error || shifts.error) && (
        <p role="alert" className="error span-2">{departments.error ?? shifts.error}</p>
      )}
      {formError && <p role="alert" className="error span-2">{formError}</p>}
      <div className="span-2">
        <button type="submit" disabled={saving}>{saving ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
