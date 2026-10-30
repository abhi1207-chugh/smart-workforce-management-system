# Functional Requirements

Requirements are labeled **REQ** (must have for MVP) or **FUTURE** (explicitly deferred).

---

## 1. Authentication & Authorization

| ID | Requirement | Priority |
|----|-------------|----------|
| AUTH-01 | **REQ** — Users must authenticate before accessing protected resources | MVP |
| AUTH-02 | **REQ** — System must support two roles: `ADMIN` and `EMPLOYEE` | MVP |
| AUTH-03 | **REQ** — Admins can manage all workforce, attendance, and payroll resources | MVP |
| AUTH-04 | **REQ** — Employees can view their own attendance, leave, and payroll summary | MVP |
| AUTH-05 | **REQ** — Employees cannot modify other employees' records or payroll data | MVP |
| AUTH-06 | **FUTURE** — Password reset via email | Deferred |

---

## 2. Employee Management

| ID | Requirement | Priority |
|----|-------------|----------|
| EMP-01 | **REQ** — Admin can create an employee with required profile fields (identity, contact, employment details) | MVP |
| EMP-02 | **REQ** — Admin can update employee information | MVP |
| EMP-03 | **REQ** — Admin can deactivate an employee (soft disable; preserve history) | MVP |
| EMP-04 | **REQ** — Admin can assign an employee to a department | MVP |
| EMP-05 | **REQ** — Admin can assign an employee to a shift | MVP |
| EMP-06 | **REQ** — Admin can list and search employees | MVP |
| EMP-07 | **FUTURE** — Bulk employee import via CSV | Deferred |

---

## 3. Department Management

| ID | Requirement | Priority |
|----|-------------|----------|
| DEPT-01 | **REQ** — Admin can create, update, and deactivate departments | MVP |
| DEPT-02 | **REQ** — Admin can view employees grouped by department | MVP |
| DEPT-03 | **FUTURE** — Department hierarchy (parent/child) | Deferred |

---

## 4. Shift Management

| ID | Requirement | Priority |
|----|-------------|----------|
| SHIFT-01 | **REQ** — Admin can define shifts with name, scheduled start time, scheduled end time, and configurable weekly-off days | MVP |
| SHIFT-02 | **REQ** — Admin can assign a shift to employees | MVP |
| SHIFT-03 | **REQ** — Shift definitions are used by attendance logic to evaluate lateness, expected hours, overtime derivation, and weekly-off treatment | MVP |
| SHIFT-04 | **REQ** — Weekly-off days are configurable per shift (not hardcoded to Sunday) | MVP |
| SHIFT-05 | **FUTURE** — Rotating or weekly shift patterns | Deferred |

---

## 5. Face Registration

| ID | Requirement | Priority |
|----|-------------|----------|
| FACE-REG-01 | **REQ** — Admin (or authorized flow) can register a face for an existing employee | MVP |
| FACE-REG-02 | **REQ** — Registration captures face via camera, generates embedding, stores in vector DB with employee ID | MVP |
| FACE-REG-03 | **REQ** — System must confirm employee exists in PostgreSQL before accepting registration | MVP |
| FACE-REG-04 | **REQ** — Admin can view registration status (registered / not registered) per employee | MVP |
| FACE-REG-05 | **REQ** — Admin can re-register (replace) an employee's face embedding | MVP |
| FACE-REG-06 | **FUTURE** — Multiple embeddings per employee (angles/lighting) | Deferred |

---

## 6. Face Recognition & Attendance Capture

| ID | Requirement | Priority |
|----|-------------|----------|
| FACE-REC-01 | **REQ** — System can detect a face from camera input | MVP |
| FACE-REC-02 | **REQ** — System generates embedding and performs similarity search against vector DB | MVP |
| FACE-REC-03 | **REQ** — Recognition returns a matched employee ID above a configurable similarity threshold | MVP |
| FACE-REC-04 | **REQ** — Unmatched or below-threshold results must not auto-record attendance | MVP |
| FACE-REC-05 | **REQ** — Matched employee ID is sent to backend; backend applies attendance business rules | MVP |
| ATT-01 | **REQ** — Employee can check in via face recognition; backend records arrival using server timestamp as authoritative time | MVP |
| ATT-02 | **REQ** — Employee can check out (record departure timestamp); working duration derived from valid check-in and check-out | MVP |
| ATT-03 | **REQ** — Backend prevents duplicate check-in for the same working period and duplicate check-out on the same session | MVP |
| ATT-04 | **REQ** — Backend rejects check-out without a valid check-in on the same session | MVP |
| ATT-05 | **REQ** — System classifies completed sessions as HALF-DAY (< 4 hours) or FULL-DAY (≥ 4 hours) per business rules | MVP |
| ATT-06 | **REQ** — System marks ABSENT on scheduled working days with no valid check-in, subject to approved leave/exceptions | MVP |
| ATT-07 | **REQ** — System derives LATE_ARRIVAL and EARLY_CHECKOUT states by comparing timestamps to assigned shift | MVP |
| ATT-08 | **REQ** — Admin can view attendance records by employee, department, and date range | MVP |
| ATT-09 | **REQ** — Employee can view their own attendance history | MVP |
| ATT-10 | **REQ** — Admin can manually correct attendance with audit trail | MVP |
| ATT-11 | **FUTURE** — Break time tracking within a shift | Deferred |

