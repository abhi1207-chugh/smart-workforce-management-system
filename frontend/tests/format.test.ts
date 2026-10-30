import { describe, expect, it } from "vitest";
import { formatMinutes, formatMoney } from "../src/lib/format";

describe("format", () => {
  it("formats minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(125)).toBe("2h 05m");
    expect(formatMinutes(null)).toBe("—");
  });
  it("formats money from decimal strings without float rounding", () => {
    expect(formatMoney("21000.00")).toBe("₹21,000.00");
    expect(formatMoney("1234567.5")).toBe("₹1,234,567.50");
    expect(formatMoney("999")).toBe("₹999.00");
    expect(formatMoney("-1500.25")).toBe("-₹1,500.25");
    expect(formatMoney(undefined)).toBe("—");
  });
});
