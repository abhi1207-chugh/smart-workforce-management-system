import { Router } from "express";
import { getHealth } from "../controllers/health.controller.js";
import {
  createEmployeeHandler,
  deactivateEmployeeHandler,
  getEmployeeHandler,
  listEmployeesHandler,
  updateEmployeeHandler,
} from "../controllers/employee.controller.js";
import {
  checkInHandler,
  checkOutHandler,
  correctionHandler,
  listAttendanceHandler,
  todayHandler,
} from "../controllers/attendance.controller.js";
import {
  approveLeaveHandler,
  adjustBalanceHandler,
  balancesHandler,
  getLeaveHandler,
  leaveTypesHandler,
  listLeaveHandler,
  rejectLeaveHandler,
  submitLeaveHandler,
} from "../controllers/leave.controller.js";
import {
  approveOvertimeHandler,
  listOvertimeHandler,
  rejectOvertimeHandler,
  submitOvertimeHandler,
} from "../controllers/overtime.controller.js";
import * as reports from "../controllers/reports.controller.js";
import * as payroll from "../controllers/payroll.controller.js";
import {
  listDepartmentsHandler,
  listShiftsHandler,
} from "../controllers/reference.controller.js";
import { createAuthenticate, requireRole } from "../middleware/auth.js";
import { createLoginHandler } from "../controllers/auth.controller.js";
import type { AuthConfig } from "../services/auth.service.js";

export function createHealthRouter(): Router {
  const router = Router();
  router.get("/health", (req, res, next) => {
    void getHealth(req, res).catch(next);
  });
  return router;
}

export function createEmployeeRouter(config: AuthConfig): Router {
  const router = Router();
  router.use("/employees", createAuthenticate(config.jwtSecret), requireRole("ADMIN"));
  router.get("/employees", listEmployeesHandler);
  router.post("/employees", createEmployeeHandler);
  router.get("/employees/:id", getEmployeeHandler);
  router.patch("/employees/:id", updateEmployeeHandler);
  router.post("/employees/:id/deactivate", deactivateEmployeeHandler);
  return router;
}

export function createReferenceRouter(config: AuthConfig): Router {
  const router = Router();
  const adminOnly = [createAuthenticate(config.jwtSecret), requireRole("ADMIN")];
  router.get("/departments", ...adminOnly, listDepartmentsHandler);
  router.get("/shifts", ...adminOnly, listShiftsHandler);
  return router;
}

export function createAttendanceRouter(config: AuthConfig): Router {
  const router = Router();
  const authenticate = createAuthenticate(config.jwtSecret);
  router.post("/attendance/check-in", authenticate, checkInHandler);
  router.post("/attendance/check-out", authenticate, checkOutHandler);
  router.get("/attendance/today", authenticate, todayHandler);
  router.get("/attendance", authenticate, listAttendanceHandler);
  router.patch(
    "/attendance/:id",
    authenticate,
    requireRole("ADMIN"),
    correctionHandler
  );
  return router;
}

export function createLeaveRouter(config: AuthConfig): Router {
  const router = Router();
  const authenticate = createAuthenticate(config.jwtSecret);
  const admin = requireRole("ADMIN");
  router.get("/leave/types", authenticate, leaveTypesHandler);
  router.get("/leave/balances", authenticate, balancesHandler);
  router.post("/leave/balances/adjust", authenticate, admin, adjustBalanceHandler);
  router.get("/leave/requests", authenticate, listLeaveHandler);
  router.post("/leave/requests", authenticate, requireRole("EMPLOYEE"), submitLeaveHandler);
  router.get("/leave/requests/:id", authenticate, getLeaveHandler);
  router.post("/leave/requests/:id/approve", authenticate, admin, approveLeaveHandler);
  router.post("/leave/requests/:id/reject", authenticate, admin, rejectLeaveHandler);
  return router;
}

export function createOvertimeRouter(config: AuthConfig): Router {
  const router = Router();
  const authenticate = createAuthenticate(config.jwtSecret);
  const admin = requireRole("ADMIN");
  router.get("/overtime", authenticate, listOvertimeHandler);
  router.post("/overtime", authenticate, submitOvertimeHandler);
  router.post("/overtime/:id/approve", authenticate, admin, approveOvertimeHandler);
  router.post("/overtime/:id/reject", authenticate, admin, rejectOvertimeHandler);
  return router;
}

export function createPayrollRouter(config: AuthConfig): Router {
  const router = Router();
  const authenticate = createAuthenticate(config.jwtSecret);
  const admin = [authenticate, requireRole("ADMIN")];

  router.get("/payroll/runs", ...admin, payroll.listRunsHandler);
  router.post("/payroll/runs", ...admin, payroll.createRunHandler);
  router.get("/payroll/runs/:id", ...admin, payroll.getRunHandler);
  router.post("/payroll/runs/:id/compute", ...admin, payroll.computeRunHandler);
  router.post("/payroll/runs/:id/finalize", ...admin, payroll.finalizeRunHandler);

  // Scoped in the service: employees see only their own finalized/paid records.
  router.get("/payroll/records", authenticate, payroll.listRecordsHandler);
  router.get("/payroll/records/:id", authenticate, payroll.getRecordHandler);
  router.get("/payroll/records/:id/payslip", authenticate, payroll.payslipHandler);

  router.get("/bonuses", ...admin, payroll.listBonusesHandler);
  router.post("/bonuses", ...admin, payroll.createBonusHandler);
  router.get("/deductions", ...admin, payroll.listDeductionsHandler);
  router.post("/deductions", ...admin, payroll.createDeductionHandler);

  router.get("/payments", ...admin, payroll.listPaymentsHandler);
  router.post("/payments", ...admin, payroll.createPaymentHandler);
  return router;
}

export function createReportsRouter(config: AuthConfig): Router {
  const router = Router();
  const authenticate = createAuthenticate(config.jwtSecret);
  const admin = [authenticate, requireRole("ADMIN")];
  router.get("/reports/dashboard", ...admin, reports.dashboardHandler);
  router.get("/reports/attendance-summary", ...admin, reports.attendanceSummaryHandler);
  router.get("/reports/leave-balances", ...admin, reports.leaveBalancesReportHandler);
  router.get("/reports/payroll-register", ...admin, reports.payrollRegisterHandler);
  router.get("/reports/me/summary", authenticate, requireRole("EMPLOYEE"), reports.meSummaryHandler);
  router.get("/audit-logs", ...admin, reports.auditLogsHandler);
  return router;
}

export function createAuthRouter(config: AuthConfig): Router {
  const router = Router();
  router.post("/auth/login", createLoginHandler(config));
  router.get("/auth/me", createAuthenticate(config.jwtSecret), (req, res) => {
    res.status(200).json({ success: true, data: req.user });
  });
  return router;
}
