import { z } from "zod";
import { badRequest } from "../errors/app-error.js";
import { parseWith } from "./parse.js";
import { isoDate, pagingShape, uuid } from "./common.js";

/**
 * Face recognition is not wired up yet, so only MANUAL is accepted; the
 * server clock is authoritative and any client timestamp is rejected.
 */
const punchSchema = z
  .object({
    employee_id: z.uuid().optional(),
    source: z.literal("MANUAL").optional(),
  })
  .strict();

const timestamp = z.iso.datetime({ offset: true });

export const correctionSchema = z
  .object({
    check_in: timestamp.optional(),
    check_out: timestamp.optional(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict()
  .refine((v) => v.check_in !== undefined || v.check_out !== undefined, {
    message: "check_in or check_out must be provided",
  })
  .refine(
    (v) =>
      v.check_in === undefined ||
      v.check_out === undefined ||
      Date.parse(v.check_out) >= Date.parse(v.check_in),
    { message: "check_out must not be before check_in", path: ["check_out"] }
  );

const todayQuerySchema = z.object({ employee_id: z.uuid().optional() }).strict();

const listSchema = z
  .object({
    employee_id: uuid.optional(),
    department_id: uuid.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    ...pagingShape,
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    message: "to must not be before from",
    path: ["to"],
  });

export type PunchInput = z.infer<typeof punchSchema>;
export type CorrectionInput = z.infer<typeof correctionSchema>;

export const parsePunchBody = (body: unknown): PunchInput =>
  parseWith(punchSchema, body ?? {}, "request body");
export const parseCorrectionBody = (body: unknown): CorrectionInput =>
  parseWith(correctionSchema, body, "request body");
export const parseTodayQuery = (query: unknown): { employee_id?: string } =>
  parseWith(todayQuerySchema, query, "query parameters");

/** Rejects timestamps after the server clock. */
export function assertNotFuture(...values: (string | undefined)[]): void {
  const now = Date.now();
  for (const v of values) {
    if (v !== undefined && Date.parse(v) > now) {
      throw badRequest("Timestamps cannot be in the future");
    }
  }
}

export const parseListAttendance = (query: unknown) =>
  parseWith(listSchema, query, "query parameters");
