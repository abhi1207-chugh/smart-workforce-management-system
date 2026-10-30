# Business Rules

Business rules define **domain logic** that the backend and PostgreSQL must enforce. They go beyond CRUD by encoding workforce policies as invariant conditions and calculations.

Rules are labeled **REQ** (MVP) or **FUTURE** (deferred). Values marked **TBD** belong to later technical design phases (see §11) — not unresolved business-rule ambiguity.

---

## 1. Employee Rules

| ID | Rule | Priority |
|----|------|----------|
| BR-EMP-01 | **REQ** — An employee must belong to exactly one department at a time | MVP |
| BR-EMP-02 | **REQ** — An employee must be assigned exactly one primary shift at a time | MVP |
| BR-EMP-03 | **REQ** — Deactivated employees cannot check in, accrue new leave, or appear in new payroll runs | MVP |
| BR-EMP-04 | **REQ** — Employee must have a unique employee code or identifier within the organization | MVP |
| BR-EMP-05 | **REQ** — Face registration requires an active employee record in PostgreSQL | MVP |
| BR-EMP-06 | **REQ** — Employee base salary is stored as a monthly/base salary amount used for payroll calculation | MVP |

---

## 2. Shift Rules

| ID | Rule | Priority |
|----|------|----------|
| BR-SHIFT-01 | **REQ** — Each shift defines scheduled start time, scheduled end time, and scheduled shift duration (derived from start/end or configured explicitly) | MVP |
| BR-SHIFT-02 | **REQ** — Shift scheduled duration is the basis for overtime derivation — not a hardcoded system-wide hour value | MVP |
| BR-SHIFT-03 | **REQ** — Weekly-off days are configurable per shift (or per organization policy linked to shift); the system must not hardcode Sunday as the only weekly-off day | MVP |
| BR-SHIFT-04 | **REQ** — Late arrival and early checkout are evaluated by comparing actual check-in/check-out timestamps against the employee's assigned shift schedule | MVP |
| BR-SHIFT-05 | **FUTURE** — Rotating or weekly shift patterns | Deferred |

---

## 3. Attendance Rules

### 3.1 Check-In

| ID | Rule | Priority |
|----|------|----------|
| BR-ATT-01 | **REQ** — Check-in is recorded when an employee is recognized through the face recognition pipeline and the backend accepts the attendance request | MVP |
| BR-ATT-02 | **REQ** — The recognition pipeline returns a candidate `employee_id` and confidence/similarity score; the backend validates before persisting attendance | MVP |
| BR-ATT-03 | **REQ** — Backend validates `employee_id` exists, employee is active, face is registered, and recognition meets configured threshold from a trusted source | MVP |
| BR-ATT-04 | **REQ** — The backend/server timestamp is the authoritative attendance check-in timestamp; client-provided timestamps must not be trusted as the sole source of truth | MVP |
| BR-ATT-05 | **REQ** — A check-in creates an attendance session with a check-in timestamp | MVP |
| BR-ATT-06 | **REQ** — Duplicate check-ins for the same working period must be prevented (an employee cannot have more than one open attendance session at a time) | MVP |
| BR-ATT-07 | **REQ** — Duplicate check-in attempts for an already-open session are rejected | MVP |

### 3.2 Check-Out

| ID | Rule | Priority |
|----|------|----------|
| BR-ATT-08 | **REQ** — Check-out is recorded separately from check-in; the check-out timestamp is stored on the attendance session | MVP |
| BR-ATT-09 | **REQ** — Working duration for a session is calculated from valid check-in and check-out timestamps | MVP |
| BR-ATT-10 | **REQ** — An employee cannot check out without a valid check-in on the same attendance session | MVP |
| BR-ATT-11 | **REQ** — Multiple checkout records for the same attendance session must be prevented | MVP |
| BR-ATT-12 | **REQ** — The backend/server timestamp is the authoritative check-out timestamp when recording via the attendance API | MVP |

