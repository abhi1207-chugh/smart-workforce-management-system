# PostgreSQL Triggers — Phase 2.2 Step 3

Triggers enforce database invariants automatically. Defined in `20240903110000_advanced_dbms_features.sql`.

---

## Integrity Triggers

### `trg_payroll_record_prevent_finalized_update`

| | |
|---|---|
| **Table** | `payroll_record` |
| **Event** | `BEFORE UPDATE` |
| **Purpose** | Prevents mutation of finalized/paid payroll amounts (BR-PAY-18/19). |
| **Why in DB** | Payroll immutability must hold regardless of which client updates the row. |
| **Behavior** | Blocks updates when `OLD.status IN ('FINALIZED','PAID')` except allowed `FINALIZED → PAID` with unchanged monetary fields. |

### `trg_payment_requires_finalized_payroll`

| | |
|---|---|
| **Table** | `payment` |
| **Event** | `BEFORE INSERT` |
| **Purpose** | Payment only against `FINALIZED` payroll records (BR-PMT-01). |
| **Why in DB** | Prevents recording payment before payroll is locked. |

### `trg_attendance_session_active_employee`

| | |
|---|---|
| **Table** | `attendance_session` |
| **Event** | `BEFORE INSERT` |
| **Purpose** | Blocks check-in for non-`ACTIVE` employees (BR-EMP-03). |
| **Why in DB** | Attendance invariant must hold even if backend validation is bypassed. |

### `trg_attendance_session_audit_correction`

| | |
|---|---|
| **Table** | `attendance_session` |
| **Event** | `AFTER INSERT OR UPDATE` |
| **Purpose** | Appends `audit_log` when correction fields are set. |
| **Why in DB** | Ensures corrections are always audited at persistence layer. |
| **Condition** | `check_in_source = 'CORRECTION'` OR `check_out_source = 'CORRECTION'` OR `correction_reason IS NOT NULL`. |

### `trg_audit_log_no_update` / `trg_audit_log_no_delete`

| | |
|---|---|
| **Table** | `audit_log` |
| **Event** | `BEFORE UPDATE`, `BEFORE DELETE` |
| **Purpose** | Append-only audit trail (BR-AUDIT-05). |
| **Why in DB** | Audit tampering must be impossible at the database layer. |

---

## `updated_at` Triggers

| Trigger | Table |
|---------|-------|
| `trg_department_set_updated_at` | `department` |
| `trg_shift_set_updated_at` | `shift` |
| `trg_employee_set_updated_at` | `employee` |
| `trg_user_set_updated_at` | `"user"` |
| `trg_face_registration_set_updated_at` | `face_registration_metadata` |
| `trg_attendance_session_set_updated_at` | `attendance_session` |
| `trg_employee_day_attendance_set_updated_at` | `employee_day_attendance` |
| `trg_leave_type_set_updated_at` | `leave_type` |
| `trg_leave_request_set_updated_at` | `leave_request` |
| `trg_overtime_record_set_updated_at` | `overtime_record` |
| `trg_payroll_policy_set_updated_at` | `payroll_policy` |
| `trg_overtime_rate_config_set_updated_at` | `overtime_rate_config` |
| `trg_payroll_run_set_updated_at` | `payroll_run` |
| `trg_payroll_record_set_updated_at` | `payroll_record` |

All call `set_updated_at()` on `BEFORE UPDATE`.

**Note:** `CURRENT_TIMESTAMP` is stable within a transaction (PostgreSQL snapshot semantics). For typical short API transactions this is sufficient.

---

## Design Principles

1. **No recursive triggers** — trigger functions do not modify their own table in a way that re-fires the same trigger.
2. **No cosmetic triggers** — each trigger solves a documented integrity or audit requirement.
3. **CHECK constraints complement triggers** — `payroll_record_gross_pay_formula` and `payroll_record_net_pay_formula` enforce formulas at row level.
