import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, type AppErrorCode } from "../errors/app-error";

/**
 * 404 handler: runs only when no route matched the request.
 * Registered in app.ts AFTER all routes (Express runs middleware in registration order).
 */
export const notFound: RequestHandler = (req, res) => {
  console.warn(`404 ${req.method} ${req.originalUrl}`); // see what clients asked for
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
};

// Every AppErrorCode → HTTP status. Record<AppErrorCode, number> makes TypeScript fail
// if a code is missing, so adding a code to app-error.ts forces a mapping here.
const statusByCode: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400, // the request itself is wrong (bad input)
  UNAUTHENTICATED: 401, // we don't know who you are (no or invalid session)
  NOT_FOUND: 404, // doesn't exist, or isn't yours
  CONFLICT: 409, // clashes with the current state of the data (e.g. duplicate)
};

/**
 * Error handler: Express treats a middleware with FOUR parameters as an error handler.
 * It runs when a route throws, when an async route's promise rejects (Express 5 catches
 * that for you), or when something calls next(err). Registered LAST in app.ts.
 *
 * Keep all four parameters even if you don't use some of them: Express counts them
 * to decide that this is an error handler.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // 1. The response already started streaming: we can't send another one.
  //    Hand off to Express's default handler, which closes the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  // 2. Expected failure that our code threw on purpose. Its message was written for the client.
  if (err instanceof AppError) {
    res.status(statusByCode[err.code]).json({ error: err.message, code: err.code });
    return;
  }

  // 3. The request body wasn't valid JSON (express.json() throws this before any route runs).
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body", code: "BAD_REQUEST" });
    return;
  }

  // 4. Anything else is a bug: log everything on the server, tell the client nothing.
  //    (Shows in the terminal locally and in Netlify's function logs in production.)
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
