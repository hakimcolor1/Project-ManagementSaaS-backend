import express from "express";

const app = express();

app.use(express.json({ limit: "100kb" }));

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "TaskNest API is running",
    data: { name: "TaskNest", version: "v1", baseUrl: "/api/v1" },
  });
});

export default app;
