// Browser-only face pipeline (detector + 68-point landmarks + 128-d recognition net).
// face-api is imported dynamically so it never runs during server rendering.
// Registration and recognition MUST both use this module (same model, same alignment).

import { combineSamples } from "./face";

type FaceApi = typeof import("@vladmandic/face-api");

const MODEL_URL = "/models";
let loading: Promise<FaceApi> | null = null;

export function loadFaceEngine(): Promise<FaceApi> {
  loading ??= (async () => {
    const faceapi = await import("@vladmandic/face-api");
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    return faceapi;
  })().catch((e) => {
    loading = null; // allow a retry
    throw e;
  });
  return loading;
}

export type FrameResult =
  | { kind: "ok"; descriptor: number[] }
  | { kind: "none" }
  | { kind: "multiple" }
  | { kind: "low-quality" };

const MIN_DETECTION_SCORE = 0.7;
/** Face box must be at least this fraction of the frame width (rejects faces far from the camera). */
const MIN_FACE_WIDTH_RATIO = 0.18;

export async function detectFrame(video: HTMLVideoElement): Promise<FrameResult> {
  const faceapi = await loadFaceEngine();
  const results = await faceapi
    .detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  if (results.length === 0) return { kind: "none" };
  if (results.length > 1) return { kind: "multiple" };
  const r = results[0];
  const width = video.videoWidth || 640;
  if (r.detection.score < MIN_DETECTION_SCORE || r.detection.box.width / width < MIN_FACE_WIDTH_RATIO) {
    return { kind: "low-quality" };
  }
  return { kind: "ok", descriptor: Array.from(r.descriptor) };
}

const FRAME_MESSAGES: Record<Exclude<FrameResult["kind"], "ok">, string> = {
  none: "No face detected. Look at the camera.",
  multiple: "More than one face in view. Only one person at a time.",
  "low-quality": "Move closer to the camera and face it directly.",
};

export type CaptureResult = { embedding: number[] } | { error: string };

/**
 * Takes `samples` frames about 250 ms apart and averages them. Aborts at once if more
 * than one face appears; tolerates a few misses before giving up.
 */
export async function captureEmbedding(
  video: HTMLVideoElement,
  opts: { samples: number; minSamples: number; maxAttempts?: number }
): Promise<CaptureResult> {
  const maxAttempts = opts.maxAttempts ?? opts.samples * 3;
  const collected: number[][] = [];
  let lastProblem: Exclude<FrameResult["kind"], "ok"> = "none";
  for (let attempt = 0; attempt < maxAttempts && collected.length < opts.samples; attempt++) {
    const frame = await detectFrame(video);
    if (frame.kind === "ok") {
      collected.push(frame.descriptor);
    } else {
      lastProblem = frame.kind;
      if (frame.kind === "multiple") return { error: FRAME_MESSAGES.multiple };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (collected.length < opts.minSamples) return { error: FRAME_MESSAGES[lastProblem] };
  const combined = combineSamples(collected, opts.minSamples);
  return "error" in combined ? { error: combined.error } : { embedding: combined.embedding };
}
