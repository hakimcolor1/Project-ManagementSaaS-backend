import type { Response } from "express";

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type SuccessResponse<T> = {
  statusCode?: number;
  message: string;
  data?: T;
  meta?: PaginationMeta;
};

/** Sends the standard success shape: { success: true, message, data, meta? } */
export function sendResponse<T>(
  res: Response,
  { statusCode = 200, message, data, meta }: SuccessResponse<T>,
): void {
  res.status(statusCode).json({
    success: true,
    message,
    data: data ?? null,
    ...(meta ? { meta } : {}),
  });
}
