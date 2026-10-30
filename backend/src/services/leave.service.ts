import type { AuthUser } from "../auth/types.js";
import { getDatabase } from "../database/client.js";
import { badRequest, conflict, notFound } from "../errors/app-error.js";
import {
  adjustLeaveBalanceInDb,
  approveLeaveInDb,
  findActiveLeaveType,
  getLeaveRequest,
  hasOverlappingRequest,
  hasSufficientBalance,
  insertLeaveRequest,
  listLeaveBalances,
  listLeaveRequests,
  listLeaveTypes,
  lockLeaveRequest,
  rejectLeaveInDb,
} from "../repositories/leave.repository.js";
import { findEmployeeStatus } from "../repositories/attendance.repository.js";
import type { AdjustBalanceInput, CreateLeaveInput } from "../validation/leave.validation.js";
import { ownEmployeeId, scopeEmployee } from "./scope.js";

export const getLeaveTypes = listLeaveTypes;

export async function submitLeave(user: AuthUser, input: CreateLeaveInput) {
  const employeeId = ownEmployeeId(user);
  const db = getDatabase();
  if ((await findEmployeeStatus(db, employeeId)) !== "ACTIVE") {
    throw conflict("Inactive employees cannot request leave");
  }
  if (!(await findActiveLeaveType(db, input.leave_type_id))) {
    throw badRequest("Leave type does not exist or is inactive");
  }
  return db.withTransaction(async (client) => {
    if (await hasOverlappingRequest(client, employeeId, input.start_date, input.end_date)) {
      throw conflict("Dates overlap an existing pending or approved leave request");
    }
    const id = await insertLeaveRequest(
      client,
      employeeId,
      input.leave_type_id,
      input.start_date,
      input.end_date,
      input.reason ?? null
    );
    return getLeaveRequest(client, id);
  });
}

export async function listRequests(
  user: AuthUser,
  q: { employee_id?: string; status?: string; limit: number; offset: number }
) {
  return listLeaveRequests({
    employeeId: scopeEmployee(user, q.employee_id),
    status: q.status,
    limit: q.limit,
    offset: q.offset,
  });
}

export async function getRequest(user: AuthUser, id: string) {
  const request = await getLeaveRequest(getDatabase(), id);
  // Other employees' requests are reported as missing rather than forbidden.
  if (!request || (user.role === "EMPLOYEE" && request.employee_id !== user.employee_id)) {
    throw notFound("Leave request not found");
  }
  return request;
}

async function review(
  id: string,
  reviewerId: string,
  decide: "approve" | "reject"
) {
  return getDatabase().withTransaction(async (client) => {
    const locked = await lockLeaveRequest(client, id);
    if (!locked) throw notFound("Leave request not found");
    if (locked.status !== "PENDING") {
      throw conflict(`Leave request is already ${locked.status}`);
    }
    if (decide === "approve") {
      const ok = await hasSufficientBalance(
        client,
        locked.employee_id,
        locked.leave_type_id,
        Number(locked.days)
      );
      if (!ok) throw conflict("Insufficient leave balance");
      await approveLeaveInDb(client, id, reviewerId);
    } else {
      await rejectLeaveInDb(client, id, reviewerId);
    }
    return getLeaveRequest(client, id);
  });
}

export const approveRequest = (id: string, reviewerId: string) => review(id, reviewerId, "approve");
export const rejectRequest = (id: string, reviewerId: string) => review(id, reviewerId, "reject");

export async function getBalances(user: AuthUser, employeeId?: string) {
  return listLeaveBalances(scopeEmployee(user, employeeId));
}

export async function adjustBalance(input: AdjustBalanceInput, adminUserId: string) {
  const db = getDatabase();
  if (!(await findEmployeeStatus(db, input.employee_id))) throw notFound("Employee not found");
  if (!(await findActiveLeaveType(db, input.leave_type_id))) {
    throw badRequest("Leave type does not exist or is inactive");
  }
  return adjustLeaveBalanceInDb(
    db, input.employee_id, input.leave_type_id, input.balance_days, adminUserId, input.reason
  );
}
