# PostgreSQL Functions — Phase 2.2 Step 3

This document describes database functions implemented in migration `20240903110000_advanced_dbms_features.sql`. Business rules are sourced from [`business-rules.md`](../requirements/business-rules.md).

---

## Utility

### `set_updated_at()`

| | |
|---|---|
| **What** | Trigger function that sets `NEW.updated_at = CURRENT_TIMESTAMP`. |
| **Why** | Keeps `updated_at` accurate without backend boilerplate. |
| **How** | `BEFORE UPDATE` trigger on 12 tables. |
| **Where** | Any row update on department, shift, employee, user, face_registration_metadata, attendance_session, employee_day_attendance, leave_type, leave_request, overtime_record, payroll_policy, overtime_rate_config, payroll_run, payroll_record. |

---

## Attendance Calculations

### `compute_working_duration_minutes(check_in, check_out)`

| | |
|---|---|
| **What** | Returns whole minutes between check-in and check-out. |
| **Why** | BR-ATT-09 — standardized duration for classification and payroll. |
| **How** | `FLOOR(EPOCH delta / 60)`; `STRICT` (NULL in → NULL out). |
| **Where** | `complete_attendance_checkout`, reporting. |

### `compute_session_working_duration(session_id)`

| | |
|---|---|
| **What** | Duration for a **COMPLETED** session. |
| **Why** | Convenience wrapper over session row. |
| **How** | Reads `attendance_session` where `status = 'COMPLETED'`. |
| **Where** | Backend queries, overtime derivation. |

### `classify_day_from_minutes(total_minutes)`

| | |
|---|---|
| **What** | Returns `(classification, payable_day_fraction)`. |
| **Why** | BR-ATT-13/15/18 — fixed 4-hour threshold. |
| **How** | `< 240` → `HALF_DAY` / `0.5`; `>= 240` → `FULL_DAY` / `1.0`. |
| **Where** | `complete_attendance_checkout`, payroll day-fraction sums. |

### `is_scheduled_working_day(employee_id, work_date)`

| | |
|---|---|
| **What** | `TRUE` if date is a scheduled working day for the employee's shift. |
| **Why** | BR-ATT-23/24 — weekly-off configuration. |
| **How** | Checks `shift_weekly_off` for employee's assigned shift. |
| **Where** | Day attendance records, leave marking. |

### `derive_shift_timing_flags(employee_id, check_in, check_out)`

| | |
|---|---|
| **What** | Returns `(is_late_arrival, is_early_checkout)`. |
| **Why** | BR-ATT-26/27 — lateness vs shift times. |
| **How** | Compares check-in/out `TIME` to shift `start_time`/`end_time`. Late only when check-in is after `start_time + shift.grace_period_minutes` (BR-ATT-29; Stage 3). |
| **Where** | `complete_attendance_checkout`. |

### `derive_overtime_minutes(employee_id, work_date)`

| | |
|---|---|
| **What** | `max(0, total completed session minutes − shift scheduled duration)`. |
| **Why** | BR-OT-02 — overtime beyond shift length. |
| **How** | Sums `attendance_session.working_duration_minutes` for date. |
| **Where** | Overtime record creation (backend), reporting. |

---

## Leave

### `check_leave_balance(employee_id, leave_type_id, days)`

| | |
|---|---|
| **What** | `TRUE` if `leave_balance.balance_days >= days`. |
| **Why** | BR-LEAVE-05 — balance validation before approval. |
| **How** | Reads `leave_balance`; returns `FALSE` if no row. **Admin override (BR-LEAVE-05) not implemented** — TBD. |
| **Where** | `approve_leave_request`. |

### `approve_leave_request(request_id, reviewer_user_id)`

| | |
|---|---|
| **What** | Atomically approves leave, deducts balance, marks days as `LEAVE`. |
| **Why** | BR-LEAVE-03/04/09 — multi-step leave approval. |
| **How** | `FOR UPDATE` on request; validates `PENDING` and balance; updates `leave_request`, `leave_balance`, upserts `employee_day_attendance` with paid/unpaid fraction. |
| **Where** | Backend leave approval API (calls this function in a transaction). |

---

## Payroll

### `compute_one_day_salary(monthly_base_salary, payroll_policy_id)`

