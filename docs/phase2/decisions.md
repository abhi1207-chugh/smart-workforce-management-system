# Phase 2 Design Decisions

**Phase:** 2.1 — Database & Face Data Architecture Design  
**Status:** Design complete (no implementation)  
**Prerequisites:** Phase 1 requirements finalized

---

## 1. DECIDED

### Architecture

| Decision | Detail | Rationale |
|----------|--------|-----------|
| PostgreSQL as source of truth | All workforce, attendance, leave, overtime, payroll, audit data | Phase 1 NFR-DI-01, ACID for financial data |
| Vector DB for similarity search only | Embeddings + employee reference + model metadata | Optimized NN search; separation of concerns |
| Face pipeline identifies; backend decides | Recognition does not write attendance | BR-FACE-05, BR-FACE-03 |
| Next.js → Backend API → PostgreSQL | Frontend never writes directly to databases | Security boundary |
| Camera → Pipeline → Vector DB → Backend | Recognition path separate from business writes | system-architecture.md |

### Data Ownership

| Decision | Detail |
|----------|--------|
| Business data in PostgreSQL only | Name, salary, department, shift, attendance, payroll |
| Embeddings in Vector DB only | No face vectors in PostgreSQL |
| No business data duplication in Vector DB | employee_id reference only — no salary/name/department |
| Registration metadata in PostgreSQL | `face_registration_metadata` tracks status + `vector_record_id` |

### employee_id Mapping

| Decision | Detail |
|----------|--------|
| Canonical ID | `employee.id` (UUID) in PostgreSQL |
| Vector DB field | `employee_id` — same UUID value |
| Cross-store link | `face_registration_metadata.vector_record_id` → vector record `id` |
| Validation | Backend queries PostgreSQL before attendance write |
| Creation order | Employee in PostgreSQL before face registration |

### Entity Model

| Decision | Detail |
|----------|--------|
| `user` separate from `employee` | Admins may lack employee records |
| `attendance_session` + `employee_day_attendance` | Session state machine + daily classification for payroll |
| `shift_weekly_off` normalized table | Configurable weekly-off — not hardcoded Sunday |
| `payroll_run` + `payroll_record` | Run-level vs per-employee payroll |
| `bonus` and `deduction` as separate tables | Auditable adjustments linked to periods/runs |
| `payment` separate from `payroll_record` | Payment recording against finalized payroll |
| `payroll_policy` + `overtime_rate_config` | Configurable divisor and OT multiplier — not hardcoded |
| `leave_type` + `leave_balance` + `leave_request` | Type catalog, balances, workflow |

### Face Registration Responsibility

| Decision | Detail |
|----------|--------|
| Who registers | `ADMIN` only |
| Preconditions | Active employee in PostgreSQL |
| Pipeline steps | Detect → align/preprocess → embed → vector insert → PostgreSQL metadata |
| Re-registration | Supersede old embedding; audit log |
| Inactive employee | Registration blocked; embedding revoked |

### Recognition Responsibility

| Decision | Detail |
|----------|--------|
| Pipeline | Detect → preprocess → embed → vector search → threshold |
| Output | Candidate `employee_id` + similarity score |
| No attendance write | Pipeline and vector DB are read-only for attendance |
| Unknown face | No match → no side effects |

### Backend Validation Boundary

| Decision | Detail |
|----------|--------|
| Frontend not trusted | Identity, confidence, classification, payroll amounts |
| Backend validates | Employee exists, active, face registered, threshold, no duplicate session |
| Server timestamp | Authoritative for check-in/check-out |
| Attendance writes | Backend only, after validation |
| Recognition proof | Trusted source token/session (**format TBD**) |

### Normalization

| Decision | Detail |
|----------|--------|
| Target | 3NF for PostgreSQL entities |
| Weekly-off | Normalized to `shift_weekly_off` |
| Controlled denormalization | Payroll snapshots on `payroll_record` for immutability |

### Security

| Decision | Detail |
|----------|--------|
| Vector results are candidates | Not authoritative until backend validates |
| Client cannot fabricate confidence | BR-FACE-06 |
| Frontend no direct DB access | API-only |
| Audit append-only | `audit_log` no app-layer deletes |

---

## 2. TBD (Deferred to Later Phases)

