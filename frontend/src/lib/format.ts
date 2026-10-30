export function formatMinutes(total: number | null | undefined): string {
  if (total == null) return "—";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Amounts arrive as decimal strings (NUMERIC); keep them exact, just group digits. */
export function formatMoney(amount: string | null | undefined): string {
  if (amount == null) return "—";
  const [whole, frac = "00"] = amount.split(".");
  const neg = whole.startsWith("-");
  const digits = neg ? whole.slice(1) : whole;
  return `${neg ? "-" : ""}₹${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac.padEnd(2, "0").slice(0, 2)}`;
}
