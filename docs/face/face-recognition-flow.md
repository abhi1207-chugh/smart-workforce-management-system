# Face Recognition Flow

**Phase:** 2.1 — Design only  
**Related:** FACE-REC-01–05, BR-FACE-01–07, BR-ATT-01–07

Recognition **identifies** an employee. It does **not** record attendance.

---

## 1. Flow Overview

```
Camera
  ↓
Face Detection
  ↓
Face Alignment / Preprocessing
  ↓
Embedding Generation
  ↓
Vector Similarity Search (top-K)
  ↓
Similarity Score(s)
  ↓
Threshold Decision
  ↓
Candidate employee_id (or no match)
  ↓
Backend API Validation
  ↓
Attendance Business Rules
  ↓
PostgreSQL attendance_session
```

---

## 2. Detailed Step Design

### Step 1 — Input

| Aspect | Design |
|--------|--------|
| Source | Browser camera (MVP) |
| Format | Frame / image buffer (**exact format TBD**) |
| Trigger | User at kiosk or check-in UI |
| Storage | Not persisted by default (NFR-SEC-05) |

### Step 2 — Face Detection

| Aspect | Design |
|--------|--------|
| Output | Face bounding box(es) in frame |
| No face | Return `no_face_detected`; no vector search |
| Multiple faces | Policy: reject or use largest face (**TBD**) |
| Model | **TBD** — selected in AI architecture phase |

### Step 3 — Preprocessing / Alignment

| Aspect | Design |
|--------|--------|
| Purpose | Normalize face for consistent embeddings |
| Steps | Crop, resize, normalize — **exact pipeline TBD** |
| Consistency | Must match registration preprocessing |

### Step 4 — Embedding Generation

| Aspect | Design |
|--------|--------|
| Input | Aligned face image/tensor |
| Output | Float vector (dimension **TBD**) |
| Model | Must match registration model/version |
| Output metadata | `model_name`, `model_version`, `embedding_version` |

### Step 5 — Vector Search

| Aspect | Design |
|--------|--------|
| Query | Generated embedding vector |
| Scope | Only embeddings with `status = ACTIVE` |
| Method | Top-K nearest neighbors (**K TBD**, typically 1–5) |
| Metric | **TBD** (cosine similarity, L2, inner product — depends on model + vector DB) |
| Output | List of `{ employee_id, similarity_score, vector_record_id }` |

### Step 6 — Top-K Candidate Retrieval

| Rank | Field | Use |
|------|-------|-----|
| 1 | `employee_id` | Primary candidate |
| 1 | `similarity_score` | Threshold comparison |
| 2..K | Additional candidates | Ambiguous match detection (BR-FACE-07) |

**Ambiguous match policy:** **TBD** — highest score wins vs. reject if second candidate within margin.

### Step 7 — Threshold Decision

| Condition | Result |
|-----------|--------|
| `similarity_score >= threshold` | Candidate match |
| `similarity_score < threshold` | No match |
| No candidates | No match |

**Threshold value:** **TBD** — depends on model evaluation (BR-FACE-01).

Below threshold → **no attendance side effects** (BR-FACE-02).

### Step 8 — Unknown Face

| Aspect | Behavior |
|--------|----------|
| UI | "Face not recognized" |
| Attendance | Not recorded |
| Vector DB | No write |
| PostgreSQL | No write |
| Logging | Optional security log (**TBD**) |

### Step 9 — employee_id Output

| Aspect | Design |
|--------|--------|
| Format | UUID matching PostgreSQL `employee.id` |
| Delivery | Recognition service response to frontend/caller |
| Trust level | **Candidate only** — not authoritative |

Example recognition response (matches api-contract):

```json
{
  "matched": true,
  "employee_id": "uuid",
  "confidence": 0.92,
  "threshold": 0.85
}
```

`confidence` produced by recognition service — not client-supplied.

### Step 10 — Backend Validation

Before attendance write, backend validates:

| Check | Source | Failure |
|-------|--------|---------|
| `employee_id` exists | PostgreSQL | 404 |
| Employee `ACTIVE` | PostgreSQL | 403 / business error |
| Face registered | PostgreSQL `face_registration_metadata` | Reject |
| Recognition proof valid | Trusted token/session from recognition service | 400 |
| Confidence meets threshold | Re-validate against configured threshold | 400 |
| No duplicate open session | PostgreSQL `attendance_session` | 409 |
| Recognition source trusted | Service auth / signed token (**TBD**) | 403 |

### Step 11 — Attendance Service

| Action | Detail |
|--------|--------|
| Check-in | Insert `attendance_session` with server `check_in_at` |
| Check-out | Update session with server `check_out_at`, compute duration, classify day |
| Source | `FACE_RECOGNITION` |
| Classification | HALF-DAY / FULL-DAY on completed session (BR-ATT-13–16) |

Attendance is written **only** by backend after validation — never by recognition pipeline.

---

## 3. Check-In Integration Sequence

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐
│ Camera   │  │ Pipeline │  │ Vector   │  │ Frontend │  │ Backend    │
└────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘
     │ frame       │             │             │              │
     │────────────►│ detect      │             │              │
     │────────────►│ embed       │             │              │
     │             │────────────►│ search      │              │
     │             │◄────────────│ candidates  │              │
     │             │ threshold   │             │              │
     │             │────────────►│             │              │
     │             │  match/no   │             │              │
     │             │────────────►│             │              │
     │             │             │ POST check-in│              │
     │             │             │─────────────►│              │
     │             │             │              │ validate +  │
     │             │             │              │ INSERT session│
     │             │             │◄─────────────│              │
```

---

## 4. Security Summary

| Risk | Mitigation |
|------|------------|
| Client spoofing employee_id | Backend requires trusted recognition proof |
| Client spoofing confidence | Backend re-validates threshold; ignores untrusted scores |
| Direct DB access from frontend | All writes via backend API |
| Vector match on inactive employee | Backend status check |
| Recognition without attendance rules | Pipeline has no attendance write permission |

---

## 5. Recognition vs Authentication

| | Face Recognition | Login Authentication |
|--|------------------|----------------------|
| Purpose | Which employee? | Which user account? |
| Used for | Check-in/out biometric ID | Admin portal, API auth |
| Kiosk | May work without login | Optional for kiosk (**TBD**) |

---

## 6. Related Documents

- [face-data-architecture.md](./face-data-architecture.md)
- [vector-db-design.md](./vector-db-design.md)
- [../integration/api-contract.md](../integration/api-contract.md) — §8, §9, §18
- [../requirements/business-rules.md](../requirements/business-rules.md) — §4, §10
