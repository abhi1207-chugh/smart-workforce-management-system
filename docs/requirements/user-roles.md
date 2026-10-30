# User Roles

The MVP supports exactly two application roles. Additional roles are **FUTURE** unless explicitly added later.

---

## Role Summary

| Role | Code | Description |
|------|------|-------------|
| Administrator | `ADMIN` | Full operational control over workforce, attendance, payroll, and system configuration |
| Employee | `EMPLOYEE` | Self-service access to own attendance, leave, and payroll information; face-based check-in/out |

---

## ADMIN

### Purpose

Administrators manage the organization’s workforce data and financial operations. They are trusted to modify sensitive records and must leave an audit trail when doing so.

### Capabilities

| Domain | Allowed Actions |
|--------|-----------------|
| Employees | Create, read, update, deactivate; assign department and shift |
| Departments | Create, read, update, deactivate |
| Shifts | Create, read, update, deactivate; assign to employees |
| Face Registration | Register, re-register, view registration status for any employee |
| Attendance | View all records; manual correction with audit |
| Leave | View all requests; approve/reject |
| Overtime | Record, approve |
| Bonus & Deductions | Apply to employees for pay periods |
| Payroll | Initiate runs, view all payroll records, finalize |
| Payments | Record payment against payroll |
| Audit Logs | Query and view |
| Reports | All admin reports |

### Restrictions

- Admins authenticate as users; admin actions are attributed to their user account in audit logs.
- Admins should not bypass business rules silently (e.g., payroll must still follow defined calculation rules; corrections use explicit adjustment paths).

---

## EMPLOYEE

### Purpose

Employees interact with the system for daily attendance and personal workforce information. They have no authority over other employees’ data or organizational configuration.

### Capabilities

| Domain | Allowed Actions |
|--------|-----------------|
| Authentication | Login, logout, view own profile |
| Face Check-In/Out | Use recognition flow to record own attendance (backend validates identity) |
| Attendance | View own history |
| Leave | Submit requests; view own balance and history |
| Payroll | View own finalized payroll summaries |
| Reports | Personal attendance and payroll summary only |

### Restrictions

| Restriction | Rationale |
|-------------|-----------|
| Cannot view other employees’ records | Privacy and least privilege |
| Cannot approve own leave | Separation of duties |
| Cannot modify payroll, bonuses, or deductions | Financial integrity |
| Cannot register faces for other employees | Prevents impersonation enrollment |
| Cannot access audit logs | Admin-only governance |
| Cannot manage departments, shifts, or employee master data | Admin responsibility |

---

## Authentication vs. Recognition

These are **distinct** concepts and must not be conflated:

| Mechanism | Purpose | When Used |
|-----------|---------|-----------|
| **Authentication** (login) | Proves the interactive user is a known account with a role | Admin dashboard, employee portal, API sessions |
| **Face Recognition** (biometric ID) | Maps a live face to an employee ID | Check-in/check-out kiosk flow |

An employee may be **recognized** by face without being **logged in** to the web session (e.g., shared kiosk). The backend must still validate that the recognized employee ID is active and eligible before recording attendance.

**OPEN decision:** Whether check-in kiosks require a logged-in session or operate in kiosk-only mode.

---

## Authorization Model (High Level)

```
Request → Authenticate (who is the user?) → Authorize (what can they do?) → Execute
```

For attendance via face recognition:

```
Camera → Recognize (which employee ID?) → Backend validates employee → Apply attendance rules → Persist
```

Authorization checks occur in the **backend/API**. The frontend hides unauthorized UI elements for usability but is not the security boundary.

---

## Role Assignment

| Rule | Detail |
|------|--------|
| REQ | Each user account has exactly one role: `ADMIN` or `EMPLOYEE` |
| REQ | Admin users are not required to have an employee record (system operators) |
| REQ | Employee users should be linked to an employee record for attendance and payroll |
| FUTURE | Users with both admin duties and employee record (dual linkage) |

---

## Permission Matrix (MVP)

Legend: ✅ Allowed · ❌ Denied · 🔶 Own records only

| Resource / Action | ADMIN | EMPLOYEE |
|-------------------|-------|----------|
| Manage employees | ✅ | ❌ |
| Manage departments | ✅ | ❌ |
| Manage shifts | ✅ | ❌ |
| Register faces | ✅ | ❌ |
| Face check-in/out | 🔶¹ | 🔶¹ |
| View attendance | ✅ | 🔶 |
| Correct attendance | ✅ | ❌ |
| Submit leave | ✅² | ✅ |
| Approve leave | ✅ | ❌ |
| Manage overtime | ✅ | ❌ |
| Apply bonus/deduction | ✅ | ❌ |
| Run payroll | ✅ | ❌ |
| View payroll | ✅ | 🔶 |
| Record payments | ✅ | ❌ |
| View audit logs | ✅ | ❌ |
| Admin reports | ✅ | ❌ |
| Personal reports | ✅ | ✅ |

¹ Face check-in applies to the recognized employee, not the logged-in user (unless they are the same).
² Admin may submit leave on behalf of an employee (**OPEN** — may be admin-only proxy or disallowed).
