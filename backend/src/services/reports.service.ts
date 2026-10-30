import type { AuthUser } from "../auth/types.js";
import { notFound } from "../errors/app-error.js";
import * as repo from "../repositories/reports.repository.js";
import { ownEmployeeId } from "./scope.js";

export const attendanceSummary = (q: { from: string; to: string; employee_id?: string; department_id?: string }) =>
  repo.attendanceSummary({ from: q.from, to: q.to, employeeId: q.employee_id, departmentId: q.department_id });

export const leaveBalances = (q: { employee_id?: string; leave_type_code?: string }) =>
  repo.leaveBalanceReport({ employeeId: q.employee_id, leaveTypeCode: q.leave_type_code });

export async function payrollRegister(periodId: string) {
  const register = await repo.payrollRegister(periodId);
  if (!register) throw notFound("Payroll run not found");
  return register;
}

export const meSummary = (user: AuthUser, q: { from?: string; to?: string }) =>
  repo.personalSummary(ownEmployeeId(user), q.from, q.to);

export const auditLogs = (q: {
  from?: string; to?: string; entity_type?: string; entity_id?: string; actor_id?: string; limit: number; offset: number;
}) =>
  repo.queryAuditLogs({
    from: q.from, to: q.to, entityType: q.entity_type, entityId: q.entity_id, actorId: q.actor_id,
    limit: q.limit, offset: q.offset,
  });

export const dashboard = repo.dashboardSummary;