### 3.3 Attendance Classification — Half-Day and Full-Day

Classification is derived from **actual working duration** (check-out minus check-in) for a completed attendance session on a scheduled working day.

| ID | Rule | Priority |
|----|------|----------|
| BR-ATT-13 | **REQ** — **HALF-DAY** — If total working duration is **less than 4 hours**, the attendance day is classified as `HALF-DAY` | MVP |
| BR-ATT-14 | **REQ** — **HALF-DAY** — Employee earns **50%** of the normal one-day salary for that attendance day | MVP |
| BR-ATT-15 | **REQ** — **FULL-DAY** — If total working duration is **4 hours or more**, the attendance day is classified as `FULL-DAY` | MVP |
| BR-ATT-16 | **REQ** — **FULL-DAY** — Employee earns the normal one-day salary for that attendance day | MVP |
| BR-ATT-17 | **REQ** — The normal working-day / shift duration used for lateness, expected hours, and overtime comparison comes from the employee's **assigned shift** — not hardcoded system-wide | MVP |
| BR-ATT-18 | **REQ** — The 4-hour half-day threshold is a fixed business rule for MVP; shift duration remains separately configurable for overtime and schedule evaluation | MVP |

### 3.4 Absence

| ID | Rule | Priority |
|----|------|----------|
| BR-ATT-19 | **REQ** — **ABSENT** — An employee is considered absent on a scheduled working day when there is no valid attendance check-in for that day | MVP |
| BR-ATT-20 | **REQ** — Approved leave on a date overrides absence marking for that date (see BR-LEAVE-09) | MVP |
| BR-ATT-21 | **REQ** — Other approved exceptions (e.g., admin-documented exceptions — policy detail TBD in implementation) may override absence where configured | MVP |
| BR-ATT-22 | **REQ** — **ABSENT** — Employee earns **0%** of the normal one-day salary for that day unless covered by an approved paid leave policy | MVP |

### 3.5 Weekly Off

| ID | Rule | Priority |
|----|------|----------|
| BR-ATT-23 | **REQ** — Days configured as weekly-off for the employee's shift (or organization) are not treated as scheduled working days for absence classification | MVP |
| BR-ATT-24 | **REQ** — Weekly-off configuration is per shift or organization policy — not hardcoded to Sunday | MVP |
| BR-ATT-25 | **REQ** — Attendance recorded on a weekly-off day, if allowed by policy, is handled per overtime/extra-day rules — not as a default scheduled working day | MVP |

### 3.6 Derived Attendance States — Late Arrival and Early Checkout

| ID | Rule | Priority |
|----|------|----------|
| BR-ATT-26 | **REQ** — **LATE_ARRIVAL** is a derived attendance state: actual check-in is later than the employee's assigned shift start time | MVP |
| BR-ATT-27 | **REQ** — **EARLY_CHECKOUT** is a derived attendance state: actual check-out is earlier than the employee's assigned shift end time | MVP |
| BR-ATT-28 | **REQ** — Late arrival and early checkout are informational/reporting states derived from shift comparison; they do not by themselves change HALF-DAY/FULL-DAY classification unless policy explicitly links them (no such linkage in MVP) | MVP |
| BR-ATT-29 | **REQ** — Grace period for late check-in is configured per shift (`shift.grace_period_minutes`, default 0 = exact start) | MVP |
| BR-ATT-30 | **TBD** — Whether early check-in is allowed or clamped to shift start | MVP — policy TBD |

### 3.7 Manual Correction and Leave Interaction

| ID | Rule | Priority |
|----|------|----------|
| BR-ATT-31 | **REQ** — Manual attendance correction by admin requires audit log entry with reason | MVP |
| BR-ATT-32 | **REQ** — Approved leave on a date overrides absence marking for that date | MVP |

### Attendance State Machine (Conceptual)

