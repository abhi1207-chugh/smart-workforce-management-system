# Relational Schema (Preliminary)

**Phase:** 2.1 — Design only (no migrations)  
**Database:** PostgreSQL  
**Identifier type:** `UUID` for primary keys (design choice — enables distributed ID generation)

All timestamps use `TIMESTAMPTZ` (server-authoritative per BR-ATT-04, BR-ATT-12).

---

## 1. `department`

**Purpose:** Organizational unit for grouping employees.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Primary key |
| `code` | VARCHAR(50) | NOT NULL | Unique department code |
| `name` | VARCHAR(255) | NOT NULL | Display name |
| `status` | ENUM | NOT NULL | `ACTIVE`, `INACTIVE` |
| `created_at` | TIMESTAMPTZ | NOT NULL | Record creation |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Last update |

**PK:** `id`  
**FK:** —  
**Unique:** `code`

---

## 2. `shift`

**Purpose:** Defines scheduled work window and basis for lateness, overtime, and weekly-off evaluation.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Primary key |
| `name` | VARCHAR(255) | NOT NULL | Shift name |
| `start_time` | TIME | NOT NULL | Scheduled start |
| `end_time` | TIME | NOT NULL | Scheduled end |
| `scheduled_duration_minutes` | INTEGER | NOT NULL | Derived or explicit shift duration for overtime |
| `status` | ENUM | NOT NULL | `ACTIVE`, `INACTIVE` |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** —  
**Constraint:** `end_time` ≠ `start_time`; `scheduled_duration_minutes > 0`

---

## 3. `shift_weekly_off`

**Purpose:** Configurable weekly-off days per shift (BR-SHIFT-03, BR-ATT-24).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Primary key |
| `shift_id` | UUID | FK → `shift.id` | Parent shift |
| `day_of_week` | SMALLINT | NOT NULL | 0=Sunday … 6=Saturday (or ISO enum — **exact enum TBD**) |

**PK:** `id`  
**FK:** `shift_id` → `shift(id)` ON DELETE RESTRICT  
**Unique:** `(shift_id, day_of_week)`

---

## 4. `employee`

**Purpose:** Workforce identity — source of truth for employment data linked to attendance and payroll.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Primary key — **same ID referenced in vector DB** |
| `employee_code` | VARCHAR(50) | NOT NULL | Unique org identifier (BR-EMP-04) |
| `first_name` | VARCHAR(100) | NOT NULL | |
| `last_name` | VARCHAR(100) | NOT NULL | |
| `email` | VARCHAR(255) | NOT NULL | Work email |
| `phone` | VARCHAR(50) | NULL | Contact |
| `department_id` | UUID | FK → `department.id` | Current department (BR-EMP-01) |
| `shift_id` | UUID | FK → `shift.id` | Primary shift (BR-EMP-02) |
| `monthly_base_salary` | NUMERIC(12,2) | NOT NULL | Monthly base pay (BR-EMP-06, BR-PAY-04) |
| `status` | ENUM | NOT NULL | `ACTIVE`, `INACTIVE` (BR-EMP-03) |
| `hire_date` | DATE | NULL | Employment start |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `department_id`, `shift_id`  
**Unique:** `employee_code`, `email`  
**Constraint:** `monthly_base_salary >= 0`; inactive employees cannot have new attendance (enforced by app + triggers)

---

## 5. `user`

**Purpose:** Authentication account — separate from employee (admin may lack employee record).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Primary key |
| `email` | VARCHAR(255) | NOT NULL | Login email |
| `password_hash` | VARCHAR(255) | NOT NULL | Hashed password (algorithm **TBD**) |
| `role` | ENUM | NOT NULL | `ADMIN`, `EMPLOYEE` |
| `employee_id` | UUID | FK → `employee.id` | NULL for admin-only accounts |
| `status` | ENUM | NOT NULL | `ACTIVE`, `INACTIVE` |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `employee_id` → `employee(id)` ON DELETE SET NULL  
**Unique:** `email`, `UNIQUE (employee_id)` — at most one user per employee; `employee_id` remains nullable for `ADMIN` users  
**Constraint:** `role = EMPLOYEE` implies `employee_id IS NOT NULL` (check constraint)

