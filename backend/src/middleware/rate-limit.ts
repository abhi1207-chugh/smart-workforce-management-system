import type { Request, RequestHandler } from "express";
import { tooManyRequests } from "../errors/app-error.js";
import type { RateLimitRule } from "../config/env.js";

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_KEYS = 10_000;

/**
 * In-memory fixed-window limiter. State is per process (fine for one API
 * instance; use a shared store if the API is ever scaled out). Returns 429 with
 * Retry-After when a key exceeds `rule.max` in the window. A null key skips the limit.
 */
export function createRateLimiter(
  rule: RateLimitRule,
  keyFor: (req: Request) => string | null,
  now: () => number = Date.now
): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req, res, next) => {
    const key = keyFor(req);
    if (key === null) return next();
    const t = now();

    if (buckets.size >= MAX_KEYS) {
      for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
      // Still full of live keys: drop the oldest so memory stays bounded.
      if (buckets.size >= MAX_KEYS) buckets.delete(buckets.keys().next().value!);
    }

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + rule.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > rule.max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - t) / 1000))));
      return next(tooManyRequests());
    }
    next();
  };
}

export const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? "unknown";

/** IP + lower-cased submitted email, so one account cannot be hammered from one address. */
export function loginAccountKey(req: Request): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  const id = typeof email === "string" ? email.trim().toLowerCase().slice(0, 254) : "";
  return `${clientIp(req)}|${id}`;
}
