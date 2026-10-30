# Project Roadmap — Smart Workforce Attendance & Payroll Management System

This roadmap reflects the **actual** project status. Items marked **COMPLETE** have implementation or design artifacts in the repository. Items marked **PLANNED** or **NEXT** are not yet implemented.

---

## PHASE 1 — Requirements & Architecture

**STATUS: COMPLETE**

| Deliverable | Location |
|-------------|----------|
| Problem statement | `docs/requirements/problem-statement.md` |
| Objectives | `docs/requirements/objectives.md` |
| Scope | `docs/requirements/scope.md` |
| Functional requirements | `docs/requirements/functional-requirements.md` |
| Non-functional requirements | `docs/requirements/non-functional-requirements.md` |
| User roles | `docs/requirements/user-roles.md` |
| Business rules | `docs/requirements/business-rules.md` |
| System architecture | `docs/requirements/system-architecture.md` |
| API / integration contract | `docs/integration/api-contract.md` |

---

## PHASE 2.1 — Database + Face Data Design

**STATUS: COMPLETE** (design only)

| Deliverable | Location |
|-------------|----------|
| ER diagram | `docs/database/er-diagram.md` |
| Relational schema | `docs/database/relational-schema.md` |
| Normalization | `docs/database/normalization.md` |
| Database constraints | `docs/database/database-constraints.md` |
| Face data architecture | `docs/face/face-data-architecture.md` |
| Face registration flow | `docs/face/face-registration-flow.md` |
| Face recognition flow | `docs/face/face-recognition-flow.md` |
| Vector DB design | `docs/face/vector-db-design.md` |
| Integration decisions | `docs/phase2/decisions.md` |

---

## PHASE 2.2 — PostgreSQL Database Implementation

### Step 1 — PostgreSQL / Docker

**STATUS: COMPLETE**

- `docker-compose.yml` — PostgreSQL 16 Alpine
- `database/migrations/20240903000000_foundation.sql`
- `database/scripts/migrate.sh`
- `.env.example`, `database/README.md`

### Step 2 — Schema + Constraints

**STATUS: COMPLETE**

- `database/migrations/20240903100000_application_schema.sql` — 20 tables, 11 enums
- Foreign keys, unique constraints, check constraints, partial unique indexes
- `database/scripts/verify_step2_constraints.sql` — tests A–H

### Step 3 — Functions / Triggers / Views / Transactions / Indexes / DML / Tests

**STATUS: COMPLETE**

- `database/migrations/20240903110000_advanced_dbms_features.sql`
- PostgreSQL functions, triggers, views, transaction helpers, supporting indexes
- `database/scripts/verify_step3_dbms.sql` — tests S3-01..S3-20
- Documentation: `docs/database/functions.md`, `triggers.md`, `views.md`, `transactions.md`, `indexes.md`

**DB-layer deferrals from this step were closed in Stage 3 (see below).**

---

## PHASE 2.3 — Backend Application

### Step 1 — Backend Foundation + PostgreSQL Integration

**STATUS: COMPLETE**

- `backend/` — Node.js + Express + TypeScript
- PostgreSQL connection via `DATABASE_URL`, parameterized query layer, connection pooling
- `GET /api/v1/health` — real PostgreSQL connectivity check
- `GET /api/v1/employees` — list employees from PostgreSQL
- Validation (Zod), structured error handling, Vitest + Supertest tests
- `docs/integration/backend-architecture.md`

**Resolved in Step 2:** `GET /employees` now requires an ADMIN token.

### Step 2 — Authentication + Authorization

**STATUS: COMPLETE**

- `POST /auth/login` (bcrypt + Bearer JWT), `GET /auth/me`
- `authenticate` + `requireRole` middleware; `GET /employees` is ADMIN-only
- Dev seed data: `cd backend && npm run seed`
- Tests: `backend/tests/auth-utils.test.ts`, `auth-login.test.ts`, `auth-guard.test.ts`
- Known limitation: stateless JWT — no logout/revocation until token expiry

### Step 3 — Employee Management API (Execution Plan Stage 2a)

**STATUS: COMPLETE**

- `POST /employees` (one transaction: employee + login user + leave balances for active leave types)
- `GET /employees/{id}`, `PATCH /employees/{id}` (syncs login email), `POST /employees/{id}/deactivate` (also disables linked user)
- `GET /departments`, `GET /shifts` (read-only lists, ADMIN)
- Tests: `backend/tests/employees-crud.test.ts`
- Department/shift create/update endpoints from api-contract §5–6 are not implemented (not in Stage 2a scope)

### Step 4 — Face Registration + Embedding Pipeline

