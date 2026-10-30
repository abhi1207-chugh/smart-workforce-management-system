"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Status } from "@/components/Status";
import { useApi } from "@/components/useApi";
import { useAuth } from "@/lib/auth";
import { formatMinutes, formatMoney } from "@/lib/format";
import type { Payslip } from "@/lib/types";

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data, error, loading } = useApi<Payslip>(`/payroll/records/${id}/payslip`);
  const back = user?.role === "ADMIN" ? "/payroll" : "/payslips";

  return (
    <>
      <p className="no-print"><Link href={back}>← Back</Link></p>
      {loading && <p className="muted">Loading…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {data && (
        <div className="card payslip">
          <div className="toolbar">
            <h1>Payslip</h1>
            <Status value={data.record.status} />
            <button className="secondary no-print" onClick={() => window.print()}>Print</button>
          </div>
          <p>
            <strong>{data.employee.first_name} {data.employee.last_name}</strong> ({data.employee.employee_code}) ·{" "}
            {data.employee.department}<br />
            <span className="muted">Period {data.period.start} → {data.period.end}</span>
          </p>
          <table>
            <tbody>
              <tr><td>Monthly base salary</td><td>{formatMoney(data.record.monthly_base_salary)}</td></tr>
              <tr><td>Working days in policy</td><td>{data.record.working_days_in_policy}</td></tr>
              <tr><td>One-day salary</td><td>{formatMoney(data.record.one_day_salary)}</td></tr>
              <tr><td>Attendance-adjusted pay</td><td>{formatMoney(data.record.attendance_adjusted_pay)}</td></tr>
              <tr><td>Overtime pay</td><td>{formatMoney(data.record.overtime_pay)}</td></tr>
              <tr><td>Bonuses</td><td>{formatMoney(data.record.bonus_total)}</td></tr>
              <tr><td><strong>Gross pay</strong></td><td><strong>{formatMoney(data.record.gross_pay)}</strong></td></tr>
              <tr><td>Deductions</td><td>−{formatMoney(data.record.deduction_total)}</td></tr>
              <tr><td><strong>Net pay</strong></td><td><strong>{formatMoney(data.record.net_pay)}</strong></td></tr>
            </tbody>
          </table>
          <p className="muted small">
            Attendance: {data.attendance.full_days} full, {data.attendance.half_days} half,{" "}
            {data.attendance.leave_days} leave, {data.attendance.absent_days} absent ·{" "}
            {formatMinutes(data.attendance.total_working_minutes)} worked
          </p>
          {data.payment && (
            <p className="ok small">
              Paid {new Date(data.payment.paid_at).toLocaleDateString()}
              {data.payment.reference ? ` · ref ${data.payment.reference}` : ""}
            </p>
          )}
        </div>
      )}
    </>
  );
}
