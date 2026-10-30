import type { Request, Response, NextFunction } from "express";
import { getDepartments, getShifts } from "../services/reference.service.js";

export function listDepartmentsHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  getDepartments()
    .then((data) => res.status(200).json({ success: true, data }))
    .catch(next);
}

export function listShiftsHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  getShifts()
    .then((data) => res.status(200).json({ success: true, data }))
    .catch(next);
}
