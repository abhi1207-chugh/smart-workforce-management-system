# Transaction Boundaries — Phase 2.2 Step 3

This document describes which multi-step operations are atomic in PostgreSQL vs. the backend API layer.

**Architecture:**

```
Next.js  →  Backend API  →  PostgreSQL transaction
```

The backend owns HTTP/auth/validation; PostgreSQL functions own atomic business persistence.

---

## Operations Atomic in PostgreSQL

These are implemented as `plpgsql` functions that run in a single database transaction when called:

### 1. `complete_attendance_checkout(session_id, check_out_at)`

| Step | Action |
|------|--------|
| 1 | Lock `OPEN` session (`FOR UPDATE`) |
| 2 | Validate state and timestamps |
| 3 | Update session to `COMPLETED` with duration and flags |
| 4 | Upsert `employee_day_attendance` with classification |

**Failure:** Entire call rolls back — no partial checkout.

**Backend responsibility:** Obtain `employee_id` from face recognition, locate `OPEN` session, then call this function.

### 2. `approve_leave_request(request_id, reviewer_user_id)`

| Step | Action |
|------|--------|
| 1 | Lock leave request |
| 2 | Validate `PENDING` and balance |
| 3 | Update request to `APPROVED` |
| 4 | Deduct `leave_balance` |
| 5 | Upsert `employee_day_attendance` for each date in range |

**Failure:** No partial approval or balance deduction.

### 3. `compute_employee_payroll_record(payroll_run_id, employee_id)`

| Step | Action |
|------|--------|
| 1 | Load run, employee, policy, OT config |
| 2 | Compute pay components |
| 3 | Upsert `payroll_record` |
| 4 | Link unlinked `bonus` / `deduction` rows |

**Failure:** No orphan bonus/deduction links.

### 4. `finalize_payroll_run(payroll_run_id)`

| Step | Action |
|------|--------|
| 1 | Lock payroll run |
| 2 | Generate records for all `ACTIVE` employees |
| 3 | Set all records to `FINALIZED` |
| 4 | Set run to `FINALIZED` |
| 5 | Insert `audit_log` entry |

**Failure:** Run stays `DRAFT`; no partial finalization.

---

## Operations in Backend (with DB transaction wrapper)

The backend should wrap these in `BEGIN … COMMIT` but logic spans API + optional external systems:

| Operation | Why backend |
|-----------|-------------|
| Check-in (face recognition) | Vector DB lookup → then insert `attendance_session` |
| Overtime submission/approval | May involve UI workflow before `overtime_record` insert |
| Bonus/deduction entry | Admin form → insert row |
| Payment recording | After bank transfer confirmation → insert `payment` (trigger validates `FINALIZED`) |

**Pattern:**

```sql
BEGIN;
  -- optional: SELECT ... FOR UPDATE
  SELECT complete_attendance_checkout($1, $2);
COMMIT;
```

Use `SERIALIZABLE` or `REPEATABLE READ` only if concurrent race conditions require it; default `READ COMMITTED` is sufficient for MVP.

---

## What PostgreSQL Functions Do NOT Replace

1. **Authentication / authorization** — backend validates JWT and role before calling functions.
2. **Face recognition** — external Vector DB; only `employee_id` enters PostgreSQL.
3. **Idempotency keys / retry logic** — backend concern.
4. **Notification emails** — post-commit side effects in backend.

---

## Verification

Test `S3-19` in `database/scripts/verify_step3_dbms.sql` confirms that a failed `complete_attendance_checkout` leaves session and day attendance unchanged within the sub-transaction error handler.
