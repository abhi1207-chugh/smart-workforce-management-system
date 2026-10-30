import { z } from "zod";

export const uuid = z.uuid();
export const isoDate = z.iso.date();

/** Optional paging for list endpoints (query-string values arrive as strings). */
export const pagingShape = {
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
};
