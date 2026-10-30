import { z } from "zod";
import { parseWith } from "./parse.js";
import { isoDate, pagingShape, uuid } from "./common.js";

const createSchema = z
  .object({
    leave_type_id: uuid,
    start_date: isoDate,
    end_date: isoDate,
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine((v) => v.end_date >= v.start_date, {
    message: "end_date must not be before start_date",
    path: ["end_date"],
  });

const listSchema = z
  .object({
    employee_id: uuid.optional(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
    ...pagingShape,
  })
  .strict();

const balancesSchema = z.object({ employee_id: uuid.optional() }).strict();

const adjustSchema = z
  .object({
    employee_id: uuid,
    leave_type_id: uuid,
    balance_days: z.number().min(0).max(999.99).multipleOf(0.01),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export type AdjustBalanceInput = z.infer<typeof adjustSchema>;
export const parseAdjustBalance = (b: unknown) => parseWith(adjustSchema, b, "request body");
export type CreateLeaveInput = z.infer<typeof createSchema>;
export const parseCreateLeave = (b: unknown) => parseWith(createSchema, b, "request body");
export const parseListLeave = (q: unknown) => parseWith(listSchema, q, "query parameters");
export const parseLeaveBalances = (q: unknown) => parseWith(balancesSchema, q, "query parameters");
