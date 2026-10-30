"use client";

import { useState } from "react";
import { Stat } from "./Stat";
import { useApi } from "./useApi";
import { ApiError, api } from "@/lib/api";
import { formatMinutes, formatMoney, formatTime } from "@/lib/format";
import type { MeSummary, TodayStatus } from "@/lib/types";

const STATUS_LABEL = {
  NOT_CHECKED_IN: "Not checked in",
  CHECKED_IN: "Checked in",
  CHECKED_OUT: "Checked out",
} as const;

export function EmployeeHome() {
  const today = useApi<TodayStatus>("/attendance/today");
  const summary = useApi<MeSummary>("/reports/me/summary");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function punch(kind: "check-in" | "check-out") {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/attendance/${kind}`, { method: "POST", body: {} });
      await Promise.all([today.reload(), summary.reload()]);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const t = today.data;
  const s = summary.data;
  return (
    <>
      <h2>Today</h2>
      <div className="card">
        {today.error && <p role="alert" className="error">{today.error}</p>}
        {t && (
          <>
            <p>
              <span className="badge">{STATUS_LABEL[t.status]}</span>{" "}
              {t.sessions.map((x) => (
                <span key={x.id} className="muted">
                  {formatTime(x.check_in)} – {x.check_out ? formatTime(x.check_out) : "now"}
                  {x.is_late_arrival ? " (late)" : ""}{"  "}
                </span>
              ))}
            </p>
            {t.status === "CHECKED_IN" ? (
              <button disabled={busy} onClick={() => punch("check-out")}>Check out</button>
            ) : (
              <button disabled={busy} onClick={() => punch("check-in")}>Check in</button>
            )}
          </>
        )}
        {actionError && <p role="alert" className="error">{actionError}</p>}
      </div>

      {s && (
        <>
          <h2>This month ({s.period.from} → {s.period.to})</h2>
          <div className="grid">
            <Stat label="Full days" value={s.attendance.full_days} />
            <Stat label="Half days" value={s.attendance.half_days} />
            <Stat label="Leave days" value={s.attendance.leave_days} />
            <Stat label="Absent days" value={s.attendance.absent_days} />
            <Stat label="Hours worked" value={formatMinutes(s.attendance.total_working_minutes)} />
            <Stat
              label="Approved overtime"
              value={formatMinutes(s.overtime.approved_minutes)}
              hint={s.overtime.pending_minutes ? `${formatMinutes(s.overtime.pending_minutes)} pending` : undefined}
            />
          </div>

          <h2>Leave balances</h2>
          <div className="grid">
            {s.leave_balances.length === 0 && <p className="muted">No leave balances.</p>}
            {s.leave_balances.map((b) => (
              <Stat key={b.leave_type_code} label={b.leave_type_name} value={b.balance_days} hint="days left" />
            ))}
          </div>

          <h2>Latest payslip</h2>
          <div className="card">
            {s.latest_payroll ? (
              <p>
                {s.latest_payroll.period_start} → {s.latest_payroll.period_end}:{" "}
                <strong>{formatMoney(s.latest_payroll.net_pay)}</strong>{" "}
                <span className="badge">{s.latest_payroll.status}</span>
              </p>
            ) : (
              <p className="muted">No finalized payroll yet.</p>
            )}
          </div>
        </>
      )}
      {summary.error && <p role="alert" className="error">{summary.error}</p>}
    </>
  );
}
