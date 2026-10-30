import { asyncHandler } from "../middleware/async-handler.js";
import { unauthorized } from "../errors/app-error.js";
import * as svc from "../services/reports.service.js";
import * as v from "../validation/reports.validation.js";

const ok = (data: unknown) => ({ success: true, data });

export const attendanceSummaryHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.attendanceSummary(v.parseAttendanceSummary(req.query))));
});
export const leaveBalancesReportHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.leaveBalances(v.parseLeaveBalanceReport(req.query))));
});
export const payrollRegisterHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.payrollRegister(v.parsePayrollRegister(req.query).period_id)));
});
export const meSummaryHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  res.status(200).json(ok(await svc.meSummary(req.user, v.parseMeSummary(req.query))));
});
export const auditLogsHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.auditLogs(v.parseAuditQuery(req.query))));
});
export const dashboardHandler = asyncHandler(async (_req, res) => {
  res.status(200).json(ok(await svc.dashboard()));
});
