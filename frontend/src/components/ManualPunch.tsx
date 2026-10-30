"use client";

import { useState } from "react";
import { useApi } from "./useApi";
import { ApiError, api } from "@/lib/api";
import type { Employee } from "@/lib/types";

/** Admin/kiosk fallback: record a check-in or check-out for any active employee. */
export function ManualPunch({ onDone }: { onDone(): void }) {
  const employees = useApi<Employee[]>("/employees", { status: "ACTIVE" });
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function punch(kind: "check-in" | "check-out") {
    const who = employees.data?.find((e) => e.id === employeeId);
    setBusy(true);
    setMessage(null);
    try {
      await api(`/attendance/${kind}`, { method: "POST", body: { employee_id: employeeId } });
      setMessage({ ok: true, text: `${kind === "check-in" ? "Checked in" : "Checked out"}: ${who?.first_name} ${who?.last_name}` });
      onDone();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Action failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card row-gap wrap">
      <strong>Manual punch</strong>
      <select aria-label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
        <option value="">Select employee…</option>
        {(employees.data ?? []).map((e) => (
          <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
        ))}
      </select>
      <button disabled={!employeeId || busy} onClick={() => punch("check-in")}>Check in</button>
      <button disabled={!employeeId || busy} className="secondary" onClick={() => punch("check-out")}>Check out</button>
      {message && (
        <span role={message.ok ? "status" : "alert"} className={message.ok ? "ok" : "error"}>{message.text}</span>
      )}
    </div>
  );
}
