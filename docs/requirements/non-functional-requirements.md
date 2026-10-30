# Non-Functional Requirements

Non-functional requirements define **how** the system should behave. Items marked **OPEN** require a decision before implementation.

---

## 1. Data Integrity & Consistency

| ID | Requirement |
|----|-------------|
| NFR-DI-01 | PostgreSQL is the **authoritative source** for all structured workforce and financial data. |
| NFR-DI-02 | Payroll runs and payment recording must use **database transactions** — no partial payroll states. |
| NFR-DI-03 | Vector database stores embeddings and employee ID references only; payroll and attendance records live in PostgreSQL. |
| NFR-DI-04 | If recognition succeeds but backend attendance write fails, the system must return a clear error (no silent success). |
| NFR-DI-05 | Deactivated employees must not be able to check in, even if a face match occurs. |

**Why:** Financial and attendance data requires ACID guarantees that a vector store alone cannot provide.

---

## 2. Security

| ID | Requirement |
|----|-------------|
| NFR-SEC-01 | All API endpoints (except login/public health) require authentication. |
| NFR-SEC-02 | Authorization enforced server-side; frontend role checks are UX only, not security boundaries. |
| NFR-SEC-03 | Passwords must be stored using a strong one-way hash (**algorithm: OPEN**). |
| NFR-SEC-04 | Face embeddings are sensitive biometric derivatives — access restricted to registration and recognition flows. |
| NFR-SEC-05 | Raw camera frames should not be persistently stored by default (**storage policy: OPEN**). |
| NFR-SEC-06 | API communication should use HTTPS in non-local deployments. |
| NFR-SEC-07 | Audit logs must not be modifiable or deletable via standard application APIs. |
| NFR-SEC-08 | The client/frontend must not be trusted to assert employee identity, attendance validity, payroll amounts, attendance classification, or passing confidence scores. |
| NFR-SEC-09 | Confidence/similarity scores must originate from the trusted recognition service; backend validates threshold before accepting attendance. |

**Why:** The system handles payroll (financial) and biometric data — both require strong access control.

---

## 3. Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-PERF-01 | Face recognition end-to-end (capture → ID) | **OPEN** — define acceptable latency for MVP demo |
| NFR-PERF-02 | Standard API read operations (list employees, attendance) | < 2 seconds under demo dataset |
| NFR-PERF-03 | Payroll run for demo-scale employee count (~50–100) | Completes within reasonable batch time (**exact target: OPEN**) |
| NFR-PERF-04 | Vector similarity search | Sub-second for demo embedding count (**exact SLA: OPEN**) |

**Why:** Attendance kiosks need responsive recognition; payroll is batch-oriented but must not block indefinitely.

---

## 4. Scalability & Modularity

| ID | Requirement |
|----|-------------|
| NFR-SCALE-01 | Components (frontend, backend, PostgreSQL, vector DB) are independently replaceable behind API contracts. |
| NFR-SCALE-02 | MVP targets single-organization, demo-scale data; horizontal scaling is **FUTURE**. |
| NFR-SCALE-03 | Business logic resides in backend and PostgreSQL — not duplicated in frontend or recognition pipeline. |

**Why:** Modular boundaries allow Person A and Person B to develop in parallel with minimal coupling.

---

## 5. Availability & Reliability

| ID | Requirement |
|----|-------------|
| NFR-AVAIL-01 | If vector database is unavailable, face check-in must fail gracefully with user-visible error; manual admin attendance correction remains available. |
| NFR-AVAIL-02 | If PostgreSQL is unavailable, all operations fail — no offline cache of payroll data. |
| NFR-AVAIL-03 | MVP does not require high-availability clustering (**FUTURE** for production). |

---

## 6. Usability

| ID | Requirement |
|----|-------------|
| NFR-UX-01 | Distinct admin and employee navigation paths based on role. |
| NFR-UX-02 | Face registration and check-in flows provide clear success/failure feedback. |
| NFR-UX-03 | Attendance and payroll screens use consistent date/period selectors. |
| NFR-UX-04 | Error messages are human-readable (not raw stack traces in UI). |

---

## 7. Maintainability & Documentation

| ID | Requirement |
|----|-------------|
| NFR-MAINT-01 | API contract documented and versioned in [api-contract.md](../integration/api-contract.md). |
| NFR-MAINT-02 | Business rules documented separately from implementation in [business-rules.md](./business-rules.md). |
| NFR-MAINT-03 | Database logic (functions, triggers, views) must be traceable to functional requirements. |
| NFR-MAINT-04 | Git history with meaningful commits; feature branches per module where practical. |

---

## 8. Testability

| ID | Requirement |
|----|-------------|
| NFR-TEST-01 | Business rules (attendance, leave, payroll) must be testable without live camera input. |
| NFR-TEST-02 | Face recognition integration testable with mock/stub employee ID injection (**approach: OPEN**). |
| NFR-TEST-03 | Payroll calculation tests cover edge cases: partial attendance, approved leave, overtime, bonuses, deductions. |
| NFR-TEST-04 | Authorization tests verify EMPLOYEE cannot access admin endpoints. |

---

## 9. Compliance & Privacy (Academic Context)

| ID | Requirement |
|----|-------------|
| NFR-PRIV-01 | Collect only data necessary for attendance and payroll MVP. |
| NFR-PRIV-02 | Employees should be informed that face embeddings are stored (**consent flow: OPEN**). |
| NFR-PRIV-03 | Deactivated employee embeddings should be removable from vector store (**retention policy: OPEN**). |

**Note:** Full legal compliance (GDPR, local labor law) is beyond MVP scope but privacy-aware design is required.

---

## 10. Technology Constraints (Specified)

| Constraint | Detail |
|------------|--------|
| Relational database | PostgreSQL (required) |
| Frontend | Next.js (required) |
| Vector store | Required; **product choice OPEN** |
| Face pipeline | Detection + embeddings + similarity search (required); **library choice OPEN** |
| Backend | Required; **language/framework OPEN** |

These constraints come from the project specification. Specific library and product selections are intentionally deferred.
