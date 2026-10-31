import { z } from "zod";
import { parseWith } from "./parse.js";

/** face-api.js produces 128-dimension descriptors. Must match face_embedding.embedding vector(128). */
export const EMBEDDING_DIMENSION = 128;

/** A finite 128-float vector that is not all zeros (cosine similarity is undefined for the zero vector). */
export const embeddingSchema = z
  .array(z.number().min(-1000).max(1000))
  .length(EMBEDDING_DIMENSION)
  .refine((v) => v.some((x) => x !== 0), {
    message: "Embedding must not be the zero vector",
  });

export const registerFaceSchema = z
  .object({
    embedding: embeddingSchema,
    model_version: z.string().trim().min(1).max(50).default("1"),
  })
  .strict();

export const recognizeFaceSchema = z
  .object({
    embedding: embeddingSchema,
  })
  .strict();

export type RegisterFaceInput = z.infer<typeof registerFaceSchema>;
export type RecognizeFaceInput = z.infer<typeof recognizeFaceSchema>;

export const parseRegisterFaceBody = (body: unknown) =>
  parseWith(registerFaceSchema, body, "request body");
export const parseRecognizeFaceBody = (body: unknown) =>
  parseWith(recognizeFaceSchema, body, "request body");
