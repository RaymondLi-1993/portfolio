import serverless from "serverless-http";
import { createApp } from "../../src/app";

// Production entry point: Netlify runs this as the function "api" (named after the file).
// netlify.toml sends every /api/* request here, and serverless-http converts Netlify's
// event into a request Express understands (and Express's response back into
// { statusCode, headers, body }). Local dev uses src/server.ts instead.
export const handler = serverless(createApp());
