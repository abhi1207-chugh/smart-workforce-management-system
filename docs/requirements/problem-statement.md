# Problem Statement

## Context

Organizations with distributed or shift-based workforces need reliable ways to record attendance, manage leave and overtime, and process payroll accurately. Manual attendance registers, spreadsheet-based payroll, and ad-hoc leave tracking are error-prone, difficult to audit, and do not scale as employee counts grow.

Traditional biometric systems (fingerprint, RFID) solve identification but often require dedicated hardware and do not integrate cleanly with modern payroll workflows. Meanwhile, face recognition technology has matured enough to support workforce identification when combined with proper backend business logic and data governance.

## Problem

Workforce management for small-to-medium organizations typically suffers from:

1. **Inaccurate attendance records** — Manual check-in/check-out leads to missing entries, buddy punching, and disputes over hours worked.
2. **Disconnected systems** — Attendance, leave balances, overtime, and payroll are often tracked in separate tools with no single source of truth.
3. **Weak auditability** — Changes to attendance or payroll data are rarely logged in a way that supports compliance review or dispute resolution.
4. **Slow payroll cycles** — Payroll calculation depends on manually reconciling attendance, leave, overtime, bonuses, and deductions each pay period.
5. **Limited role-based access** — Employees cannot self-serve their records; administrators lack structured controls over who can modify sensitive financial data.

## Proposed Solution (High Level)

Build a **Smart Workforce Attendance & Payroll Management System** — an MVP that:

- Uses **face recognition** to identify employees at check-in/check-out.
- Stores structured workforce and financial data in **PostgreSQL** as the system of record.
- Stores **face embeddings** in a **vector database** for similarity-based employee identification.
- Applies **attendance, leave, overtime, and payroll business logic** in the backend/API layer (not in the recognition pipeline alone).
- Exposes a **Next.js frontend** for administrators and employees.
- Enforces **authentication, authorization, and audit logging** across all sensitive operations.

## Why This Matters (Academic & Real-World)

This project demonstrates DBMS Level-3 competencies beyond simple CRUD:

- Relational modeling with transactions, constraints, and referential integrity.
- Server-side business logic via stored functions, triggers, and views.
- Indexing and query optimization for reporting workloads.
- Integration between a relational database and a vector store.
- API design that separates identification (face) from authorization and business rules (backend).

## Out of Scope for This Document

Specific technology choices (vector database product, face model library, auth provider) are **not** finalized here. See [system-architecture.md](./system-architecture.md) for component boundaries and open decisions.
