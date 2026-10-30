# API Contract

This document defines the **integration contract** between the Next.js frontend, backend/API, and consumers of recognition results. It is a Phase 1 specification — not implementation code.

**Status:** Phase 1 Final  
**Version:** 0.2.0  
**Base URL:** `{API_BASE_URL}/api/v1` (**deployment value TBD**)

---

## 1. Purpose

**Why this document exists:**

- Allows Person A (backend/PostgreSQL) and Person B (frontend/face) to develop in parallel.
- Makes the boundary explicit: recognition returns identity; backend owns business outcomes.
- Provides a shared reference for testing and integration.

---

## 2. Conventions

### 2.1 Transport

| Item | Specification |
|------|---------------|
| Protocol | HTTPS (HTTP acceptable for local development only) |
| Format | JSON request and response bodies |
| Charset | UTF-8 |
| Timestamps | ISO 8601 (`2026-08-31T09:30:00+05:30`) |
| Dates | ISO 8601 date (`2026-08-31`) |

### 2.2 Authentication

| Item | Specification |
|------|---------------|
| Mechanism | **OPEN** — Bearer JWT or session cookie |
| Header | `Authorization: Bearer <token>` (if JWT) |
| Login endpoint | `POST /auth/login` |
| Protected routes | All except `/auth/login` and health check |

### 2.3 Authorization

- Every protected endpoint enforces role requirements server-side.
- `ADMIN` — full access per [user-roles.md](../requirements/user-roles.md).
- `EMPLOYEE` — scoped to own resources unless noted.

### 2.4 Standard Response Envelope

**Success:**

```json
{
  "success": true,
  "data": { }
}
```

**Error:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": []
  }
}
```

**OPEN:** Pagination format for list endpoints.

### 2.5 HTTP Status Codes

| Code | Usage |
|------|-------|
| 200 | Success (GET, PATCH) |
| 201 | Created (POST) |
| 400 | Validation / business rule violation |
| 401 | Unauthenticated |
| 403 | Unauthorized (wrong role or scope) |
| 404 | Resource not found |
| 409 | Conflict (e.g., duplicate check-in) |
| 500 | Server error |

---

## 3. Authentication Endpoints

### POST /auth/login

Authenticate a user and receive a token.

**Auth required:** No

**Request:**

```json
{
  "email": "admin@example.com",
  "password": "string"
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "token": "string",
    "user": {
      "id": "uuid",
      "email": "string",
      "role": "ADMIN | EMPLOYEE",
      "employee_id": "uuid | null"
    }
  }
}
```

### POST /auth/logout

Invalidate session (**behavior: OPEN** if stateless JWT).

**Auth required:** Yes

---

## 4. Employee Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/employees` | ADMIN | List employees (filter/search) |
| POST | `/employees` | ADMIN | Create employee |
| GET | `/employees/{id}` | ADMIN | Get employee |
| PATCH | `/employees/{id}` | ADMIN | Update employee |
| POST | `/employees/{id}/deactivate` | ADMIN | Deactivate employee |

**Employee object (conceptual fields):**

```json
{
  "id": "uuid",
  "employee_code": "string",
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "department_id": "uuid",
  "shift_id": "uuid",
  "status": "ACTIVE | INACTIVE",
  "face_registered": false
}
```

`face_registered` is derived from vector DB / registration metadata (**sync mechanism: OPEN**).

---

## 5. Department Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/departments` | ADMIN | List departments |
| POST | `/departments` | ADMIN | Create department |
| GET | `/departments/{id}` | ADMIN | Get department |
| PATCH | `/departments/{id}` | ADMIN | Update department |
| POST | `/departments/{id}/deactivate` | ADMIN | Deactivate department |

---

## 6. Shift Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/shifts` | ADMIN | List shifts |
| POST | `/shifts` | ADMIN | Create shift |
| GET | `/shifts/{id}` | ADMIN | Get shift |
| PATCH | `/shifts/{id}` | ADMIN | Update shift |

**Shift object:**

```json
{
  "id": "uuid",
  "name": "string",
  "start_time": "09:00",
  "end_time": "18:00",
  "weekly_off_days": ["SUNDAY"]
}
```

`weekly_off_days` is configurable per shift — not hardcoded to Sunday at the system level.

---

## 7. Face Registration Endpoints

Face embedding generation may occur client-side or via a dedicated endpoint (**pipeline placement: OPEN**). The contract below assumes the backend coordinates persistence.

### POST /employees/{id}/face/register

Register or replace face embedding for an employee.

