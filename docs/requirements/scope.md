# Scope

## In Scope (MVP)

### Workforce Structure

| Module | Description |
|--------|-------------|
| Employee Management | Create, update, deactivate employees; link to department and shift |
| Department Management | Define departments; assign employees |
| Shift Management | Define shifts with start/end expectations used for attendance evaluation |

### Identity & Attendance

| Module | Description |
|--------|-------------|
| Face Registration | Capture face embedding(s) and associate with employee ID in vector store |
| Face Recognition | Identify employee from camera input; return employee ID to backend |
| Attendance | Check-in/check-out recording driven by backend business logic after identification |

### Time & Compensation

| Module | Description |
|--------|-------------|
| Leave | Request, approve/reject, track balances |
| Overtime | Record and approve overtime hours linked to attendance periods |
| Bonus | Apply one-off or periodic bonuses to payroll |
| Deductions | Apply statutory or organizational deductions |
| Payroll | Calculate monthly pay for a period from attendance classification, leave, overtime, bonuses, deductions |
| Payments | Record payment status against payroll outputs |

### Governance & Reporting

| Module | Description |
|--------|-------------|
| Audit Logs | Record who changed what and when for sensitive operations |
| Reports | Attendance summaries, leave balances, payroll registers (admin); personal views (employee) |

### Cross-Cutting

| Concern | Description |
|---------|-------------|
| Authentication | Login and session/token management for all users |
| Authorization | Role-based access (ADMIN, EMPLOYEE) enforced on API and UI |
| API Integration | Defined contracts between frontend, backend, PostgreSQL, and vector DB |

## Out of Scope (MVP)

The following are **explicitly excluded** from the initial release. They may be noted as future enhancements but must not block MVP delivery.

| Item | Reason |
|------|--------|
| Database table DDL / migrations | Deferred to a later phase (not Phase 1 documentation) |
| Production deployment & CI/CD | Infrastructure decisions not yet specified |
| Third-party payment gateways | Payments are recorded, not processed externally |
| Geofencing / GPS attendance | Adds complexity beyond face-based MVP |
| Multi-location / multi-company tenancy | Single-organization MVP |
| Offline-first mobile apps | Web frontend only |
| Custom ML model training | Use pre-trained embedding models; no training pipeline |
| Email/SMS notifications | Optional future enhancement |
| Document management (contracts, IDs) | Outside core attendance/payroll scope |

## Module Boundaries

Understanding **what belongs where** prevents scope creep and keeps the architecture modular.

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js Frontend                                           │
│  UI, forms, camera capture, role-based views                │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP API
┌──────────────────────────▼──────────────────────────────────┐
│  Backend/API                                                │
│  Auth, authorization, ALL business logic, orchestration     │
│  Attendance rules, leave, overtime, payroll, audit          │
└───────┬──────────────────────────────────────┬──────────────┘
        │                                      │
        ▼                                      ▼
┌───────────────┐                    ┌─────────────────────┐
│  PostgreSQL   │                    │  Vector Database    │
│  Source of    │                    │  Face embeddings +  │
│  truth        │                    │  employee ID refs   │
└───────────────┘                    └─────────────────────┘

Face pipeline (detection → embedding → similarity search)
returns employee ID only. Backend decides attendance action.
```

### Person A Scope

- PostgreSQL schema design and implementation (future phase)
- Stored functions, triggers, views, indexes
- Attendance, leave, overtime, payroll business logic
- Backend/API endpoints for all structured data operations
- Transaction management for financial operations

### Person B Scope

- Face detection, embedding, and similarity search
- Vector database integration
- Camera integration in frontend
- Face registration and recognition UI flows
- Next.js frontend for all modules (consuming shared API)

### Shared Scope

- Authentication and authorization design and implementation
- API contract adherence ([api-contract.md](../integration/api-contract.md))
- Integration testing across both tracks
- Security review and documentation

## Assumptions

1. Single organization; all employees belong to one logical tenant.
2. One primary camera source per check-in station (browser-based webcam acceptable for MVP).
3. Pay periods are **monthly** for MVP; shift definitions (including weekly-off days) are configured by admin before payroll runs.
4. Face recognition returns a candidate employee ID; backend validates eligibility (active employee, registered face, etc.) before recording attendance.
5. PostgreSQL remains authoritative for any data that affects payroll amounts.

## Dependencies Between Tracks

| Dependency | Owner | Consumer |
|------------|-------|----------|
| Employee ID exists in PostgreSQL | Person A | Person B (face registration) |
| Face embedding stored with employee ID | Person B | Person A (attendance validation) |
| API contract for recognition result → attendance | Both | Both |
| Auth tokens and role claims | Both | Both |
