# Backend API

Node.js + Express + TypeScript backend for the Smart Workforce Attendance & Payroll Management System.

## Prerequisites

- Node.js 20+
- PostgreSQL running via Docker (`docker compose up -d` from repository root)
- `.env` configured at repository root (see `.env.example`)

## Setup

```bash
cd backend
npm install
```

## Development

```bash
npm run dev
```

Server listens on `http://localhost:3001` by default (`BACKEND_PORT`).

## API Endpoints

All paths are under `/api/v1`. Auth: `Bearer` JWT. "Scoped" means an EMPLOYEE only ever sees their own records.

| Area | Endpoints | Access |
|------|-----------|--------|
| Health / auth | `GET /health`, `POST /auth/login`, `GET /auth/me` | public / public / any |
| Employees | `GET,POST /employees`, `GET,PATCH /employees/{id}`, `POST /employees/{id}/deactivate` | ADMIN |
| Reference | `GET /departments`, `GET /shifts` | ADMIN |
| Attendance | `POST /attendance/check-in`, `POST /attendance/check-out`, `GET /attendance/today`, `GET /attendance` | ADMIN any employee; EMPLOYEE self |
| | `PATCH /attendance/{id}` (correction, reason required) | ADMIN |
| Leave | `GET /leave/types`, `GET,POST /leave/requests`, `GET /leave/requests/{id}`, `GET /leave/balances` | scoped; submit is EMPLOYEE |
| | `POST /leave/requests/{id}/approve`, `.../reject` | ADMIN |
| Overtime | `GET,POST /overtime` | scoped; ADMIN may set minutes |
| | `POST /overtime/{id}/approve`, `.../reject` | ADMIN |
| Payroll | `GET,POST /payroll/runs`, `GET /payroll/runs/{id}`, `POST .../compute`, `POST .../finalize` | ADMIN |
| | `GET /payroll/records`, `GET /payroll/records/{id}`, `GET .../{id}/payslip` | scoped (EMPLOYEE: FINALIZED/PAID only) |
| | `GET,POST /bonuses`, `GET,POST /deductions`, `GET,POST /payments` | ADMIN |
| Face | `POST /employees/{id}/face/register`, `DELETE /employees/{id}/face`, `GET /employees/{id}/face/status` | ADMIN |
| | `POST /face/recognize` (identify only; returns a short-lived `recognition_token`) | any authenticated role |
| Reports | `GET /reports/attendance-summary`, `/reports/leave-balances`, `/reports/payroll-register`, `GET /audit-logs` | ADMIN |
| | `GET /reports/me/summary` | EMPLOYEE |

Deviations from `docs/integration/api-contract.md`: day classes are `FULL_DAY`/`HALF_DAY` (the DB enum values); attendance still accepts only the `MANUAL` source (the `FACE_RECOGNITION` wiring is specified in `docs/integration/face-attendance-integration.md` but not built) and ignores client timestamps; `POST /face/recognize` returns extra `reason`, `recognition_token` and `expires_in_seconds` fields; `POST /employees` takes an initial `password`; extra endpoints `/leave/types`, `/overtime/{id}/reject`, `/payroll/runs/{id}/compute`, `/payroll/records/{id}/payslip`.

## Seed data (development)

```bash
npm run seed
```

Idempotent. Creates departments, shifts, 8 employees, leave types/balances, overtime rates, a payroll policy, and logins (`admin@example.com` / `Admin@12345`). Refuses to run in production.

## Tests

```bash
npm test
```

Tests use the development PostgreSQL database configured in the root `.env` file and send requests in-process (`tests/helpers.ts`, via `light-my-request`) rather than over sockets. Files run serially because payroll finalization touches every active employee. Each test creates and removes its own rows; payroll tests use an isolated far-future/past year.

## Environment Variables

Configured in the repository root `.env`:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `BACKEND_PORT` | API port (default `3001`) |
| `NODE_ENV` | `development` / `test` / `production` |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Auth signing secret (32+ chars) and token lifetime. The face recognition proof is signed with a key derived from `JWT_SECRET` |
| `FACE_MATCH_THRESHOLD` | Minimum cosine similarity for a face match (default `0.90`, range 0.5–1) |
| `FACE_AMBIGUITY_MARGIN` | Runner-up within this margin makes a match `AMBIGUOUS` (default `0.03`) |
| `FACE_PROOF_TTL_SECONDS` | Lifetime of the recognition proof (default `30`, range 5–300) |

Face storage needs the pgvector PostgreSQL image (`docker-compose.yml`); after pulling this change run `docker compose up -d --force-recreate postgres` and apply migrations.

See [backend architecture docs](../docs/integration/backend-architecture.md).
