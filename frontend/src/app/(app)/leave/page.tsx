"use client";

import { useState } from "react";
import { ReviewButtons } from "@/components/ReviewButtons";
import { Status } from "@/components/Status";
import { useApi } from "@/components/useApi";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import type { LeaveBalance, LeaveRequest, LeaveType } from "@/lib/types";

export default function LeavePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [status, setStatus] = useState<string>(isAdmin ? "PENDING" : "");
  const requests = useApi<LeaveRequest[]>("/leave/requests", { status, limit: 200 });
  const balances = useApi<LeaveBalance[]>(isAdmin ? null : "/leave/balances");
  const types = useApi<LeaveType[]>("/leave/types");

  const refresh = () => Promise.all([requests.reload(), balances.reload()]);

  return (
    <>
      <h1>{isAdmin ? "Leave requests" : "My leave"}</h1>
      {!isAdmin && (
        <>
          <div className="grid">
            {(balances.data ?? []).map((b) => (
              <div key={b.leave_type_id} className="card stat">
                <div className="stat-value">{b.balance_days}</div>
                <div className="stat-label">{b.leave_type_name}</div>
              </div>
            ))}
          </div>
          <RequestForm types={types.data ?? []} onDone={refresh} />
        </>
      )}

      <div className="toolbar">
        <label className="inline">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
      </div>
      {requests.error && <p role="alert" className="error">{requests.error}</p>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              {isAdmin && <th>Employee</th>}
              <th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {(requests.data ?? []).map((r) => (
              <tr key={r.id}>
                {isAdmin && <td>{r.employee_code} {r.first_name} {r.last_name}</td>}
                <td>{r.leave_type_code}</td>
                <td>{r.start_date}</td><td>{r.end_date}</td><td>{r.days}</td>
                <td>{r.reason ?? "—"}</td>
                <td><Status value={r.status} /></td>
                {isAdmin && (
                  <td>{r.status === "PENDING" && <ReviewButtons basePath="/leave/requests" id={r.id} onDone={refresh} />}</td>
                )}
              </tr>
            ))}
            {!requests.loading && (requests.data ?? []).length === 0 && (
              <tr><td colSpan={isAdmin ? 8 : 6} className="muted">No leave requests.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && <BalanceAdjust onDone={refresh} types={types.data ?? []} />}
    </>
  );
}

function RequestForm({ types, onDone }: { types: LeaveType[]; onDone(): void }) {
  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!typeId || !start || !end) return setError("Choose a leave type and both dates");
    if (end < start) return setError("End date cannot be before start date");
    setBusy(true);
    setError(null);
    try {
      await api("/leave/requests", {
        method: "POST",
        body: { leave_type_id: typeId, start_date: start, end_date: end, ...(reason.trim() && { reason: reason.trim() }) },
      });
      setStart(""); setEnd(""); setReason("");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <strong className="span-2">Request leave</strong>
      <label>Type
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Select…</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <span />
      <label>From<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label>To<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      <label className="span-2">Reason (optional)
        <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p role="alert" className="error span-2">{error}</p>}
      <div className="span-2"><button disabled={busy}>{busy ? "Submitting…" : "Submit request"}</button></div>
    </form>
  );
}

/** ADMIN override of a leave balance (audited, reason required). */
function BalanceAdjust({ types, onDone }: { types: LeaveType[]; onDone(): void }) {
  const employees = useApi<{ id: string; employee_code: string; first_name: string; last_name: string }[]>(
    "/employees", { status: "ACTIVE" }
  );
  const [employeeId, setEmployeeId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(days);
    if (!employeeId || !typeId || days === "" || !Number.isFinite(n) || n < 0) {
      return setMessage({ ok: false, text: "Choose employee, type and a balance of 0 or more" });
    }
    if (!reason.trim()) return setMessage({ ok: false, text: "A reason is required" });
    try {
      await api("/leave/balances/adjust", {
        method: "POST",
        body: { employee_id: employeeId, leave_type_id: typeId, balance_days: n, reason: reason.trim() },
      });
      setMessage({ ok: true, text: "Balance updated" });
      setDays(""); setReason("");
      onDone();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit} style={{ marginTop: "1.5rem" }}>
      <strong className="span-2">Override a leave balance</strong>
      <label>Employee
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Select…</option>
          {(employees.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
          ))}
        </select>
      </label>
      <label>Leave type
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Select…</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label>New balance (days)<input type="number" min={0} step="0.5" value={days} onChange={(e) => setDays(e.target.value)} /></label>
      <label>Reason<input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></label>
      {message && <p role={message.ok ? "status" : "alert"} className={`span-2 ${message.ok ? "ok" : "error"}`}>{message.text}</p>}
      <div className="span-2"><button>Set balance</button></div>
    </form>
  );
}
