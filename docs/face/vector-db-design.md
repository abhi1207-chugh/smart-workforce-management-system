# Vector Database Design

**Phase:** 2.1 — Design only  
**Product selection:** **TBD** (standalone vector DB vs. PostgreSQL extension)

This document defines the **conceptual data model** for face embedding storage and similarity search. No product-specific DDL is written in Phase 2.1.

---

## 1. Purpose

The vector database optimizes nearest-neighbor search over face embeddings. It supports **identity matching only** — not business logic or workforce financial data.

---

## 2. Collection / Index (Conceptual)

| Aspect | Design value |
|--------|--------------|
| **Collection name** | `employee_face_embeddings` (conceptual — exact name TBD per product) |
| **Scope** | Single organization (MVP single-tenant) |
| **Partitioning** | By `model_name` + `model_version` if multiple models coexist (**TBD**) |

---

## 3. Record Schema (Conceptual)

Each record represents one face embedding for one employee.

| Field | Type (conceptual) | Required | Description |
|-------|-------------------|----------|-------------|
| `id` | string / UUID | Yes | Vector record primary identifier — stored as `vector_record_id` in PostgreSQL |
| `employee_id` | UUID | Yes | Reference to PostgreSQL `employee.id` — **not a FK enforceable across stores** |
| `embedding` | float vector | Yes | Face embedding; **dimension TBD** (depends on model) |
| `model_name` | string | Yes | e.g. model family identifier |
| `model_version` | string | Yes | Specific model version string |
| `embedding_version` | string | Yes | Pipeline/version for preprocessing + embedding |
| `status` | enum | Yes | `ACTIVE`, `SUPERSEDED`, `REVOKED` |
| `similarity_metric` | string | Yes | Metric used at query time — **value TBD** with model |
| `created_at` | timestamp | Yes | Record creation time |
| `updated_at` | timestamp | Yes | Last status change |

### Metadata (vector-related only)

| Field | Description |
|-------|-------------|
| `registered_by` | Optional admin user ID (UUID) — audit helper, not business data |
| `source` | `REGISTRATION` — origin of embedding |
| `quality_score` | Optional face quality metric from pipeline (**TBD**) |

### Explicitly excluded fields

Do **not** store in vector DB:

- `first_name`, `last_name`, `email`, `phone`
- `department_id`, `department_name`
- `shift_id`, `salary`, `monthly_base_salary`
- `attendance`, `leave`, `payroll` data

---

## 4. Embedding Vector

| Aspect | Status |
|--------|--------|
| **Dimension** | **TBD** — determined when embedding model is selected |
| **Type** | Array of floats |
| **Normalization** | Depends on model + similarity metric (**TBD**) |
| **Storage** | Native vector type in chosen product |

**Why TBD:** Dimension is a property of the model (e.g., 128, 512, 768). Inventing a dimension before model selection would misdesign indexes.

---

## 5. employee_id Relationship

```
PostgreSQL                          Vector DB
┌─────────────────┐                ┌─────────────────────────┐
│ employee        │                │ employee_face_embeddings  │
│ id (PK)         │◄───────────────│ employee_id (reference) │
│ status          │   same UUID    │ embedding               │
│ ...business...  │                │ status, model metadata  │
└─────────────────┘                └─────────────────────────┘
         ▲
         │ backend validates before attendance
         │
┌─────────────────┐
│ face_registration│
│ _metadata        │
│ vector_record_id │──────────────► id in vector DB
└─────────────────┘
```

| Rule | Detail |
|------|--------|
| Canonical employee | PostgreSQL `employee.id` |
| Vector reference | `employee_id` on embedding record |
| Link in PostgreSQL | `face_registration_metadata.vector_record_id` → vector `id` |
| Search filter | Only `status = ACTIVE` embeddings |
| Inactive employee | Embeddings excluded or `REVOKED` |

---

## 6. Similarity Search Design

| Parameter | Value |
|-----------|-------|
| **Query input** | Embedding vector from live frame |
| **Search type** | Approximate nearest neighbor (ANN) for scale (**exact algorithm TBD**) |
| **Top-K** | **TBD** (design default: K=3 for ambiguous detection) |
| **Similarity metric** | **TBD** (cosine, Euclidean, dot product — model-dependent) |
| **Threshold** | **TBD** (configured after model evaluation) |
| **Output** | Ranked list: `{ id, employee_id, similarity_score }` |

### Threshold decision (conceptual)

```
if best_score >= configured_threshold:
    return candidate employee_id
else:
    return no_match
```

Threshold is **not** invented in Phase 2.1 — requires model benchmark on project dataset.

---

## 7. Status Lifecycle

| Status | Searchable | Meaning |
|--------|------------|---------|
| `ACTIVE` | Yes | Current embedding for employee |
| `SUPERSEDED` | No | Replaced by newer registration |
| `REVOKED` | No | Employee deactivated or admin revoked |

---

## 8. Operations

| Operation | Caller | Notes |
|-----------|--------|-------|
| **Insert** | Registration flow (admin) | After PostgreSQL employee validation |
| **Update status** | Backend on re-registration / deactivation | Supersede or revoke old records |
| **Delete** | Admin revoke / deactivation policy | **Retention policy TBD** |
| **Search** | Recognition pipeline | Read-only candidate retrieval |
| **Get by employee_id** | Backend status check | Verify active embedding exists |

Vector DB has **no** attendance or payroll write operations.

---

## 9. PostgreSQL vs Vector DB — Complete Ownership

| Information | PostgreSQL | Vector DB |
|-------------|------------|-------------|
| Employee name, email, phone | ✓ | ✗ |
| Department, shift, salary | ✓ | ✗ |
| Employment status | ✓ | ✗ |
| Attendance sessions | ✓ | ✗ |
| Leave, overtime, payroll | ✓ | ✗ |
| Audit logs | ✓ | ✗ |
| Face embedding vector | ✗ | ✓ |
| employee_id (reference) | ✓ (canonical) | ✓ (reference copy) |
| Model name, version | ✓ (metadata table) | ✓ (search metadata) |
| Registration status | ✓ | ✗ (status on vector record only) |
| vector_record_id link | ✓ | ✓ (record id) |

---

## 10. Product Selection Criteria (For Later Phase)

When choosing vector DB product, evaluate:

| Criterion | Relevance |
|-----------|-----------|
| Embedding dimension support | Must support TBD dimension |
| Similarity metrics | Cosine / L2 / inner product |
| Filtered search (`status = ACTIVE`) | Required |
| MVP demo scale (~50–100 employees) | Low latency sub-second |
| Integration with face pipeline | Person B ownership |
| PostgreSQL extension option | pgvector — reduces infra complexity |

**Decision deferred** to AI/vector architecture implementation phase.

---

## 11. Related Documents

- [face-data-architecture.md](./face-data-architecture.md)
- [face-registration-flow.md](./face-registration-flow.md)
- [face-recognition-flow.md](./face-recognition-flow.md)
- [../database/relational-schema.md](../database/relational-schema.md) — `face_registration_metadata`
- [../phase2/decisions.md](../phase2/decisions.md)
