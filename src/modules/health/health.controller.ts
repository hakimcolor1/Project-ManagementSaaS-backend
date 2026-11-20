import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { sendResponse } from "../../utils/sendResponse.js";

/** GET /api/v1/health – is the API up and can it reach the database? */
export async function getHealth(_req: Request, res: Response) {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    throw new AppError(503, "Database is not reachable");
  }

  sendResponse(res, {
    message: "TaskNest API is healthy",
    data: {
      status: "ok",
      database: "up",
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
}
