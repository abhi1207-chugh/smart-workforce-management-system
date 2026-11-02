import { createHmac } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { unauthorized } from "../errors/app-error.js";

/**
 * Short-lived proof that THIS backend recognised a face (POST /face/recognize).
 * The attendance check-in must verify it instead of trusting a client-supplied
 * employee_id/confidence when source = FACE_RECOGNITION.
 *
 * It is signed with a key derived from JWT_SECRET plus a purpose label and carries
 * its own audience, so it can never be accepted as a login token (or vice versa).
 */
const AUDIENCE = "face-recognition-proof";

export interface RecognitionProof {
  employee_id: string;
  confidence: number;
  /** The authenticated user (e.g. the kiosk account) who requested the recognition. */
  user_id: string;
}

function proofKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(AUDIENCE).digest();
}

export function signRecognitionProof(
  proof: RecognitionProof,
  secret: string,
  ttlSeconds: number
): string {
  return jwt.sign({ conf: proof.confidence, uid: proof.user_id }, proofKey(secret), {
    algorithm: "HS256",
    audience: AUDIENCE,
    subject: proof.employee_id,
    expiresIn: ttlSeconds as SignOptions["expiresIn"],
  });
}

/** Throws a 401 AppError if the proof is invalid, expired or not a recognition proof. */
export function verifyRecognitionProof(token: string, secret: string): RecognitionProof {
  try {
    const decoded = jwt.verify(token, proofKey(secret), {
      algorithms: ["HS256"],
      audience: AUDIENCE,
    });
    if (
      typeof decoded === "string" ||
      typeof decoded.sub !== "string" ||
      typeof decoded.conf !== "number" ||
      typeof decoded.uid !== "string"
    ) {
      throw unauthorized("Invalid recognition proof");
    }
    return { employee_id: decoded.sub, confidence: decoded.conf, user_id: decoded.uid };
  } catch (error) {
    if (error instanceof Error && error.name === "AppError") throw error;
    throw unauthorized("Invalid or expired recognition proof");
  }
}
