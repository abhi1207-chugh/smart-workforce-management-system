"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/components/useApi";
import { RequireRole } from "@/components/RequireRole";
import type { Department, Employee } from "@/lib/types";

export default function EmployeesPage() {
  return (
    <RequireRole role="ADMIN">
      <EmployeeList />
    </RequireRole>
  );
}

function EmployeeList() {
  const [status, setStatus] = useState<"" | "ACTIVE" | "INACTIVE">("");
  const [search, setSearch] = useState("");
  const employees = useApi<Employee[]>("/employees", { status });
  const departments = useApi<Department[]>("/departments");

  const deptName = useMemo(
    () => new Map((departments.data ?? []).map((d) => [d.id, d.name])),
    [departments.data]
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (employees.data ?? []).filter(
      (e) =>
        !q ||
        `${e.first_name} ${e.last_name} ${e.employee_code} ${e.email}`.toLowerCase().includes(q)
    );
  }, [employees.data, search]);

  return (
    <>
      <div className="toolbar">
        <h1>Employees</h1>
        <Link href="/employees/new" className="btn">Add employee</Link>
      </div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search name, code or email"
          aria-label="Search employees"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>
      {employees.error && <p role="alert" className="error">{employees.error}</p>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Name</th><th>Email</th><th>Department</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>{e.employee_code}</td>
                <td><Link href={`/employees/${e.id}`}>{e.first_name} {e.last_name}</Link></td>
                <td>{e.email}</td>
                <td>{deptName.get(e.department_id) ?? "—"}</td>
                <td><span className={`badge ${e.status === "INACTIVE" ? "badge-off" : ""}`}>{e.status}</span></td>
              </tr>
            ))}
            {!employees.loading && rows.length === 0 && (
              <tr><td colSpan={5} className="muted">No employees found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
