import { z } from "zod";
import { badRequest } from "../errors/app-error.js";

export const loginBodySchema = z.object({
  email: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(200),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export function parseLoginBody(body: unknown): LoginBody {
  const parsed = loginBodySchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest("Invalid login request", parsed.error.issues);
  }
  return parsed.data;
}
