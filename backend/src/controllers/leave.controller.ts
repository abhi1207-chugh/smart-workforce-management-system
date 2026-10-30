import { asyncHandler } from "../middleware/async-handler.js";
import { unauthorized } from "../errors/app-error.js";
import {
  adjustBalance,
  approveRequest,
  getBalances,
  getLeaveTypes,
  getRequest,
  listRequests,
  rejectRequest,
  submitLeave,
} from "../services/leave.service.js";
import { parseIdParam } from "../validation/employees.validation.js";
import {
  parseAdjustBalance,
  parseCreateLeave,
  parseLeaveBalances,
  parseListLeave,
} from "../validation/leave.validation.js";

export const leaveTypesHandler = asyncHandler(async (_req, res) => {
  res.status(200).json({ success: true, data: await getLeaveTypes() });
});

export const submitLeaveHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await submitLeave(req.user, parseCreateLeave(req.body));
  res.status(201).json({ success: true, data });
});

export const listLeaveHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await listRequests(req.user, parseListLeave(req.query));
  res.status(200).json({ success: true, data });
});

export const getLeaveHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await getRequest(req.user, parseIdParam(req.params));
  res.status(200).json({ success: true, data });
});

export const approveLeaveHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await approveRequest(parseIdParam(req.params), req.user.id);
  res.status(200).json({ success: true, data });
});

export const rejectLeaveHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await rejectRequest(parseIdParam(req.params), req.user.id);
  res.status(200).json({ success: true, data });
});

export const balancesHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const { employee_id } = parseLeaveBalances(req.query);
  res.status(200).json({ success: true, data: await getBalances(req.user, employee_id) });
});

export const adjustBalanceHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const data = await adjustBalance(parseAdjustBalance(req.body), req.user.id);
  res.status(200).json({ success: true, data });
});
