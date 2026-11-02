# Smart Workforce Attendance & Payroll Management System

A college DBMS-focused workforce management system that combines **PostgreSQL** (authoritative business data), a **backend API** (business logic orchestration), **face recognition** (employee identification), and a **Vector DB** (face embeddings) with a planned **Next.js** frontend.

---

## 1. Project Overview

This system helps organizations record attendance, manage leave and overtime, and run payroll using business rules enforced in both the **backend** and **PostgreSQL**. Face recognition identifies an employee; the **backend** decides whether an attendance operation is allowed and writes authoritative records to PostgreSQL.

**Current status:** Requirements, database design, PostgreSQL implementation, and backend foundation are complete. Authentication and authorization are complete. Face pipeline, Vector DB, domain APIs, and frontend are planned next.

---

## 2. Real-World Problem

Manual attendance and payroll processes are error-prone, slow, and difficult to audit. Organizations need:

- Reliable attendance capture
- Enforced business rules (half-day/full-day, leave balance, payroll formulas)
- Traceable payroll calculations
- Separation between **identity** (face recognition) and **business decisions** (attendance/payroll)

---

## 3. Project Objectives

| Objective | Description |
|-----------|-------------|
| O1 | Model workforce data in a normalized PostgreSQL schema |
| O2 | Encode attendance, leave, overtime, and payroll rules in DB + backend |
| O3 | Integrate face recognition as an identification layer only |
| O4 | Provide admin and employee interfaces (planned) |
| O5 | Demonstrate advanced DBMS features (functions, triggers, views, transactions) |

See [`docs/requirements/objectives.md`](docs/requirements/objectives.md).

---

## 4. Core Features

| Feature | Status |
|---------|--------|
| Requirements & architecture documentation | **Complete** |
| PostgreSQL schema (20 tables) + advanced DBMS layer | **Complete** |
| Backend health + employee list API | **Complete** |
| Authentication & authorization (JWT, roles, seed data) | **Complete** |
| Face registration & recognition (backend: register/revoke/status, `POST /face/recognize`) | **Complete** |
| Vector search (pgvector in PostgreSQL) | **Complete** |
| Face capture UI (registration on the employee page, `/kiosk`) | **Complete** (live camera test pending) |
| Attendance accepting `FACE_RECOGNITION` + proof | **Next** (attendance owner) |
| Attendance check-in/out APIs | **Planned** |
| Leave & overtime APIs | **Planned** |
| Payroll engine & APIs | **Planned** |
| Next.js frontend | **Planned** |

---

## 5. System Architecture

```
Next.js Frontend (planned)
        ↓  HTTPS / REST
Backend API (Node.js + Express + TypeScript)
        ↓  SQL / transactions
PostgreSQL (source of truth)
        ↑
Attendance Service (planned)
        ↑
Face Recognition (POST /face/recognize — implemented)
        ↑
Face embeddings in pgvector (same PostgreSQL — implemented)
        ↑
Browser capture + face-api.js 128-d embeddings (implemented: employee page + /kiosk)
```

**Boundary:** Face recognition returns a candidate `employee_id`. The backend validates eligibility and performs attendance writes. The frontend never connects directly to PostgreSQL.

See [`docs/requirements/system-architecture.md`](docs/requirements/system-architecture.md).

---

## 6. Technology Stack

| Layer | Technology | Status |
|-------|------------|--------|
| Frontend | Next.js | Planned |
| Backend | Node.js 18+, Express 5, TypeScript | **Implemented (foundation)** |
| Database | PostgreSQL 16 (Docker) | **Implemented** |
| Migrations | dbmate | **Implemented** |
| Vector search | pgvector in PostgreSQL (`pgvector/pgvector:pg16` image) | **Implemented** |
| Face pipeline | `@vladmandic/face-api` (face-api.js fork) in the browser, 128-d embeddings | **Implemented** |

---

## 7. Database Architecture

- **20 application tables** in `public` schema
- **11 PostgreSQL ENUM types** for domain statuses
- **Constraints:** PK, FK, UNIQUE, CHECK, partial unique indexes
- **Advanced DBMS (Step 3):** functions, triggers, views, transaction helpers, supporting indexes
- **Verification:** `database/scripts/verify_step2_constraints.sql`, `verify_step3_dbms.sql`

