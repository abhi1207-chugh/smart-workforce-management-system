# Database Constraints

**Phase:** 2.1 — Design only  
**Applies to:** PostgreSQL schema ([relational-schema.md](./relational-schema.md))

Constraints map to Phase 1 business rules. Implementation via DDL, triggers, and application logic is deferred to Phase 2.2.

---

## 1. Primary Keys

All entities use `UUID` primary keys (`id`).

| Table | PK Column |
|-------|-----------|
| `department` | `id` |
| `shift` | `id` |
| `shift_weekly_off` | `id` |
| `employee` | `id` |
| `user` | `id` |
| `face_registration_metadata` | `id` |
| `attendance_session` | `id` |
| `employee_day_attendance` | `id` |
| `leave_type` | `id` |
| `leave_balance` | `id` |
| `leave_request` | `id` |
| `overtime_record` | `id` |
| `payroll_policy` | `id` |
| `overtime_rate_config` | `id` |
| `payroll_run` | `id` |
| `payroll_record` | `id` |
| `bonus` | `id` |
| `deduction` | `id` |
| `payment` | `id` |
| `audit_log` | `id` |

---

## 2. Foreign Keys

| Child Table | Column | Parent | ON DELETE | Business Rule |
|-------------|--------|--------|-----------|---------------|
| `shift_weekly_off` | `shift_id` | `shift.id` | RESTRICT | Preserve shift integrity |
| `employee` | `department_id` | `department.id` | RESTRICT | BR-EMP-01 |
| `employee` | `shift_id` | `shift.id` | RESTRICT | BR-EMP-02 |
| `user` | `employee_id` | `employee.id` | SET NULL | Preserve user on employee archival |
| `face_registration_metadata` | `employee_id` | `employee.id` | RESTRICT | BR-EMP-05 |
| `face_registration_metadata` | `registered_by_user_id` | `user.id` | RESTRICT | Audit attribution |
| `attendance_session` | `employee_id` | `employee.id` | RESTRICT | Attendance history |
| `attendance_session` | `corrected_by_user_id` | `user.id` | SET NULL | Optional corrector |
| `employee_day_attendance` | `employee_id` | `employee.id` | RESTRICT | |
| `employee_day_attendance` | `leave_request_id` | `leave_request.id` | SET NULL | |
| `leave_balance` | `employee_id` | `employee.id` | RESTRICT | |
| `leave_balance` | `leave_type_id` | `leave_type.id` | RESTRICT | |
| `leave_request` | `employee_id` | `employee.id` | RESTRICT | |
| `leave_request` | `leave_type_id` | `leave_type.id` | RESTRICT | |
| `leave_request` | `reviewed_by_user_id` | `user.id` | SET NULL | |
| `overtime_record` | `employee_id` | `employee.id` | RESTRICT | |
| `overtime_record` | `attendance_session_id` | `attendance_session.id` | SET NULL | |
| `overtime_record` | `approved_by_user_id` | `user.id` | SET NULL | |
| `payroll_run` | `payroll_policy_id` | `payroll_policy.id` | RESTRICT | |
| `payroll_run` | `overtime_rate_config_id` | `overtime_rate_config.id` | RESTRICT | |
| `payroll_run` | `initiated_by_user_id` | `user.id` | RESTRICT | |
| `payroll_record` | `payroll_run_id` | `payroll_run.id` | RESTRICT | |
| `payroll_record` | `employee_id` | `employee.id` | RESTRICT | |
| `bonus` | `employee_id` | `employee.id` | RESTRICT | |
| `bonus` | `payroll_run_id` | `payroll_run.id` | SET NULL | NULL until bonus is included in a payroll run |
| `bonus` | `created_by_user_id` | `user.id` | RESTRICT | |
| `deduction` | `employee_id` | `employee.id` | RESTRICT | |
| `deduction` | `payroll_run_id` | `payroll_run.id` | SET NULL | NULL until deduction is included in a payroll run |
| `deduction` | `created_by_user_id` | `user.id` | RESTRICT | |
| `payment` | `payroll_record_id` | `payroll_record.id` | RESTRICT | |
| `payment` | `recorded_by_user_id` | `user.id` | RESTRICT | |
| `audit_log` | `actor_user_id` | `user.id` | SET NULL | |

**Cross-store FK:** `face_registration_metadata.vector_record_id` references vector DB record — **not enforceable as PostgreSQL FK**; validated by application layer.

---

## 3. Unique Constraints

| Table | Constraint | Business Rule |
|-------|------------|---------------|
| `department` | `UNIQUE (code)` | Org uniqueness |
| `employee` | `UNIQUE (employee_code)` | BR-EMP-04 |
| `employee` | `UNIQUE (email)` | Login/contact uniqueness |
| `user` | `UNIQUE (email)` | AUTH |
| `user` | `UNIQUE (employee_id)` | At most one user per employee; `employee_id` nullable for `ADMIN` users |
| `shift_weekly_off` | `UNIQUE (shift_id, day_of_week)` | No duplicate off-days |
| `employee_day_attendance` | `UNIQUE (employee_id, work_date)` | One classification per day |
| `leave_type` | `UNIQUE (code)` | |
| `leave_balance` | `UNIQUE (employee_id, leave_type_id)` | |
| `payroll_record` | `UNIQUE (payroll_run_id, employee_id)` | One record per employee per run |
| `payroll_run` | `UNIQUE (period_start, period_end)` WHERE `status != 'FAILED'` | BR-PAY-16 idempotent runs |

---

## 4. Partial Unique Indexes (Business Logic)

