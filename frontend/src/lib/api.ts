// Thin client for the Express API. Every response uses the envelope
// { success, data } / { success: false, error: { code, message, details } }.

const BASE = "/api/v1";
const TOKEN_KEY = "sap.token";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The JWT is stateless and kept in localStorage so it survives reloads.
// Trade-off: readable by injected scripts; mitigated by React escaping and no
// third-party scripts. Revisit (httpOnly cookie) in Stage 6 hardening.
export const tokenStore = {
  get(): string | null {
    return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
  },
};

type UnauthorizedListener = () => void;
let onUnauthorized: UnauthorizedListener | null = null;
export function setUnauthorizedHandler(fn: UnauthorizedListener | null) {
  onUnauthorized = fn;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the global "session expired" handling (used by login itself). */
  anonymous?: boolean;
}

export function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ""}`;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = opts.anonymous ? null : tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server. Is the backend running?");
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body: fall through to generic error */
  }

  if (res.ok && payload?.success === true) return payload.data as T;

  if (res.status === 401 && !opts.anonymous) onUnauthorized?.();
  const err = payload?.error;
  throw new ApiError(
    res.status,
    err?.code ?? "HTTP_ERROR",
    err?.message ?? `Request failed (${res.status})`,
    err?.details
  );
}