```
[No open session on working day]
      │ check-in (valid employee, active, trusted recognition)
      ▼
[Checked in] ──check-out──► [Completed session]
      │                           │
      │                           ▼
      │                    Classify: HALF-DAY | FULL-DAY
      │
      └── duplicate check-in ──► REJECTED

[Scheduled working day, no valid check-in, no approved leave]
      ▼
[ABSENT]
```

**Why:** Explicit session states and classification rules prevent duplicate or orphan records that would corrupt payroll calculations.

---

## 4. Face Recognition Rules

| ID | Rule | Priority |
|----|------|----------|
| BR-FACE-01 | **REQ** — Recognition must meet a minimum similarity threshold to return a match (**threshold value: TBD** — configurable) | MVP |
| BR-FACE-02 | **REQ** — Below-threshold or no match → no attendance side effects | MVP |
| BR-FACE-03 | **REQ** — Recognition returns candidate employee ID and confidence score; backend re-validates employee status before attendance write | MVP |
| BR-FACE-04 | **REQ** — Only registered employees appear in similarity search scope | MVP |
| BR-FACE-05 | **REQ** — Face recognition identifies only; it must not directly create or modify attendance, payroll, or leave records | MVP |
| BR-FACE-06 | **REQ** — The client/frontend must not be allowed to arbitrarily claim a valid confidence score; the backend must validate recognition results from a trusted recognition source | MVP |
| BR-FACE-07 | **TBD** — Policy when multiple embeddings match above threshold (highest score wins vs. reject ambiguous) | MVP — TBD |
| BR-FACE-08 | **FUTURE** — Liveness detection to prevent photo spoofing | Deferred |

### Face Recognition → Backend Boundary

```
Camera
  → Face Detection
  → Face Embedding
  → Vector Similarity Search
  → Candidate Employee ID + Confidence Score
  → Backend API
  → Employee validation
  → Attendance business rules
  → PostgreSQL attendance record
```

**PostgreSQL (source of truth):** employees, departments, shifts, attendance, leaves, overtime, payroll, audit information.

**Vector database (identity matching only):** face embeddings, employee reference ID, embedding/model metadata, vector-search metadata.

**Must NOT be stored in vector DB:** salary, employee name, department, or other business data duplicated from PostgreSQL.

**Why:** Biometric identification is probabilistic. Backend validation ensures recognition errors do not directly corrupt authoritative records.

---

## 5. Leave Rules

| ID | Rule | Priority |
|----|------|----------|
| BR-LEAVE-01 | **REQ** — Leave request must specify type, start date, and end date | MVP |
| BR-LEAVE-02 | **REQ** — Leave requests start in `PENDING` status | MVP |
| BR-LEAVE-03 | **REQ** — Only `ADMIN` can transition leave to `APPROVED` or `REJECTED` | MVP |
| BR-LEAVE-04 | **REQ** — Approved leave deducts from employee leave balance for the leave type | MVP |
| BR-LEAVE-05 | **REQ** — Cannot approve leave that exceeds available balance (unless admin override — **override policy: TBD**) | MVP |
| BR-LEAVE-06 | **TBD** — Leave types and annual entitlements (e.g., casual: 12, sick: 10) | MVP — values TBD |
| BR-LEAVE-07 | **REQ** — Rejected leave does not affect balance | MVP |
| BR-LEAVE-08 | **REQ** — Approved paid leave days are not counted as absence and may preserve daily pay per leave policy | MVP |
| BR-LEAVE-09 | **REQ** — Approved leave on a date overrides absence marking for that date | MVP |
| BR-LEAVE-10 | **FUTURE** — Carry-forward unused leave to next year | Deferred |

---

## 6. Overtime Rules

**Definition:** Overtime is working time **beyond the employee's scheduled shift duration** for a given work date. Overtime is not calculated from a hardcoded number of hours system-wide.

