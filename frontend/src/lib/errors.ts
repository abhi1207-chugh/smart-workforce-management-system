import { ApiError } from "./api";

export const errorMessage = (e: unknown, fallback = "Something went wrong") =>
  e instanceof ApiError ? e.message : fallback;
