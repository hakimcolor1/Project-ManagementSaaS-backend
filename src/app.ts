import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env, isProduction } from "./config/env.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFound } from "./middlewares/notFound.js";
import { globalLimiter } from "./middlewares/rateLimit.js";
import { apiRoutes } from "./routes.js";
import { sendResponse } from "./utils/sendResponse.js";

const app = express();

// On Vercel the request comes through one proxy; trust it so rate limiting sees the real client IP.
if (isProduction) {
  app.set("trust proxy", 1);
}

const corsOrigins =
  env.CORS_ORIGINS === "*"
    ? "*"
    : env.CORS_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

app.use(helmet());
app.use(cors({ origin: corsOrigins }));
app.use(globalLimiter);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/", (_req, res) => {
  sendResponse(res, {
    message: "TaskNest API is running",
    data: { name: "TaskNest", version: "v1", baseUrl: "/api/v1", health: "/api/v1/health" },
  });
});

app.use("/api/v1", apiRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
