import { describe, expect, it } from "vitest";
import {
  buildCorrection,
  defaultRange,
  fromLocalInput,
  localIsoDate,
  toLocalInput,
} from "../src/lib/attendance";

const row = { check_in: "2024-05-10T03:30:00.000Z", check_out: "2024-05-10T12:00:00.000Z" };
const NOW = new Date("2024-06-01T00:00:00.000Z");
const base = { check_in: toLocalInput(row.check_in), check_out: toLocalInput(row.check_out), reason: "forgot" };

describe("attendance helpers", () => {
  it("computes a local-date range ending today", () => {
    const now = new Date(2024, 2, 5, 10, 0); // local 5 Mar 2024
    expect(defaultRange(now, 7)).toEqual({ from: "2024-02-28", to: "2024-03-05" });
    expect(localIsoDate(new Date(2024, 0, 9))).toBe("2024-01-09");
  });

  it("round-trips datetime-local values", () => {
    expect(toLocalInput(fromLocalInput("2024-05-10T09:05"))).toBe("2024-05-10T09:05");
    expect(toLocalInput(null)).toBe("");
  });

  it("requires a reason and an actual change", () => {
    expect(buildCorrection(row, { ...base, reason: " " }, NOW)).toEqual({ error: "A reason is required" });
    expect(buildCorrection(row, base, NOW)).toEqual({ error: "Change the check-in or check-out time" });
  });

  it("sends only the changed field plus the reason", () => {
    const r = buildCorrection(row, { ...base, check_out: "2024-05-10T18:00" }, NOW);
    expect(r).toEqual({ body: { reason: "forgot", check_out: fromLocalInput("2024-05-10T18:00") } });
  });

  it("rejects check-out before check-in and future times", () => {
    expect(buildCorrection(row, { ...base, check_in: "2024-05-11T09:00" }, NOW)).toEqual({
      error: "Check-out cannot be before check-in",
    });
    expect(buildCorrection(row, { ...base, check_out: "2024-07-01T09:00" }, NOW)).toEqual({
      error: "Times cannot be in the future",
    });
  });
});
