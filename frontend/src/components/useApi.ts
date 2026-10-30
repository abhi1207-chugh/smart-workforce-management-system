"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type RequestOptions } from "@/lib/api";

/** Loads `path` on mount; `reload()` refetches. A null path disables the request. */
export function useApi<T>(path: string | null, query?: RequestOptions["query"]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const key = JSON.stringify(query ?? {});

  const reload = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    try {
      setData(await api<T>(path, { query: JSON.parse(key) }));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [path, key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
