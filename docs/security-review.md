# Security Review (Execution Plan Stage 6)

Scope: backend API (`backend/src`) and the frontend token handling. Method: static review plus the
automated sweep in `backend/tests/security.test.ts`.

## Checked and OK
| Area | Result |
|---|---|
| SQL injection | All values go through `$n` placeholders. The only interpolated SQL fragments are constants: `UPDATABLE_COLUMNS` (fixed whitelist), `Where` conditions (string literals in code), `LIMIT/OFFSET` placeholders. Injection payloads in query params, path ids and login fields return 400/404/401, never 500. |
| Missing authentication | The test discovers every registered route from the Express router stacks and asserts each one except `GET /health` and `POST /auth/login` returns 401 without a token. New routes are covered automatically. |
| Forged tokens | Wrong secret, `alg: none`, expired, role outside the enum, and missing subject are all 401. Malformed `Authorization` headers are 401. Only HS256 is accepted. |
| Role checks | 17 representative ADMIN-only routes return 403 for an EMPLOYEE token. |
| Object-level access (IDOR) | EMPLOYEE reads of other people's leave requests, payroll records and payslips return 404. Lists are pinned to the caller with `scopeEmployee`. |
| Credential handling | bcrypt hashes; unknown email and wrong password give identical responses (a dummy hash is verified to equalise timing); disabled accounts get the same message. Login is rate limited (see Stage 6a). |
| Secrets | `.env` is git-ignored and not tracked; no secrets found in tracked source; `JWT_SECRET` must be at least 32 characters. Password hashes and embeddings never appear in API responses. |
| Error handling | Raw PostgreSQL errors are not returned (only deliberate `RAISE EXCEPTION` business messages, as 409). |
| Dependencies | `npm audit fix` applied. Backend: 0 production vulnerabilities. See "Accepted risks". |

## Kiosk session
The kiosk has no password. An ADMIN mints a one-time launch code (`POST /kiosk/launch`); the kiosk page redeems it for a `KIOSK` token (`POST /kiosk/session`, public, IP rate limited). Codes are 256-bit random, expire in 60 s, are single use (deleted on first look-up even when invalid) and only their SHA-256 is held in memory. They travel in the URL fragment, so they are not sent to the server or in Referer. Activations are audited with the launching admin as actor. Every route refuses the KIOSK role by default (403, enforced in `createAuthenticate`, proven by a sweep over the whole route table); allowed are `POST /face/recognize`, `POST /attendance/check-in|check-out` (face proof only) and `GET /auth/me`. Residual risks: a KIOSK token cannot be revoked before it expires (default 12 h) and can scan faces / punch only with a real face match; launch codes are per-process memory, so a restart invalidates pending ones (launch again).

## Fixed in this review
1. **Malformed JSON / oversized body returned 500.** The error handler now maps body-parser errors to 400 / 413, and the JSON body limit is explicit (100 kb).
2. **Missing hardening headers.** Added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`, and removed `X-Powered-By`.

## Accepted risks / known limitations
- **Stateless JWT (8 h).** A deactivated user or employee keeps a valid token until it expires. Impact is bounded: check-in/out requires an ACTIVE employee, and new logins are refused. Reads of that person's own data remain possible for up to 8 h. Mitigation if needed: look up the user's status in `authenticate` (one query per request) or shorten `JWT_EXPIRES_IN`.
- **Token in `localStorage`** (frontend). Exposed to any XSS; the app has no `dangerouslySetInnerHTML`/`innerHTML`, but there is no CSP yet. An HttpOnly cookie would need CSRF protection.
- **Face proof is replayable for its TTL** (30 s). Bounded by the duplicate-session and active-employee checks; the TTL must not be extended.
- **Rate limiter is in-memory and per process**; behind a reverse proxy enable Express `trust proxy`, otherwise all clients share one IP bucket.
- **No TLS / CORS / security headers on the frontend** in dev. Production configuration belongs to Phase 6 (TLS termination, CSP, secrets management).
- **Dev-only dependency advisories** (vitest/vite/tinypool in the backend; `postcss` bundled inside Next.js in the frontend) need breaking upgrades. They are not reachable in production runtime and are left as-is rather than using `npm audit fix --force`.
- **Seed credentials** (`admin@example.com` / `Admin@12345`) are for local development only and must not exist in any deployed database.