| ID | Rule | Priority |
|----|------|----------|
| BR-OT-01 | **REQ** — Overtime must be linked to a specific employee and work date | MVP |
| BR-OT-02 | **REQ** — Overtime hours are derived from actual working duration minus the employee's assigned shift scheduled duration (or equivalent shift-based rule) | MVP |
| BR-OT-03 | **REQ** — Overtime hours are stored separately from normal working hours | MVP |
| BR-OT-04 | **REQ** — Overtime starts in `PENDING` status until admin approval | MVP |
| BR-OT-05 | **REQ** — Only `APPROVED` overtime is included in payroll calculation | MVP |
| BR-OT-06 | **REQ** — Overtime rate multiplier is configurable — not hardcoded to a universal value; exact default multiplier **TBD** | MVP |
| BR-OT-07 | **REQ** — Approved overtime amount is added separately to payroll (not folded into base daily pay) | MVP |
| BR-OT-08 | **REQ** — Overtime creation, approval, and payroll inclusion must be transaction-safe with attendance and payroll operations | MVP |
| BR-OT-09 | **TBD** — Maximum overtime hours per day/month | MVP — TBD |
| BR-OT-10 | **FUTURE** — Auto-suggest overtime from attendance exceeding shift end | Deferred |

### Overtime Approval Status (Conceptual)

| Status | Payroll inclusion |
|--------|-------------------|
| `PENDING` | Not payable |
| `APPROVED` | Included in payroll for the matching pay period |
| `REJECTED` | Not payable |

### Overtime Derivation (Conceptual)

```
overtime_hours = max(0, actual_working_duration − shift_scheduled_duration)
```

Actual working duration comes from completed attendance sessions. Shift scheduled duration comes from the employee's assigned shift.

**Why:** Overtime must align with each employee's schedule. A single hardcoded hour threshold would misrepresent shift-based work patterns.

---

## 7. Payroll Rules

### 7.1 Pay Frequency

| ID | Rule | Priority |
|----|------|----------|
| BR-PAY-01 | **REQ** — MVP payroll frequency is **MONTHLY** | MVP |
| BR-PAY-02 | **REQ** — Payroll is generated for a defined employee and payroll period (`period_start`, `period_end`) | MVP |
| BR-PAY-03 | **REQ** — Attendance classification, approved leave, approved overtime, bonuses, and deductions all contribute to payroll for the period | MVP |

### 7.2 Base Pay and Daily Pay

| ID | Rule | Priority |
|----|------|----------|
| BR-PAY-04 | **REQ** — Employee salary is stored as a monthly/base salary | MVP |
| BR-PAY-05 | **REQ** — Daily pay is derived from monthly base salary using a **configurable payroll/working-day policy** (divisor or working-day count) — the divisor must not be permanently hardcoded in application logic (e.g., not fixed to 30) | MVP |
| BR-PAY-06 | **REQ** — Exact working-day divisor or policy values are configuration — specific default **TBD** at implementation | MVP |

### 7.3 Attendance Adjustment

| ID | Rule | Priority |
|----|------|----------|
| BR-PAY-07 | **REQ** — **FULL-DAY** attendance earns 100% of normal one-day salary | MVP |
| BR-PAY-08 | **REQ** — **HALF-DAY** attendance earns 50% of normal one-day salary | MVP |
| BR-PAY-09 | **REQ** — **ABSENT** (unapproved) earns 0% of normal one-day salary for that day | MVP |
| BR-PAY-10 | **REQ** — Approved paid leave days are not counted as absence deductions | MVP |

### 7.4 Overtime, Bonus, Deductions, and Net Pay

| ID | Rule | Priority |
|----|------|----------|
| BR-PAY-11 | **REQ** — Approved overtime is added separately to payroll per overtime rate rules | MVP |
| BR-PAY-12 | **REQ** — Optional bonuses for the period are summed into payroll | MVP |
| BR-PAY-13 | **REQ** — Deductions for the period are summed into payroll | MVP |
| BR-PAY-14 | **REQ** — Tax calculations are **not** part of MVP payroll (no statutory tax rules in Phase 1) | MVP |
| BR-PAY-15 | **REQ** — Net pay formula (conceptual): `Net Pay = Base Pay after attendance adjustment + Approved Overtime + Bonus − Deductions` | MVP |

