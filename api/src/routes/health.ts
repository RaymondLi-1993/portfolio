import { Router } from "express";

// A Router is a mini-app: a group of routes you mount at a path in app.ts.
// This one is mounted at /api/health, so a handler for '/' here answers GET /api/health.
export const healthRouter = Router();

// Public on purpose: monitoring checks the API is up without signing in. It returns no user data.
healthRouter.get("/", (_req, res) => {
  res.json({ status: "ok" });
});
