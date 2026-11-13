import { z } from "zod";

/**
 * Every environment variable the API reads, validated ONCE at startup.
 * The rest of the code imports `config` and never reads process.env directly.
 *
 * Where the values come from:
 * - local dev: the root .env file (`npm run dev:api` passes --env-file=../.env)
 * - Netlify:   the site's environment variables (Site configuration → Environment variables)
 *
 * If something is missing or malformed, importing this module throws, so the app fails
 * immediately with a clear message instead of failing later inside a request.
 */

const envSchema = z.object({
    DATABASE_URL: z.url(),
    PORT:z.coerce.number().int().default(3001),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development")

});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  // prettifyError names the variable and the rule that failed, never the value:
  // values can be secrets (DATABASE_URL contains the database password).
  throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
}

export const config = result.data;

// The config's TypeScript type, inferred from the schema (no need to write it by hand).
export type Config = z.infer<typeof envSchema>;