**Role:** ADMIN

**Request:**

```json
{
  "embedding": [0.012, -0.034],
  "model_version": "string"
}
```

**Alternative (OPEN):** Multipart image upload; server generates embedding.

**Response (201):**

```json
{
  "success": true,
  "data": {
    "employee_id": "uuid",
    "registered_at": "ISO8601",
    "model_version": "string"
  }
}
```

### DELETE /employees/{id}/face

Remove employee face embedding from vector store.

**Role:** ADMIN

### GET /employees/{id}/face/status

**Role:** ADMIN

**Response (200):**

```json
{
  "success": true,
  "data": {
    "employee_id": "uuid",
    "is_registered": true,
    "registered_at": "ISO8601 | null"
  }
}
```

---

## 8. Face Recognition Endpoints

Recognition may be implemented as a direct vector DB query from a service layer or exposed as an API route. Minimum contract for integration with attendance:

### POST /face/recognize

**Auth required:** **OPEN** (kiosk mode may differ)

**Request:**

```json
{
  "embedding": [0.012, -0.034]
}
```

**Response (200) — match:**

```json
{
  "success": true,
  "data": {
    "matched": true,
    "employee_id": "uuid",
    "confidence": 0.92,
    "threshold": 0.85
  }
}
```

**Response (200) — no match:**

```json
{
  "success": true,
  "data": {
    "matched": false,
    "employee_id": null,
    "confidence": 0.0,
    "threshold": 0.85
  }
}
```

**Note:** This endpoint identifies only. It does **not** record attendance. The confidence score is produced by the trusted recognition service — clients must not fabricate passing scores.

---

## 9. Attendance Endpoints

### POST /attendance/check-in

Record check-in after successful recognition and backend validation.

**Role:** ADMIN (kiosk) or EMPLOYEE (self) — **kiosk auth: OPEN**

**Request:**

```json
{
  "employee_id": "uuid",
  "timestamp": "ISO8601",
  "source": "FACE_RECOGNITION",
  "recognition_confidence": 0.92,
  "recognition_token": "string"
}
```

**Server behavior:**
- `timestamp` in the request is optional/informational; the **server timestamp** is authoritative for the recorded check-in time.
- `recognition_confidence` must be validated against a trusted recognition source — the client cannot arbitrarily assert a passing score.
- Backend validates employee exists, is active, recognition threshold met, and no duplicate open session.

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "check_in": "ISO8601",
    "status": "CHECKED_IN"
  }
}
```

**Error (409):** Employee already has open session or duplicate check-in for working period.

### POST /attendance/check-out

**Request:**

```json
{
  "employee_id": "uuid",
  "timestamp": "ISO8601",
  "source": "FACE_RECOGNITION"
}
```

**Server behavior:**
- `timestamp` in the request is optional/informational; the **server timestamp** is authoritative for the recorded check-out time.
- Backend rejects check-out without a valid open check-in on the same session.
- Backend prevents multiple checkout records for the same attendance session.
- On completion, working duration is calculated and attendance classification (HALF-DAY / FULL-DAY) is derived per business rules.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "check_in": "ISO8601",
    "check_out": "ISO8601",
    "working_duration_minutes": 480,
    "classification": "FULL-DAY | HALF-DAY",
    "status": "COMPLETED"
  }
}
```

### GET /attendance

**Role:** ADMIN (all filters) | EMPLOYEE (own only)

**Query params:** `employee_id`, `department_id`, `from`, `to`

### PATCH /attendance/{id}

Manual correction by admin.

**Role:** ADMIN

**Request:**

```json
{
  "check_in": "ISO8601",
  "check_out": "ISO8601",
  "reason": "string"
}
```

Creates audit log entry.

---

## 10. Leave Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/leave/requests` | ADMIN, EMPLOYEE | List (scoped) |
| POST | `/leave/requests` | EMPLOYEE | Submit request |
| GET | `/leave/requests/{id}` | ADMIN, EMPLOYEE | Get request |
| POST | `/leave/requests/{id}/approve` | ADMIN | Approve |
| POST | `/leave/requests/{id}/reject` | ADMIN | Reject |
| GET | `/leave/balances` | ADMIN, EMPLOYEE | Balances (scoped) |
| POST | `/leave/balances/adjust` | ADMIN | Override a balance: `{employee_id, leave_type_id, balance_days, reason}`; audited |

**Leave request statuses:** `PENDING` | `APPROVED` | `REJECTED`

---

