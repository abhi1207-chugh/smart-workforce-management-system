import { asyncHandler as wrap } from "../middleware/async-handler.js";
import { unauthorized } from "../errors/app-error.js";
import { getFaceStatus, registerFace, revokeFace } from "../services/face.service.js";
import { parseIdParam } from "../validation/employees.validation.js";
import { parseRecognizeFaceBody, parseRegisterFaceBody } from "../validation/face.validation.js";
import { recognizeFace } from "../services/face-recognition.service.js";
import type { FaceConfig } from "../config/env.js";
import type { AuthConfig } from "../services/auth.service.js";
import { asyncHandler } from "../middleware/async-handler.js";

/** Identify-only; never writes attendance. Any authenticated user (kiosk = ADMIN login). */
export function createRecognizeHandler(auth: AuthConfig, face: FaceConfig) {
  return asyncHandler(async (req, res) => {
    const { embedding } = parseRecognizeFaceBody(req.body);
    if (!req.user) throw unauthorized();
    const result = await recognizeFace(embedding, req.user.id, auth.jwtSecret, face);
    res.status(200).json({ success: true, data: result });
  });
}

export const registerFaceHandler = wrap(async (req, res) => {
  const id = parseIdParam(req.params);
  const input = parseRegisterFaceBody(req.body);
  if (!req.user) throw unauthorized();
  res.status(201).json({ success: true, data: await registerFace(id, input, req.user.id) });
});

export const revokeFaceHandler = wrap(async (req, res) => {
  const id = parseIdParam(req.params);
  if (!req.user) throw unauthorized();
  res.status(200).json({ success: true, data: await revokeFace(id, req.user.id) });
});

export const faceStatusHandler = wrap(async (req, res) => {
  const id = parseIdParam(req.params);
  res.status(200).json({ success: true, data: await getFaceStatus(id) });
});