**STATUS: PLANNED**

- Admin face registration flow
- Embedding generation coordination
- PostgreSQL `face_registration_metadata` writes

### Step 5 — Vector DB Integration + Face Recognition

**STATUS: PLANNED**

- Vector DB client and health check
- `POST /face/recognize` — returns candidate `employee_id`
- Similarity threshold validation

### Step 6 — Attendance APIs + Business Rules (Execution Plan Stage 2b)

**STATUS: COMPLETE** (manual `employee_id` input; face recognition arrives in Stage 5)

- `POST /attendance/check-in`, `POST /attendance/check-out` (calls `complete_attendance_checkout()`), `GET /attendance/today`
- `PATCH /attendance/{id}` — ADMIN correction with required reason; recomputes duration, shift flags and the day row; audit entry written by the existing trigger
- ADMIN may punch for any employee; EMPLOYEE only for themself. Server clock is authoritative; client timestamps and `FACE_RECOGNITION` source are rejected for now
- Inactive employee and duplicate open session return 409
- Tests: `backend/tests/attendance.test.ts`
- `GET /attendance` list (ADMIN: employee/department/date filters; EMPLOYEE: own only)

### Step 7 — Leave + Overtime APIs (Execution Plan Stage 2c)

**STATUS: COMPLETE**

- Leave: `GET /leave/types`, `POST|GET /leave/requests`, `GET /leave/requests/{id}`, `POST .../approve` (calls `approve_leave_request()` after a balance check), `POST .../reject`, `GET /leave/balances`. Submit is EMPLOYEE-only; overlapping pending/approved dates return 409; EMPLOYEE sees only own records
- Overtime: `POST|GET /overtime`, `POST /overtime/{id}/approve|reject`. Minutes derive from attendance via `derive_overtime_minutes()`; only ADMIN may set them explicitly; one active record per employee/date
- Tests: `backend/tests/leave-overtime.test.ts`

### Step 8 — Payroll Engine + Payroll APIs (Execution Plan Stage 2d)

**STATUS: COMPLETE**

- `POST|GET /payroll/runs`, `GET /payroll/runs/{id}`, `POST .../compute` (preview, DRAFT only), `POST .../finalize` (`finalize_payroll_run()`)
- `GET /payroll/records`, `GET /payroll/records/{id}`, `GET .../{id}/payslip` — EMPLOYEE sees only own FINALIZED/PAID records
- `POST|GET /bonuses`, `POST|GET /deductions` (audited; rejected for periods already covered by a finalized run)
- `POST|GET /payments` — requires a FINALIZED record, moves it to PAID, audited
- Only `FIXED_DIVISOR` policies are accepted (`CALENDAR_WORKING_DAYS` is Stage 3); overlapping runs return 409
- Tests: `backend/tests/payroll.test.ts` (verifies exact pay amounts)

### Step 9 — Audit + Reporting APIs (Execution Plan Stage 2e)

**STATUS: COMPLETE**

- `GET /audit-logs` (from, to, entity_type, entity_id, actor_id, paging)
- `GET /reports/attendance-summary`, `/reports/leave-balances`, `/reports/payroll-register?period_id=<run id>`, `/reports/me/summary`
- Tests: `backend/tests/reports-audit.test.ts`

### Step 10 — Close known SQL gaps (Execution Plan Stage 3)

**STATUS: COMPLETE**

- Migration `20241001000000_close_sql_gaps.sql` (up/rollback/up verified)
- Lateness grace: `shift.grace_period_minutes` (0–240, default 0); `derive_shift_timing_flags()` flags late only after `start_time + grace`; exposed on `GET /shifts`
- Leave balance override: `adjust_leave_balance()` + `POST /leave/balances/adjust` (ADMIN, mandatory reason, audited)
- Deduction cap: `compute_employee_payroll_record()` caps deductions at gross pay (excess is not carried over); `payroll_record_net_pay_non_negative` CHECK
- `CALENDAR_WORKING_DAYS`: `resolve_payroll_divisor()` counts non-weekly-off days in the run period; payroll runs now accept these policies. No holiday calendar yet, intended for monthly runs; `working_days_in_policy` stores the effective divisor
- Tests: `backend/tests/stage3-sql-gaps.test.ts`, `database/scripts/verify_stage3_gaps.sql` (S4-01..06)

---

## PHASE 3 — Next.js Frontend

**STATUS: COMPLETE** except the face registration UI, which belongs to Execution Plan Stage 5

