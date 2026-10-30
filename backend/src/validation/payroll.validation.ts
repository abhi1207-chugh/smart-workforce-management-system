import { z } from "zod";
import { parseWith } from "./parse.js";
import { isoDate, pagingShape, uuid } from "./common.js";

const money = z
  .number()
  .positive()
  .max(9_999_999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: "At most 2 decimal places",
  });

const period = {
  period_start: isoDate,
  period_end: isoDate,
};
const periodOrder = (v: { period_start: string; period_end: string }) =>
  v.period_end >= v.period_start;
const periodIssue = {
  message: "period_end must not be before period_start",
  path: ["period_end"],
};

const createRunSchema = z
  .object({
    ...period,
    payroll_policy_id: uuid.optional(),
    overtime_rate_config_id: uuid.optional(),
  })
  .strict()
  .refine(periodOrder, periodIssue);

const adjustmentBase = {
  employee_id: uuid,
  ...period,
  amount: money,
  reason: z.string().trim().min(1).max(1000),
};
const bonusSchema = z.object(adjustmentBase).strict().refine(periodOrder, periodIssue);
const deductionSchema = z
  .object({ ...adjustmentBase, deduction_type: z.string().trim().min(1).max(100) })
  .strict()
  .refine(periodOrder, periodIssue);

const adjustmentListSchema = z
  .object({ employee_id: uuid.optional(), payroll_run_id: uuid.optional(), ...pagingShape })
  .strict();

const runListSchema = z
  .object({ status: z.enum(["DRAFT", "FINALIZED", "FAILED"]).optional(), ...pagingShape })
  .strict();

const recordListSchema = z
  .object({
    payroll_run_id: uuid.optional(),
    employee_id: uuid.optional(),
    status: z.enum(["DRAFT", "FINALIZED", "PAID"]).optional(),
    ...pagingShape,
  })
  .strict();

const paymentSchema = z
  .object({
    payroll_record_id: uuid,
    paid_at: z.iso.datetime({ offset: true }).optional(),
    reference: z.string().trim().min(1).max(255).optional(),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

const paymentListSchema = z
  .object({ payroll_record_id: uuid.optional(), employee_id: uuid.optional(), ...pagingShape })
  .strict();

export type CreateRunInput = z.infer<typeof createRunSchema>;
export type BonusInput = z.infer<typeof bonusSchema>;
export type DeductionInput = z.infer<typeof deductionSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;

const q = "query parameters";
const b = "request body";
export const parseCreateRun = (v: unknown) => parseWith(createRunSchema, v, b);
export const parseBonus = (v: unknown) => parseWith(bonusSchema, v, b);
export const parseDeduction = (v: unknown) => parseWith(deductionSchema, v, b);
export const parsePayment = (v: unknown) => parseWith(paymentSchema, v, b);
export const parseAdjustmentList = (v: unknown) => parseWith(adjustmentListSchema, v, q);
export const parseRunList = (v: unknown) => parseWith(runListSchema, v, q);
export const parseRecordList = (v: unknown) => parseWith(recordListSchema, v, q);
export const parsePaymentList = (v: unknown) => parseWith(paymentListSchema, v, q);
