"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { captureEmbedding, loadFaceEngine, type CaptureResult } from "@/lib/face-engine";

export interface FaceCameraHandle {
  /** Captures and averages `samples` frames; resolves with an embedding or a user-facing error. */
  capture(opts: { samples: number; minSamples: number }): Promise<CaptureResult>;
}

type State = { phase: "starting" } | { phase: "ready" } | { phase: "error"; message: string };

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "Camera permission was denied. Allow camera access in the browser and reload.";
  if (name === "NotFoundError") return "No camera found on this device.";
  if (name === "NotReadableError") return "The camera is in use by another application.";
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "The camera needs HTTPS or localhost.";
  }
  return e instanceof Error ? e.message : "Could not start the camera or load the face models.";
}

/** Live camera preview plus the face model; the stream is released on unmount. */
export const FaceCamera = forwardRef<FaceCameraHandle, { onStateChange?(ready: boolean): void }>(
  function FaceCamera({ onStateChange }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [state, setState] = useState<State>({ phase: "starting" });

    useEffect(() => {
      let stream: MediaStream | null = null;
      let cancelled = false;
      (async () => {
        try {
          if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot access the camera.");
          const [media] = await Promise.all([
            navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false }),
            loadFaceEngine(),
          ]);
          if (cancelled) {
            media.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = media;
          const video = videoRef.current;
          if (!video) return;
          video.srcObject = media;
          await video.play();
          setState({ phase: "ready" });
          onStateChange?.(true);
        } catch (e) {
          if (!cancelled) {
            setState({ phase: "error", message: cameraErrorMessage(e) });
            onStateChange?.(false);
          }
        }
      })();
      return () => {
        cancelled = true;
        stream?.getTracks().forEach((t) => t.stop());
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
      async capture(opts) {
        const video = videoRef.current;
        if (!video || state.phase !== "ready") return { error: "The camera is not ready yet." };
        return captureEmbedding(video, opts);
      },
    }));

    return (
      <div className="face-camera">
        <video ref={videoRef} muted playsInline aria-label="Camera preview" />
        {state.phase === "starting" && <p className="muted small">Starting camera and loading face models…</p>}
        {state.phase === "error" && <p role="alert" className="error">{state.message}</p>}
      </div>
    );
  }
);
