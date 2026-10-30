"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequireRole } from "@/components/RequireRole";
import { Status } from "@/components/Status";
import { useApi } from "@/components/useApi";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import type { PayrollRun } from "@/lib/types";

export default function PayrollPage() {
  return (
    <RequireRole role="ADMIN">
      <Runs />
    </RequireRole>
  );
}

function Runs() {
  const router = useRouter();
  const runs = useApi<PayrollRun[]>("/payroll/runs", { limit: 100 });
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!start || !end) return setError("Choose the period start and end");
    if (end < start) return setError("Period end cannot be before start");
    setBusy(true);
    setError(null);
    try {
      const run = await api<PayrollRun>("/payroll/runs", { method: "POST", body: { period_start: start, period_end: end } });
      router.push(`/payroll/${run.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Payroll</h1>
      <form className="card row-gap wrap" onSubmit={create}>
        <strong>New payroll run</strong>
        <label className="inline">From<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="inline">To<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <button disabled={busy}>Create run</button>
        <span className="muted small">Uses the default payroll policy and overtime rate.</span>
        {error && <span role="alert" className="error">{error}</span>}
      </form>

      {runs.error && <p role="alert" className="error">{runs.error}</p>}
      <div className="card table-wrap" style={{ marginTop: "1rem" }}>
        <table>
          <thead>
            <tr><th>Period</th><th>Status</th><th>Records</th><th>Gross</th><th>Net</th></tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id}>
                <td><Link href={`/payroll/${r.id}`}>{r.period_start} → {r.period_end}</Link></td>
                <td><Status value={r.status} /></td>
                <td>{r.record_count}</td>
                <td>{formatMoney(r.total_gross)}</td>
                <td>{formatMoney(r.total_net)}</td>
              </tr>
            ))}
            {!runs.loading && (runs.data ?? []).length === 0 && (
              <tr><td colSpan={5} className="muted">No payroll runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