---

## 7. Leave Management

| ID | Requirement | Priority |
|----|-------------|----------|
| LEAVE-01 | **REQ** — Employee can submit a leave request (type, date range, reason) | MVP |
| LEAVE-02 | **REQ** — Admin can approve or reject leave requests | MVP |
| LEAVE-03 | **REQ** — Approved leave affects attendance expectations for covered dates | MVP |
| LEAVE-04 | **REQ** — System tracks leave balance per employee per leave type | MVP |
| LEAVE-05 | **REQ** — Employee can view leave balance and request history | MVP |
| LEAVE-06 | **FUTURE** — Partial-day leave | Deferred |

---

## 8. Overtime Management

| ID | Requirement | Priority |
|----|-------------|----------|
| OT-01 | **REQ** — Overtime hours can be recorded linked to employee and date, derived from shift-based rules (not hardcoded hours) | MVP |
| OT-02 | **REQ** — Overtime is stored separately from normal working hours | MVP |
| OT-03 | **REQ** — Admin can approve overtime before inclusion in payroll (`PENDING` → `APPROVED`) | MVP |
| OT-04 | **REQ** — Only approved overtime is available as payroll input | MVP |
| OT-05 | **FUTURE** — Automatic overtime detection from attendance vs. shift end | Deferred |

---

## 9. Bonus & Deductions

| ID | Requirement | Priority |
|----|-------------|----------|
| BONUS-01 | **REQ** — Admin can apply a bonus to an employee for a pay period | MVP |
| BONUS-02 | **REQ** — Bonus amount and reason are stored and auditable | MVP |
| DED-01 | **REQ** — Admin can apply deductions to an employee for a pay period | MVP |
| DED-02 | **REQ** — Deduction amount, type, and reason are stored and auditable | MVP |
| DED-03 | **FUTURE** — Recurring deduction templates | Deferred |

---

## 10. Payroll

| ID | Requirement | Priority |
|----|-------------|----------|
| PAY-01 | **REQ** — Admin can initiate a monthly payroll run for a defined pay period | MVP |
| PAY-02 | **REQ** — Payroll calculation incorporates: monthly base salary, attendance classification (FULL-DAY/HALF-DAY/ABSENT), approved leave, approved overtime, bonuses, deductions | MVP |
| PAY-03 | **REQ** — Daily pay uses a configurable working-day policy — not a permanently hardcoded divisor | MVP |
| PAY-04 | **REQ** — Net pay = base pay after attendance adjustment + approved overtime + bonus − deductions (no tax in MVP) | MVP |
| PAY-05 | **REQ** — Payroll run is transactional — partial failure rolls back the run | MVP |
| PAY-06 | **REQ** — Generated payroll records are immutable after finalization (corrections via adjustment entries, not silent overwrite) | MVP |
| PAY-07 | **REQ** — Admin can view payroll summary per employee and per period | MVP |
| PAY-08 | **REQ** — Employee can view their own finalized payroll for past periods | MVP |
| PAY-09 | **FUTURE** — Tax slab automation with jurisdiction rules | Deferred |

---

## 11. Payments

| ID | Requirement | Priority |
|----|-------------|----------|
| PMT-01 | **REQ** — Admin can mark a payroll record as paid with payment date and reference | MVP |
| PMT-02 | **REQ** — Payment status is visible on payroll reports | MVP |
| PMT-03 | **FUTURE** — Integration with external payment rails | Deferred |

---

## 12. Audit Logs

| ID | Requirement | Priority |
|----|-------------|----------|
| AUDIT-01 | **REQ** — System logs create/update/delete on sensitive entities (attendance corrections, payroll, bonuses, deductions, employee status changes) | MVP |
| AUDIT-02 | **REQ** — Each log entry includes actor, timestamp, action, entity type, and entity identifier | MVP |
| AUDIT-03 | **REQ** — Admin can query audit logs by date range and entity type | MVP |
| AUDIT-04 | **FUTURE** — Before/after value snapshots for all fields | Deferred |

---

## 13. Reports

| ID | Requirement | Priority |
|----|-------------|----------|
| RPT-01 | **REQ** — Admin: daily/period attendance summary | MVP |
| RPT-02 | **REQ** — Admin: leave balance report | MVP |
| RPT-03 | **REQ** — Admin: payroll register for a pay period | MVP |
| RPT-04 | **REQ** — Employee: personal attendance and payroll summary | MVP |
| RPT-05 | **FUTURE** — Export to PDF/Excel | Deferred |

---

## Separation of Concerns (Critical)

| Responsibility | Owner |
|----------------|-------|
| Face detection & embedding | Recognition pipeline (Person B) |
| Similarity search & employee ID lookup | Vector database layer (Person B) |
| Attendance state machine (check-in/out rules) | Backend/API (Person A) |
| Leave, overtime, payroll calculations | Backend/API + PostgreSQL (Person A) |
| Role enforcement | Backend/API (both, shared) |
| UI presentation | Next.js frontend (Person B, consuming all APIs) |

Face recognition **identifies** an employee. It does **not** decide attendance outcomes — the backend does.
