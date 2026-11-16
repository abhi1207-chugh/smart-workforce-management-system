import { signRecognitionProof } from "../auth/recognition-proof.js";
import type { FaceConfig } from "../config/env.js";
import { getDatabase } from "../database/client.js";
import { listSessionsForToday } from "../repositories/attendance.repository.js";
import { searchNearest } from "../repositories/face.repository.js";

export interface RecognitionResultDto {
  matched: boolean;
  employee_id: string | null;
  /** Cosine similarity of the best candidate when matched, otherwise 0. */
  confidence: number;
  threshold: number;
  /** Minimal display info for the matched employee (so a kiosk needs no employee-read access). */
  employee: { employee_code: string; first_name: string; last_name: string } | null;
  /** Today's attendance state of the matched employee, to suggest check-in vs check-out. */
  today_status: "NOT_CHECKED_IN" | "CHECKED_IN" | "CHECKED_OUT" | null;
  /** Why there is no match; null when matched. */
  reason: "NO_MATCH" | "AMBIGUOUS" | null;
  /** Signed, short-lived proof for the attendance check-in; null when not matched. */
  recognition_token: string | null;
  expires_in_seconds: number | null;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Identifies an employee from an embedding. Read-only: it never writes attendance
 * (or anything else). The caller must still pass the returned proof to the
 * attendance check-in, where the backend re-validates the employee.
 */
export async function recognizeFace(
  embedding: number[],
  requestedByUserId: string,
  jwtSecret: string,
  face: FaceConfig
): Promise<RecognitionResultDto> {
  const noMatch = (reason: "NO_MATCH" | "AMBIGUOUS"): RecognitionResultDto => ({
    matched: false,
    employee_id: null,
    confidence: 0,
    threshold: face.matchThreshold,
    employee: null,
    today_status: null,
    reason,
    recognition_token: null,
    expires_in_seconds: null,
  });

  const [best, second] = await searchNearest(getDatabase(), embedding, 3);
  if (!best || best.similarity < face.matchThreshold) return noMatch("NO_MATCH");

  // BR-FACE-07: a different employee that also passes the threshold and is within
  // the margin of the best score makes the identification unsafe.
  if (
    second &&
    second.employee_id !== best.employee_id &&
    second.similarity >= face.matchThreshold &&
    best.similarity - second.similarity <= face.ambiguityMargin
  ) {
    return noMatch("AMBIGUOUS");
  }

  const db = getDatabase();
  const [who, sessions] = await Promise.all([
    db.query(`SELECT employee_code, first_name, last_name FROM employee WHERE id = $1`, [
      best.employee_id,
    ]),
    listSessionsForToday(db, best.employee_id),
  ]);
  const employee = who.rows[0] as RecognitionResultDto["employee"];
  if (!employee) return noMatch("NO_MATCH");

  const confidence = round4(Math.min(best.similarity, 1));
  return {
    matched: true,
    employee_id: best.employee_id,
    confidence,
    threshold: face.matchThreshold,
    employee,
    today_status: sessions.some((s) => s.status === "CHECKED_IN")
      ? "CHECKED_IN"
      : sessions.length > 0
        ? "CHECKED_OUT"
        : "NOT_CHECKED_IN",
    reason: null,
    recognition_token: signRecognitionProof(
      { employee_id: best.employee_id, confidence, user_id: requestedByUserId },
      jwtSecret,
      face.proofTtlSeconds
    ),
    expires_in_seconds: face.proofTtlSeconds,
  };
}
