import { asyncHandler } from "../middleware/async-handler.js";
import { unauthorized } from "../errors/app-error.js";
import {
  checkIn,
  checkOut,
  correctSession,
  getTodayStatus,
  listAttendance,
  resolveEmployeeId,
} from "../services/attendance.service.js";
import {
  parseCorrectionBody,
  parseListAttendance,
  parsePunchBody,
  parseTodayQuery,
} from "../validation/attendance.validation.js";
import { parseIdParam } from "../validation/employees.validation.js";

export const checkInHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const body = parsePunchBody(req.body);
  const data = await checkIn(resolveEmployeeId(req.user, body.employee_id));
  res.status(201).json({ success: true, data });
});

export const checkOutHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const body = parsePunchBody(req.body);
  const data = await checkOut(resolveEmployeeId(req.user, body.employee_id));
  res.status(200).json({ success: true, data });
});

export const todayHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const query = parseTodayQuery(req.query);
  const data = await getTodayStatus(resolveEmployeeId(req.user, query.employee_id));
  res.status(200).json({ success: true, data });
});

export const correctionHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const id = parseIdParam(req.params);
  const input = parseCorrectionBody(req.body);
  const data = await correctSession(id, input, req.user.id);
  res.status(200).json({ success: true, data });
});

export const listAttendanceHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await listAttendance(req.user, parseListAttendance(req.query));
  res.status(200).json({ success: true, data });
});
