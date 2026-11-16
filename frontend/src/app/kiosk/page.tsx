"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaceCamera, type FaceCameraHandle } from "@/components/FaceCamera";
import { ApiError, api, kioskTokenStore, setKioskUnauthorizedHandler } from "@/lib/api";
import {
  describeRecognition,
  proofSecondsLeft,
  punchBody,
  suggestedAction,
  type RecognitionResult,
} from "@/lib/face";
import { parseLaunchCode } from "@/lib/kiosk";
import type { LoginResult, SessionUser } from "@/lib/types";

/** How long the success/failure banner stays before the kiosk is ready for the next person. */
const RESET_AFTER_MS = 5000;

export default function KioskPage() {
  const [session, setSession] = useState<"loading" | "locked" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);

  const lock = useCallback(() => {
    kioskTokenStore.clear();
    setSession("locked");
  }, []);

  useEffect(() => {
    setKioskUnauthorizedHandler(lock);
    return () => setKioskUnauthorizedHandler(null);
  }, [lock]);

  useEffect(() => {
    const code = parseLaunchCode(window.location.hash);
    // Never leave the one-time code in the address bar or history.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);

    if (code) {
      api<LoginResult>("/kiosk/session", { method: "POST", body: { code }, anonymous: true })
        .then((r) => {
          if (r.user.role !== "KIOSK") throw new Error("Unexpected account type");
          kioskTokenStore.set(r.token);
          setSession("ready");
        })
        .catch((e) => {
          setError(e instanceof ApiError ? e.message : "Could not activate the kiosk.");
          lock();
        });
      return;
    }
    if (!kioskTokenStore.get()) {
      setSession("locked");
      return;
    }
    // A device already activated by an admin keeps working across reloads until its session ends.
    api<SessionUser>("/auth/me", { kiosk: true })
      .then((u) => {
        if (u.role !== "KIOSK") throw new Error("not a kiosk session");
        setSession("ready");
      })
      .catch(() => lock());
  }, [lock]);

  if (session === "loading") return <p className="muted center-msg">Loading…</p>;
  if (session === "locked") {
    return (
      <main className="login-wrap">
        <div className="card login-card">
          <h1>Kiosk is locked</h1>
          <p className="muted">Open the face kiosk from the admin portal to activate this device.</p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  }
  return <Scanner onSignOut={lock} />;
}

interface Recognised {
  result: RecognitionResult;
  issuedAt: number;
}

function Scanner({ onSignOut }: { onSignOut: () => void }) {
  const camera = useRef<FaceCameraHandle>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recognised, setRecognised] = useState<Recognised | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick while a recognition is pending so the countdown (and expiry) stay live.
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

  // Return to a clean "ready" state after a result so the next person never sees the last one.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), RESET_AFTER_MS);
    return () => clearTimeout(t);
  }, [message]);

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
        kiosk: true,
      });
      if (!result.matched || !result.employee_id || !result.employee) {
        setMessage({ ok: false, text: describeRecognition(result) });
        return;
      }
      const issuedAt = Date.now();
      setNow(issuedAt);
      setRecognised({ result, issuedAt });
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
      await api(`/attendance/${kind}`, { method: "POST", body: punchBody(recognised.result), kiosk: true });
      const who = recognised.result.employee!;
      setMessage({
        ok: true,
        text: `${kind === "check-in" ? "Checked in" : "Checked out"}: ${who.first_name} ${who.last_name}`,
      });
      setRecognised(null);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Action failed" });
    } finally {
      setBusy(false);
    }
  }

  const suggested = recognised ? suggestedAction(recognised.result.today_status ?? undefined) : null;
  const who = recognised?.result.employee;

  return (
    <main className="kiosk-main">
      <header className="kiosk-head">
        <h1>Face check-in</h1>
        <button className="link" onClick={onSignOut}>
          Lock kiosk
        </button>
      </header>
      <p className="muted">Look at the camera and press Scan. Not recognised? Ask an administrator to punch you in manually.</p>
      <div className="card kiosk">
        <FaceCamera ref={camera} onStateChange={setCameraReady} />
        <div className="row-gap wrap">
          <button disabled={!cameraReady || busy || recognised !== null} onClick={scan}>
            {busy && !recognised ? "Scanning…" : "Scan face"}
          </button>
        </div>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "ok" : "error"}>
            {message.text}
          </p>
        )}
        {recognised && who && (
          <div className="kiosk-result" role="status">
            <strong>
              {who.first_name} {who.last_name}
            </strong>
            <span className="muted small">
              {who.employee_code} · {Math.round(recognised.result.confidence * 100)}% match · confirm in {secondsLeft}s
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
    </main>
  );
}
