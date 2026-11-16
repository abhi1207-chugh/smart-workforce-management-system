import express from "express";
import {
  createAttendanceRouter,
  createAuthRouter,
  createEmployeeRouter,
  createFaceRouter,
  createHealthRouter,
  createKioskRouter,
  createLeaveRouter,
  createOvertimeRouter,
  createPayrollRouter,
  createReportsRouter,
  createReferenceRouter,
} from "./routes/index.js";
import {
  loadConfig,
  loadFaceConfig,
  loadRateLimitConfig,
  type FaceConfig,
  type RateLimitConfig,
} from "./config/env.js";
import type { AuthConfig } from "./services/auth.service.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/error-handler.js";

export function createApp(
  authConfig: AuthConfig = loadConfig(),
  faceConfig: FaceConfig = loadFaceConfig(),
  rateLimits: RateLimitConfig = loadRateLimitConfig()
) {
  const app = express();

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    // API responses are JSON only and often personal data: never sniffed, framed or cached.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "100kb" }));

  const apiRouter = express.Router();
  apiRouter.use(createHealthRouter());
  apiRouter.use(createAuthRouter(authConfig, rateLimits));
  apiRouter.use(createEmployeeRouter(authConfig));
  apiRouter.use(createFaceRouter(authConfig, faceConfig, rateLimits));
  apiRouter.use(createKioskRouter(authConfig, rateLimits));
  apiRouter.use(createReferenceRouter(authConfig));
  apiRouter.use(createAttendanceRouter(authConfig, faceConfig));
  apiRouter.use(createLeaveRouter(authConfig));
  apiRouter.use(createOvertimeRouter(authConfig));
  apiRouter.use(createPayrollRouter(authConfig));
  apiRouter.use(createReportsRouter(authConfig));

  app.use("/api/v1", apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
