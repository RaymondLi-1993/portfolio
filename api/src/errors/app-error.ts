/**
 * The app's one error class for EXPECTED failures: bad input, a card that doesn't exist,
 * not signed in. It knows nothing about HTTP, so logic/ modules, routes and scheduled jobs
 * can all throw it. The HTTP layer (middleware/errors.ts) maps each code to a status code.
 *
 * Anything thrown that is NOT an AppError is treated as a bug: it gets logged, and the
 * client only sees a generic 500.
 *
 * Usage:
 *   throw new AppError("NOT_FOUND", "Card not found");
 *   throw new AppError("BAD_REQUEST", "Quantity must be at least 1");
 *   throw new AppError("NOT_FOUND", "Lot not found", { cause: dbError }); // keeps the original error for logs
 */

// Add a code here only when a real feature needs it.
export type AppErrorCode =
  | "BAD_REQUEST" // input failed validation
  | "UNAUTHENTICATED" // not signed in, or the session is invalid
  | "NOT_FOUND" // doesn't exist, OR belongs to another user (never reveal which)
  | "CONFLICT"; // clashes with existing data, e.g. a duplicate

export class AppError extends Error {
  readonly code: AppErrorCode;

  /**
   * @param code    what kind of failure this is (the HTTP layer picks the status from it)
   * @param message safe to show the client: never put SQL, ids of other users, or internals here
   * @param options.cause the underlying error, kept for server logs only
   */
  constructor(
    code: AppErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
  }
}
