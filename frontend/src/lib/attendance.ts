import type { AttendanceRow } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD (not UTC, so "today" matches the user's day). */
export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function defaultRange(now = new Date(), days = 7): { from: string; to: string } {
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  return { from: localIsoDate(start), to: localIsoDate(now) };
}

/** ISO instant -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${localIsoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value -> ISO instant with offset, as the API requires. */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export interface CorrectionForm {
  check_in: string;
  check_out: string;
  reason: string;
}

/**
 * Builds the PATCH body, sending only fields the admin actually changed.
 * Returns an error string when the form is not submittable.
 */
export function buildCorrection(
  row: Pick<AttendanceRow, "check_in" | "check_out">,
  form: CorrectionForm,
  now = new Date()
): { body: Record<string, string> } | { error: string } {
  if (!form.reason.trim()) return { error: "A reason is required" };
  if (!form.check_in) return { error: "Check-in time is required" };
  const body: Record<string, string> = { reason: form.reason.trim() };
  if (form.check_in !== toLocalInput(row.check_in)) body.check_in = fromLocalInput(form.check_in);
  if (form.check_out && form.check_out !== toLocalInput(row.check_out)) {
    body.check_out = fromLocalInput(form.check_out);
  }
  if (!body.check_in && !body.check_out) return { error: "Change the check-in or check-out time" };

  const inMs = Date.parse(body.check_in ?? row.check_in);
  const outMs = body.check_out ? Date.parse(body.check_out) : row.check_out ? Date.parse(row.check_out) : null;
  if (outMs !== null && outMs < inMs) return { error: "Check-out cannot be before check-in" };
  if (Math.max(inMs, outMs ?? 0) > now.getTime()) return { error: "Times cannot be in the future" };
  return { body };
}
