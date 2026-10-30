import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { signToken, verifyToken } from "../src/auth/token.js";
import type { AuthUser } from "../src/auth/types.js";

const SECRET = "a".repeat(32);
const user: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "admin@example.com",
  role: "ADMIN",
  employee_id: null,
};

describe("password utilities", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("Secret123!");
    expect(hash).not.toBe("Secret123!");
    expect(await verifyPassword("Secret123!", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("Secret123!");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("token utilities", () => {
  it("round-trips a user through sign and verify", () => {
    const token = signToken(user, SECRET, "1h");
    expect(verifyToken(token, SECRET)).toEqual(user);
  });

  it("rejects a token signed with another secret", () => {
    const token = signToken(user, SECRET, "1h");
    expect(() => verifyToken(token, "b".repeat(32))).toThrow(/Invalid/);
  });

  it("rejects an expired token", () => {
    const token = jwt.sign({ sub: user.id, email: user.email, role: "ADMIN" }, SECRET, {
      expiresIn: -10,
    });
    expect(() => verifyToken(token, SECRET)).toThrow(/Invalid or expired/);
  });

  it("rejects garbage", () => {
    expect(() => verifyToken("not.a.token", SECRET)).toThrow(/Invalid or expired/);
  });

  it("rejects a token with an unknown role", () => {
    const token = jwt.sign({ sub: user.id, email: user.email, role: "HACKER" }, SECRET);
    expect(() => verifyToken(token, SECRET)).toThrow(/Invalid/);
  });
});
