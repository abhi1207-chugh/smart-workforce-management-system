"use client";

import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";

/** Page-level guard (UI only; the API enforces roles server-side). */
export function RequireRole({ role, children }: { role: Role; children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== role) return <p role="alert" className="error">You do not have access to this page.</p>;
  return <>{children}</>;
}
