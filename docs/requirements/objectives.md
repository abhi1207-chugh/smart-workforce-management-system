# Objectives

## Primary Objectives

| # | Objective | Rationale |
|---|-----------|-----------|
| O1 | Provide accurate, timestamped attendance capture via face recognition | Reduces manual entry errors and establishes a verifiable check-in/check-out trail |
| O2 | Maintain PostgreSQL as the single source of truth for workforce and payroll data | Ensures consistency, ACID guarantees, and auditability for financial records |
| O3 | Implement attendance, leave, overtime, and payroll logic in the backend with database support | Goes beyond CRUD by encoding business rules in application and database layers |
| O4 | Support role-based access for ADMIN and EMPLOYEE users | Separates operational control from self-service access |
| O5 | Integrate face registration and recognition with employee records | Links biometric identity to structured employee IDs without storing raw images as the primary key |
| O6 | Produce payroll outputs from attendance-derived inputs plus bonuses and deductions | Demonstrates end-to-end workforce-to-payment workflow |
| O7 | Log auditable actions on sensitive data changes | Supports dispute resolution and academic demonstration of accountability |

## Learning Objectives (DBMS Level-3)

### Person A — PostgreSQL & Backend Track

- Design a normalized relational schema for workforce and payroll domains.
- Use **transactions** for operations that must succeed or fail atomically (e.g., payroll run, payment recording).
- Implement **stored functions** for reusable payroll and attendance calculations.
- Use **triggers** to enforce invariants and maintain derived/audit data.
- Create **views** for reporting and role-appropriate data exposure.
- Apply **indexing** strategies for common query patterns (attendance by date, payroll by period).
- Build a **backend/API** that orchestrates business logic and database access.

### Person B — Face Recognition & Frontend Track

- Implement **face detection** and **embedding** generation from camera input.
- Store and query embeddings in a **vector database** via **similarity search**.
- Build **face registration** and **recognition** flows integrated with employee IDs.
- Deliver a **Next.js frontend** for admin and employee workflows.
- Integrate frontend with backend APIs for all non-recognition business operations.

### Shared Objectives (Both Members)

- **Authentication** — Verify user identity before granting access.
- **Authorization** — Enforce role and resource-level permissions.
- **API integration** — Connect frontend, backend, PostgreSQL, and vector store through defined contracts.
- **Testing** — Validate business rules, API behavior, and critical integration paths.
- **Security** — Protect credentials, embeddings, and payroll data.
- **Documentation** — Maintain requirements, architecture, and API contracts.
- **Git/GitHub** — Version control, branching, and collaborative development.

## Success Criteria (MVP)

The MVP is successful when:

1. An admin can register an employee, assign department/shift, and enroll their face.
2. An employee can check in and check out via face recognition; the backend records attendance.
3. Leave requests can be submitted, approved/rejected, and reflected in balances.
4. Overtime can be recorded and considered in payroll calculations.
5. A payroll run for a pay period produces correct gross/net amounts including bonuses and deductions.
6. Payments can be recorded against payroll records.
7. Admins can generate basic reports; employees can view their own attendance and payroll summary.
8. Sensitive actions appear in audit logs.

## Non-Objectives (Explicitly Not Primary Goals)

These are **future ideas**, not MVP requirements:

- Multi-tenant SaaS deployment
- Mobile native applications
- Real-time payment gateway integration (bank transfers, UPI, etc.)
- Advanced ML model training pipelines
- Full HR lifecycle (recruitment, performance reviews, asset management)