---

## 6. `face_registration_metadata`

**Purpose:** PostgreSQL-side face registration history and vector DB linkage — **no embedding stored here**. Multiple historical registrations may exist per employee; only one may be `ACTIVE` at a time (MVP).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Primary key |
| `employee_id` | UUID | FK → `employee.id` | Employee reference — multiple rows per employee allowed (history) |
| `vector_record_id` | VARCHAR(255) | NOT NULL | ID of record in vector DB collection |
| `model_name` | VARCHAR(100) | NOT NULL | Embedding model identifier |
| `model_version` | VARCHAR(50) | NOT NULL | Model version string |
| `embedding_version` | VARCHAR(50) | NOT NULL | Embedding pipeline version |
| `status` | ENUM | NOT NULL | `ACTIVE`, `SUPERSEDED`, `REVOKED` |
| `registered_at` | TIMESTAMPTZ | NOT NULL | Registration timestamp |
| `registered_by_user_id` | UUID | FK → `user.id` | Admin who registered |
| `revoked_at` | TIMESTAMPTZ | NULL | When embedding was revoked |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `employee_id`, `registered_by_user_id`  
**Unique:** `UNIQUE (employee_id) WHERE status = 'ACTIVE'` — only one active registration per employee; older rows remain as `SUPERSEDED` or `REVOKED`

**Lifecycle:** Registration 1 → `SUPERSEDED`, Registration 2 → `SUPERSEDED`, Registration 3 → `ACTIVE`. Face embeddings remain in the vector DB; PostgreSQL stores metadata and `vector_record_id`.

---

## 7. `attendance_session`

**Purpose:** Check-in/check-out session — state machine for attendance capture (BR-ATT-05–12).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Primary key |
| `employee_id` | UUID | FK → `employee.id` | Session owner |
| `check_in_at` | TIMESTAMPTZ | NOT NULL | Server-authoritative check-in |
| `check_out_at` | TIMESTAMPTZ | NULL | Server-authoritative check-out |
| `working_duration_minutes` | INTEGER | NULL | Computed on checkout |
| `status` | ENUM | NOT NULL | `OPEN`, `COMPLETED` |
| `check_in_source` | ENUM | NOT NULL | `FACE_RECOGNITION`, `MANUAL`, `CORRECTION` |
| `check_out_source` | ENUM | NULL | Same enum |
| `recognition_confidence` | NUMERIC(5,4) | NULL | Confidence at check-in (trusted source) |
| `recognition_token` | VARCHAR(255) | NULL | Trusted recognition proof (**format TBD**) |
| `is_late_arrival` | BOOLEAN | NOT NULL DEFAULT false | Derived vs shift start |
| `is_early_checkout` | BOOLEAN | NOT NULL DEFAULT false | Derived vs shift end |
| `corrected_by_user_id` | UUID | FK → `user.id` | NULL unless manual correction |
| `correction_reason` | TEXT | NULL | Required for manual correction |
| `work_date` | DATE | NOT NULL | Calendar date of session (for daily rollup) |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `employee_id`, `corrected_by_user_id`  
**Constraint:** `check_out_at IS NULL` when `status = OPEN`; `check_out_at >= check_in_at` when completed; only one `OPEN` session per employee (partial unique index)

---

## 8. `employee_day_attendance`