| Index | Rule |
|-------|------|
| `UNIQUE (employee_id) WHERE status = 'OPEN'` on `attendance_session` | BR-ATT-06 — one open session per employee |
| `UNIQUE (employee_id) WHERE status = 'ACTIVE'` on `face_registration_metadata` | One active face registration per employee (MVP); multiple historical `SUPERSEDED`/`REVOKED` rows allowed |

---

## 5. Check Constraints

| Table | Constraint | Business Rule |
|-------|------------|---------------|
| `employee` | `monthly_base_salary >= 0` | |
| `employee` | `status IN ('ACTIVE', 'INACTIVE')` | BR-EMP-03 |
| `shift` | `scheduled_duration_minutes > 0` | BR-SHIFT-01 |
| `attendance_session` | `check_out_at IS NULL OR check_out_at >= check_in_at` | BR-ATT-09 |
| `attendance_session` | `status = 'OPEN' IMPLIES check_out_at IS NULL` | Session state machine |
| `attendance_session` | `status = 'COMPLETED' IMPLIES check_out_at IS NOT NULL` | |
| `employee_day_attendance` | `payable_day_fraction IN (0, 0.5, 1.0)` | BR-ATT-13–22 |
| `leave_request` | `end_date >= start_date` | |
| `overtime_record` | `overtime_minutes > 0` | |
| `bonus` | `amount > 0` | |
| `deduction` | `amount > 0` | |
| `payroll_record` | `gross_pay = attendance_adjusted_pay + overtime_pay + bonus_total` | Payroll formula (enforced at calculation / optional check in Phase 2.2) |
| `payroll_record` | `net_pay = gross_pay − deduction_total` | Payroll formula (enforced at calculation / optional check in Phase 2.2) |
| `payroll_record` | `net_pay >= 0` OR cap policy (**TBD** — BR-DED-02) | |
| `user` | `role = 'EMPLOYEE' IMPLIES employee_id IS NOT NULL` | User-role linkage |

---

## 6. Enum Domains (Conceptual)

| Domain | Values |
|--------|--------|
| `entity_status` | `ACTIVE`, `INACTIVE` |
| `user_role` | `ADMIN`, `EMPLOYEE` |
| `attendance_session_status` | `OPEN`, `COMPLETED` |
| `attendance_source` | `FACE_RECOGNITION`, `MANUAL`, `CORRECTION` |
| `day_classification` | `FULL_DAY`, `HALF_DAY`, `ABSENT`, `LEAVE`, `WEEKLY_OFF` |
| `leave_request_status` | `PENDING`, `APPROVED`, `REJECTED` |
| `overtime_status` | `PENDING`, `APPROVED`, `REJECTED` |
| `payroll_run_status` | `DRAFT`, `FINALIZED`, `FAILED` |
| `payroll_record_status` | `DRAFT`, `FINALIZED`, `PAID` |
| `face_registration_status` | `ACTIVE`, `SUPERSEDED`, `REVOKED` |

Exact PostgreSQL enum vs. lookup table — **TBD** at implementation.

---

## 7. Triggers (Planned — Phase 2.2+)

| Trigger | Purpose | Business Rule |
|---------|---------|---------------|
| `prevent_payroll_record_update_after_finalize` | Block silent edits | BR-PAY-18 |
| `prevent_payroll_run_duplicate_finalize` | Idempotent runs | BR-PAY-16 |
| `audit_attendance_correction` | Auto audit on manual correction | BR-AUDIT-01, BR-ATT-31 |
| `audit_payroll_finalize` | Log finalization | BR-AUDIT-02 |
| `audit_face_reregistration` | Log face changes | BR-AUDIT-03 |
| `update_employee_day_attendance` | Roll up session minutes and classification | BR-ATT-13–16 |
| `validate_active_employee_checkin` | Reject inactive employee attendance | BR-EMP-03 |
| `validate_payment_on_finalized` | Payment only on finalized record | BR-PMT-01 |

---

## 8. Stored Functions (Planned — Phase 2.2+)

| Function | Purpose |
|----------|---------|
| `compute_working_duration(session_id)` | BR-ATT-09 |
| `classify_attendance_day(employee_id, date)` | HALF-DAY / FULL-DAY |
| `compute_one_day_salary(employee_id, policy_id)` | BR-PAY-05 |
| `compute_payroll_for_run(run_id)` | BR-PAY-17 transactional calculation |
| `check_leave_balance(employee_id, type_id, days)` | BR-LEAVE-05 |
| `derive_overtime_minutes(employee_id, date)` | BR-OT-02 |

---

## 9. Views (Planned — Phase 2.2+)

| View | Purpose |
|------|---------|
| `v_employee_attendance_summary` | Admin/employee reporting |
| `v_payroll_register` | Payroll register per period |
| `v_leave_balance_report` | Leave balances |
| `v_open_attendance_sessions` | Duplicate check-in prevention queries |

---

## 10. Application-Layer Constraints (Backend)

These cannot be fully enforced by FK alone:

| Rule | Enforcement |
|------|-------------|
| BR-ATT-04, BR-ATT-12 | Server timestamp on check-in/out |
| BR-FACE-06 | Validate recognition from trusted source |
| BR-EMP-03 | Reject attendance for inactive employees |
| BR-OT-05 | Only APPROVED overtime in payroll |
| BR-PAY-17 | Payroll run in single transaction |
| Vector DB employee_id exists | Cross-store validation before attendance |

---

## 11. Related Documents

- [relational-schema.md](./relational-schema.md)
- [normalization.md](./normalization.md)
- [../requirements/business-rules.md](../requirements/business-rules.md)
