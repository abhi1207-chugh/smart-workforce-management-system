"use client";

import Link from "next/link";
import { RequireRole } from "@/components/RequireRole";
import { Status } from "@/components/Status";
import { useApi } from "@/components/useApi";
import { formatMoney } from "@/lib/format";
import type { PayrollRecord } from "@/lib/types";

export default function PayslipsPage() {
  return (
    <RequireRole role="EMPLOYEE">
      <List />
    </RequireRole>
  );
}

function List() {
  const records = useApi<PayrollRecord[]>("/payroll/records", { limit: 100 });
  return (
    <>
      <h1>My payslips</h1>
      {records.error && <p role="alert" className="error">{records.error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Period</th><th>Gross</th><th>Net pay</th><th>Status</th></tr></thead>
          <tbody>
            {(records.data ?? []).map((r) => (
              <tr key={r.id}>
                <td><Link href={`/payslips/${r.id}`}>{r.period_start} → {r.period_end}</Link></td>
                <td>{formatMoney(r.gross_pay)}</td>
                <td><strong>{formatMoney(r.net_pay)}</strong></td>
                <td><Status value={r.status} /></td>
              </tr>
            ))}
            {!records.loading && (records.data ?? []).length === 0 && (
              <tr><td colSpan={4} className="muted">No payslips yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
