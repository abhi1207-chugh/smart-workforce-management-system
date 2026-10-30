# Face Data Architecture

**Phase:** 2.1 — Design only  
**Scope:** Face data lifecycle across PostgreSQL and Vector DB

This document preserves Phase 1 boundaries: recognition identifies; backend decides business outcomes.

---

## 1. Purpose

Define how face biometric data flows through the system without storing embeddings in PostgreSQL or duplicating business data in the vector store.

---

## 2. Data Ownership Summary

| Data | Owner Store | Examples |
|------|-------------|----------|
| Employee identity, salary, department, shift | **PostgreSQL** | `employee`, `department`, `shift` |
| Attendance, leave, overtime, payroll | **PostgreSQL** | All business tables |
| Face embedding vector | **Vector DB** | High-dimensional float array |
| Employee reference for matching | **Vector DB** | `employee_id` (UUID matching PostgreSQL) |
| Model/version metadata | **Vector DB** + **PostgreSQL** | Vector DB: search metadata; PostgreSQL: registration status |
| Registration audit | **PostgreSQL** | `face_registration_metadata`, `audit_log` |

**Never in Vector DB:** name, phone, email, salary, department, shift, attendance, payroll.

---

## 3. Face Data Lifecycle

### 3.1 Registration Lifecycle

```
Employee (PostgreSQL, ACTIVE)
        ↓
Admin initiates registration (role: ADMIN)
        ↓
Camera capture
        ↓
Face Detection
        ↓
Face Alignment / Preprocessing
        ↓
Face Embedding generation
        ↓
Vector DB: insert embedding + employee_id + metadata
        ↓
PostgreSQL: upsert face_registration_metadata
        (vector_record_id, model_name, status=ACTIVE)
        ↓
Audit log entry (BR-AUDIT-03)
```

### 3.2 Recognition Lifecycle

```
Camera capture
        ↓
Face Detection
        ↓
Preprocessing / Alignment
        ↓
Embedding generation (same model as registration)
        ↓
Vector similarity search (top-K)
        ↓
Candidate employee_id + similarity score
        ↓
Threshold decision (value TBD)
        ↓
Backend API: validate employee + recognition proof
        ↓
Attendance business rules
        ↓
PostgreSQL: attendance_session write
```

### 3.3 Deactivation Lifecycle

```
Employee status → INACTIVE (PostgreSQL)
        ↓
Backend rejects new attendance (BR-EMP-03)
        ↓
Vector DB: embedding status → REVOKED or excluded from search
        ↓
PostgreSQL: face_registration_metadata.status → REVOKED
        ↓
Audit log
```

Embedding removal from vector DB on deactivation — **retention policy TBD** (NFR-PRIV-03).

---

## 4. employee_id as Cross-Store Key

| Aspect | Design |
|--------|--------|
| **Canonical ID** | `employee.id` (UUID) in PostgreSQL |
| **Vector DB reference** | Same UUID as `employee_id` field on embedding record |
| **Validation** | Backend queries PostgreSQL before accepting recognition for attendance |
| **Creation order** | Employee must exist in PostgreSQL before face registration (BR-EMP-05) |
| **Deletion** | Employee deactivation does not delete history; vector embedding revoked or removed per policy |

```
Vector DB face record
        ↓ employee_id (UUID)
PostgreSQL employee record
        ↓ validate status = ACTIVE
Attendance write permitted
```

---

## 5. Component Responsibilities

| Component | Face-related responsibility |
|-----------|----------------------------|
| **Next.js Frontend** | Camera UI, frame capture, invoke pipeline, call backend APIs |
| **Face Pipeline** | Detection, alignment, embedding, vector search |
| **Vector DB** | Store/query embeddings |
| **Backend API** | Authorize registration, validate recognition, persist attendance |
| **PostgreSQL** | Employee truth, registration metadata, attendance records |

---

## 6. Security Principles

| Principle | Detail |
|-----------|--------|
| Frontend not trusted for identity | Client cannot assert employee_id without trusted recognition path |
| Frontend not trusted for confidence | Client cannot fabricate passing similarity scores (BR-FACE-06) |
| Frontend no direct PostgreSQL access | All writes via backend API |
| Vector results are candidates | Not authoritative until backend validates |
| Attendance writes only via backend | Recognition pipeline never inserts attendance rows |

See [face-recognition-flow.md](./face-recognition-flow.md) and [../requirements/business-rules.md](../requirements/business-rules.md) §10.

---

## 7. Failure Modes

| Failure | System behavior |
|---------|-----------------|
| No face detected | No vector search; no attendance side effects |
| Below threshold | No match returned; no attendance |
| Employee inactive | Backend rejects after vector match |
| Vector DB unavailable | Registration/recognition fail; manual attendance available (NFR-AVAIL-01) |
| PostgreSQL unavailable | All operations fail |
| Registration fails mid-flow | No PostgreSQL metadata update; vector insert rolled back or orphan cleaned |

---

## 8. Related Documents

- [face-registration-flow.md](./face-registration-flow.md)
- [face-recognition-flow.md](./face-recognition-flow.md)
- [vector-db-design.md](./vector-db-design.md)
- [../database/relational-schema.md](../database/relational-schema.md) — `face_registration_metadata`
- [../phase2/decisions.md](../phase2/decisions.md)