**Purpose:** Daily attendance classification per employee per calendar date for payroll and absence tracking.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Primary key |
| `employee_id` | UUID | FK → `employee.id` | |
| `work_date` | DATE | NOT NULL | Calendar date |
| `classification` | ENUM | NOT NULL | `FULL_DAY`, `HALF_DAY`, `ABSENT`, `LEAVE`, `WEEKLY_OFF` |
| `total_working_minutes` | INTEGER | NOT NULL DEFAULT 0 | Sum from completed sessions |
| `is_scheduled_working_day` | BOOLEAN | NOT NULL | False for weekly-off |
| `leave_request_id` | UUID | FK → `leave_request.id` | NULL unless classification = LEAVE |
| `payable_day_fraction` | NUMERIC(3,2) | NOT NULL | 1.0, 0.5, or 0 per business rules |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `employee_id`, `leave_request_id`  
**Unique:** `(employee_id, work_date)`

---

## 9. `leave_type`

**Purpose:** Configurable leave categories (entitlement values **TBD** at configuration).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `code` | VARCHAR(50) | NOT NULL | e.g. `CASUAL`, `SICK` |
| `name` | VARCHAR(255) | NOT NULL | |
| `annual_entitlement_days` | INTEGER | NOT NULL | Default entitlement (**values TBD**) |
| `is_paid` | BOOLEAN | NOT NULL | Paid leave preserves daily pay |
| `status` | ENUM | NOT NULL | `ACTIVE`, `INACTIVE` |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**Unique:** `code`

---

## 10. `leave_balance`

**Purpose:** Per-employee leave balance by type (BR-LEAVE-04).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `employee_id` | UUID | FK → `employee.id` | |
| `leave_type_id` | UUID | FK → `leave_type.id` | |
| `balance_days` | NUMERIC(5,2) | NOT NULL | Current balance |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `employee_id`, `leave_type_id`  
**Unique:** `(employee_id, leave_type_id)`  
**Constraint:** `balance_days >= 0` (unless override policy allows negative — **TBD**)

---

## 11. `leave_request`

**Purpose:** Leave request and approval workflow (BR-LEAVE-01–03).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `employee_id` | UUID | FK → `employee.id` | |
| `leave_type_id` | UUID | FK → `leave_type.id` | |
| `start_date` | DATE | NOT NULL | |
| `end_date` | DATE | NOT NULL | |
| `reason` | TEXT | NULL | |
| `status` | ENUM | NOT NULL | `PENDING`, `APPROVED`, `REJECTED` |
| `requested_at` | TIMESTAMPTZ | NOT NULL | |
| `reviewed_by_user_id` | UUID | FK → `user.id` | NULL until reviewed |
| `reviewed_at` | TIMESTAMPTZ | NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `employee_id`, `leave_type_id`, `reviewed_by_user_id`  
**Constraint:** `end_date >= start_date`

---

## 12. `overtime_record`

**Purpose:** Overtime hours stored separately with approval workflow (BR-OT-01–08).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `employee_id` | UUID | FK → `employee.id` | |
| `work_date` | DATE | NOT NULL | |
| `overtime_minutes` | INTEGER | NOT NULL | Stored separately from normal hours |
| `status` | ENUM | NOT NULL | `PENDING`, `APPROVED`, `REJECTED` |
| `attendance_session_id` | UUID | FK → `attendance_session.id` | Optional link to source session |
| `approved_by_user_id` | UUID | FK → `user.id` | NULL until approved |
| `approved_at` | TIMESTAMPTZ | NULL | |
| `notes` | TEXT | NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `employee_id`, `attendance_session_id`, `approved_by_user_id`  
**Constraint:** `overtime_minutes > 0`

---

## 13. `payroll_policy`