| Stage | Description |
|-------|-------------|
| Frontend foundation — **COMPLETE** | `frontend/` Next.js 15 (App Router, TypeScript); `/api/v1/*` proxied to the backend via `rewrites` (no CORS); typed API client (`src/lib/api.ts`) that unwraps the response envelope; role-aware sidebar shell |
| Admin + employee dashboards — **COMPLETE** | Admin: stat tiles from new `GET /reports/dashboard` (active/present/late/on-leave counts, pending leave and overtime, latest payroll run). Employee: today's status with check-in/out, month summary, leave balances, latest payslip. Tests: `backend/tests/dashboard.test.ts`, `frontend/tests/format.test.ts` |
| Employee management — **COMPLETE** | ADMIN-only `/employees` (search + status filter), `/employees/new`, `/employees/[id]` (edit, deactivate with confirm). Client validation mirrors server rules; server field errors are shown inline. No reactivate (no API). Tests: `frontend/tests/employees.test.ts` |
| Attendance UI — **COMPLETE** | `/attendance` for both roles: date-range history with Late / Early out / Corrected flags. ADMIN also gets employee + department filters, a manual punch (check-in/out for any active employee, the kiosk fallback until face recognition) and an inline correction form (reason required, only changed times sent). `GET /attendance` now includes employee names. Face-based kiosk arrives with Stage 5. Tests: `frontend/tests/attendance.test.ts` |
| Leave / overtime UI — **COMPLETE** | `/leave`: employees request leave and see balances; ADMIN approves/rejects and can override a balance (reason required). `/overtime`: employees request (minutes derived from attendance); ADMIN adds records (optional minutes override) and approves/rejects. Lists now include employee names |
| Payroll UI — **COMPLETE** | ADMIN `/payroll` (create run, list) and `/payroll/[id]` (compute preview, finalize with confirm, register with totals, bonuses/deductions for DRAFT runs, mark paid). EMPLOYEE `/payslips`; `/payslips/[id]` payslip with print |
| Reports — **COMPLETE** | `/reports`: ADMIN tabs for attendance summary (range + department), leave balances, audit log (range + entity); EMPLOYEE personal summary for a date range |
| Authentication UI — **COMPLETE** | `/login`, `AuthProvider` (token in localStorage, restored via `GET /auth/me`, auto sign-out on 401), guarded `(app)` layout, sign out. Tests: `frontend/tests/api.test.ts` |
| Face registration UI | Camera capture for admin registration |

---

## PHASE 4 — Full System Integration

**STATUS: PLANNED**

End-to-end flow:

```
Camera
  → Face Detection
  → Face Embedding
  → Vector DB Similarity Search
  → Employee ID (candidate)
  → Backend API (validation)
  → Business Rules
  → PostgreSQL (authoritative write)
  → Dashboard (read via API)
```

---

## PHASE 5 — Testing & Security

**STATUS: PLANNED**

- Unit testing (backend services)
- Integration testing (API + PostgreSQL)
- API contract testing
- Database regression tests
- Authentication / authorization testing
- Face recognition accuracy and threshold testing
- Vector DB integration testing
- Security testing (injection, auth bypass, secret exposure)
- Validation and error-path testing
- Transaction and concurrency testing

---

## PHASE 6 — Deployment & Documentation

**STATUS: PLANNED**

- Production configuration (TLS, secrets management)
- Deployment (backend, frontend, PostgreSQL, Vector DB)
- Database backup and recovery considerations
- Environment configuration for staging/production
- Published API documentation
- Final ER diagram and DBMS documentation package
- Demo preparation and presentation materials

---

## Summary Status Table

| Phase | Status |
|-------|--------|
| Phase 1 — Requirements & Architecture | **COMPLETE** |
| Phase 2.1 — Database + Face Design | **COMPLETE** |
| Phase 2.2 Step 1 — Docker/PostgreSQL | **COMPLETE** |
| Phase 2.2 Step 2 — Schema + Constraints | **COMPLETE** |
| Phase 2.2 Step 3 — Advanced DBMS | **COMPLETE** |
| Phase 2.3 Step 1 — Backend Foundation | **COMPLETE** |
| Phase 2.3 Step 2 — Auth | **COMPLETE** |
| Phase 2.3 Steps 3–9 — Employee, attendance, leave/overtime, payroll, reports/audit APIs | **COMPLETE** |
| Phase 2.3 Step 10 — Close SQL gaps (Execution Plan Stage 3) | **COMPLETE** |
| Phase 3 — Frontend | **COMPLETE** (face registration UI deferred to Stage 5) |
| Phase 4 — Full Integration (face recognition, Execution Plan Stage 5) | **NEXT** |
| Phase 5 — Testing & Security | **PLANNED** |
| Phase 6 — Deployment & Docs | **PLANNED** |
