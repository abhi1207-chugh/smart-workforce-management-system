import { z } from "zod";
import { asyncHandler } from "../middleware/async-handler.js";
import { unauthorized } from "../errors/app-error.js";
import type { AuthConfig } from "../services/auth.service.js";
import { createLaunchCode, redeemLaunchCode } from "../services/kiosk.service.js";
import { parseWith } from "../validation/parse.js";

const sessionSchema = z.object({ code: z.string().min(20).max(200) }).strict();

/** ADMIN: mint a one-time code that opens the kiosk page. */
export const launchHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  res.status(201).json({ success: true, data: createLaunchCode(req.user.id) });
});

/** Public: the kiosk page trades the code for a KIOSK session token. */
export function createKioskSessionHandler(auth: AuthConfig) {
  return asyncHandler(async (req, res) => {
    const { code } = parseWith(sessionSchema, req.body, "request body");
    res.status(200).json({ success: true, data: await redeemLaunchCode(code, auth) });
  });
}
