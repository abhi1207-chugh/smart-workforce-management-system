# Face Recognition ↔ Attendance Integration Contract

**Audience:** whoever owns the attendance routes and the kiosk/frontend.
**Status:** the face side (register / revoke / status / recognize) is implemented and tested.
The attendance side is **not changed yet**; this document lists exactly what must change.

Principle (unchanged): recognition only **identifies**. The backend **decides** and is the only
writer of attendance. `POST /face/recognize` never writes anything.

---

## 1. Flow

```
Kiosk (logged in as ADMIN)
  1. Camera → face-api.js → 128-d embedding           (browser)
  2. POST /api/v1/face/recognize { embedding }         → matched? employee_id, confidence, recognition_token
  3. Show "Hello <name>" (fetch employee via GET /employees/{id}) – optional confirmation
  4. POST /api/v1/attendance/check-in  (or /check-out)
        { employee_id, source: "FACE_RECOGNITION", recognition_token }
  5. Backend re-validates everything (§3) and writes the session using the SERVER clock
```

If recognize returns `matched: false` (`reason` = `NO_MATCH` or `AMBIGUOUS`), the kiosk must **not**
call attendance. It falls back to the existing manual flow (`source: "MANUAL"` with a chosen
`employee_id`), which keeps working exactly as today.

If the vector search is unavailable (`/health` → `vector_db` is `degraded`/`down`) the kiosk should
go straight to the manual flow.

---

## 2. `POST /face/recognize`

**Auth:** any valid Bearer token (the kiosk is an ADMIN login).

Request (strict; extra fields → 400):

```json
{ "embedding": [/* exactly 128 finite numbers, not all zero */] }
```

Response 200 – match:

```json
{
  "success": true,
  "data": {
    "matched": true,
    "employee_id": "uuid",
    "confidence": 0.9731,
    "threshold": 0.9,
    "reason": null,
    "recognition_token": "<signed proof>",
    "expires_in_seconds": 30
  }
}
```

Response 200 – no match (`reason`: `NO_MATCH` | `AMBIGUOUS`):

```json
{
  "success": true,
  "data": {
    "matched": false, "employee_id": null, "confidence": 0, "threshold": 0.9,
    "reason": "NO_MATCH", "recognition_token": null, "expires_in_seconds": null
  }
}
```

- `confidence` is cosine similarity computed by the server. Clients cannot supply it.
- Only ACTIVE faces of ACTIVE employees are searched.
- `AMBIGUOUS`: a second employee also passed the threshold within `FACE_AMBIGUITY_MARGIN`.
- 400 invalid embedding, 401 missing/invalid token.

### Recognition proof (`recognition_token`)

A short-lived (`FACE_PROOF_TTL_SECONDS`, default 30 s) HS256 JWT, signed with a key derived from
`JWT_SECRET` and a purpose label. Claims: `sub` = employee id, `conf` = confidence,
`uid` = the authenticated user who called recognize, `aud` = `face-recognition-proof`.
It cannot be used as a login token and a login token cannot be used as a proof.

Verify it with the existing helper (do not hand-roll JWT checks):

```ts
import { verifyRecognitionProof } from "../auth/recognition-proof.js";
const proof = verifyRecognitionProof(token, jwtSecret);
// → { employee_id, confidence, user_id }   (throws 401 AppError if invalid/expired/wrong type)
```

The proof is stateless, so it is **replayable until it expires** (≤ 30 s). The duplicate-open-session
rule (409) and the active-employee rule bound the damage; do not extend the TTL.

---

## 3. What check-in / check-out must do for `source: "FACE_RECOGNITION"`

All of these run in the backend **before** writing. Any failure → no attendance row.

| # | Check | Failure |
|---|---|---|
| 1 | `recognition_token` present and `verifyRecognitionProof` succeeds | 401 (from the helper) |
| 2 | `proof.employee_id === body.employee_id` (reject a token for a different person) | 400/403 |
| 3 | `proof.user_id === req.user.id` (token was issued to this caller) | 403 |
| 4 | `proof.confidence >= FACE_MATCH_THRESHOLD` (re-validate against current config; never trust a client score) | 400 |
| 5 | Employee exists and is `ACTIVE` (existing `findEmployeeStatus` check) | 404 / 409 |
| 6 | Employee still has an ACTIVE face registration (query below) – covers revoke after recognize | 409 |
| 7 | Existing rules: no duplicate open session (409), server clock, shift flags, etc. | unchanged |

