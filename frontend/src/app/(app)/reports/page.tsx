"use client";

import { useMemo, useState } from "react";
import { Stat } from "@/components/Stat";
import { useApi } from "@/components/useApi";
import { defaultRange } from "@/lib/attendance";
import { useAuth } from "@/lib/auth";
import { formatMinutes } from "@/lib/format";
import type {
  AttendanceSummaryRow,
  AuditEntry,
  Department,
  LeaveBalanceReportRow,
  MeSummary,
} from "@/lib/types";

type Tab = "attendance" | "leave" | "audit";

export default function ReportsPage() {
  const { user } = useAuth();
  return (
    <>
      <h1>Reports</h1>
      {user?.role === "ADMIN" ? <AdminReports /> : <MyReport />}
    </>
  );
}

function DateRange({ from, to, setFrom, setTo }: { from: string; to: string; setFrom(v: string): void; setTo(v: string): void }) {
  return (
    <>
      <label className="inline">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="inline">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      {to < from && <span role="alert" className="error">“To” must not be before “From”.</span>}
    </>
  );
}

function AdminReports() {
  const [tab, setTab] = useState<Tab>("attendance");
  return (
    <>
      <div className="tabs" role="tablist">
        {([["attendance", "Attendance summary"], ["leave", "Leave balances"], ["audit", "Audit log"]] as [Tab, string][]).map(
          ([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "tab active" : "tab"} onClick={() => setTab(key)}>
              {label}
            </button>
          )
        )}
      </div>
      {tab === "attendance" && <AttendanceSummary />}
      {tab === "leave" && <LeaveBalances />}
      {tab === "audit" && <AuditLog />}
      <p className="muted small">The payroll register is on each payroll run page.</p>
    </>
  );
}

function AttendanceSummary() {
  const initial = useMemo(() => defaultRange(new Date(), 30), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [dept, setDept] = useState("");
  const departments = useApi<Department[]>("/departments");
  const valid = to >= from;
  const rows = useApi<AttendanceSummaryRow[]>(valid ? "/reports/attendance-summary" : null, { from, to, department_id: dept });

  return (
    <>
      <div className="toolbar">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <label className="inline">Department
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All</option>
            {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      {rows.error && <p role="alert" className="error">{rows.error}</p>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Employee</th><th>Full</th><th>Half</th><th>Leave</th><th>Absent</th><th>Payable days</th><th>Hours</th><th>Late</th><th>Early out</th></tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((r) => (
              <tr key={r.employee_id}>
                <td>{r.employee_code} {r.first_name} {r.last_name}</td>
                <td>{r.full_days}</td><td>{r.half_days}</td><td>{r.leave_days}</td><td>{r.absent_days}</td>
                <td>{r.payable_days}</td><td>{formatMinutes(r.total_working_minutes)}</td>
                <td>{r.late_arrivals}</td><td>{r.early_checkouts}</td>
              </tr>
            ))}
            {!rows.loading && (rows.data ?? []).length === 0 && <tr><td colSpan={9} className="muted">No data for this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LeaveBalances() {
  const rows = useApi<LeaveBalanceReportRow[]>("/reports/leave-balances");
  return (
    <>
      {rows.error && <p role="alert" className="error">{rows.error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Leave type</th><th>Balance (days)</th></tr></thead>
          <tbody>
            {(rows.data ?? []).map((r) => (
              <tr key={`${r.employee_id}-${r.leave_type_code}`}>
                <td>{r.employee_code} {r.first_name} {r.last_name}</td>
                <td>{r.leave_type_name}</td>
                <td>{r.balance_days}</td>
              </tr>
            ))}
            {!rows.loading && (rows.data ?? []).length === 0 && <tr><td colSpan={3} className="muted">No balances.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AuditLog() {
  const initial = useMemo(() => defaultRange(new Date(), 7), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [entity, setEntity] = useState("");
  const valid = to >= from;
  const rows = useApi<AuditEntry[]>(valid ? "/audit-logs" : null, { from, to, entity_type: entity.trim(), limit: 200 });

  return (
    <>
      <div className="toolbar">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <label className="inline">Entity
          <input placeholder="e.g. payroll_run" value={entity} onChange={(e) => setEntity(e.target.value)} />
        </label>
      </div>
      {rows.error && <p role="alert" className="error">{rows.error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            {(rows.data ?? []).map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.created_at).toLocaleString()}</td>
                <td>{a.actor_email ?? "system"}</td>
                <td><span className="badge">{a.action}</span></td>
                <td>{a.entity_type}</td>
                <td className="small muted mono">{a.metadata ? JSON.stringify(a.metadata) : "—"}</td>
              </tr>
            ))}
            {!rows.loading && (rows.data ?? []).length === 0 && <tr><td colSpan={5} className="muted">No audit entries.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MyReport() {
  const initial = useMemo(() => defaultRange(new Date(), 30), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const valid = to >= from;
  const s = useApi<MeSummary>(valid ? "/reports/me/summary" : null, { from, to });

  return (
    <>
      <div className="toolbar"><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} /></div>
      {s.error && <p role="alert" className="error">{s.error}</p>}
      {s.data && (
        <div className="grid">
          <Stat label="Full days" value={s.data.attendance.full_days} />
          <Stat label="Half days" value={s.data.attendance.half_days} />
          <Stat label="Leave days" value={s.data.attendance.leave_days} />
          <Stat label="Absent days" value={s.data.attendance.absent_days} />
          <Stat label="Hours worked" value={formatMinutes(s.data.attendance.total_working_minutes)} />
          <Stat label="Approved overtime" value={formatMinutes(s.data.overtime.approved_minutes)} />
        </div>
      )}
    </>
  );
}
