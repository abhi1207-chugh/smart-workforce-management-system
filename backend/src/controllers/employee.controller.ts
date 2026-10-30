import { asyncHandler as wrap } from "../middleware/async-handler.js";
import {
  createEmployee,
  deactivateEmployee,
  getEmployee,
  getEmployees,
  updateEmployee,
} from "../services/employee.service.js";
import {
  parseCreateEmployeeBody,
  parseIdParam,
  parseListEmployeesQuery,
  parseUpdateEmployeeBody,
} from "../validation/employees.validation.js";

export const listEmployeesHandler = wrap(async (req, res) => {
  const filters = parseListEmployeesQuery(req.query);
  res.status(200).json({ success: true, data: await getEmployees(filters) });
});

export const createEmployeeHandler = wrap(async (req, res) => {
  const input = parseCreateEmployeeBody(req.body);
  res.status(201).json({ success: true, data: await createEmployee(input) });
});

export const getEmployeeHandler = wrap(async (req, res) => {
  const id = parseIdParam(req.params);
  res.status(200).json({ success: true, data: await getEmployee(id) });
});

export const updateEmployeeHandler = wrap(async (req, res) => {
  const id = parseIdParam(req.params);
  const input = parseUpdateEmployeeBody(req.body);
  res.status(200).json({ success: true, data: await updateEmployee(id, input) });
});

export const deactivateEmployeeHandler = wrap(async (req, res) => {
  const id = parseIdParam(req.params);
  res.status(200).json({ success: true, data: await deactivateEmployee(id) });
});
