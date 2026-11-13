import pg from "pg";
import { config } from "../config";
import { SUPABASE_CA_CERT } from "./supabase-ca";

/**
 * The API's Postgres connection pool: one per process, shared by every request.
 *
 * Which Supabase connection string DATABASE_URL holds (same database, different port):
 * - local .env: session pooler, port 5432. dbmate needs session mode, and one long-running
 *   dev server is fine on it.
 * - Netlify:    transaction pooler, port 6543. Many short-lived function instances share a
 *   few real database connections, so we don't hit Supabase's connection limit.
 */

// If the URL contains sslmode=..., pg lets it override the `ssl` option below.
// .env keeps sslmode=require for dbmate, so strip it here.
function withoutSslMode(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  return parsed.toString();
}

export const pool = new pg.Pool({
  connectionString: withoutSslMode(config.DATABASE_URL),

  // Encrypt AND verify that the server really is Supabase (see supabase-ca.ts).
  ssl: { ca: SUPABASE_CA_CERT },

  // Netlify: an instance handles one request at a time, and the transaction pooler does the
  // real pooling, so 1 connection per instance is enough. Locally: a few for parallel requests.
  max: config.NODE_ENV === "production" ? 1 : 5,

  idleTimeoutMillis: 10_000, // close connections idle for 10s
  connectionTimeoutMillis: 5_000, // fail a request after 5s instead of hanging if the DB is unreachable
});

// An idle connection can fail (e.g. Supabase restarts or drops it). Without this listener,
// Node treats that as an unhandled error and the whole process crashes.
pool.on("error", (err) => {
  console.error("Postgres pool error (idle connection)", err);
});
