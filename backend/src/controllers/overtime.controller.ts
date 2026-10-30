import { asyncHandler } from "../middleware/async-handler.js";
import { unauthorized } from "../errors/app-error.js";
import { decide, listRecords, submitOvertime } from "../services/overtime.service.js";
import { parseIdParam } from "../validation/employees.validation.js";
import { parseCreateOvertime, parseListOvertime } from "../validation/overtime.validation.js";

export const submitOvertimeHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await submitOvertime(req.user, parseCreateOvertime(req.body));
  res.status(201).json({ success: true, data });
});

export const listOvertimeHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await listRecords(req.user, parseListOvertime(req.query));
  res.status(200).json({ success: true, data });
});

export const approveOvertimeHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await decide(parseIdParam(req.params), "APPROVED", req.user.id);
  res.status(200).json({ success: true, data });
});

export const rejectOvertimeHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await decide(parseIdParam(req.params), "REJECTED", req.user.id);
  res.status(200).json({ success: true, data });
});
