# Smart Workforce Attendance & Payroll System

A DBMS mini project for managing employees, attendance, leave, overtime,
payroll, payments, reports, and audit logs.

PostgreSQL is the source of truth. The Express backend applies business rules
and calls PostgreSQL functions, while the Next.js frontend provides ADMIN and
EMPLOYEE dashboards.

## Technology stack

- PostgreSQL 16 and dbmate migrations
- Node.js, Express 5, and TypeScript
- Next.js 15 and React 19
- Vitest
- Docker Compose

## Implemented features

- JWT login with ADMIN and EMPLOYEE roles
- Employee creation, updates, and deactivation
- Attendance check-in, check-out, history, and corrections
- Leave requests, approval, rejection, and balance adjustment
- Overtime submission and approval
- Payroll calculation, finalization, bonuses, deductions, and payments
- Employee payslips and self-service summary
- Admin reports and immutable audit logs
- PostgreSQL functions, triggers, views, constraints, indexes, and transactions
- API-contract, security, integration, concurrency, and regression tests

Face recognition and pgvector are not implemented in this version. Attendance
currently uses authenticated employee or ADMIN actions.

## Prerequisites

- Docker Desktop running
- Node.js 20 or newer
- npm
- A root `.env` file configured from `.env.example`

For first-time setup:

```bash
cp .env.example .env
```

Do not commit the `.env` file.

## Start the project

Open three terminals.

### Terminal 1 — PostgreSQL

```bash
cd smart_attendence_and_payroll_system
docker compose up -d
docker compose ps
./database/scripts/migrate.sh up
./database/scripts/migrate.sh status
```

Wait until PostgreSQL is shown as `healthy`. The migration status command
should show all migrations as applied.

Load the demonstration data when setting up the database for the first time:

```bash
cd backend
npm install
npm run seed
```

The seed is idempotent, so running it again does not duplicate its data.

### Terminal 2 — Backend

```bash
cd smart_attendence_and_payroll_system/backend
npm install
npm run dev
```

Backend URL: <http://localhost:3001>

Health check:

```bash
curl http://localhost:3001/api/v1/health
```

### Terminal 3 — Frontend

```bash
cd smart_attendence_and_payroll_system/frontend
npm install
npm run dev
```

Open <http://localhost:3000>.

## Development logins

| Role | Email | Password |
|---|---|---|
| ADMIN | `admin@example.com` | `Admin@12345` |
| EMPLOYEE | `aarav.sharma@example.com` | `Employee@12345` |

## Testing

Start PostgreSQL and apply migrations before running database integration
tests.

### Backend database-free tests

```bash
cd smart_attendence_and_payroll_system/backend
npm run test:unit
npm run typecheck
```

Expected result: 88 tests passing.

The suite includes:

- Service unit tests
- API-contract tests
- Security tests
- Transaction helper tests
- Authentication and authorization tests

### API-contract tests only

```bash
cd smart_attendence_and_payroll_system/backend
npm run test:contract
```

Expected result: 47 tests passing, covering all 45 protected API routes and
the standard response envelopes.

### Security tests only

```bash
cd smart_attendence_and_payroll_system/backend
npm run test:security
```

Expected result: 11 tests passing.

These tests cover malformed and unsigned JWTs, login rate limiting,
SQL-injection-shaped input, oversized request bodies, security headers, and
secret-safe error responses.

### Backend integration tests

Docker Desktop must be running. Use this complete sequence from a new terminal:

```bash
cd /Users/abhinav/smart_attendence_and_payroll_system

# Start PostgreSQL and wait for it to become healthy.
docker compose up -d
docker compose ps

# Apply and verify all database migrations.
./database/scripts/migrate.sh up
./database/scripts/migrate.sh status

# Load idempotent demonstration data and run the integration suite.
cd backend
npm run seed
npm run test:integration
```

These tests use the real PostgreSQL database and verify employee, attendance,
leave, overtime, payroll, payment, report, audit, validation, authorization,
transaction, and concurrency flows.

After testing, return to the project root and stop PostgreSQL safely:

```bash
cd ..
docker compose down
```

Do not use `docker compose down -v`; `-v` deletes the PostgreSQL data volume.

### Concurrent check-in demonstration

```bash
cd smart_attendence_and_payroll_system/backend
npx vitest run tests/attendance.test.ts \
  -t "concurrent check-ins create exactly one open session"
```

The test sends five concurrent check-in requests. Exactly one succeeds and the
remaining requests return `409 Conflict`, proving that the database prevents
multiple open attendance sessions.

### Database regression test

Run from the project root:

```bash
cd smart_attendence_and_payroll_system
docker exec -i smart_attendance_postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' \
  < database/scripts/verify_phase5_regression.sql
```

This read-only test verifies:

- 20 application tables
- 32 foreign keys
- Critical PostgreSQL functions
- Integrity and audit triggers
- Unique and lookup indexes
- Important check constraints

### Frontend tests

```bash
cd smart_attendence_and_payroll_system/frontend
npm test
npm run typecheck
```

Expected result: 19 tests passing.

## Manual security demonstration

Start the backend, then send eleven invalid login requests from another
terminal:

```bash
for i in {1..11}; do
  printf "Attempt $i: "
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3001/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{}'
done
```

Attempts 1–10 return `400`. Attempt 11 returns `429`, demonstrating login rate
limiting. Restart the backend afterward to clear the in-memory limiter.

## Stop the project

Stop the backend and frontend with `Control + C` in their terminals.

Stop PostgreSQL from the project root:

```bash
docker compose down
```

Do not use `docker compose down -v`; `-v` removes the PostgreSQL data volume.

## Main project directories

```text
backend/              Express API and tests
database/migrations/  PostgreSQL migrations
database/scripts/     Migration and regression scripts
docs/                 Requirements, database, API, and testing documentation
frontend/             Next.js application and tests
```

Detailed testing evidence is available in
[`docs/testing/phase5-verification.md`](docs/testing/phase5-verification.md).
The current implementation status is tracked in
[`PROJECT-ROADMAP.md`](PROJECT-ROADMAP.md).