See [`docs/database/`](docs/database/) and [`database/README.md`](database/README.md).

---

## 8. Face Recognition + Vector DB Architecture

**Implemented (backend):**

- Embeddings (128-d) live in `face_embedding` using **pgvector inside the same PostgreSQL**; `face_registration_metadata` keeps the registration history/status and links to it via `vector_record_id`
- One ACTIVE face registration per employee (partial unique index); re-registering supersedes the old face, revoking or deactivating the employee deletes the embedding
- ADMIN: `POST /employees/{id}/face/register`, `DELETE /employees/{id}/face`, `GET /employees/{id}/face/status`
- `POST /face/recognize`: cosine nearest-neighbour + threshold (`FACE_MATCH_THRESHOLD`) + ambiguity check; returns the candidate `employee_id`, a server-computed confidence and a short-lived signed proof. It **never writes attendance**; the attendance check-in must verify the proof and re-validate the employee
- `/health` reports a real `vector_db` status

**Frontend:** ADMIN employee page has Register / Re-register / Remove face (camera capture, averaged samples); ADMIN `/kiosk` ("Face check-in") scans, shows the recognised employee and checks them in or out. The camera needs HTTPS or `localhost`. Model weights are copied to `frontend/public/models` (git-ignored) by `npm run models`, which runs automatically before `dev` and `build`.

**Not yet built:** attendance accepting `source: FACE_RECOGNITION` + `recognition_token` (the kiosk currently punches with `employee_id` only) — see [`docs/integration/face-attendance-integration.md`](docs/integration/face-attendance-integration.md).

Upgrading an existing dev machine: `docker compose up -d --force-recreate postgres`, then run the dbmate migrations (the data volume is kept).

See [`docs/face/`](docs/face/).

---

## 9. Backend / API Architecture

**Implemented (Phase 2.3 Step 1):**

- Layered structure: routes → controllers → services → repositories → PostgreSQL
- `GET /api/v1/health` — backend + PostgreSQL connectivity check
- `GET /api/v1/employees` — list employees from PostgreSQL
- Parameterized queries, connection pooling, structured errors, Zod validation
- Vitest + Supertest integration tests

**Auth (Phase 2.3 Step 2):** `POST /auth/login` issues a JWT; `GET /employees` requires an ADMIN token.

See [`docs/integration/backend-architecture.md`](docs/integration/backend-architecture.md) and [`docs/integration/api-contract.md`](docs/integration/api-contract.md).

---

## 10. User Roles

| Role | Capabilities (target) |
|------|------------------------|
| **ADMIN** | Manage employees, attendance, leave, payroll, reports |
| **EMPLOYEE** | View own attendance, leave, payroll summary |

See [`docs/requirements/user-roles.md`](docs/requirements/user-roles.md).

---

## 11. Current Implementation Status

### COMPLETE

| Phase | Deliverable |
|-------|-------------|
| **Phase 1** | Requirements, business rules, system architecture, API contract |
| **Phase 2.1** | ER diagram, relational schema, normalization, constraints, face/vector design |
| **Phase 2.2 Step 1** | Docker PostgreSQL, dbmate foundation migration |
| **Phase 2.2 Step 2** | 20-table schema, enums, constraints, Step 2 verification tests |
| **Phase 2.2 Step 3** | Functions, triggers, views, indexes, transaction helpers, Step 3 tests |
| **Phase 2.3 Step 1** | Backend foundation, PostgreSQL integration, health + employees APIs, tests |
| **Phase 2.3 Step 2** | JWT login, role-based route protection, dev seed data, auth tests |
| **Stage 5 (backend)** | pgvector, face register/revoke/status, `POST /face/recognize`, recognition proof, real `vector_db` health, tests |

### IN PROGRESS / NEXT

| Item | Notes |
|------|-------|
| **Phase 2.3 Step 3** | Employee management API |

### PLANNED

- Employee management CRUD APIs
- Attendance `FACE_RECOGNITION` wiring and threshold tuning with real faces
- Attendance, leave, overtime, payroll APIs
- Next.js frontend
- Full integration, security hardening, deployment

See [`PROJECT-ROADMAP.md`](PROJECT-ROADMAP.md).

---

## 12. Project Structure

