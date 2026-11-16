import { createHash, randomBytes, randomUUID } from "node:crypto";
import { signToken } from "../auth/token.js";
import type { AuthUser } from "../auth/types.js";
import { getDatabase } from "../database/client.js";
import { unauthorized } from "../errors/app-error.js";
import type { AuthConfig } from "./auth.service.js";

/** A launch code is good for this long and for a single redemption. */
export const LAUNCH_CODE_TTL_SECONDS = 60;
const MAX_PENDING_CODES = 1000;
const DEFAULT_KIOSK_TOKEN_TTL = "12h";

interface PendingCode {
  adminUserId: string;
  expiresAt: number;
}

// In-memory and per process: codes live for 60 s, so a restart only means "launch again".
// Only the SHA-256 of a code is kept, never the code itself.
const pending = new Map<string, PendingCode>();
const digest = (code: string) => createHash("sha256").update(code).digest("hex");

function sweep(now: number): void {
  for (const [k, v] of pending) if (v.expiresAt <= now) pending.delete(k);
  while (pending.size >= MAX_PENDING_CODES) pending.delete(pending.keys().next().value!);
}

/** ADMIN only (enforced by the route). Returns a one-time code for the kiosk page. */
export function createLaunchCode(adminUserId: string): { code: string; expires_in_seconds: number } {
  const now = Date.now();
  sweep(now);
  const code = randomBytes(32).toString("base64url");
  pending.set(digest(code), { adminUserId, expiresAt: now + LAUNCH_CODE_TTL_SECONDS * 1000 });
  return { code, expires_in_seconds: LAUNCH_CODE_TTL_SECONDS };
}

export interface KioskSessionDto {
  token: string;
  user: AuthUser;
}

/**
 * Public (the kiosk page has no session yet). Single use: the code is deleted on first
 * look-up, valid or not. Issues a KIOSK token and audits who activated the device.
 */
export async function redeemLaunchCode(code: string, config: AuthConfig): Promise<KioskSessionDto> {
  const key = digest(code);
  const entry = pending.get(key);
  pending.delete(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    throw unauthorized("This kiosk link has expired. Open the kiosk again from the admin portal.");
  }

  const sessionId = randomUUID();
  const user: AuthUser = { id: sessionId, email: "kiosk@device", role: "KIOSK", employee_id: null };
  await getDatabase().query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, 'KIOSK_ACTIVATED', 'kiosk_session', $2, $3::jsonb)`,
    [entry.adminUserId, sessionId, JSON.stringify({ token_ttl: config.kioskExpiresIn ?? DEFAULT_KIOSK_TOKEN_TTL })]
  );
  return {
    token: signToken(user, config.jwtSecret, config.kioskExpiresIn ?? DEFAULT_KIOSK_TOKEN_TTL),
    user,
  };
}
