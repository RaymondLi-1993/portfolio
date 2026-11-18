import { parseArgs } from "node:util";
import { syncCatalog } from "../src/catalog/sync";
import { pool } from "../src/db/pool";

/**
 * Command-line entry point for the catalog sync. Run from the repo root:
 *   npm run sync:catalog                 → every set not synced yet
 *   npm run sync:catalog -- --set sv08   → just this set (re-syncs it even if done)
 */
const { values } = parseArgs({
  options: { set: { type: "string" } },
});

try {
  await syncCatalog({ setId: values.set });
} catch (err) {
  console.error("Catalog sync failed:", err);
  process.exitCode = 1;
} finally {
  // Close the pool's connections, otherwise the open connections keep Node running.
  await pool.end();
}
