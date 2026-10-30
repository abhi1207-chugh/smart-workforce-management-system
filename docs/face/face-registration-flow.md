# Face Registration Flow

**Phase:** 2.1 — Design only  
**Related:** FACE-REG-01–05, BR-EMP-05, BR-FACE-04

---

## 1. Who Can Register

| Actor | Permission | Rationale |
|-------|------------|-----------|
| `ADMIN` | Register, re-register, revoke any employee face | user-roles.md — employees cannot register others |
| `EMPLOYEE` | **Cannot** register faces | Prevents impersonation enrollment |

Registration requires authenticated admin session (except pipeline placement **TBD** for embedding generation location).

---

## 2. Preconditions

| Check | Store | Failure action |
|-------|-------|----------------|
| Employee exists | PostgreSQL | Reject — 404 |
| Employee `status = ACTIVE` | PostgreSQL | Reject — BR-EMP-05 |
| Admin authorized | Backend | Reject — 403 |
| Camera/face detectable | Pipeline | Retry UI message |

---

## 3. Registration Flow (Step-by-Step)

```
┌─────────┐   ┌──────────┐   ┌─────────────┐   ┌──────────┐   ┌────────────┐
│ Admin   │   │ Frontend │   │ Face        │   │ Vector   │   │ Backend    │
│ UI      │   │          │   │ Pipeline    │   │ DB       │   │ API        │
└────┬────┘   └────┬─────┘   └──────┬──────┘   └────┬─────┘   └─────┬──────┘
     │ Select      │               │               │               │
     │ employee    │               │               │               │
     │────────────►│ GET employee  │               │               │
     │             │──────────────────────────────────────────────►│
     │             │               │               │  verify ACTIVE│
     │             │◄──────────────────────────────────────────────│
     │ Start       │               │               │               │
     │ registration│               │               │               │
     │────────────►│ Capture frame │               │               │
     │             │──────────────►│ Detect face   │               │
     │             │               │               │               │
     │             │  [no face]    │               │               │
     │             │◄──────────────│ FAIL          │               │
     │             │ Show error    │               │               │
     │             │               │               │               │
     │             │  [face found] │               │               │
     │             │──────────────►│ Align/preproc │               │
     │             │──────────────►│ Generate      │               │
     │             │               │ embedding     │               │
     │             │──────────────►│               │               │
     │             │               │ INSERT vector │               │
     │             │               │──────────────►│               │
     │             │               │ vector_record │               │
     │             │               │ _id           │               │
     │             │               │◄──────────────│               │
     │             │ POST register │               │               │
     │             │ metadata      │               │               │
     │             │──────────────────────────────────────────────►│
     │             │               │               │  TX: upsert   │
     │             │               │               │  face_reg_   │
     │             │               │               │  metadata    │
     │             │               │               │  audit log   │
     │             │◄──────────────────────────────────────────────│
     │ Success     │               │               │               │
     │◄────────────│               │               │               │
```

---

## 4. employee_id Association

| Step | Action |
|------|--------|
| 1 | Admin selects employee from PostgreSQL-backed list |
| 2 | Backend confirms `employee.id` before registration UI proceeds |
| 3 | Vector DB record stores **same** `employee_id` UUID |
| 4 | PostgreSQL `face_registration_metadata.employee_id` links to `employee.id` |
| 5 | PostgreSQL stores `vector_record_id` for cross-reference |

The embedding is never associated with a client-supplied ID without server-side employee validation.

---

## 5. Re-Registration (Replace Face)

**Requirement:** FACE-REG-05, admin can re-register.

| Step | Action |
|------|--------|
| 1 | Admin initiates re-registration for employee with existing face |
| 2 | New embedding generated and inserted in vector DB |
| 3 | Old vector record: status → `SUPERSEDED` or deleted (**exact policy TBD**) |
| 4 | PostgreSQL: previous `face_registration_metadata` → `SUPERSEDED` |
| 5 | New `face_registration_metadata` row or update with new `vector_record_id`, `status = ACTIVE` |
| 6 | Audit log: face re-registration (BR-AUDIT-03) |

**MVP constraint:** One `ACTIVE` registration per employee (unique constraint on `employee_id` where active).

---

## 6. Registration Failure Handling

| Failure point | PostgreSQL | Vector DB | User feedback |
|---------------|------------|-----------|---------------|
| No face in frame | No change | No insert | "No face detected" |
| Multiple faces | No change | No insert | "Single face required" |
| Embedding generation error | No change | No insert | Technical error message |
| Vector DB insert fails | No metadata write | Rollback / no orphan | "Registration failed" |
| PostgreSQL metadata fails after vector insert | No metadata | Orphan vector — **cleanup job TBD** | "Registration incomplete" |
| Employee deactivated mid-flow | Reject | Do not insert | "Employee inactive" |

**Design intent:** Prefer vector insert **before** PostgreSQL metadata with compensating delete on failure, OR backend-coordinated two-phase commit — **exact orchestration TBD** at implementation.

---

## 7. Employee Becomes Inactive

| Action | Detail |
|--------|--------|
| PostgreSQL | `employee.status = INACTIVE` |
| Registration blocked | New registration rejected (BR-EMP-03, BR-EMP-05) |
| Existing embedding | Mark `REVOKED` in PostgreSQL metadata |
| Vector DB | Exclude from search filter OR delete embedding (**retention TBD**) |
| Recognition | Even if vector match occurs, backend rejects attendance |
| Audit | Employee deactivation logged (BR-AUDIT-03) |

---

## 8. Registration Status Query

Admin views registration status via:

- PostgreSQL `face_registration_metadata` (primary for `face_registered` flag)
- Optional vector DB health check for `vector_record_id` existence

Sync mechanism between stores — **TBD** at implementation (api-contract notes `face_registered` derivation OPEN).

---

## 9. What Is NOT Stored

| Item | Where NOT stored |
|------|------------------|
| Raw camera frames | Persistent storage disabled by default (NFR-SEC-05) |
| Embeddings | PostgreSQL |
| Employee name on vector record | Vector DB (only `employee_id`) |

---

## 10. Related Documents

- [face-data-architecture.md](./face-data-architecture.md)
- [vector-db-design.md](./vector-db-design.md)
- [../integration/api-contract.md](../integration/api-contract.md) — §7 Face Registration Endpoints
