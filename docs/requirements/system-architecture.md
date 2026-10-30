# System Architecture

This document describes the **logical architecture** for the Smart Workforce Attendance & Payroll Management System. It explains component boundaries, data flows, and rationale. Implementation details and product selections marked **OPEN** are intentionally deferred.

---

## 1. Architectural Principles

| Principle | Description |
|-----------|-------------|
| **Single source of truth** | PostgreSQL owns all structured workforce and financial data |
| **Separation of identification and business logic** | Face recognition identifies; backend decides attendance and payroll outcomes |
| **Modularity** | Frontend, backend, PostgreSQL, and vector DB are loosely coupled via APIs |
| **Defense in depth** | AuthN/AuthZ at API layer; database constraints for financial invariants |
| **Beyond CRUD** | Business rules live in backend logic and PostgreSQL (functions, triggers, views) |

---

## 2. High-Level Component Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     Next.js Frontend                             │
│  Admin portal · Employee portal · Camera UI · Reports            │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS / REST (or equivalent)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Backend / API                                │
│  Authentication · Authorization · Business logic orchestration   │
│  Attendance · Leave · Overtime · Payroll · Audit                 │
└──────────────┬─────────────────────────────┬───────────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────┐    ┌──────────────────────────────────┐
│       PostgreSQL         │    │       Vector Database            │
│  Employees · Departments │    │  Face embeddings                 │
│  Shifts · Attendance     │    │  Employee ID references          │
│  Leave · Overtime        │    │  Similarity search index         │
│  Payroll · Payments      │    └──────────────────────────────────┘
│  Audit logs              │                  ▲
│  Functions · Triggers    │                  │
│  Views · Indexes         │    ┌─────────────┴────────────────────┐
└──────────────────────────┘    │   Face Recognition Pipeline      │
                                │  (invoked from frontend or API)    │
┌──────────────────────────┐    │  Detect → Embed → Search → ID    │
│        Camera            │───►└──────────────────────────────────┘
└──────────────────────────┘
```

---

## 3. Component Descriptions

### 3.1 Next.js Frontend

**Why it exists:** Provides role-based UI for admins and employees, including camera access for face registration and check-in/out.

**Responsibilities:**
- Render dashboards, forms, and reports
- Capture camera frames for face flows
- Call backend APIs for all business operations
- Invoke face pipeline (detection/embedding/search) per agreed integration pattern

**Does NOT:**
- Enforce authorization (backend does)
- Calculate payroll
- Store authoritative attendance or financial records

---

### 3.2 Backend / API

**Why it exists:** Central orchestrator and security boundary. Owns all business rules that affect workforce and financial outcomes.

**Responsibilities:**
- Authentication and authorization
- CRUD orchestration for PostgreSQL entities
- Attendance state machine (check-in/out validation)
- Leave approval workflow
- Overtime approval and payroll inclusion
- Payroll run execution (with DB transactions)
- Payment recording
- Audit log emission
- Validation of recognition results before persisting attendance

**Does NOT:**
- Store face embeddings (vector DB does)
- Perform similarity search (vector DB / recognition pipeline does)

**Technology:** **OPEN** (language and framework not specified)

---

### 3.3 PostgreSQL

**Why it exists:** ACID-compliant relational store for workforce and payroll — the system's source of truth.

**Responsibilities:**
- Persist all structured entities and relationships
- Enforce referential integrity and domain constraints
- Execute stored functions for calculations
- Fire triggers for audit and invariant enforcement
- Expose views for reporting
- Provide indexed access paths for common queries

**Person A ownership:** Schema, migrations, functions, triggers, views, indexes, and backend data access.

---

### 3.4 Vector Database

**Why it exists:** Optimized for high-dimensional similarity search over face embeddings — a workload ill-suited to traditional relational indexes alone.

**Responsibilities:**
- Store face embedding vectors keyed by employee reference ID
- Store embedding/model metadata and relevant vector-search metadata
- Support nearest-neighbor / similarity search
- Return candidate employee ID(s) and confidence/similarity scores

**Does NOT:**
- Store payroll, attendance, or leave records
- Store salary, employee name, department, or other business data duplicated from PostgreSQL
- Decide attendance outcomes, classification, or payroll amounts

**Product choice:** **OPEN** (e.g., dedicated vector DB vs. PostgreSQL extension — decision required)

---

### 3.5 Face Recognition Pipeline

**Why it exists:** Converts camera input into a stable employee identity signal for attendance capture.

**Pipeline stages:**

```
Camera frame
    → Face Detection (locate face in frame)
    → Face Embedding (generate vector representation)
    → Similarity Search (query vector DB)
    → Employee ID (candidate match)
    → Backend validation & attendance action
