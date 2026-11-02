import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSION,
  combineSamples,
  cosineSimilarity,
  describeRecognition,
  isValidEmbedding,
  proofSecondsLeft,
  punchBody,
  suggestedAction,
  type RecognitionResult,
} from "../src/lib/face";

const vec = (parts: Record<number, number>): number[] =>
  Array.from({ length: EMBEDDING_DIMENSION }, (_, k) => parts[k] ?? 0);

const matched: RecognitionResult = {
  matched: true,
  employee_id: "11111111-1111-4111-8111-111111111111",
  confidence: 0.97,
  threshold: 0.9,
  reason: null,
  recognition_token: "tok",
  expires_in_seconds: 30,
};

describe("embedding validation", () => {
  it("accepts exactly 128 finite, non-zero numbers", () => {
    expect(isValidEmbedding(vec({ 0: 1 }))).toBe(true);
  });

  it("rejects wrong length, non-finite values, zero vectors and non-arrays", () => {
    expect(isValidEmbedding([1, 2, 3])).toBe(false);
    expect(isValidEmbedding(vec({}))).toBe(false);
    expect(isValidEmbedding(vec({ 3: NaN }))).toBe(false);
    expect(isValidEmbedding(vec({ 3: Infinity }))).toBe(false);
    expect(isValidEmbedding("nope")).toBe(false);
    expect(isValidEmbedding(null)).toBe(false);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical, 0 for orthogonal, scale invariant, 0 for zero vectors", () => {
    expect(cosineSimilarity(vec({ 0: 1 }), vec({ 0: 5 }))).toBeCloseTo(1);
    expect(cosineSimilarity(vec({ 0: 1 }), vec({ 1: 1 }))).toBeCloseTo(0);
    expect(cosineSimilarity(vec({}), vec({ 0: 1 }))).toBe(0);
  });
});

describe("combineSamples", () => {
  it("averages agreeing samples into one valid embedding", () => {
    const r = combineSamples([vec({ 0: 1, 1: 0.1 }), vec({ 0: 1, 1: -0.1 }), vec({ 0: 1 })], 3);
    expect("embedding" in r).toBe(true);
    if ("embedding" in r) {
      expect(isValidEmbedding(r.embedding)).toBe(true);
      expect(r.embedding[0]).toBeCloseTo(1);
      expect(r.embedding[1]).toBeCloseTo(0);
    }
  });

  it("fails when there are too few usable samples", () => {
    expect(combineSamples([vec({ 0: 1 })], 3)).toHaveProperty("error");
    expect(combineSamples([vec({ 0: 1 }), vec({}), [1, 2]], 2)).toHaveProperty("error");
  });

  it("fails when the samples disagree (a different face walked in)", () => {
    const r = combineSamples([vec({ 0: 1 }), vec({ 0: 1 }), vec({ 1: 1 })], 3);
    expect(r).toHaveProperty("error");
  });
});

describe("recognition helpers", () => {
  it("describes outcomes for the kiosk", () => {
    expect(describeRecognition(matched)).toBe("Face recognised");
    expect(describeRecognition({ ...matched, matched: false, reason: "AMBIGUOUS" })).toMatch(/tell who/);
    expect(describeRecognition({ ...matched, matched: false, reason: "NO_MATCH" })).toMatch(/not recognised/);
  });

  it("counts down the proof lifetime and never goes negative", () => {
    expect(proofSecondsLeft(0, 30, 0)).toBe(30);
    expect(proofSecondsLeft(0, 30, 10_500)).toBe(20);
    expect(proofSecondsLeft(0, 30, 31_000)).toBe(0);
    expect(proofSecondsLeft(0, null, 0)).toBe(0);
  });

  it("suggests check-out only when the employee is checked in", () => {
    expect(suggestedAction("CHECKED_IN")).toBe("check-out");
    expect(suggestedAction("NOT_CHECKED_IN")).toBe("check-in");
    expect(suggestedAction("CHECKED_OUT")).toBe("check-in");
    expect(suggestedAction(undefined)).toBe("check-in");
  });
});

describe("punchBody", () => {
  it("never carries client-asserted confidence", () => {
    expect(punchBody(matched)).not.toHaveProperty("recognition_confidence");
  });

  it("sends the employee id with the FACE_RECOGNITION source and the server-issued proof", () => {
    expect(punchBody(matched)).toEqual({
      employee_id: matched.employee_id,
      source: "FACE_RECOGNITION",
      recognition_token: "tok",
    });
  });

  it("refuses to build a face punch without a proof", () => {
    expect(() => punchBody({ ...matched, recognition_token: null })).toThrow();
  });

  it("refuses to build a punch without a recognised employee", () => {
    expect(() => punchBody({ ...matched, matched: false, employee_id: null })).toThrow();
  });
});