### 7.5 Payroll Run Integrity

| ID | Rule | Priority |
|----|------|----------|
| BR-PAY-16 | **REQ** — A pay period cannot be payroll-finalized twice (idempotent run protection) | MVP |
| BR-PAY-17 | **REQ** — Payroll run must be atomic (single database transaction) | MVP |
| BR-PAY-18 | **REQ** — Finalized payroll records are immutable; errors corrected via adjustment entries | MVP |
| BR-PAY-19 | **REQ** — Once finalized or paid, payroll records have controlled modification — only via explicit adjustment or status transition paths, not silent overwrite | MVP |
| BR-PAY-20 | **FUTURE** — Pro-rata salary for mid-period joiners/leavers | Deferred |

### Payroll Calculation (Conceptual)

```
one_day_salary = monthly_base_salary / working_days_in_period_policy

attendance_adjusted_pay =
    sum(FULL-DAY days × one_day_salary)
  + sum(HALF-DAY days × one_day_salary × 0.5)
  + sum(approved paid leave days × one_day_salary per leave policy)
  + sum(ABSENT unapproved days × 0)

Net Pay =
    attendance_adjusted_pay
  + approved_overtime_amount
  + sum(bonuses for period)
  − sum(deductions for period)
```

Exact calculation implementation will be designed in database/backend phases. Business rules above define the payable outcomes.

**Why:** Payroll is the convergence point for attendance, leave, overtime, and adjustments. Explicit inputs make the calculation auditable and testable.

---

## 8. Bonus & Deduction Rules

| ID | Rule | Priority |
|----|------|----------|
| BR-BONUS-01 | **REQ** — Bonus must reference employee, amount, pay period, and reason | MVP |
| BR-DED-01 | **REQ** — Deduction must reference employee, amount, type, pay period, and reason | MVP |
| BR-DED-02 | **REQ** — Total deductions in a period cannot exceed gross pay (**or cap policy: TBD**) | MVP |
| BR-BONUS-02 | **FUTURE** — Recurring bonuses/deductions | Deferred |

---

## 9. Payment Rules

| ID | Rule | Priority |
|----|------|----------|
| BR-PMT-01 | **REQ** — Payment can only be recorded against finalized payroll records | MVP |
| BR-PMT-02 | **REQ** — Payment records include date and optional reference/note | MVP |
| BR-PMT-03 | **REQ** — Payroll status transitions: `DRAFT` → `FINALIZED` → `PAID` (exact enum TBD at implementation) | MVP |
| BR-PMT-04 | **FUTURE** — Partial payments | Deferred |

---

## 10. Security and Trust Boundaries

The frontend must **not** be trusted to decide:

- Employee identity (only trusted recognition pipeline + backend validation)
- Attendance validity
- Payroll amount
- Attendance classification (HALF-DAY / FULL-DAY / ABSENT)
- Confidence/similarity validity

The backend is responsible for validating all of the above.

### Confidence Score Security

| ID | Rule | Priority |
|----|------|----------|
| BR-SEC-01 | **REQ** — The face recognition service produces the confidence/similarity result | MVP |
| BR-SEC-02 | **REQ** — Client/frontend cannot arbitrarily assert a passing confidence score | MVP |
| BR-SEC-03 | **REQ** — Backend validates: employee exists, employee is active, recognition meets configured threshold, recognition source is trusted, attendance request is valid, duplicate attendance is prevented | MVP |
| BR-SEC-04 | **TBD** — Exact face model, embedding dimension, vector database product, similarity metric, and threshold value — finalized during AI/vector architecture phase | Later phase |

---

