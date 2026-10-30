export type Role = "ADMIN" | "EMPLOYEE";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  employee_id: string | null;
}

export interface LoginResult {
  token: string;
  user: SessionUser;
}

export interface DashboardSummary {
  work_date: string;
  active_employees: number;
  present_today: number;
  checked_in_now: number;
  late_today: number;
  on_leave_today: number;
  pending_leave_requests: number;
  pending_overtime: number;
  latest_payroll_run: { id: string; period_start: string; period_end: string; status: string } | null;
}

export interface AttendanceSession {
  id: string;
  work_date: string;
  check_in: string;
  check_out: string | null;
  working_duration_minutes: number | null;
  status: "CHECKED_IN" | "COMPLETED";
  is_late_arrival: boolean;
  is_early_checkout: boolean;
}

export interface TodayStatus {
  employee_id: string;
  work_date: string;
  status: "NOT_CHECKED_IN" | "CHECKED_IN" | "CHECKED_OUT";
  sessions: AttendanceSession[];
  day: { classification: string; total_working_minutes: number; payable_day_fraction: string } | null;
}

export interface MeSummary {
  period: { from: string; to: string };
  attendance: {
    full_days: number;
    half_days: number;
    leave_days: number;
    absent_days: number;
    total_working_minutes: number;
  };
  overtime: { approved_minutes: number; pending_minutes: number };
  leave_balances: { leave_type_code: string; leave_type_name: string; balance_days: string }[];
  latest_payroll: { id: string; period_start: string; period_end: string; net_pay: string; status: string } | null;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface Employee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  department_id: string;
  shift_id: string;
  status: "ACTIVE" | "INACTIVE";
  face_registered: boolean;
}

export interface EmployeeDetail extends Employee {
  phone: string | null;
  monthly_base_salary: string;
  hire_date: string | null;
}

export interface AttendanceRow extends AttendanceSession {
  employee_id: string;
  employee_code?: string;
  first_name?: string;
  last_name?: string;
  correction_reason: string | null;
}

export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  annual_entitlement_days: string;
  is_paid: boolean;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  leave_type_id: string;
  leave_type_code: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: ReviewStatus;
}

export interface LeaveBalance {
  employee_id: string;
  employee_code: string;
  leave_type_id: string;
  leave_type_code: string;
  leave_type_name: string;
  balance_days: string;
}

export interface OvertimeRecord {
  id: string;
  employee_id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  work_date: string;
  overtime_minutes: number;
  status: ReviewStatus;
  notes: string | null;
}

export interface PayrollRun {
  id: string;
  period_start: string;
  period_end: string;
  status: "DRAFT" | "FINALIZED" | "FAILED";
  record_count: number;
  total_gross: string;
  total_net: string;
}

export interface PayrollRecord {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  employee_code: string;
  period_start: string;
  period_end: string;
  monthly_base_salary: string;
  working_days_in_policy: string;
  one_day_salary: string;
  attendance_adjusted_pay: string;
  overtime_pay: string;
  bonus_total: string;
  deduction_total: string;
  gross_pay: string;
  net_pay: string;
  status: "DRAFT" | "FINALIZED" | "PAID";
}

export interface PayrollRegister {
  run: { id: string; period_start: string; period_end: string; status: string };
  rows: {
    payroll_record_id: string;
    employee_code: string;
    first_name: string;
    last_name: string;
    attendance_adjusted_pay: string;
    overtime_pay: string;
    bonus_total: string;
    deduction_total: string;
    gross_pay: string;
    net_pay: string;
    status: "DRAFT" | "FINALIZED" | "PAID";
  }[];
  totals: {
    employees: number;
    attendance_adjusted_pay: string;
    overtime_pay: string;
    bonus_total: string;
    deduction_total: string;
    gross_pay: string;
    net_pay: string;
  };
}

export interface Payslip {
  record: PayrollRecord;
  employee: { employee_code: string; first_name: string; last_name: string; email: string; department: string };
  period: { start: string; end: string };
  attendance: {
    full_days: number;
    half_days: number;
    leave_days: number;
    absent_days: number;
    total_working_minutes: number;
  };
  payment: { paid_at: string; reference: string | null; notes: string | null } | null;
}

export interface Adjustment {
  id: string;
  employee_id: string;
  amount: string;
  reason: string;
  period_start: string;
  period_end: string;
  deduction_type?: string;
}

export interface AttendanceSummaryRow {
  employee_id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  full_days: number;
  half_days: number;
  leave_days: number;
  absent_days: number;
  total_working_minutes: number;
  payable_days: string;
  late_arrivals: number;
  early_checkouts: number;
}

export interface LeaveBalanceReportRow {
  employee_id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  leave_type_code: string;
  leave_type_name: string;
  balance_days: string;
}

export interface AuditEntry {
  id: string;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
