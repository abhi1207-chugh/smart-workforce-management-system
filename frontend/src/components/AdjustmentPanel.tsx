"use client";

import { useState } from "react";
import { useApi } from "./useApi";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import type { Adjustment, Employee } from "@/lib/types";

interface Props {
  runId: string;
  periodStart: string;
  periodEnd: string;
  onChanged(): void;
}

/** Add a bonus or deduction for the run's period (DRAFT runs only). */
export function AdjustmentPanel({ runId, periodStart, periodEnd, onChanged }: Props) {
  const employees = useApi<Employee[]>("/employees", { status: "ACTIVE" });
  const bonuses = useApi<Adjustment[]>("/bonuses", { payroll_run_id: runId });
  const deductions = useApi<Adjustment[]>("/deductions", { payroll_run_id: runId });
  const [kind, setKind] = useState<"bonus" | "deduction">("bonus");
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!employeeId) return setMessage({ ok: false, text: "Choose an employee" });
    if (!Number.isFinite(n) || n <= 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
      return setMessage({ ok: false, text: "Enter a positive amount with at most 2 decimals" });
    }
    if (!reason.trim()) return setMessage({ ok: false, text: "A reason is required" });
    if (kind === "deduction" && !type.trim()) return setMessage({ ok: false, text: "A deduction type is required" });
    try {
      await api(kind === "bonus" ? "/bonuses" : "/deductions", {
        method: "POST",
        body: {
          employee_id: employeeId,
          period_start: periodStart,
          period_end: periodEnd,
          amount: n,
          reason: reason.trim(),
          ...(kind === "deduction" && { deduction_type: type.trim() }),
        },
      });
      setMessage({ ok: true, text: `${kind === "bonus" ? "Bonus" : "Deduction"} added. Compute the run to include it.` });
      setAmount(""); setReason(""); setType("");
      onChanged();
      await Promise.all([bonuses.reload(), deductions.reload()]);
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  const name = (id: string) => {
    const e = employees.data?.find((x) => x.id === id);
    return e ? `${e.employee_code} ${e.first_name} ${e.last_name}` : id;
  };

  return (
    <>
      <h2>Bonuses &amp; deductions</h2>
      <form className="card form-grid" onSubmit={submit}>
        <label>Type
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="bonus">Bonus</option>
            <option value="deduction">Deduction</option>
          </select>
        </label>
        <label>Employee
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select…</option>
            {(employees.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
            ))}
          </select>
        </label>
        <label>Amount<input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        {kind === "deduction" ? (
          <label>Deduction type<input value={type} maxLength={100} onChange={(e) => setType(e.target.value)} /></label>
        ) : <span />}
        <label className="span-2">Reason<input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></label>
        <p className="muted small span-2">Applies to {periodStart} → {periodEnd}. Deductions are capped at gross pay.</p>
        {message && <p role={message.ok ? "status" : "alert"} className={`span-2 ${message.ok ? "ok" : "error"}`}>{message.text}</p>}
        <div className="span-2"><button>Add</button></div>
      </form>

      {[["Bonuses", bonuses.data], ["Deductions", deductions.data]].map(([title, rows]) =>
        (rows as Adjustment[] | null)?.length ? (
          <div key={title as string} className="card table-wrap" style={{ marginTop: "1rem" }}>
            <table>
              <thead><tr><th>{title as string}</th><th>Amount</th><th>Reason</th></tr></thead>
              <tbody>
                {(rows as Adjustment[]).map((a) => (
                  <tr key={a.id}>
                    <td>{name(a.employee_id)}{a.deduction_type ? ` · ${a.deduction_type}` : ""}</td>
                    <td>{formatMoney(a.amount)}</td>
                    <td>{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null
      )}
      <p className="muted small">Adjustments appear in the lists above once the run has been computed.</p>
    </>
  );
}
