import type { Request, Response } from "express";
import { getHealthStatus } from "../database/health.js";

export async function getHealth(_req: Request, res: Response): Promise<void> {
  const health = await getHealthStatus();
  res.status(200).json({
    success: true,
    data: health,
  });
}
