# Database — PostgreSQL

PostgreSQL is the **authoritative source of truth** for workforce, attendance, leave, overtime, payroll, and audit data for the Smart Workforce Attendance & Payroll Management System.

**Phase:** 2.2 — PostgreSQL infrastructure, schema, and advanced DBMS features.

| Step | Status | Migration |
|------|--------|-----------|
| Step 1 — Foundation (UUID extension, schema comment) | Applied | `20240903000000_foundation.sql` |
| Step 2 — Application tables (20 entities) | Applied | `20240903100000_application_schema.sql` |
| Step 3 — Functions, triggers, views, indexes | Applied | `20240903110000_advanced_dbms_features.sql` |
| Dev seed data | `cd backend && npm run seed` (idempotent; refuses production) | `backend/src/scripts/seed.ts` |
| Further backend APIs | Not started | — |

**Backend integration (Phase 2.3):** The Node.js backend in `backend/` connects via `DATABASE_URL`. See [backend README](../backend/README.md) and [backend architecture](../docs/integration/backend-architecture.md).

Design documents: [`docs/database/`](../docs/database/)

---

## 1. PostgreSQL Version

| Setting | Value |
|---------|-------|
| **Version** | PostgreSQL **16** (Alpine image) |
| **Image** | `postgres:16-alpine` |
| **Rationale** | Stable, widely supported, includes native `gen_random_uuid()` and modern SQL features |

---

## 2. Docker Setup

PostgreSQL runs locally via Docker Compose at the repository root.

| File | Purpose |
|------|---------|
| [`docker-compose.yml`](../docker-compose.yml) | Defines the `postgres` service and persistent volume |
| [`.env.example`](../.env.example) | Placeholder environment variables (no secrets) |
| `.env` | Local credentials (**not committed** — copy from `.env.example`) |

Data is persisted in the Docker volume `postgres_data`.

---

## 3. Environment Variables

Copy the example file and set your local values:

```bash
cp .env.example .env
```

| Variable | Description | Example |
|----------|-------------|---------|
| `POSTGRES_DB` | Database name created on first startup | `smart_attendance` |
| `POSTGRES_USER` | Application database user | `smart_attendance_app` |
| `POSTGRES_PASSWORD` | Database password (**set locally only**) | *(your secret)* |
| `POSTGRES_PORT` | Host port mapped to container `5432` | `5432` |
| `DATABASE_URL` | Full connection string for migrations and backend | `postgres://user:pass@localhost:5432/smart_attendance?sslmode=disable` |

`DATABASE_URL` must match the other `POSTGRES_*` values.

---

## 4. Start PostgreSQL

From the repository root:

```bash
cp .env.example .env   # first time only — then edit .env
docker compose up -d
```

Wait until the container is healthy:

```bash
docker compose ps
```

---

## 5. Stop PostgreSQL

```bash
docker compose down
```

To stop and **remove persisted data** (destructive):

```bash
docker compose down -v
```

---

## 6. Migrations

### Tool

