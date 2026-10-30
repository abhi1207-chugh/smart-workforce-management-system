import { hashPassword, verifyPassword } from "../auth/password.js";
import { signToken } from "../auth/token.js";
import type { AuthUser } from "../auth/types.js";
import { unauthorized } from "../errors/app-error.js";
import { findUserByEmail } from "../repositories/user.repository.js";

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

const INVALID_CREDENTIALS = "Invalid email or password";

// Compared against when the email is unknown, so response time does not reveal
// whether an account exists.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("dummy-password-for-timing");
  return dummyHashPromise;
}

export async function login(
  email: string,
  password: string,
  config: AuthConfig
): Promise<LoginResult> {
  const record = await findUserByEmail(email);

  if (!record) {
    await verifyPassword(password, await getDummyHash());
    throw unauthorized(INVALID_CREDENTIALS);
  }

  const passwordOk = await verifyPassword(password, record.password_hash);
  if (!passwordOk) {
    throw unauthorized(INVALID_CREDENTIALS);
  }

  // Same message on purpose: do not reveal that the account exists but is disabled.
  if (record.status !== "ACTIVE") {
    throw unauthorized(INVALID_CREDENTIALS);
  }
  if (record.role === "EMPLOYEE" && record.employee_status !== "ACTIVE") {
    throw unauthorized(INVALID_CREDENTIALS);
  }

  const user: AuthUser = {
    id: record.id,
    email: record.email,
    role: record.role,
    employee_id: record.employee_id,
  };

  return {
    token: signToken(user, config.jwtSecret, config.jwtExpiresIn),
    user,
  };
}