Check 6 query (parameterized):

```sql
SELECT 1 FROM face_registration_metadata WHERE employee_id = $1 AND status = 'ACTIVE'
```

Notes:
- ADMIN may punch for any employee, so for the kiosk `body.employee_id` comes from the recognize
  result, not from a picker. For an EMPLOYEE token, keep the existing "only yourself" rule in
  `resolveEmployeeId`.
- A client-supplied `recognition_confidence` (api-contract §9) must be **ignored**; the confidence
  comes only from the verified proof. Do not accept it in the schema (strict schemas already reject it).
- The `source` stored must be `FACE_RECOGNITION` (enum `attendance_source` already contains it).

---

## 4. Concrete changes needed in the attendance code (not done by the face work)

1. `validation/attendance.validation.ts` – `punchSchema`:
   `source: z.enum(["MANUAL", "FACE_RECOGNITION"]).optional()` and
   `recognition_token: z.string().min(20).max(2000).optional()`, with a refine:
   `source === "FACE_RECOGNITION"` ⇔ `recognition_token` present (MANUAL must not carry one).
2. `controllers/attendance.controller.ts` – pass `source`, `recognition_token`, `req.user` and the
   face config (`loadFaceConfig()`) into `checkIn` / `checkOut`.
3. `services/attendance.service.ts` – add the checks in §3 before `insertOpenSession` /
   `completeCheckout` for the face source. Suggested helper:
   `assertFaceProof(user, employeeId, token, jwtSecret, faceConfig)`.
4. `repositories/attendance.repository.ts` – `insertOpenSession` hard-codes
   `check_in_source = 'MANUAL'` (line ~47); give it a `source` parameter so `FACE_RECOGNITION` is
   stored. `complete_attendance_checkout()` sets `check_out_source = COALESCE(check_out_source,
   check_in_source)`, so a face check-in yields a face check-out source automatically. If a
   face-verified check-out should be recorded as `FACE_RECOGNITION` while the check-in was
   `MANUAL` (or vice versa), the checkout path needs to set `check_out_source` explicitly before
   calling the function.
5. Tests (`tests/attendance.test.ts`): valid proof → 201 with stored source `FACE_RECOGNITION`;
   missing/forged/expired proof → 401; proof for another employee → rejected; proof issued to a
   different user → 403; face revoked or employee deactivated between recognize and check-in →
   409; `MANUAL` unchanged; duplicate open session → 409.

Test helper for the attendance tests: obtain a real proof by registering a face via
`POST /employees/{id}/face/register` and calling `POST /face/recognize`, or sign one directly with
`signRecognitionProof({ employee_id, confidence, user_id }, jwtSecret, 30)`.

---

### Kiosk already built (frontend)

`/kiosk` (ADMIN) runs the §1 flow up to step 4. It builds the punch body in one place,
`punchBody()` in `frontend/src/lib/face.ts`. While `ATTENDANCE_ACCEPTS_FACE_PROOF = false` it sends
`{ employee_id }` only (today's `MANUAL` behaviour). **When the attendance changes in §4 are merged,
set that constant to `true`** and the kiosk will send `source: "FACE_RECOGNITION"` and the
`recognition_token`. The kiosk also hides the confirmation after the proof expires.

## 5. Related behaviour the attendance side can rely on

- Deactivating an employee (`POST /employees/{id}/deactivate`) now revokes their face and deletes the
  embedding in the same transaction (audit `FACE_REVOKED`, reason `EMPLOYEE_DEACTIVATED`).
- Re-registering supersedes the old face atomically; at most one ACTIVE face per employee.
- `face_registered` on `GET /employees` and `GET /employees/{id}` reflects the ACTIVE registration.
- Embeddings are never returned by any endpoint and never logged.
- Face endpoints: `POST /employees/{id}/face/register`, `DELETE /employees/{id}/face`,
  `GET /employees/{id}/face/status` (ADMIN) and `POST /face/recognize` (any authenticated role).

## 6. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FACE_MATCH_THRESHOLD` | 0.90 | Minimum cosine similarity (0.5–1) for a match |
| `FACE_AMBIGUITY_MARGIN` | 0.03 | Runner-up within this margin (and above threshold) ⇒ `AMBIGUOUS` |
| `FACE_PROOF_TTL_SECONDS` | 30 | Proof lifetime (5–300) |

The threshold needs tuning with real face-api.js descriptors once the capture UI exists.
