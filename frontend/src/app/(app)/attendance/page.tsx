"use client";

import { useMemo, useState } from "react";
import { CorrectionPanel } from "@/components/CorrectionPanel";
import { ManualPunch } from "@/components/ManualPunch";
import { useApi } from "@/components/useApi";
import { defaultRange } from "@/lib/attendance";
import { useAuth } from "@/lib/auth";
import { formatMinutes, formatTime } from "@/lib/format";
import type { AttendanceRow, Department, Employee } from "@/lib/types";

const LIMIT = 200;

export default function AttendancePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const initial = useMemo(() => defaultRange(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [editing, setEditing] = useState<AttendanceRow | null>(null);

  const rows = useApi<AttendanceRow[]>("/attendance", {
    from,
    to,
    limit: LIMIT,
    employee_id: isAdmin ? employeeId : undefined,
    department_id: isAdmin ? departmentId : undefined,
  });
  const employees = useApi<Employee[]>(isAdmin ? "/employees" : null);
  const departments = useApi<Department[]>(isAdmin ? "/departments" : null);

  const invalidRange = to < from;
  const list = rows.data ?? [];

  return (
    <>
      <h1>{isAdmin ? "Attendance" : "My attendance"}</h1>
      {isAdmin && <ManualPunch onDone={rows.reload} />}

      <div className="toolbar filters">
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {isAdmin && (
          <>
            <label>
              Employee
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">All</option>
                {(employees.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
                ))}
              </select>
            </label>
            <label>
              Department
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">All</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      {invalidRange && <p role="alert" className="error">“To” must not be before “From”.</p>}
      {rows.error && <p role="alert" className="error">{rows.error}</p>}

      {editing && (
        <CorrectionPanel
          row={editing}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void rows.reload();
          }}
        />
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              {isAdmin && <th>Employee</th>}
              <th>In</th><th>Out</th><th>Worked</th><th>Flags</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td>{r.work_date}</td>
                {isAdmin && <td>{r.employee_code} {r.first_name} {r.last_name}</td>}
                <td>{formatTime(r.check_in)}</td>
                <td>{r.check_out ? formatTime(r.check_out) : <span className="badge">Open</span>}</td>
                <td>{formatMinutes(r.working_duration_minutes)}</td>
                <td>
                  {r.is_late_arrival && <span className="badge badge-off">Late</span>}{" "}
                  {r.is_early_checkout && <span className="badge badge-off">Early out</span>}{" "}
                  {r.correction_reason && <span className="badge" title={r.correction_reason}>Corrected</span>}
                </td>
                {isAdmin && (
                  <td><button className="link" onClick={() => setEditing(r)}>Correct</button></td>
                )}
              </tr>
            ))}
            {!rows.loading && list.length === 0 && (
              <tr><td colSpan={isAdmin ? 7 : 5} className="muted">No attendance in this range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {list.length >= LIMIT && (
        <p className="muted small">Showing the latest {LIMIT} records — narrow the filters to see others.</p>
      )}
    </>
  );
}
