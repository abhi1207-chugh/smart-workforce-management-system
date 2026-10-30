"use client";

import { Stat } from "./Stat";
import { useApi } from "./useApi";
import type { DashboardSummary } from "@/lib/types";

export function AdminDashboard() {
  const { data, error, loading } = useApi<DashboardSummary>("/reports/dashboard");
  if (loading) return <p className="muted">Loading…</p>;
  if (error || !data) return <p role="alert" className="error">{error ?? "No data"}</p>;

  const run = data.latest_payroll_run;
  return (
    <>
      <p className="muted">Today, {data.work_date}</p>
      <div className="grid">
        <Stat label="Active employees" value={data.active_employees} />
        <Stat label="Present today" value={data.present_today} hint={`${data.checked_in_now} still checked in`} />
        <Stat label="Late today" value={data.late_today} />
        <Stat label="On leave today" value={data.on_leave_today} />
        <Stat label="Pending leave requests" value={data.pending_leave_requests} />
        <Stat label="Pending overtime" value={data.pending_overtime} />
      </div>
      <h2>Latest payroll run</h2>
      <div className="card">
        {run ? (
          <p>
            {run.period_start} → {run.period_end} <span className="badge">{run.status}</span>
          </p>
        ) : (
          <p className="muted">No payroll runs yet.</p>
        )}
      </div>
    </>
  );
}
