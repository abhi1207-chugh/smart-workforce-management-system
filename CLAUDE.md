# Smart Workforce Attendance & Payroll System — Claude Code guide

College DBMS project. PostgreSQL is the source of truth; the Express backend orchestrates business logic and calls the SQL functions already written. Face recognition only *identifies* an employee; the backend decides and writes attendance.

**Current status:** Stages 1 and 2 (auth, employees, attendance, leave/overtime, payroll, reports/audit) are COMPLETE and tested. **Continue from Stage 3** — see `docs/EXECUTION-PLAN.md`. Keep `PROJECT-ROADMAP.md` and READMEs accurate as steps finish.

## Commands (run from repo root unless noted)
```bash
docker compose up -d                        # start PostgreSQL 16 (Docker Desktop must be running)
./database/scripts/migrate.sh status        # dbmate migrations; `up` to apply
cd backend && npm run dev                   # API on http://localhost:3001
cd backend && npm test                      # Vitest, needs the DB running
cd backend && npx tsc --noEmit              # type check
cd frontend && npm run dev                  # Next.js on http://localhost:3000 (proxies /api/v1 to :3001)
cd frontend && npm test && npm run typecheck
cd backend && npm run seed                  # idempotent dev seed (admin@example.com / Admin@12345)
```
Dev logins: `admin@example.com` / `Admin@12345` (ADMIN); `aarav.sharma@example.com` / `Employee@12345` (EMPLOYEE).

## Architecture
`backend/src`: routes → controllers → services → repositories → PostgreSQL (`database/client.ts`).
- Config in `config/env.ts` (reads repo-root `.env`; needs `DATABASE_URL`, `JWT_SECRET` ≥32 chars). `.env` is git-ignored — never commit or print secrets.
- Auth: Bearer JWT (HS256), bcrypt passwords. `createAuthenticate(secret)` + `requireRole(...)` in `middleware/auth.ts`; `req.user` is `{id,email,role,employee_id}`. Public routes: `/health`, `/auth/login`.
- `createApp(authConfig)` mounts routers under `/api/v1`. Routers needing auth take the `AuthConfig`.

## Conventions
- Response envelope: `{ success: true, data }` / `{ success: false, error: { code, message, details } }`. Throw `AppError` helpers from `errors/app-error.ts` (`badRequest`, `notFound`, `conflict`, `unauthorized`, `forbidden`).
- Validate input with Zod in `validation/`, parse in the controller, call a service.
- **Parameterized SQL only** (`$1, $2`). Never interpolate user input. Never leak raw Postgres errors to clients.
- **Reuse the DB layer** instead of re-implementing rules: functions such as `complete_attendance_checkout()`, `approve_leave_request()`, `compute_employee_payroll_record()`, `finalize_payroll_run()`, and views `v_*` (see `docs/database/functions.md`, `views.md`, `triggers.md`). Triggers enforce active-employee check-in, immutable audit log, no edits to finalized payroll.
- Shared helpers: `services/scope.ts` (`scopeEmployee`/`ownEmployeeId` for EMPLOYEE-scoped reads), `database/queryable.ts` (`Where` builder, `Queryable`), `middleware/async-handler.ts`, `validation/common.ts`+`parse.ts`. Unhandled SQL `RAISE EXCEPTION` (P0001) surfaces as 409 via `error-handler.ts`.
- API shapes follow `docs/integration/api-contract.md`. Business rules: `docs/requirements/business-rules.md`.
- DB enums: roles `ADMIN|EMPLOYEE`; status `ACTIVE|INACTIVE`. Weekly-off `day_of_week` 0=Sunday..6=Saturday. Do not edit applied migrations; add a new timestamped migration (dbmate) for schema changes.

## Testing
Every endpoint gets Vitest tests (success, 401/403, validation 400, conflicts). Tests create and clean up their own rows; do not depend on seed data. Use `req(app)` from `tests/helpers.ts` (in-process injection) — real sockets via supertest were flaky here because other local servers collide on ephemeral ports. `audit_log` is append-only, so a user who authored an audit entry cannot be deleted: tests share `ensureFixtureAdmin()`. Run `npm test` and `npx tsc --noEmit` before calling a step done.

## Working style for this project
Work one step at a time. After each step: run tests, summarise what changed, update `PROJECT-ROADMAP.md`, then wait for the user before the next step. Commit only when asked.
