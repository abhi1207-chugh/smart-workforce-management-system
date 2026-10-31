// Pure helpers for the face flows (no camera / model code, so they are unit-testable).
// The browser pipeline lives in face-engine.ts and must use the same model for
// registration and recognition.

export const EMBEDDING_DIMENSION = 128;

/** Sent as `model_version` on registration; bump if the detector/recognition model changes. */
export const FACE_MODEL_VERSION = "vladmandic-faceapi-1.7-ssd-lm68";

/**
 * Attendance currently accepts only manual punches. When the attendance owner ships
 * `source: "FACE_RECOGNITION"` + `recognition_token` (docs/integration/face-attendance-integration.md),
 * flip this to true so the kiosk sends the proof.
 */
export const ATTENDANCE_ACCEPTS_FACE_PROOF = false;

export interface RecognitionResult {
  matched: boolean;
  employee_id: string | null;
  confidence: number;
  threshold: number;
  reason: "NO_MATCH" | "AMBIGUOUS" | null;
  recognition_token: string | null;
  expires_in_seconds: number | null;
}

export interface FaceStatus {
  employee_id: string;
  is_registered: boolean;
  registered_at: string | null;
  model_name: string | null;
  model_version: string | null;
}

export function isValidEmbedding(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === EMBEDDING_DIMENSION &&
    v.every((x) => typeof x === "number" && Number.isFinite(x)) &&
    v.some((x) => x !== 0)
  );
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Samples of one person's face should agree with their mean at least this well. */
export const MIN_SAMPLE_AGREEMENT = 0.85;

export type Combined = { embedding: number[] } | { error: string };

/**
 * Averages several descriptors of one capture into a single embedding. Rejects when
 * there are too few samples or when they disagree (e.g. a different person walked into frame).
 */
export function combineSamples(samples: number[][], minSamples: number): Combined {
  const valid = samples.filter(isValidEmbedding);
  if (valid.length < minSamples) {
    return { error: "Could not get a clear view of the face. Look at the camera and try again." };
  }
  const mean = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  for (const s of valid) for (let i = 0; i < EMBEDDING_DIMENSION; i++) mean[i] += s[i] / valid.length;
  if (valid.some((s) => cosineSimilarity(s, mean) < MIN_SAMPLE_AGREEMENT)) {
    return { error: "The captures did not match each other. Keep one face still in frame and try again." };
  }
  return { embedding: mean };
}

export function describeRecognition(r: RecognitionResult): string {
  if (r.matched) return "Face recognised";
  return r.reason === "AMBIGUOUS"
    ? "Could not tell who this is. Please use manual check-in."
    : "Face not recognised. Try again or use manual check-in.";
}

/** Remaining validity of a recognition proof, in whole seconds (never negative). */
export function proofSecondsLeft(issuedAtMs: number, expiresInSeconds: number | null, nowMs: number): number {
  if (expiresInSeconds === null) return 0;
  return Math.max(0, Math.ceil(expiresInSeconds - (nowMs - issuedAtMs) / 1000));
}

/** Body for POST /attendance/check-in|check-out after a successful recognition. */
export function punchBody(result: RecognitionResult): Record<string, unknown> {
  if (!result.matched || !result.employee_id) throw new Error("No recognised employee");
  if (ATTENDANCE_ACCEPTS_FACE_PROOF) {
    return {
      employee_id: result.employee_id,
      source: "FACE_RECOGNITION",
      recognition_token: result.recognition_token,
    };
  }
  return { employee_id: result.employee_id };
}

/** Which action to suggest for the recognised employee, from today's status. */
export function suggestedAction(status: "NOT_CHECKED_IN" | "CHECKED_IN" | "CHECKED_OUT" | undefined): "check-in" | "check-out" {
  return status === "CHECKED_IN" ? "check-out" : "check-in";
}