```

**Person B ownership:** Detection, embedding, vector DB integration, camera UI.

**Library/model choice:** **OPEN**

---

## 4. Primary Data Flows

### 4.1 Admin: Register Employee Face

```
Admin UI → Backend: verify employee exists (PostgreSQL)
Admin UI → Camera: capture frame
Face pipeline → embedding → Vector DB: store (employee_id, embedding)
Admin UI → Backend: confirm registration status (PostgreSQL metadata flag — TBD)
```

### 4.2 Employee: Check-In via Face

```
Camera → Face Detection → Face Embedding → Vector DB: similarity search
       → candidate employee_id + confidence score
Frontend/Service → Backend: POST attendance check-in { employee_id, recognition metadata, ... }
Backend: validate employee exists, employee active, trusted recognition source,
         confidence meets threshold, no duplicate open session
Backend: record check-in using server timestamp as authoritative time
Backend → PostgreSQL: insert attendance record (transaction)
Backend → Audit log (if applicable)
```

**Critical:** Attendance is written only after backend validation — not at recognition time. The frontend must not be trusted for employee identity, confidence validity, attendance classification, or payroll outcomes.

### 4.3 Payroll Run

```
Admin UI → Backend: initiate payroll { period_start, period_end }
Backend → PostgreSQL: gather attendance, leave, overtime, bonuses, deductions
Backend → PostgreSQL: stored function(s) compute amounts
Backend → PostgreSQL: finalize payroll records (single transaction)
Backend → Audit log
```

### 4.4 Employee: View Own Payroll

```
Employee UI → Backend: GET own payroll (auth token)
Backend: authorize EMPLOYEE role, scope to own employee_id
Backend → PostgreSQL: query via view or filtered query
```

---

## 5. Integration Boundaries

| Boundary | Contract | Owner |
|----------|----------|-------|
| Frontend ↔ Backend | REST API ([api-contract.md](../integration/api-contract.md)) | Both |
| Backend ↔ PostgreSQL | SQL / data access layer | Person A |
| Face pipeline ↔ Vector DB | Insert/search embeddings | Person B |
| Recognition result ↔ Backend | Employee ID + confidence score | Both |

---

## 6. Security Architecture (Logical)

```
┌─────────────┐     JWT/Session (OPEN)     ┌─────────────┐
│   Client    │ ◄────────────────────────► │   Backend   │
└─────────────┘                            └──────┬──────┘
                                                  │
                     Role check (ADMIN/EMPLOYEE)  │
                     Resource scope check         │
                     Business rule enforcement     │
                     Trusted recognition validation│
                                                  ▼
                                           PostgreSQL / Vector DB
```

- All sensitive operations require authenticated requests.
- Biometric flow may operate on a kiosk; backend still validates employee eligibility.
- The client must **not** be trusted to decide: employee identity, attendance validity, payroll amount, attendance classification, or confidence validity.
- The face recognition service produces confidence/similarity scores; the backend validates them from a trusted source before accepting attendance.

---

## 7. Team Ownership Map

| Component | Primary Owner | Shared |
|-----------|---------------|--------|
| PostgreSQL schema & DB logic | Person A | — |
| Backend/API | Person A | Auth, testing |
| Attendance/leave/overtime/payroll logic | Person A | — |
| Face detection & embeddings | Person B | — |
| Vector DB integration | Person B | — |
| Next.js frontend | Person B | — |
| API contract | — | Both |
| AuthN / AuthZ | — | Both |
| Documentation | — | Both |
| Git/GitHub workflow | — | Both |

---

## 8. What Makes This Beyond Simple CRUD

| Area | CRUD Only | This System |
|------|-----------|-------------|
| Attendance | Insert rows | Session state machine, shift evaluation, recognition validation |
| Leave | Store requests | Balance tracking, approval workflow, payroll interaction |
| Payroll | List salaries | Period-based calculation from multiple inputs, transactional runs, immutability |
| Face | N/A | Embedding storage, similarity search, threshold-based matching |
| Governance | N/A | Audit logs, role separation, append-only audit trail |

---

## 9. Open Architectural Decisions

Detailed **DECIDED** vs **TBD** tracking lives in [phase2/decisions.md](../phase2/decisions.md).

Phase 2.1 database and face data design documents:

| Area | Documents |
|------|-----------|
| PostgreSQL schema | [database/relational-schema.md](../database/relational-schema.md), [database/er-diagram.md](../database/er-diagram.md) |
| Constraints & 3NF | [database/database-constraints.md](../database/database-constraints.md), [database/normalization.md](../database/normalization.md) |
| Face & vector store | [face/face-data-architecture.md](../face/face-data-architecture.md), [face/vector-db-design.md](../face/vector-db-design.md) |

Remaining open items (summary):

1. **Vector database product** — standalone vs. PostgreSQL extension
2. **Backend language/framework**
3. **Face model and embedding dimensions**
4. **Where face pipeline executes** — browser, backend service, or hybrid
5. **Authentication mechanism** — JWT vs. session cookies
6. **Recognition threshold and similarity metric** — after model evaluation
7. **Deployment topology** — single VM vs. containerized services (academic demo)

These must be resolved in implementation phases before production deployment.