## 11. Overtime Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/overtime` | ADMIN | List overtime records |
| POST | `/overtime` | ADMIN | Create overtime record |
| POST | `/overtime/{id}/approve` | ADMIN | Approve for payroll |

---

## 12. Bonus & Deduction Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/bonuses` | ADMIN | List bonuses |
| POST | `/bonuses` | ADMIN | Create bonus |
| GET | `/deductions` | ADMIN | List deductions |
| POST | `/deductions` | ADMIN | Create deduction |

---

## 13. Payroll Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/payroll/runs` | ADMIN | List payroll runs |
| POST | `/payroll/runs` | ADMIN | Initiate payroll run |
| GET | `/payroll/runs/{id}` | ADMIN | Run details |
| GET | `/payroll/records` | ADMIN, EMPLOYEE | Records (scoped) |
| GET | `/payroll/records/{id}` | ADMIN, EMPLOYEE | Single record |

**POST /payroll/runs request:**

```json
{
  "period_start": "2026-08-01",
  "period_end": "2026-08-31"
}
```

MVP payroll frequency is **MONTHLY**. Payroll incorporates attendance classification, approved leave, approved overtime, bonuses, and deductions. Net pay = base pay after attendance adjustment + approved overtime + bonus − deductions.

**Payroll record statuses:** `DRAFT` | `FINALIZED` | `PAID` (**exact enum: TBD**)

---

## 14. Payment Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/payments` | ADMIN | Record payment |
| GET | `/payments` | ADMIN | List payments |

**POST /payments request:**

```json
{
  "payroll_record_id": "uuid",
  "paid_at": "ISO8601",
  "reference": "string"
}
```

---

## 15. Audit Log Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/audit-logs` | ADMIN | Query logs |

**Query params:** `from`, `to`, `entity_type`, `actor_id`

---

## 16. Report Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/reports/dashboard` | ADMIN | Today's headline counts + latest payroll run |
| GET | `/reports/attendance-summary` | ADMIN | Period attendance summary |
| GET | `/reports/leave-balances` | ADMIN | Leave balance report |
| GET | `/reports/payroll-register` | ADMIN | Payroll register for period |
| GET | `/reports/me/summary` | EMPLOYEE | Personal summary |

**Query params:** `from`, `to`, `period_id` as applicable.

---

## 17. Health Check

### GET /health

**Auth required:** No

**Response (200):**

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "postgres": "ok | degraded | down",
    "vector_db": "ok | degraded | down"
  }
}
```

---

## 18. Integration Sequence: Face Check-In

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Frontend │    │Face Svc/ │    │ Vector   │    │ Backend  │
│          │    │ Pipeline │    │ DB       │    │ API      │
└────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
     │  capture      │               │               │
     │──────────────►│               │               │
     │  embedding    │               │               │
     │──────────────►│  search       │               │
     │               │──────────────►│               │
     │               │  employee_id  │               │
     │◄──────────────│◄──────────────│               │
     │  POST /attendance/check-in   │               │
     │──────────────────────────────────────────────►│
     │               │               │  validate +   │
     │               │               │  persist      │
     │  201 Created  │               │               │
     │◄──────────────────────────────────────────────│
```

---

## 19. Out of Scope for This Contract (Phase 1)

- WebSocket / real-time events
- Webhook callbacks
- GraphQL alternative
- OpenAPI/Swagger generated spec file (may be added later)
- Rate limiting configuration
- File upload for bulk import

---

## 20. Versioning

- URL path versioning: `/api/v1`
- Breaking changes require `/api/v2`
- Non-breaking additive changes (new optional fields) allowed in v1

---

## 21. Security and Trust Boundaries

The frontend must **not** be trusted to decide:

| Decision | Trusted owner |
|----------|---------------|
| Employee identity | Trusted recognition pipeline + backend validation |
| Attendance validity | Backend business rules |
| Attendance classification | Backend (HALF-DAY / FULL-DAY / ABSENT) |
| Payroll amount | Backend + PostgreSQL |
| Confidence/similarity validity | Trusted recognition service + backend threshold check |

PostgreSQL is the source of truth for employees, departments, shifts, attendance, leaves, overtime, payroll, and audit data. The vector database is used for identity matching only (embeddings, employee reference ID, model metadata).

---

## 22. Open Contract Decisions

1. JWT vs. session-based auth
2. Whether `/face/recognize` is public on kiosk
3. Image upload vs. client-side embedding for registration
4. Pagination and sorting standard for list endpoints
5. Webhook/event model for async payroll (**FUTURE**)
6. Exact error code enum
7. Idempotency keys for check-in/check-out
