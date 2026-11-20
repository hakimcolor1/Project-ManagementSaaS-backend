import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function createLimiter(limit: number, message: string) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test",
    handler: (_req, res) => {
      res.status(429).json({ success: false, message, errors: [] });
    },
  });
}

/** Every request: 300 per 15 minutes per IP. */
export const globalLimiter = createLimiter(
  300,
  "Too many requests. Please try again in 15 minutes.",
);

/** Login, register and refresh: 20 per 15 minutes per IP (slows down password guessing). */
export const authLimiter = createLimiter(20, "Too many attempts. Please try again in 15 minutes.");
