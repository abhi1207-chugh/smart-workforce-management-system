import { z } from "zod";
import { parseWith } from "./parse.js";
import { isoDate, pagingShape, uuid } from "./common.js";

const createSchema = z
  .object({
    employee_id: uuid.optional(),
    work_date: isoDate,
    /** ADMIN only; when omitted, minutes are derived from attendance. */
    overtime_minutes: z.number().int().min(1).max(1440).optional(),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

const listSchema = z
  .object({
    employee_id: uuid.optional(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    ...pagingShape,
  })
  .strict();

export type CreateOvertimeInput = z.infer<typeof createSchema>;
export const parseCreateOvertime = (b: unknown) => parseWith(createSchema, b, "request body");
export const parseListOvertime = (q: unknown) => parseWith(listSchema, q, "query parameters");
