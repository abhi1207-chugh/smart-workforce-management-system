import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, buildUrl, setUnauthorizedHandler } from "../src/lib/api";

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe("api client", () => {
  it("builds query strings, skipping empty values", () => {
    expect(buildUrl("/employees", { q: "a b", status: undefined, page: 2, x: "" })).toBe(
      "/api/v1/employees?q=a+b&page=2"
    );
    expect(buildUrl("/health")).toBe("/api/v1/health");
  });

  it("unwraps the success envelope", async () => {
    vi.stubGlobal("fetch", respond(200, { success: true, data: { ok: 1 } }));
    expect(await api("/x")).toEqual({ ok: 1 });
  });

  it("sends JSON bodies", async () => {
    const fetchMock = respond(201, { success: true, data: {} });
    vi.stubGlobal("fetch", fetchMock);
    await api("/x", { method: "POST", body: { a: 1 } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe('{"a":1}');
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("throws ApiError with the server's code and message", async () => {
    vi.stubGlobal(
      "fetch",
      respond(409, { success: false, error: { code: "CONFLICT", message: "Duplicate", details: [1] } })
    );
    await expect(api("/x")).rejects.toMatchObject({
      name: "ApiError", status: 409, code: "CONFLICT", message: "Duplicate", details: [1],
    });
  });

  it("calls the unauthorized handler on 401 unless anonymous", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", respond(401, { success: false, error: { code: "UNAUTHORIZED", message: "no" } }));
    await expect(api("/x")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(api("/auth/login", { anonymous: true })).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("maps network failures to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    await expect(api("/x")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });

  it("handles non-JSON error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error("x"); } })
    );
    await expect(api("/x")).rejects.toMatchObject({ status: 502, code: "HTTP_ERROR" });
  });
});