```
smart_attendence_and_payroll_system/
├── backend/                 # Node.js + Express API (Phase 2.3 Step 1)
│   ├── src/                 # Application source
│   └── tests/               # Vitest integration tests
├── database/
│   ├── migrations/          # dbmate SQL migrations (3 applied)
│   ├── scripts/             # migrate.sh, verification SQL
│   └── seeds/               # Seed data (placeholder)
├── docs/
│   ├── requirements/        # Phase 1 requirements
│   ├── database/            # Schema & DBMS documentation
│   ├── face/                # Face & vector DB design
│   ├── integration/         # API contract, backend architecture
│   └── phase2/              # Phase 2 decisions
├── docker-compose.yml       # PostgreSQL 16 + dbmate profile
├── .env.example             # Environment template (no secrets)
├── README.md
└── PROJECT-ROADMAP.md
```

---

## 13. Local Development Prerequisites

- **Docker** and **Docker Compose**
- **Node.js** 18+ and **npm**
- **Git**

---

## 14. How to Start PostgreSQL

```bash
cp .env.example .env          # first time — edit with local values
docker compose up -d
docker compose ps             # wait until postgres is healthy
```

---

## 15. How to Run Database Migrations

```bash
chmod +x database/scripts/migrate.sh
./database/scripts/migrate.sh up
./database/scripts/migrate.sh status
```

---

## 16. How to Run the Backend

```bash
cd backend
npm install
npm run dev                   # http://localhost:3001
```

**Endpoints:**

```bash
curl http://localhost:3001/api/v1/health
curl http://localhost:3001/api/v1/employees
```

---

## 17. How to Run Tests

**Database verification (rolled back):**

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -f - < database/scripts/verify_step2_constraints.sql

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -f - < database/scripts/verify_step3_dbms.sql
```

**Backend tests:**

```bash
cd backend
npm test
```

---

## 18. Environment Variables

Copy [`.env.example`](.env.example) to `.env` (never commit `.env`):

| Variable | Description |
|----------|-------------|
| `POSTGRES_DB` | Database name (`smart_attendance`) |
| `POSTGRES_USER` | Database user |
| `POSTGRES_PASSWORD` | Database password (local only) |
| `POSTGRES_PORT` | Host port (default `5432`) |
| `DATABASE_URL` | Full connection string for dbmate and backend |
| `BACKEND_PORT` | API port (default `3001`) |
| `NODE_ENV` | `development` / `test` / `production` |

---

## 19. Security Notes

- **Never commit `.env`** — it is gitignored
- **Public repository** — use placeholders in `.env.example` only
- Frontend must not connect directly to PostgreSQL
- API uses parameterized SQL; raw database errors are not exposed to clients
- Face recognition is an identification signal, not a replacement for application authentication

---

## 20. Database Migrations

| Migration | Description |
|-----------|-------------|
| `20240903000000_foundation.sql` | pgcrypto, UUID support |
| `20240903100000_application_schema.sql` | 20 tables, enums, constraints |
| `20240903110000_advanced_dbms_features.sql` | Functions, triggers, views, indexes |

---

## 21. Git Workflow

1. Create a feature branch from `master`
2. Implement and test locally
3. Open a pull request or merge to `master` after review
4. Do not commit secrets, `node_modules`, or `dist/`

---

## 22. Future Scope

- JWT/session authentication and role enforcement
- Full employee CRUD and domain APIs
- Face detection, embedding generation, Vector DB similarity search
- Attendance state machine wired to PostgreSQL functions
- Payroll finalization via `finalize_payroll_run()`
- Next.js admin and employee portals
- Production deployment and security hardening

See [`PROJECT-ROADMAP.md`](PROJECT-ROADMAP.md) for the full phased plan.

---

## Documentation Index

| Area | Path |
|------|------|
| Business rules | [`docs/requirements/business-rules.md`](docs/requirements/business-rules.md) |
| API contract | [`docs/integration/api-contract.md`](docs/integration/api-contract.md) |
| Backend architecture | [`docs/integration/backend-architecture.md`](docs/integration/backend-architecture.md) |
| Database | [`docs/database/`](docs/database/) |
| Face / Vector DB design | [`docs/face/`](docs/face/) |
| Phase 2 decisions | [`docs/phase2/decisions.md`](docs/phase2/decisions.md) |
