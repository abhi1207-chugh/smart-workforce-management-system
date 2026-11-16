import { describe, expect, it } from "vitest";
import { kioskLaunchUrl, parseLaunchCode } from "../src/lib/kiosk";

const CODE = "abcDEF0123456789_-abcDEF0123456789_-xyz";

describe("kiosk launch code", () => {
  it("round-trips through the URL fragment", () => {
    const url = kioskLaunchUrl(CODE);
    expect(url.startsWith("/kiosk#code=")).toBe(true);
    expect(parseLaunchCode(url.slice("/kiosk".length))).toBe(CODE);
  });

  it("keeps the code out of the query string (so it is never sent to the server)", () => {
    expect(kioskLaunchUrl(CODE)).not.toContain("?");
  });

  it("rejects missing, short, oversized and malformed fragments", () => {
    for (const h of ["", "#", "#code=", "#code=short", "#code=" + "a".repeat(201), "#code=abc def", "#other=" + CODE, "code=" + CODE]) {
      expect(parseLaunchCode(h)).toBeNull();
    }
  });
});