## 11. Audit Rules

| ID | Rule | Priority |
|----|------|----------|
| BR-AUDIT-01 | **REQ** — Log attendance manual corrections | MVP |
| BR-AUDIT-02 | **REQ** — Log payroll finalization and payment recording | MVP |
| BR-AUDIT-03 | **REQ** — Log employee deactivation and face re-registration | MVP |
| BR-AUDIT-04 | **REQ** — Log bonus and deduction creation/modification | MVP |
| BR-AUDIT-05 | **REQ** — Audit entries are append-only from application layer | MVP |

---

## 12. Database-Level Enforcement (Planned)

Design documented in Phase 2.1 — implementation in Phase 2.2+:

| Document | Content |
|----------|---------|
| [database/database-constraints.md](../database/database-constraints.md) | PK, FK, check constraints, triggers plan |
| [database/relational-schema.md](../database/relational-schema.md) | Preliminary table design |
| [phase2/decisions.md](../phase2/decisions.md) | Design decisions |

The following are **design intentions** for Person A's PostgreSQL track:

| Mechanism | Intended Use |
|-----------|--------------|
| **Constraints** | Unique employee codes, valid date ranges, non-negative amounts |
| **Triggers** | Auto-audit on sensitive updates; prevent modification of finalized payroll |
| **Stored functions** | Payroll calculation, leave balance check, attendance hour computation, classification |
| **Views** | Admin payroll register, employee self-service summary |
| **Indexes** | Attendance by (employee, date), payroll by period |

**Why:** Pushing invariants closer to the database reduces the risk of application bugs corrupting financial data.

---

## 13. Remaining TBD Items (Technical — Later Phases)

The following are intentionally **TBD** and belong to later technical design phases. They do **not** represent unresolved business-rule ambiguity:

| Item | Deferred to |
|------|-------------|
| Exact face recognition model | AI/vector architecture phase |
| Exact embedding model and dimension | AI/vector architecture phase |
| Exact vector database product | AI/vector architecture phase |
| Exact similarity metric | AI/vector architecture phase |
| Recognition threshold value | AI/vector architecture phase |
| Ambiguous multi-match policy (BR-FACE-07) | AI/vector architecture phase |
| Authentication implementation technology | Backend implementation phase |
| Exact backend framework | Backend implementation phase |
| Exact PostgreSQL schema, indexes, SQL functions/triggers | Database design phase |
| Grace period for late check-in (BR-ATT-29) | Implementation configuration |
| Early check-in clamp policy (BR-ATT-30) | Implementation configuration |
| Leave types and annual entitlements (BR-LEAVE-06) | HR policy configuration |
| Overtime rate multiplier default (BR-OT-06) | Payroll configuration |
| Overtime hour caps (BR-OT-09) | Payroll configuration |
| Working-day divisor default (BR-PAY-06) | Payroll configuration |
| Deduction cap behavior (BR-DED-02) | Payroll configuration |

---

## 14. Phase 1 Completion Checklist

- [x] Problem statement finalized
- [x] Objectives finalized
- [x] Scope finalized
- [x] Functional requirements finalized
- [x] Non-functional requirements finalized
- [x] User roles finalized
- [x] High-level architecture finalized
- [x] PostgreSQL responsibility finalized
- [x] Vector DB responsibility finalized
- [x] Face recognition responsibility finalized
- [x] Face recognition → backend boundary finalized
- [x] Attendance check-in rule finalized
- [x] Attendance check-out rule finalized
- [x] Full-day rule finalized
- [x] Half-day rule finalized
- [x] Absent rule finalized
- [x] Weekly-off rule finalized
- [x] Overtime rule finalized
- [x] Payroll calculation model finalized
- [x] Payroll frequency finalized
- [x] Authentication/authorization responsibility documented
- [x] API integration boundary documented
- [x] Security responsibilities documented
- [x] Phase 1 contains no unresolved business-rule ambiguity
