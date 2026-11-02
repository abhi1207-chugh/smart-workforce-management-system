"use client";

import { useRef, useState } from "react";
import { FaceCamera, type FaceCameraHandle } from "./FaceCamera";
import { useApi } from "./useApi";
import { ApiError, api } from "@/lib/api";
import { FACE_MODEL_VERSION, type FaceStatus } from "@/lib/face";

/** ADMIN panel on the employee page: shows face status, captures/replaces and revokes the face. */
export function FaceRegistration({
  employeeId,
  employeeActive,
  onChanged,
}: {
  employeeId: string;
  employeeActive: boolean;
  onChanged(): void;
}) {
  const status = useApi<FaceStatus>(`/employees/${employeeId}/face/status`);
  const camera = useRef<FaceCameraHandle>(null);
  const [capturing, setCapturing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const registered = status.data?.is_registered ?? false;

  async function register() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await camera.current?.capture({ samples: 5, minSamples: 3 });
      if (!result) return;
      if ("error" in result) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      await api(`/employees/${employeeId}/face/register`, {
        method: "POST",
        body: { embedding: result.embedding, model_version: FACE_MODEL_VERSION },
      });
      setMessage({ ok: true, text: registered ? "Face updated." : "Face registered." });
      setCapturing(false);
      setCameraReady(false);
      await status.reload();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Registration failed" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm("Remove this employee's registered face? They will no longer be recognised at the kiosk.")) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(`/employees/${employeeId}/face`, { method: "DELETE" });
      setMessage({ ok: true, text: "Face removed." });
      await status.reload();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Could not remove the face" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card face-panel">
      <div className="row-gap wrap">
        <strong>Face recognition</strong>
        {status.data && (
          <span className={`badge ${registered ? "badge-ok" : "badge-off"}`}>
            {registered ? "Registered" : "Not registered"}
          </span>
        )}
        {registered && status.data?.registered_at && (
          <span className="muted small">since {new Date(status.data.registered_at).toLocaleString()}</span>
        )}
      </div>
      {status.error && <p role="alert" className="error">{status.error}</p>}
      {!employeeActive && <p className="muted small">Inactive employees cannot be registered.</p>}
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "ok" : "error"}>{message.text}</p>}

      {employeeActive && !capturing && (
        <div className="row-gap wrap">
          <button disabled={busy} onClick={() => { setCapturing(true); setMessage(null); }}>
            {registered ? "Re-register face" : "Register face"}
          </button>
          {registered && (
            <button className="danger" disabled={busy} onClick={revoke}>Remove face</button>
          )}
        </div>
      )}

      {employeeActive && capturing && (
        <>
          <p className="muted small">
            Ask the employee to face the camera in good light, one person only. It takes about 2 seconds; stay still.
          </p>
          <FaceCamera ref={camera} onStateChange={setCameraReady} />
          <div className="row-gap wrap">
            <button disabled={!cameraReady || busy} onClick={register}>
              {busy ? "Capturing…" : "Capture and save"}
            </button>
            <button className="secondary" disabled={busy} onClick={() => { setCapturing(false); setCameraReady(false); }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
