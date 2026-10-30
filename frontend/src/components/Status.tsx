const TONE: Record<string, string> = {
  APPROVED: "badge-ok", FINALIZED: "badge-ok", PAID: "badge-ok", ACTIVE: "badge-ok",
  REJECTED: "badge-off", FAILED: "badge-off", INACTIVE: "badge-off",
};

export function Status({ value }: { value: string }) {
  return <span className={`badge ${TONE[value] ?? ""}`}>{value}</span>;
}
