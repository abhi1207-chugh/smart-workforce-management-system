import type { z } from "zod";
import { badRequest } from "../errors/app-error.js";

export function parseWith<T>(
  schema: z.ZodType<T>,
  value: unknown,
  what: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest(`Invalid ${what}`, parsed.error.issues);
  }
  return parsed.data;
}
