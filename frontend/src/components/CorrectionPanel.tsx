"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { buildCorrection, toLocalInput } from "@/lib/attendance";
import type { AttendanceRow } from "@/lib/types";

interface Props {
  row: AttendanceRow;
  onDone(): void;
  onCancel(): void;
}

export function CorrectionPanel({ row, onDone, onCancel }: Props) {
  const [checkIn, setCheckIn] = useState(toLocalInput(row.check_in));
  const [checkOut, setCheckOut] = useState(toLocalInput(row.check_out));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = buildCorrection(row, { check_in: checkIn, check_out: checkOut, reason });
    if ("error" in result) return setError(result.error);
    setSaving(true);
    setError(null);
    try {
      await api(`/attendance/${row.id}`, { method: "PATCH", body: result.body });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the correction");
      setSaving(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <strong className="span-2">
        Correct {row.first_name} {row.last_name} — {row.work_date}
      </strong>
      <label>
        Check-in
        <input type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
      </label>
      <label>
        Check-out
        <input
          type="datetime-local"
          value={checkOut}
          disabled={!row.check_out}
          onChange={(e) => setCheckOut(e.target.value)}
        />
      </label>
      <label className="span-2">
        Reason (recorded in the audit log)
        <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p role="alert" className="error span-2">{error}</p>}
      <div className="span-2 row-gap">
        <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save correction"}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
