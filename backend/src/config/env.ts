import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

loadDotenv({ path: path.join(repoRoot, ".env") });

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface FaceConfig {
  /** Minimum cosine similarity (0-1) for a recognition match. */
  matchThreshold: number;
  /** Runner-up within this similarity margin of the best (and above threshold) makes the match ambiguous. */
  ambiguityMargin: number;
  /** Lifetime of the signed recognition proof, in seconds. */
  proofTtlSeconds: number;
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

/** Face-recognition settings; all optional with safe defaults (see .env.example). */
export function loadFaceConfig(): FaceConfig {
  return {
    matchThreshold: numberEnv("FACE_MATCH_THRESHOLD", 0.9, 0.5, 1),
    ambiguityMargin: numberEnv("FACE_AMBIGUITY_MARGIN", 0.03, 0, 0.5),
    proofTtlSeconds: numberEnv("FACE_PROOF_TTL_SECONDS", 30, 5, 300),
  };
}

export function loadConfig(): AppConfig {
  const databaseUrl = requireEnv("DATABASE_URL");
  const jwtSecret = requireEnv("JWT_SECRET");

  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long");
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.BACKEND_PORT ?? "3001"),
    databaseUrl,
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  };
}
