"use client";

import { useEffect, useRef, useState } from "react";
import { FaceCamera, type FaceCameraHandle } from "@/components/FaceCamera";
import { RequireRole } from "@/components/RequireRole";
import { ApiError, api } from "@/lib/api";
import {
  describeRecognition,
  proofSecondsLeft,
  punchBody,
  suggestedAction,
  type RecognitionResult,
} from "@/lib/face";
import type { EmployeeDetail, TodayStatus } from "@/lib/types";

export default function KioskPage() {
  return (
    <RequireRole role="ADMIN">
      <Kiosk />
    </RequireRole>
  );
}

interface Recognised {
  result: RecognitionResult;
  employee: EmployeeDetail;
  today: TodayStatus | null;
  issuedAt: number;
}

function Kiosk() {
  const camera = useRef<FaceCameraHandle>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recognised, setRecognised] = useState<Recognised | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A recognition is only good for a short time; clear it so the next person at a shared kiosk starts clean.
  useEffect(() => {
    if (!recognised) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [recognised]);

  const secondsLeft = recognised
    ? proofSecondsLeft(recognised.issuedAt, recognised.result.expires_in_seconds, now)
    : 0;

  useEffect(() => {
    if (recognised && secondsLeft === 0) {
      setRecognised(null);
      setMessage({ ok: false, text: "Confirmation timed out. Scan again." });
    }
  }, [recognised, secondsLeft]);

  async function scan() {
    setBusy(true);
    setMessage(null);
    setRecognised(null);
    try {
      const captured = await camera.current?.capture({ samples: 3, minSamples: 2 });
      if (!captured) return;
      if ("error" in captured) {
        setMessage({ ok: false, text: captured.error });
        return;
      }
      const result = await api<RecognitionResult>("/face/recognize", {
        method: "POST",
        body: { embedding: captured.embedding },
      });
      if (!result.matched || !result.employee_id) {
        setMessage({ ok: false, text: describeRecognition(result) });
        return;
      }
      const [employee, today] = await Promise.all([
        api<EmployeeDetail>(`/employees/${result.employee_id}`),
        api<TodayStatus>("/attendance/today", { query: { employee_id: result.employee_id } }).catch(() => null),
      ]);
      const issuedAt = Date.now();
      setNow(issuedAt);
      setRecognised({ result, employee, today, issuedAt });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Recognition failed" });
    } finally {
      setBusy(false);
    }
  }

  async function punch(kind: "check-in" | "check-out") {
    if (!recognised) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(`/attendance/${kind}`, { method: "POST", body: punchBody(recognised.result) });
      const { first_name, last_name } = recognised.employee;
      setMessage({ ok: true, text: `${kind === "check-in" ? "Checked in" : "Checked out"}: ${first_name} ${last_name}` });
      setRecognised(null);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Action failed" });
    } finally {
      setBusy(false);
    }
  }

  const suggested = recognised ? suggestedAction(recognised.today?.status) : null;

  return (
    <>
      <h1>Face check-in</h1>
      <p className="muted">
        Look at the camera and press Scan. If the face is not recognised, use the manual punch on the Attendance page.
      </p>
      <div className="card kiosk">
        <FaceCamera ref={camera} onStateChange={setCameraReady} />
        <div className="row-gap wrap">
          <button disabled={!cameraReady || busy} onClick={scan}>
            {busy && !recognised ? "Scanning…" : "Scan face"}
          </button>
        </div>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "ok" : "error"}>{message.text}</p>
        )}
        {recognised && (
          <div className="kiosk-result" role="status">
            <strong>
              {recognised.employee.first_name} {recognised.employee.last_name}
            </strong>
            <span className="muted small">
              {recognised.employee.employee_code} · {Math.round(recognised.result.confidence * 100)}% match · confirm in {secondsLeft}s
            </span>
            <div className="row-gap wrap">
              <button
                className={suggested === "check-in" ? undefined : "secondary"}
                disabled={busy}
                onClick={() => punch("check-in")}
              >
                Check in
              </button>
              <button
                className={suggested === "check-out" ? undefined : "secondary"}
                disabled={busy}
                onClick={() => punch("check-out")}
              >
                Check out
              </button>
              <button className="secondary" disabled={busy} onClick={() => setRecognised(null)}>
                Not me
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
