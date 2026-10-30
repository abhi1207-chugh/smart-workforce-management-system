"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdjustmentPanel } from "@/components/AdjustmentPanel";
import { RequireRole } from "@/components/RequireRole";
import { Status } from "@/components/Status";
import { useApi } from "@/components/useApi";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import type { PayrollRegister, PayrollRun } from "@/lib/types";

export default function RunPage() {
  return (
    <RequireRole role="ADMIN">
      <RunDetail />
    </RequireRole>
  );
}

function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const run = useApi<PayrollRun>(`/payroll/runs/${id}`);
  const register = useApi<PayrollRegister>("/reports/payroll-register", { period_id: id });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = () => Promise.all([run.reload(), register.reload()]);

  async function act(action: "compute" | "finalize") {
    if (
      action === "finalize" &&
      !window.confirm("Finalize this payroll run? Records for all active employees are locked and cannot be changed.")
    ) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(`/payroll/runs/${id}/${action}`, { method: "POST" });
      setMessage({ ok: true, text: action === "compute" ? "Preview computed." : "Payroll finalized." });
      await reload();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(recordId: string) {
    setMessage(null);
    try {
      await api("/payments", { method: "POST", body: { payroll_record_id: recordId } });
      await reload();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    }
  }

  const r = run.data;
  const reg = register.data;
  return (
    <>
      <p><Link href="/payroll">← Payroll</Link></p>
      {run.error && <p role="alert" className="error">{run.error}</p>}
      {r && (
        <>
          <div className="toolbar">
            <h1>{r.period_start} → {r.period_end}</h1>
            <Status value={r.status} />
            {r.status === "DRAFT" && (
              <>
                <button className="secondary" disabled={busy} onClick={() => act("compute")}>Compute preview</button>
                <button disabled={busy} onClick={() => act("finalize")}>Finalize</button>
              </>
            )}
          </div>
          {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "ok" : "error"}>{message.text}</p>}

          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th><th>Attendance</th><th>Overtime</th><th>Bonus</th>
                  <th>Deductions</th><th>Gross</th><th>Net</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {(reg?.rows ?? []).map((x) => (
                  <tr key={x.payroll_record_id}>
                    <td>{x.employee_code} {x.first_name} {x.last_name}</td>
                    <td>{formatMoney(x.attendance_adjusted_pay)}</td>
                    <td>{formatMoney(x.overtime_pay)}</td>
                    <td>{formatMoney(x.bonus_total)}</td>
                    <td>{formatMoney(x.deduction_total)}</td>
                    <td>{formatMoney(x.gross_pay)}</td>
                    <td><strong>{formatMoney(x.net_pay)}</strong></td>
                    <td><Status value={x.status} /></td>
                    <td>
                      <span className="row-gap">
                        <Link href={`/payslips/${x.payroll_record_id}`}>Payslip</Link>
                        {x.status === "FINALIZED" && (
                          <button className="link" onClick={() => markPaid(x.payroll_record_id)}>Mark paid</button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
                {reg && reg.rows.length === 0 && (
                  <tr><td colSpan={9} className="muted">No records yet — compute a preview to generate them.</td></tr>
                )}
              </tbody>
              {reg && reg.rows.length > 0 && (
                <tfoot>
                  <tr>
                    <th>Total ({reg.totals.employees})</th>
                    <th>{formatMoney(reg.totals.attendance_adjusted_pay)}</th>
                    <th>{formatMoney(reg.totals.overtime_pay)}</th>
                    <th>{formatMoney(reg.totals.bonus_total)}</th>
                    <th>{formatMoney(reg.totals.deduction_total)}</th>
                    <th>{formatMoney(reg.totals.gross_pay)}</th>
                    <th>{formatMoney(reg.totals.net_pay)}</th>
                    <th colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {r.status === "DRAFT" && (
            <AdjustmentPanel runId={id} periodStart={r.period_start} periodEnd={r.period_end} onChanged={() => void 0} />
          )}
        </>
      )}
    </>
  );
}
