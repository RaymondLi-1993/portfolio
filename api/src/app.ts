import express from 'express';
import { healthRouter } from './routes/health';
import { errorHandler, notFound } from './middleware/errors';

/**
 * Builds the Express app and registers routes. It never calls listen():
 * - server.ts listens on a port for local dev
 * - netlify/functions/api.ts wraps it for Netlify Functions
 * - tests call createApp() directly with supertest, without opening a port
 */
export function createApp() {
  const app = express();

  // Don't advertise "X-Powered-By: Express" in every response.
  app.disable('x-powered-by');

  // Parse JSON request bodies into req.body.
  app.use(express.json());

  // Routes. Everything lives under /api (Netlify will send /api/* to the function).
  app.use('/api/health', healthRouter);

  // These two must stay AFTER all routes: Express runs middleware in the order it's registered.
  app.use(notFound); // no route matched → 404 JSON
  app.use(errorHandler); // something threw → 500 JSON (four params = error handler)

  return app;
}
