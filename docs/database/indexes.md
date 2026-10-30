# Supporting Indexes — Phase 2.2 Step 3

Additional indexes from `20240903110000_advanced_dbms_features.sql`. Step 2 indexes are unchanged.

---

## New Indexes (Step 3)

### `leave_request_employee_date_range_idx`

| | |
|---|---|
| **Table** | `leave_request` |
| **Columns** | `(employee_id, start_date, end_date)` |
| **Use case** | Overlap checks, employee leave history by date range |
| **Why** | Step 2 has `(employee_id, status)` only; date-range queries need this composite |

### `bonus_employee_period_unlinked_idx`

| | |
|---|---|
| **Table** | `bonus` |
| **Columns** | `(employee_id, period_start, period_end) WHERE payroll_run_id IS NULL` |
| **Use case** | `compute_employee_payroll_record` linking unlinked bonuses |
| **Why** | Partial index targets only rows awaiting payroll attachment |

### `deduction_employee_period_unlinked_idx`

| | |
|---|---|
| **Table** | `deduction` |
| **Columns** | `(employee_id, period_start, period_end) WHERE payroll_run_id IS NULL` |
| **Use case** | Same as bonus — payroll run linking |
| **Why** | Partial index for unlinked deductions only |

### `payroll_run_period_idx`

| | |
|---|---|
| **Table** | `payroll_run` |
| **Columns** | `(period_start, period_end)` |
| **Use case** | Lookup runs by pay period, `v_payroll_register` filtering |
| **Why** | Complements unique partial index on non-failed runs |

### `overtime_record_payroll_lookup_idx`

| | |
|---|---|
| **Table** | `overtime_record` |
| **Columns** | `(employee_id, work_date) WHERE status = 'APPROVED'` |
| **Use case** | `compute_approved_overtime_pay` period aggregation |
| **Why** | Partial index on approved rows only; Step 2 index includes `status` in composite but this optimizes approved-only scans |

---

## Existing Indexes (Step 2) — Not Duplicated

| Index | Table |
|-------|-------|
| `attendance_session_one_open_per_employee_idx` | `attendance_session` |
| `attendance_session_employee_id_status_idx` | `attendance_session` |
| `attendance_session_employee_id_work_date_idx` | `attendance_session` |
| `overtime_record_employee_id_work_date_status_idx` | `overtime_record` |
| `payroll_record_employee_id_idx` | `payroll_record` |
| `payroll_run_period_unique_non_failed_idx` | `payroll_run` |
| `leave_request_employee_id_status_idx` | `leave_request` |
| `face_registration_metadata_one_active_per_employee_idx` | `face_registration_metadata` |

---

## Indexing Principles

1. Index foreign-key access paths used in functions and views.
2. Use partial indexes when a `WHERE` clause is stable and selective.
3. Do not index every column — only documented query patterns.