| Item | Deferred to | Why later |
|------|-------------|-----------|
| Exact face detection model | AI / vector implementation | Model choice requires benchmarking on project camera setup |
| Exact face embedding model | AI / vector implementation | Dimension and metric depend on model |
| Embedding dimension | AI / vector implementation | Property of selected model — inventing breaks index design |
| Exact vector database product | AI / vector implementation | pgvector vs dedicated DB depends on ops preference + benchmarks |
| Similarity metric (cosine, L2, dot) | AI / vector implementation | Must match model training normalization |
| Recognition threshold value | AI / vector implementation | Requires evaluation dataset and false accept/reject trade-offs |
| Ambiguous multi-match policy (BR-FACE-07) | AI / vector implementation | Depends on threshold distribution across employees |
| Face pipeline execution location | Backend / frontend implementation | Browser vs server — performance and security trade-off |
| Recognition proof / token format | Backend implementation | Depends on auth and pipeline placement |
| Exact PostgreSQL DDL and migrations | Phase 2.2 | Design precedes migration |
| Stored functions, triggers, views | Phase 2.2+ | Implementation of designed constraints |
| Exact index definitions | Phase 2.2 | Depends on query patterns from API implementation |
| Password hash algorithm | Backend implementation | Standard practice — bcrypt/argon2 choice at impl |
| Enum vs lookup tables | Phase 2.2 | PostgreSQL DDL detail |
| Vector orphan cleanup on failed registration | Implementation | Orchestration detail |
| Embedding retention on deactivation | Implementation / policy | Privacy policy (NFR-PRIV-03) |
| Grace period for lateness (BR-ATT-29) | Configuration | HR policy value |
| Leave entitlements (BR-LEAVE-06) | Configuration | Org policy values |
| Overtime multiplier default (BR-OT-06) | Configuration | Payroll policy value |
| Working-day divisor default (BR-PAY-06) | Configuration | Payroll policy value |
| Deduction cap behavior (BR-DED-02) | Configuration | Payroll policy |
| Kiosk auth mode | Backend implementation | OPEN in user-roles.md |
| Pagination format | API implementation | Contract detail |

---

## 3. Design Trade-offs

| Trade-off | Choice | Alternative considered | Why chosen |
|-----------|--------|------------------------|------------|
| Session + daily attendance tables | Two tables | Single attendance table only | Session state machine + daily payroll classification need different grains |
| `shift_weekly_off` child table | Normalized | JSON array on `shift` | Enforces uniqueness, clearer queries, 3NF |
| Salary snapshot on payroll_record | Denormalized snapshot | Always read from employee | Payroll immutability after finalize |
| Single active embedding (MVP) | One per employee | Multiple embeddings per angle | Simpler MVP; FACE-REG-06 deferred |
| UUID primary keys | UUID | Serial integers | Distributed ID generation, API-friendly |
| Separate bonus/deduction tables | Two tables | Single adjustment table | Explicit audit per business rules |
| face_registration_metadata in PostgreSQL | Metadata table | Derive status only from vector DB | PostgreSQL remains authoritative for registration status API |
| No embedding in PostgreSQL | Vector DB only | pgvector in same DB | Clear separation; aligns with architecture diagram |

---

## 4. Phase 2.1 Completion Checklist

- [x] Major PostgreSQL entities designed
- [x] Relationships documented (ER diagram)
- [x] Primary and foreign keys identified
- [x] Important constraints documented
- [x] Preliminary relational schema produced
- [x] 3NF analysis completed
- [x] Face data lifecycle designed
- [x] Vector DB data model defined
- [x] PostgreSQL vs Vector DB ownership defined
- [x] employee_id cross-store relationship documented
- [x] Face registration flow designed
- [x] Face recognition flow designed
- [x] Security boundaries documented
- [x] Design decisions and TBD items recorded
- [x] No application code, migrations, or APIs implemented

**Phase 2.1 status: COMPLETE**

**Next phase (not started):** Phase 2.2 — PostgreSQL schema implementation (migrations, constraints, functions, triggers, views).

---

## 5. Document Index

### Database (`docs/database/`)

| Document | Content |
|----------|---------|
| [er-diagram.md](../database/er-diagram.md) | ER model and relationships |
| [relational-schema.md](../database/relational-schema.md) | Table-level schema |
| [normalization.md](../database/normalization.md) | 3NF analysis |
| [database-constraints.md](../database/database-constraints.md) | PK, FK, constraints, triggers plan |

### Face (`docs/face/`)

| Document | Content |
|----------|---------|
| [face-data-architecture.md](../face/face-data-architecture.md) | Lifecycle and ownership |
| [face-registration-flow.md](../face/face-registration-flow.md) | Registration flow |
| [face-recognition-flow.md](../face/face-recognition-flow.md) | Recognition flow |
| [vector-db-design.md](../face/vector-db-design.md) | Vector store model |

### Requirements (Phase 1 — preserved)

| Document | Content |
|----------|---------|
| [business-rules.md](../requirements/business-rules.md) | Domain rules |
| [system-architecture.md](../requirements/system-architecture.md) | Logical architecture |
| [api-contract.md](../integration/api-contract.md) | API boundaries |
