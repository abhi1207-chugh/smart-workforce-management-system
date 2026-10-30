# Normalization Analysis (3NF)

**Phase:** 2.1 — Design only  
**Scope:** PostgreSQL relational schema ([relational-schema.md](./relational-schema.md))

---

## 1. Normal Forms Reviewed

| Form | Requirement |
|------|-------------|
| **1NF** | Atomic values; no repeating groups in columns |
| **2NF** | No partial dependency on composite keys |
| **3NF** | No transitive dependency of non-key attributes on other non-key attributes |

Target: **Third Normal Form (3NF)** for all core entities.

---

## 2. Entity-by-Entity Analysis

### `department`

| Check | Result |
|-------|--------|
| 1NF | `code`, `name`, `status` are atomic |
| 2NF | Single-column PK (`id`) |
| 3NF | No transitive dependencies |

**Verdict:** 3NF ✓

---

### `shift` + `shift_weekly_off`

**Design choice:** Weekly-off days normalized into `shift_weekly_off` rather than a JSON array column.

| Check | Result |
|-------|--------|
| 1NF | Repeating weekly-off days removed from `shift` row |
| 2NF | `shift_weekly_off` depends on full PK |
| 3NF | `day_of_week` depends only on `shift_weekly_off.id`, not transitively on shift attributes |

**Verdict:** 3NF ✓

**Trade-off:** Extra join vs. array column — chosen for query clarity and constraint enforcement on `(shift_id, day_of_week)`.

---

### `employee`

| Check | Result |
|-------|--------|
| 1NF | All attributes atomic |
| 2NF | Single PK |
| 3NF | `department_id` and `shift_id` are FK references — department name and shift times are not duplicated on employee |

**Verdict:** 3NF ✓

**Note:** `monthly_base_salary` on employee is the current salary; `payroll_record` snapshots salary at run time to preserve payroll immutability.

---

### `user` vs `employee`

**Design choice:** Separate tables — admin users without employee records.

| Check | Result |
|-------|--------|
| 3NF | Login credentials not mixed with workforce attributes |
| Rationale | Avoids nullable workforce fields on admin-only accounts |
| Cardinality | `UNIQUE (employee_id)` on `user` enforces at most one user per employee; `employee_id` remains nullable for `ADMIN` accounts |

**Verdict:** 3NF ✓ — also supports BR-EMP-03 and user-role separation.

---

### `face_registration_metadata`

| Check | Result |
|-------|--------|
| 1NF | No embedding vector in PostgreSQL (stored in vector DB) |
| 3NF | Registration metadata depends only on `face_registration_metadata.id`; `employee_id` is FK only |
| History | Multiple rows per employee allowed; `UNIQUE (employee_id) WHERE status = 'ACTIVE'` limits one active registration (MVP) |

**Verdict:** 3NF ✓

---

### `attendance_session` + `employee_day_attendance`

**Design choice:** Session-level and day-level tables.

| Entity | 3NF rationale |
|--------|----------------|
| `attendance_session` | Session timestamps depend on session PK only |
| `employee_day_attendance` | Daily classification depends on `(employee_id, work_date)` unique key; not duplicated across sessions |

**Potential redundancy:** `total_working_minutes` on daily row is derivable from sessions.

**Decision:** Accept controlled redundancy (or maintain via trigger/view) for payroll query performance and explicit daily classification audit. Documented as **derived-but-stored** for payroll immutability — not a 3NF violation because it depends on the daily row's identity, not transitively on unrelated entities.

**Verdict:** 3NF ✓

---

### `leave_type`, `leave_balance`, `leave_request`

| Check | Result |
|-------|--------|
| 1NF | Leave types separated from balances and requests |
| 3NF | `annual_entitlement_days` on `leave_type` — not duplicated per request |
| 3NF | Balance is per `(employee, leave_type)` — no transitive dependency |

**Verdict:** 3NF ✓

---

### `overtime_record`

| Check | Result |
|-------|--------|
| 3NF | Overtime minutes depend on overtime record PK; shift duration referenced via employee → shift at calculation time, not stored redundantly on overtime row |

**Verdict:** 3NF ✓

---

### `payroll_policy`, `overtime_rate_config`

| Check | Result |
|-------|--------|
| 3NF | Configuration values isolated — not embedded in every payroll row except via FK on `payroll_run` |

**Verdict:** 3NF ✓

---

### `payroll_run` + `payroll_record`

| Check | Result |
|-------|--------|
| 3NF | Run-level attributes on `payroll_run`; employee-specific amounts on `payroll_record` |
| Snapshot columns | `monthly_base_salary`, `one_day_salary` on `payroll_record` are intentional snapshots for immutability — depend on payroll record identity at finalize time |

**Verdict:** 3NF ✓

---

### `bonus`, `deduction`, `payment`

| Check | Result |
|-------|--------|
| 3NF | Each financial adjustment is its own entity with FK to employee and optional payroll run |
| Lifecycle | `payroll_run_id` nullable until record is included in a payroll run |

**Verdict:** 3NF ✓

**Alternative considered:** Single `payroll_adjustment` table with type discriminator — rejected for MVP to keep bonus/deduction audit trails explicit per business rules.

---

### `audit_log`

| Check | Result |
|-------|--------|
| 3NF | Append-only log; `metadata` JSONB for variable context — acceptable for audit (non-query-primary attributes) |

**Verdict:** 3NF ✓ (JSONB for optional metadata does not break normalization of core entities)

---

## 3. Denormalization Decisions (Documented)

| Location | Denormalization | Reason |
|----------|-----------------|--------|
| `payroll_record` salary snapshots | Copy of employee salary at run | Immutability after finalize |
| `employee_day_attendance.total_working_minutes` | Sum of sessions | Payroll performance and audit |
| `payroll_record` computed totals | `gross_pay`, `net_pay`, bonus/deduction/overtime aggregates | Immutable payroll register; `gross_pay = attendance_adjusted_pay + overtime_pay + bonus_total`; `net_pay = gross_pay − deduction_total` |

These are **controlled** denormalizations with clear derivation rules — not accidental redundancy.

---

## 4. Cross-Store Normalization (PostgreSQL vs Vector DB)

| Store | Normalization principle |
|-------|-------------------------|
| PostgreSQL | 3NF for business entities |
| Vector DB | Single-purpose records — embedding + employee reference + metadata only; no business data duplication |

Duplicating `employee.name` or `department` into vector DB would violate logical data ownership and create update anomalies — **explicitly excluded**.

---

## 5. Conclusion

The preliminary relational schema satisfies **3NF** for core workforce and payroll entities. Intentional snapshot and rollup fields are documented with derivation rules and support payroll immutability (BR-PAY-18, BR-PAY-19).

Phase 2.2 may add views (e.g. `v_payroll_register`, `v_employee_attendance_summary`) to expose derived data without further normalization changes.
