import { signRecognitionProof } from "../auth/recognition-proof.js";
import type { FaceConfig } from "../config/env.js";
import { getDatabase } from "../database/client.js";
import { searchNearest } from "../repositories/face.repository.js";

export interface RecognitionResultDto {
  matched: boolean;
  employee_id: string | null;
  /** Cosine similarity of the best candidate when matched, otherwise 0. */
  confidence: number;
  threshold: number;
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

  const confidence = round4(Math.min(best.similarity, 1));
  return {
    matched: true,
    employee_id: best.employee_id,
    confidence,
    threshold: face.matchThreshold,
    reason: null,
    recognition_token: signRecognitionProof(
      { employee_id: best.employee_id, confidence, user_id: requestedByUserId },
      jwtSecret,
      face.proofTtlSeconds
    ),
    expires_in_seconds: face.proofTtlSeconds,
  };
}
