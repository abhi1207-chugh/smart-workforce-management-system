"use client";

import { useState } from "react";
import { ReviewButtons } from "@/components/ReviewButtons";
import { Status } from "@/components/Status";
import { useApi } from "@/components/useApi";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { formatMinutes } from "@/lib/format";
import type { Employee, OvertimeRecord } from "@/lib/types";

export default function OvertimePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [status, setStatus] = useState<string>(isAdmin ? "PENDING" : "");
  const records = useApi<OvertimeRecord[]>("/overtime", { status, limit: 200 });
  const employees = useApi<Employee[]>(isAdmin ? "/employees" : null, { status: "ACTIVE" });

  const [employeeId, setEmployeeId] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!workDate) return setMessage({ ok: false, text: "Choose the work date" });
    if (isAdmin && !employeeId) return setMessage({ ok: false, text: "Choose an employee" });
    const mins = minutes.trim() === "" ? undefined : Number(minutes);
    if (mins !== undefined && (!Number.isInteger(mins) || mins < 1 || mins > 1440)) {
      return setMessage({ ok: false, text: "Minutes must be a whole number from 1 to 1440" });
    }
    try {
      await api("/overtime", {
        method: "POST",
        body: {
          work_date: workDate,
          ...(isAdmin && { employee_id: employeeId }),
          ...(isAdmin && mins !== undefined && { overtime_minutes: mins }),
          ...(notes.trim() && { notes: notes.trim() }),
        },
      });
      setMessage({ ok: true, text: "Overtime recorded" });
      setWorkDate(""); setMinutes(""); setNotes("");
      await records.reload();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <>
      <h1>Overtime</h1>
      <form className="card form-grid" onSubmit={submit}>
        <strong className="span-2">{isAdmin ? "Add overtime record" : "Request overtime"}</strong>
        {isAdmin && (
          <label>Employee
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {(employees.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
              ))}
            </select>
          </label>
        )}
        <label>Work date<input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></label>
        {isAdmin && (
          <label>Minutes (optional — derived from attendance if blank)
            <input type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
        )}
        <label>Notes (optional)<input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></label>
        {!isAdmin && <p className="muted small span-2">Minutes are calculated from your attendance beyond the shift length.</p>}
        {message && <p role={message.ok ? "status" : "alert"} className={`span-2 ${message.ok ? "ok" : "error"}`}>{message.text}</p>}
        <div className="span-2"><button>Submit</button></div>
      </form>

      <div className="toolbar" style={{ marginTop: "1.5rem" }}>
        <label className="inline">Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
      </div>
      {records.error && <p role="alert" className="error">{records.error}</p>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              {isAdmin && <th>Employee</th>}
              <th>Date</th><th>Overtime</th><th>Notes</th><th>Status</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {(records.data ?? []).map((r) => (
              <tr key={r.id}>
                {isAdmin && <td>{r.employee_code} {r.first_name} {r.last_name}</td>}
                <td>{r.work_date}</td>
                <td>{formatMinutes(r.overtime_minutes)}</td>
                <td>{r.notes ?? "—"}</td>
                <td><Status value={r.status} /></td>
                {isAdmin && (
                  <td>{r.status === "PENDING" && <ReviewButtons basePath="/overtime" id={r.id} onDone={records.reload} />}</td>
                )}
              </tr>
            ))}
            {!records.loading && (records.data ?? []).length === 0 && (
              <tr><td colSpan={isAdmin ? 6 : 4} className="muted">No overtime records.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
