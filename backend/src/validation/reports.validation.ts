import { z } from "zod";
import { parseWith } from "./parse.js";
import { isoDate, pagingShape, uuid } from "./common.js";

const MAX_RANGE_DAYS = 366;
const dayMs = 86_400_000;

const range = <T extends { from: string; to: string }>(v: T) =>
  v.to >= v.from && (Date.parse(v.to) - Date.parse(v.from)) / dayMs <= MAX_RANGE_DAYS;
const rangeIssue = {
  message: `from/to must be ordered and at most ${MAX_RANGE_DAYS} days apart`,
  path: ["to"],
};

const attendanceSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    employee_id: uuid.optional(),
    department_id: uuid.optional(),
  })
  .strict()
  .refine(range, rangeIssue);

const leaveBalancesSchema = z
  .object({ employee_id: uuid.optional(), leave_type_code: z.string().trim().min(1).max(50).optional() })
  .strict();

const payrollRegisterSchema = z.object({ period_id: uuid }).strict();

const meSchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .strict()
  .refine((v) => !v.from || !v.to || v.to >= v.from, rangeIssue);

const auditSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    entity_type: z.string().trim().min(1).max(100).optional(),
    entity_id: uuid.optional(),
    actor_id: uuid.optional(),
    ...pagingShape,
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.to >= v.from, rangeIssue);

const q = "query parameters";
export const parseAttendanceSummary = (v: unknown) => parseWith(attendanceSchema, v, q);
export const parseLeaveBalanceReport = (v: unknown) => parseWith(leaveBalancesSchema, v, q);
export const parsePayrollRegister = (v: unknown) => parseWith(payrollRegisterSchema, v, q);
export const parseMeSummary = (v: unknown) => parseWith(meSchema, v, q);
export const parseAuditQuery = (v: unknown) => parseWith(auditSchema, v, q);
