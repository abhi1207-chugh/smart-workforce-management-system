"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { EmployeeForm } from "@/components/EmployeeForm";
import { RequireRole } from "@/components/RequireRole";
import { useApi } from "@/components/useApi";
import { ApiError, api } from "@/lib/api";
import { employeePayload, formFromEmployee } from "@/lib/employees";
import type { EmployeeDetail } from "@/lib/types";

export default function EmployeeDetailPage() {
  return (
    <RequireRole role="ADMIN">
      <Detail />
    </RequireRole>
  );
}

function Detail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<EmployeeDetail>(`/employees/${id}`);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function deactivate() {
    if (!data) return;
    if (!window.confirm(`Deactivate ${data.first_name} ${data.last_name}? They will no longer be able to sign in or check in.`)) return;
    setActionError(null);
    try {
      await api(`/employees/${id}/deactivate`, { method: "POST" });
      await reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Could not deactivate");
    }
  }

  return (
    <>
      <p><Link href="/employees">← Employees</Link></p>
      {loading && !data && <p className="muted">Loading…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {data && (
        <>
          <div className="toolbar">
            <h1>{data.first_name} {data.last_name}</h1>
            <span className={`badge ${data.status === "INACTIVE" ? "badge-off" : ""}`}>{data.status}</span>
          </div>
          {saved && <p role="status" className="ok">Saved.</p>}
          <EmployeeForm
            // remount when the server record changes so the form reflects it
            key={data.id + data.status}
            mode="edit"
            initial={formFromEmployee(data)}
            submitLabel="Save changes"
            onSubmit={async (values) => {
              setSaved(false);
              await api(`/employees/${id}`, { method: "PATCH", body: employeePayload(values) });
              await reload();
              setSaved(true);
            }}
          />
          {data.status === "ACTIVE" && (
            <div className="card danger-zone">
              <strong>Deactivate employee</strong>
              <p className="muted small">
                Disables their login and blocks check-in. There is no reactivate action yet.
              </p>
              {actionError && <p role="alert" className="error">{actionError}</p>}
              <button className="danger" onClick={deactivate}>Deactivate</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
