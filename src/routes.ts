import { Router } from "express";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { paymentRoutes } from "./modules/payments/payments.routes.js";
import { projectRoutes } from "./modules/projects/projects.routes.js";
import { taskRoutes } from "./modules/tasks/tasks.routes.js";
import { userRoutes } from "./modules/users/users.routes.js";

/** Every module is mounted here, under /api/v1. */
export const apiRoutes = Router();

apiRoutes.use("/health", healthRoutes);
apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/users", userRoutes);
apiRoutes.use("/projects", projectRoutes);
apiRoutes.use("/tasks", taskRoutes);
apiRoutes.use("/payments", paymentRoutes);
apiRoutes.use("/admin", adminRoutes);
