"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

/** Approve / reject buttons for a PENDING leave or overtime row. */
export function ReviewButtons({ basePath, id, onDone }: { basePath: string; id: string; onDone(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      await api(`${basePath}/${id}/${action}`, { method: "POST" });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row-gap">
      <button disabled={busy} onClick={() => decide("approve")}>Approve</button>
      <button disabled={busy} className="secondary" onClick={() => decide("reject")}>Reject</button>
      {error && <span role="alert" className="error small">{error}</span>}
    </span>
  );
}