| | |
|---|---|
| **What** | One-day salary from monthly base and policy. |
| **Why** | BR-PAY-05 — daily rate for attendance-adjusted pay. |
| **How** | `FIXED_DIVISOR`: `ROUND(monthly / fixed_divisor, 2)`. `CALENDAR_WORKING_DAYS` raises here; payroll now uses `resolve_payroll_divisor()` instead (Stage 3). |
| **Where** | `compute_employee_payroll_record`. |

### `resolve_payroll_divisor(payroll_policy_id, employee_id, period_start, period_end)` (Stage 3)

| | |
|---|---|
| **What** | Working-day divisor for a policy. |
| **How** | `FIXED_DIVISOR`: the fixed value. `CALENDAR_WORKING_DAYS`: days in the period that are not weekly-off for the employee's shift (no holiday calendar). Raises if zero. |
| **Where** | `compute_employee_payroll_record` (stored in `working_days_in_policy`). Also: deductions are capped at gross pay so `net_pay >= 0`. |

### `adjust_leave_balance(employee_id, leave_type_id, new_balance, admin_user_id, reason)` (Stage 3)

| | |
|---|---|
| **What** | ADMIN override: sets a leave balance to an absolute value (upserts) and writes an `ADJUST` audit entry with old/new/reason. |
| **Where** | `POST /leave/balances/adjust`. |

### `compute_attendance_adjusted_pay(employee_id, period_start, period_end, one_day_salary)`

| | |
|---|---|
| **What** | Sum of `one_day_salary × payable_day_fraction` for period. |
| **Why** | BR-PAY-07..10 — attendance-based pay component. |
| **How** | Includes `FULL_DAY`, `HALF_DAY`, `LEAVE` classifications. |
| **Where** | `compute_employee_payroll_record`. |

### `compute_approved_overtime_pay(employee_id, period_start, period_end, one_day_salary, shift_duration_minutes, multiplier)`

| | |
|---|---|
| **What** | Approved overtime pay for period. |
| **Why** | BR-OT-05/07, BR-PAY-11 — overtime component of gross pay. |
| **How** | Hourly rate = `one_day_salary / (shift_duration_minutes/60)`; pay = `SUM(approved_minutes/60 × hourly_rate × multiplier)`. Uses multiplier from `overtime_rate_config` at runtime (not invented). |
| **Where** | `compute_employee_payroll_record`. |

### `compute_employee_payroll_record(payroll_run_id, employee_id)`

| | |
|---|---|
| **What** | Computes and upserts a `DRAFT` `payroll_record`. |
| **Why** | BR-PAY-15 — per-employee payroll snapshot. |
| **How** | Loads run policy/OT config; computes components; links unlinked bonus/deduction rows. |
| **Where** | `finalize_payroll_run`, backend preview. |

### `finalize_payroll_run(payroll_run_id)`

| | |
|---|---|
| **What** | Generates records for all `ACTIVE` employees and finalizes run. |
| **Why** | BR-PAY-16/17/18 — atomic payroll finalization. |
| **How** | `FOR UPDATE` on run; loops employees; sets records and run to `FINALIZED`; appends `audit_log`. |
| **Where** | Backend payroll finalization API. |

---

## Attendance Transaction

### `complete_attendance_checkout(session_id, check_out_at)`

| | |
|---|---|
| **What** | Atomically completes an `OPEN` session and upserts `employee_day_attendance`. |
| **Why** | BR-ATT-08..16 — checkout must not leave partial state. |
| **How** | `FOR UPDATE` session; validates `OPEN`; computes duration, classification, shift flags; updates session; upserts day row (accumulates minutes on conflict). |
| **Where** | Backend attendance checkout API. |

**Architecture note:** Face recognition returns `employee_id`; the backend decides to call this function. Recognition alone does not mark attendance.

---

## Not Implemented (TBD Rules)

| Rule | Reason |
|------|--------|
| BR-PAY-06 `CALENDAR_WORKING_DAYS` | Policy divisor calculation not finalized |
| BR-LEAVE-05 admin override | Override behavior TBD |
| BR-DED-02 deduction cap / `net_pay >= 0` | Cap policy TBD |
| BR-ATT-29 grace period | Lateness grace minutes TBD |