**Purpose:** Configurable working-day policy for daily pay calculation (BR-PAY-05–06).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `name` | VARCHAR(255) | NOT NULL | Policy name |
| `working_days_method` | ENUM | NOT NULL | e.g. `FIXED_DIVISOR`, `CALENDAR_WORKING_DAYS` (**enum TBD**) |
| `fixed_divisor` | NUMERIC(5,2) | NULL | Used when method = FIXED_DIVISOR (not hardcoded 30 in code) |
| `is_default` | BOOLEAN | NOT NULL DEFAULT false | Default policy for new payroll runs |
| `status` | ENUM | NOT NULL | `ACTIVE`, `INACTIVE` |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`

---

## 14. `overtime_rate_config`

**Purpose:** Configurable overtime multiplier (BR-OT-06 — value **TBD**, structure defined here).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `name` | VARCHAR(255) | NOT NULL | |
| `multiplier` | NUMERIC(4,2) | NOT NULL | e.g. 1.5 (**default TBD**) |
| `is_default` | BOOLEAN | NOT NULL DEFAULT false | |
| `status` | ENUM | NOT NULL | `ACTIVE`, `INACTIVE` |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**Constraint:** `multiplier > 0`

---

## 15. `payroll_run`

**Purpose:** Monthly payroll run for a defined period (BR-PAY-01, BR-PAY-16).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `period_start` | DATE | NOT NULL | |
| `period_end` | DATE | NOT NULL | |
| `status` | ENUM | NOT NULL | `DRAFT`, `FINALIZED`, `FAILED` |
| `payroll_policy_id` | UUID | FK → `payroll_policy.id` | Policy used for this run |
| `overtime_rate_config_id` | UUID | FK → `overtime_rate_config.id` | Rate config for this run |
| `initiated_by_user_id` | UUID | FK → `user.id` | |
| `finalized_at` | TIMESTAMPTZ | NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `payroll_policy_id`, `overtime_rate_config_id`, `initiated_by_user_id`  
**Unique:** `(period_start, period_end)` where `status != FAILED` (idempotent run protection)

---

## 16. `payroll_record`

**Purpose:** Per-employee payroll outcome for a run (BR-PAY-15).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `payroll_run_id` | UUID | FK → `payroll_run.id` | |
| `employee_id` | UUID | FK → `employee.id` | |
| `monthly_base_salary` | NUMERIC(12,2) | NOT NULL | Snapshot at run time |
| `working_days_in_policy` | NUMERIC(5,2) | NOT NULL | Divisor used |
| `one_day_salary` | NUMERIC(12,2) | NOT NULL | Computed daily rate |
| `attendance_adjusted_pay` | NUMERIC(12,2) | NOT NULL | After FULL/HALF/ABSENT/LEAVE |
| `overtime_pay` | NUMERIC(12,2) | NOT NULL DEFAULT 0 | Approved overtime total |
| `bonus_total` | NUMERIC(12,2) | NOT NULL DEFAULT 0 | Sum of bonuses included in this run |
| `deduction_total` | NUMERIC(12,2) | NOT NULL DEFAULT 0 | Sum of deductions included in this run |
| `gross_pay` | NUMERIC(12,2) | NOT NULL | `attendance_adjusted_pay + overtime_pay + bonus_total` |
| `net_pay` | NUMERIC(12,2) | NOT NULL | `gross_pay − deduction_total` |
| `status` | ENUM | NOT NULL | `DRAFT`, `FINALIZED`, `PAID` |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**Payroll calculation (conceptual — not implemented in Phase 2.1):**

```
Gross Pay = Attendance Adjusted Pay + Approved Overtime Pay + Bonus
Net Pay   = Gross Pay − Deductions
```

Mapped to columns: `gross_pay = attendance_adjusted_pay + overtime_pay + bonus_total`; `net_pay = gross_pay − deduction_total`.

**PK:** `id`  
**FK:** `payroll_run_id`, `employee_id`  
**Unique:** `(payroll_run_id, employee_id)`  
**Constraint:** Immutable after `FINALIZED` (trigger-enforced in Phase 2.2+)

---

## 17. `bonus`

**Purpose:** Auditable bonus entries (BR-BONUS-01). May exist before attachment to a payroll run.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `employee_id` | UUID | FK → `employee.id` | |
| `payroll_run_id` | UUID | FK → `payroll_run.id` | NULL until included in a payroll run |
| `period_start` | DATE | NOT NULL | Pay period reference |
| `period_end` | DATE | NOT NULL | |
| `amount` | NUMERIC(12,2) | NOT NULL | |
| `reason` | TEXT | NOT NULL | |
| `created_by_user_id` | UUID | FK → `user.id` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `employee_id`, `payroll_run_id`, `created_by_user_id`  
**Constraint:** `amount > 0`

**Lifecycle:**

```
Bonus created for employee and period (payroll_run_id = NULL)
      ↓
