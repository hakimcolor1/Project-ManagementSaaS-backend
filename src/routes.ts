import { Router } from "express";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
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
