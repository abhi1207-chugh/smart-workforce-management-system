import type { AuthUser } from "../auth/types.js";
import { getDatabase } from "../database/client.js";
import { badRequest, conflict, notFound } from "../errors/app-error.js";
import { findEmployeeStatus } from "../repositories/attendance.repository.js";
import * as repo from "../repositories/payroll.repository.js";
import type {
  BonusInput,
  CreateRunInput,
  DeductionInput,
  PaymentInput,
} from "../validation/payroll.validation.js";
import { scopeEmployee } from "./scope.js";

// ---- runs -----------------------------------------------------------------

export async function createRun(input: CreateRunInput, userId: string) {
  return getDatabase().withTransaction(async (client) => {
    const policy = await repo.getPolicy(client, input.payroll_policy_id);
    if (!policy) throw badRequest("No active payroll policy found");
    const overtimeId = await repo.getOvertimeConfigId(client, input.overtime_rate_config_id);
    if (!overtimeId) throw badRequest("No active overtime rate configuration found");

    if (await repo.hasOverlappingRun(client, input.period_start, input.period_end)) {
      throw conflict("A payroll run already exists for an overlapping period");
    }
    const id = await repo.insertRun(
      client, input.period_start, input.period_end, policy.id, overtimeId, userId
    );
    return repo.getRun(client, id);
  });
}

export const listRuns = repo.listRuns;

export async function getRun(id: string) {
  const run = await repo.getRun(getDatabase(), id);
  if (!run) throw notFound("Payroll run not found");
  return run;
}

async function withDraftRun<T>(id: string, work: (client: import("../database/queryable.js").Queryable) => Promise<T>) {
  return getDatabase().withTransaction(async (client) => {
    const run = await repo.lockRunStatus(client, id);
    if (!run) throw notFound("Payroll run not found");
    if (run.status !== "DRAFT") throw conflict(`Payroll run is already ${run.status}`);
    await work(client);
    return repo.getRun(client, id);
  });
}

/** Recomputes DRAFT records for all active employees (a preview before finalizing). */
export const computeRun = (id: string) =>
  withDraftRun(id, (client) => repo.computeAllRecords(client, id));

/** Atomically generates records and finalizes the run via the SQL function. */
export const finalizeRun = (id: string) =>
  withDraftRun(id, (client) => repo.finalizeRunInDb(client, id));

// ---- records --------------------------------------------------------------

/** Employees only see their own finalized or paid records. */
export function listRecords(
  user: AuthUser,
  q: { payroll_run_id?: string; employee_id?: string; status?: string; limit: number; offset: number }
) {
  const employeeId = scopeEmployee(user, q.employee_id);
  const visible = user.role === "EMPLOYEE" ? ["FINALIZED", "PAID"] : undefined;
  if (visible && q.status && !visible.includes(q.status)) return Promise.resolve([]);
  return repo.listRecords({
    runId: q.payroll_run_id,
    employeeId,
    status: q.status,
    statuses: visible,
    limit: q.limit,
    offset: q.offset,
  });
}

async function loadVisibleRecord(user: AuthUser, id: string) {
  const record = await repo.getRecord(getDatabase(), id);
  const hidden =
    user.role === "EMPLOYEE" &&
    (record?.employee_id !== user.employee_id || record?.status === "DRAFT");
  if (!record || hidden) throw notFound("Payroll record not found");
  return record;
}

export const getRecord = loadVisibleRecord;

export async function getPayslip(user: AuthUser, id: string) {
  const record = await loadVisibleRecord(user, id);
  const extras = await repo.getPayslipExtras(getDatabase(), record);
  return {
    record,
    employee: extras.employee,
    period: { start: record.period_start, end: record.period_end },
    attendance: extras.attendance,
    payment: extras.payment,
  };
}

// ---- bonuses & deductions -------------------------------------------------

async function assertAdjustable(
  client: import("../database/queryable.js").Queryable,
  employeeId: string,
  start: string,
  end: string
) {
  const status = await findEmployeeStatus(client, employeeId);
  if (!status) throw notFound("Employee not found");
  if (status !== "ACTIVE") throw conflict("Employee is inactive");
  if (await repo.hasFinalizedRunOverlap(client, start, end)) {
    throw conflict("The period overlaps an already finalized payroll run");
  }
}

export async function createBonus(input: BonusInput, userId: string) {
  return getDatabase().withTransaction(async (client) => {
    await assertAdjustable(client, input.employee_id, input.period_start, input.period_end);
    const id = await repo.insertBonus(client, userId, input);
    await repo.insertAudit(client, userId, "CREATE", "bonus", id, {
      employee_id: input.employee_id, amount: input.amount, reason: input.reason,
    });
    return repo.getBonus(client, id);
  });
}

export async function createDeduction(input: DeductionInput, userId: string) {
  return getDatabase().withTransaction(async (client) => {
    await assertAdjustable(client, input.employee_id, input.period_start, input.period_end);
    const id = await repo.insertDeduction(client, userId, input);
    await repo.insertAudit(client, userId, "CREATE", "deduction", id, {
      employee_id: input.employee_id, amount: input.amount, reason: input.reason,
      deduction_type: input.deduction_type,
    });
    return repo.getDeduction(client, id);
  });
}

export const listBonuses = (q: { employee_id?: string; payroll_run_id?: string; limit: number; offset: number }) =>
  repo.listAdjustments("bonus", { employeeId: q.employee_id, runId: q.payroll_run_id, limit: q.limit, offset: q.offset });
export const listDeductions = (q: { employee_id?: string; payroll_run_id?: string; limit: number; offset: number }) =>
  repo.listAdjustments("deduction", { employeeId: q.employee_id, runId: q.payroll_run_id, limit: q.limit, offset: q.offset });

// ---- payments -------------------------------------------------------------

export async function recordPayment(input: PaymentInput, userId: string) {
  return getDatabase().withTransaction(async (client) => {
    const record = await repo.lockRecordForPayment(client, input.payroll_record_id);
    if (!record) throw notFound("Payroll record not found");
    if (record.status === "PAID") throw conflict("Payroll record has already been paid");
    if (record.status !== "FINALIZED") throw conflict("Payment requires a FINALIZED payroll record");

    const id = await repo.insertPayment(client, userId, input);
    await repo.markRecordPaid(client, record.id);
    await repo.insertAudit(client, userId, "PAYMENT", "payment", id, {
      payroll_record_id: record.id, reference: input.reference ?? null,
    });
    return repo.getPayment(client, id);
  });
}

export const listPayments = (q: { payroll_record_id?: string; employee_id?: string; limit: number; offset: number }) =>
  repo.listPayments({ recordId: q.payroll_record_id, employeeId: q.employee_id, limit: q.limit, offset: q.offset });