Included in payroll run
      ↓
payroll_run_id assigned
```

---

## 18. `deduction`

**Purpose:** Auditable deduction entries (BR-DED-01). May exist before attachment to a payroll run.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `employee_id` | UUID | FK → `employee.id` | |
| `payroll_run_id` | UUID | FK → `payroll_run.id` | NULL until included in a payroll run |
| `period_start` | DATE | NOT NULL | |
| `period_end` | DATE | NOT NULL | |
| `deduction_type` | VARCHAR(100) | NOT NULL | Type label |
| `amount` | NUMERIC(12,2) | NOT NULL | |
| `reason` | TEXT | NOT NULL | |
| `created_by_user_id` | UUID | FK → `user.id` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `employee_id`, `payroll_run_id`, `created_by_user_id`  
**Constraint:** `amount > 0`

**Lifecycle:**

```
Deduction created for employee and period (payroll_run_id = NULL)
      ↓
Included in payroll run
      ↓
payroll_run_id assigned
```

---

## 19. `payment`

**Purpose:** Record payment against finalized payroll (BR-PMT-01–02).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `payroll_record_id` | UUID | FK → `payroll_record.id` | |
| `paid_at` | TIMESTAMPTZ | NOT NULL | Payment date |
| `reference` | VARCHAR(255) | NULL | External reference |
| `notes` | TEXT | NULL | |
| `recorded_by_user_id` | UUID | FK → `user.id` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**PK:** `id`  
**FK:** `payroll_record_id`, `recorded_by_user_id`  
**Constraint:** `payroll_record.status` must be `FINALIZED` at payment time (app + trigger)

---

## 20. `audit_log`

**Purpose:** Append-only audit trail (BR-AUDIT-01–05).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | |
| `actor_user_id` | UUID | FK → `user.id` | NULL for system actions |
| `action` | VARCHAR(50) | NOT NULL | e.g. `CREATE`, `UPDATE`, `FINALIZE` |
| `entity_type` | VARCHAR(100) | NOT NULL | e.g. `attendance_session`, `payroll_run` |
| `entity_id` | UUID | NOT NULL | Target record ID |
| `metadata` | JSONB | NULL | Optional context (reason, deltas — **format TBD**) |
| `created_at` | TIMESTAMPTZ | NOT NULL | Immutable timestamp |

**PK:** `id`  
**FK:** `actor_user_id`  
**No updates or deletes** from application layer

---

## 21. Index Plan (Preliminary)

| Table | Index | Purpose |
|-------|-------|---------|
| `employee` | `(department_id)`, `(shift_id)`, `(status)` | Filtering |
| `attendance_session` | `(employee_id, status)` | Open session lookup |
| `attendance_session` | `(employee_id, work_date)` | Daily queries |
| `employee_day_attendance` | `(employee_id, work_date)` | Payroll input |
| `leave_request` | `(employee_id, status)` | Approval queue |
| `overtime_record` | `(employee_id, work_date, status)` | Payroll inclusion |
| `payroll_record` | `(payroll_run_id)`, `(employee_id)` | Register reports |
| `audit_log` | `(entity_type, created_at)`, `(actor_user_id)` | Admin queries |

Exact index definitions deferred to Phase 2.2 migration design.

---

## 22. Related Documents

- [er-diagram.md](./er-diagram.md)
- [database-constraints.md](./database-constraints.md)
- [normalization.md](./normalization.md)