Migrations are managed with **[dbmate](https://github.com/amacneil/dbmate)** — versioned SQL files in `database/migrations/`.

dbmate tracks applied migrations in the `schema_migrations` table and supports `up`, `down`, `status`, and `new`.

### Run migrations

Ensure PostgreSQL is running (`docker compose up -d`), then:

```bash
chmod +x database/scripts/migrate.sh   # first time only
./database/scripts/migrate.sh up
```

The script runs dbmate via `docker compose --profile tools` on the same network as PostgreSQL, using the internal hostname `postgres` (no host port mapping required for migrations).

Check status:

```bash
./database/scripts/migrate.sh status
```

### Create a new migration

```bash
./database/scripts/migrate.sh new add_department_table
```

This creates a timestamped file in `database/migrations/`. Edit it with `-- migrate:up` and `-- migrate:down` sections.

**Current migrations:** `20240903000000_foundation.sql`, `20240903100000_application_schema.sql`, `20240903110000_advanced_dbms_features.sql`

### Verify Step 2 constraints (optional)

Runs tests A–H in a rolled-back transaction:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -f - < database/scripts/verify_step2_constraints.sql
```

### Verify Step 3 DBMS features (optional)

Runs tests S3-01 through S3-20 in a rolled-back transaction:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -f - < database/scripts/verify_step3_dbms.sql
```

### Alternative: run dbmate directly

```bash
docker compose --profile tools run --rm dbmate up
```

### Manual connection (optional)

```bash
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

---

## 7. UUID Strategy

| Decision | Detail |
|----------|--------|
| **Primary key type** | `UUID` on all entity tables (per Phase 2.1 design) |
| **Generation** | `gen_random_uuid()` — PostgreSQL built-in (13+), enabled via `pgcrypto` extension in the foundation migration for explicit portability |
| **Why not serial integers** | Distributed-friendly IDs, safe to expose in APIs, aligns with `employee.id` referenced in the vector DB |
| **Application responsibility** | Migrations will use `DEFAULT gen_random_uuid()` on `id` columns; the backend may also generate UUIDs before insert if needed |

Do **not** change UUID primary keys to auto-increment integers without updating the design documents.

### Enum strategy (Step 2 implementation)

PostgreSQL `ENUM` types are used for fixed domain values (status fields, roles, classifications). Defined once in `20240903100000_application_schema.sql`:

| Enum type | Used by |
|-----------|---------|
| `entity_status` | `department`, `shift`, `employee`, `user`, `leave_type`, `payroll_policy`, `overtime_rate_config` |
| `user_role` | `user` |
| `face_registration_status` | `face_registration_metadata` |
| `attendance_session_status` | `attendance_session` |
| `attendance_source` | `attendance_session` |
| `day_classification` | `employee_day_attendance` |
| `leave_request_status` | `leave_request` |
| `overtime_status` | `overtime_record` |
| `working_days_method` | `payroll_policy` |
| `payroll_run_status` | `payroll_run` |
| `payroll_record_status` | `payroll_record` |

The authentication table is named `"user"` (quoted) because `user` is a reserved word in PostgreSQL.

---

## 8. Schema Naming Decision

| Decision | Detail |
|----------|--------|
| **Chosen schema** | `public` |
| **Alternative considered** | Dedicated application schema (e.g. `workforce`) |
| **Rationale** | Simplest approach for an MVP college project; no multi-tenant or shared-database isolation requirement. All application tables will live in `public` unless a future phase requires separation. |

---

## 9. Where Credentials Are Configured

| Location | Committed? | Purpose |
|----------|------------|---------|
| `.env.example` | Yes | Placeholders and documentation |
| `.env` | **No** (gitignored) | Local development secrets |
| `docker-compose.yml` | Yes | Reads `POSTGRES_*` from `.env` at runtime — no hardcoded passwords |
| Future backend | Not yet implemented | Will read `DATABASE_URL` or discrete `POSTGRES_*` variables |

---

## 10. Security Notes (Local Development)

1. **Never commit `.env`** — it is listed in `.gitignore`.
2. **Use strong passwords** even locally if the port is exposed on a shared network.
3. **PostgreSQL is not exposed to the Next.js frontend** — only the backend API connects to the database (see [`docs/requirements/system-architecture.md`](../docs/requirements/system-architecture.md)).
4. **Default bind** — Docker maps port `5432` to the host; restrict access on untrusted networks.
5. **Production** — use managed PostgreSQL, TLS (`sslmode=require`), least-privilege DB users, and secrets management (not `.env` files).

---

## Directory Layout

```
database/
├── migrations/          # Versioned SQL migrations (dbmate)
│   ├── 20240903000000_foundation.sql
│   ├── 20240903100000_application_schema.sql
│   └── 20240903110000_advanced_dbms_features.sql
├── seeds/               # Reference/seed data (post-schema)
├── scripts/
│   ├── migrate.sh       # Run dbmate via Docker
│   ├── verify_step2_constraints.sql  # Constraint tests A–H (rolled back)
│   └── verify_step3_dbms.sql         # DBMS feature tests S3-01..S3-20 (rolled back)
└── README.md            # This file
```

---

## Verification Checklist

After setup:

```bash
# Container healthy
docker compose ps

# Database reachable
docker compose exec postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"

# Migrations applied
./database/scripts/migrate.sh status

# All 20 application tables exist (plus schema_migrations)
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> 'schema_migrations';"

# UUID extension available
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT gen_random_uuid();"
```

---

## Related Documents

- [ER diagram](../docs/database/er-diagram.md)
- [Relational schema](../docs/database/relational-schema.md)
- [Constraints](../docs/database/database-constraints.md)
- [Functions](../docs/database/functions.md)
- [Triggers](../docs/database/triggers.md)
- [Views](../docs/database/views.md)
- [Transactions](../docs/database/transactions.md)
- [Indexes](../docs/database/indexes.md)
- [Phase 2 decisions](../docs/phase2/decisions.md)
- [System architecture](../docs/requirements/system-architecture.md)
