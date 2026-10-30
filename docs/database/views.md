# PostgreSQL Views — Phase 2.2 Step 3

Read-only views for reporting and backend queries. Defined in `20240903110000_advanced_dbms_features.sql`.

---

## `v_open_attendance_sessions`

| | |
|---|---|
| **Purpose** | List employees with an `OPEN` attendance session (duplicate check-in prevention). |
| **Source tables** | `attendance_session`, `employee` |
| **Key columns** | `session_id`, `employee_id`, `employee_code`, `check_in_at`, `work_date`, `check_in_source` |
| **Usage** | Backend before creating a new session; admin dashboard. |

---

## `v_employee_attendance_summary`

| | |
|---|---|
| **Purpose** | Per-employee daily attendance classification. |
| **Source tables** | `employee`, `employee_day_attendance` |
| **Key columns** | `employee_code`, `work_date`, `classification`, `total_working_minutes`, `payable_day_fraction`, `is_scheduled_working_day` |
| **Usage** | Employee attendance history, HR reports. |

---

## `v_daily_attendance_report`

| | |
|---|---|
| **Purpose** | Aggregated counts by date and classification. |
| **Source tables** | `employee_day_attendance` |
| **Key columns** | `work_date`, `classification`, `employee_count`, `total_minutes`, `total_payable_day_fractions` |
| **Usage** | Daily workforce summary for admins. |

---

## `v_leave_balance_report`

| | |
|---|---|
| **Purpose** | Current leave balances by employee and leave type. |
| **Source tables** | `leave_balance`, `employee`, `leave_type` |
| **Key columns** | `employee_code`, `leave_type_code`, `balance_days`, `updated_at` |
| **Usage** | Leave management UI, balance inquiries. |

---

## `v_overtime_summary`

| | |
|---|---|
| **Purpose** | Overtime records with employee identifiers. |
| **Source tables** | `overtime_record`, `employee` |
| **Key columns** | `employee_code`, `work_date`, `overtime_minutes`, `status`, `approved_at` |
| **Usage** | Overtime approval queue, payroll review. |

---

## `v_payroll_register`

| | |
|---|---|
| **Purpose** | Full payroll register per run and employee. |
| **Source tables** | `payroll_run`, `payroll_record`, `employee` |
| **Key columns** | `period_start`, `period_end`, `run_status`, `one_day_salary`, `attendance_adjusted_pay`, `overtime_pay`, `bonus_total`, `deduction_total`, `gross_pay`, `net_pay`, `record_status` |
| **Usage** | Payroll admin reports, export, payment processing. |

---

## Design Notes

- Views contain **no presentation logic** (formatting, locale) — that belongs in the backend/frontend.
- Views are **not materialized** — suitable for MVP scale; materialized views may be added later if reporting load grows.
- All views join only tables present in the Step 2 schema.
