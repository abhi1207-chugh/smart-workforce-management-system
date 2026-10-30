import { asyncHandler } from "../middleware/async-handler.js";
import { unauthorized } from "../errors/app-error.js";
import * as svc from "../services/payroll.service.js";
import { parseIdParam } from "../validation/employees.validation.js";
import * as v from "../validation/payroll.validation.js";

const ok = (data: unknown) => ({ success: true, data });

export const createRunHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  res.status(201).json(ok(await svc.createRun(v.parseCreateRun(req.body), req.user.id)));
});
export const listRunsHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.listRuns(v.parseRunList(req.query))));
});
export const getRunHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.getRun(parseIdParam(req.params))));
});
export const computeRunHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.computeRun(parseIdParam(req.params))));
});
export const finalizeRunHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.finalizeRun(parseIdParam(req.params))));
});

export const listRecordsHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  res.status(200).json(ok(await svc.listRecords(req.user, v.parseRecordList(req.query))));
});
export const getRecordHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  res.status(200).json(ok(await svc.getRecord(req.user, parseIdParam(req.params))));
});
export const payslipHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  res.status(200).json(ok(await svc.getPayslip(req.user, parseIdParam(req.params))));
});

export const createBonusHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  res.status(201).json(ok(await svc.createBonus(v.parseBonus(req.body), req.user.id)));
});
export const listBonusesHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.listBonuses(v.parseAdjustmentList(req.query))));
});
export const createDeductionHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  res.status(201).json(ok(await svc.createDeduction(v.parseDeduction(req.body), req.user.id)));
});
export const listDeductionsHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.listDeductions(v.parseAdjustmentList(req.query))));
});

export const createPaymentHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  res.status(201).json(ok(await svc.recordPayment(v.parsePayment(req.body), req.user.id)));
});
export const listPaymentsHandler = asyncHandler(async (req, res) => {
  res.status(200).json(ok(await svc.listPayments(v.parsePaymentList(req.query))));
});
