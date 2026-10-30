# Execution Plan

Status legend: DONE / NEXT / PLANNED. Detailed phase status lives in `PROJECT-ROADMAP.md`.

## Stage 1 — Secure the backend — DONE
Auth (`POST /auth/login`, `GET /auth/me`), JWT + role guard, `GET /employees` ADMIN-only, seed script, 29 passing tests.

## Stage 2 — Core domain APIs — DONE
Follow the existing layering. Each sub-step ends with tests green + roadmap updated.

| Step | Scope |
|---|---|
| **2a Employees — DONE** | `POST /employees` (also creates a login user and leave balances for active leave types, in one transaction), `GET /employees/{id}`, `PATCH /employees/{id}`, `POST /employees/{id}/deactivate` (also disable linked user). Department and shift list endpoints. Contract: api-contract §4. |
| **2b Attendance — DONE** | Check-in, check-out via `complete_attendance_checkout()`, today's status, admin correction. Input is `employee_id` for now (face later). Reject inactive employee and duplicate open session. |
| **2c Leave & overtime — DONE** | Request, approve/reject (`approve_leave_request()`), balances, overtime submit/approve. EMPLOYEE sees only own records. |
| **2d Payroll — DONE** | Create run, compute, finalize (`finalize_payroll_run()`), bonuses, deductions, payments, payslip. |
| **2e Reports & audit — DONE** | Wrap `v_*` views; audit log queries. |

## Stage 3 — Close known SQL gaps — COMPLETE (migration `20241001000000_close_sql_gaps.sql`, `verify_stage3_gaps.sql`)
Deduction cap so `net_pay >= 0`; lateness grace period; leave balance admin override; `CALENDAR_WORKING_DAYS` payroll divisor.

## Stage 4 — Frontend (Next.js) — COMPLETE (face registration/kiosk UI deferred to Stage 5)
App foundation + API client, login, admin dashboard, employee management, attendance/kiosk, leave/overtime, payroll, reports, employee self-service home.

## Stage 5 — Face recognition (stretch, last)
Fallback already works (attendance by employee ID/PIN). Full version: browser-side embeddings (face-api.js), pgvector in the existing PostgreSQL, `POST /face/register`, `POST /face/recognize` with similarity threshold; backend still makes the attendance decision.

## Stage 6 — Testing, security, polish
Full suite + a few end-to-end flows; SQLi/auth-bypass/secrets pass; `npm audit` review (do not use `--force`); rate-limit login; update README/API docs; demo script.

## Known limitations / decisions
- JWT is stateless: no logout/revocation until expiry (8h default).
- Chose pgvector over a separate vector DB.
- npm audit currently reports vulnerabilities in existing dependencies — review in Stage 6.
- Stage 2 finding: `audit_log` is append-only, so a user who has authored an audit entry can never be deleted (the FK `ON DELETE SET NULL` is blocked). Deactivate users instead; tests reuse one fixture admin.
- Stage 3: deductions are capped at gross pay (excess not carried over); `CALENDAR_WORKING_DAYS` counts non-weekly-off days in the run period (no holiday calendar).
- Not implemented from api-contract: department/shift create/update, `POST /auth/logout`, and the face endpoints (Stage 5).
