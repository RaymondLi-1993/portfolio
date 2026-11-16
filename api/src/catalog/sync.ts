import { pool } from "../db/pool";
import { tcgdex } from "../tcgdex/client";
import { toCardRow, toPrintings } from "./map";

export interface SyncOptions {
  /** Sync only this set (e.g. "sv08"), even if it was synced before. Default: every unsynced set. */
  setId?: string;
}

/**
 * Copy the TCGdex catalog into series → sets → cards → card_printings.
 * Resumable: a set counts as done once its `synced_at` is set, so re-running skips it.
 * Prices are NOT part of this (that's the daily price job).
 *
 * TODO(you), in this order:
 *   1. Series: tcgdex.listSeries(), then getSeries(id) for each (for releaseDate + its sets).
 *      Upsert into `series` (insert … on conflict (id) do update set name, release_date).
 *      Leave `era` alone: it's our classification, not TCGdex's (set by hand / a later step).
 *   2. Sets: upsert each series' sets into `sets` (id, series_id, name, release_date).
 *      Never overwrite synced_at here.
 *   3. Pick the sets to sync: [options.setId] if given, otherwise
 *      `select id from sets where synced_at is null order by release_date`.
 *   4. For each set (log progress, e.g. "sv08 (12/221): 252 cards"):
 *      a. tcgdex.getSet(id) → its card list
 *      b. for each card brief: tcgdex.getCard(card.id) → toCardRow + toPrintings
 *         (the client's throttle makes this ~1 card/second; a 252-card set ≈ 4 minutes)
 *      c. ONE transaction per set: upsert all cards, insert printings
 *         (on conflict (card_id, printing) do nothing), then set synced_at = now().
 *         If anything fails, the whole set rolls back and stays unsynced → the next run redoes it.
 *   5. Log a summary at the end (sets synced, cards, printings, time taken).
 *
 * Transactions with pg: const client = await pool.connect(); await client.query("begin");
 * … await client.query("commit") (or "rollback" in catch); finally client.release().
 */
export async function syncCatalog(options: SyncOptions = {}): Promise<void> {
  // These references only keep the imports "used" until you write the steps above.
  void pool;
  void tcgdex;
  void toCardRow;
  void toPrintings;
  throw new Error(`Not implemented: syncCatalog(${JSON.stringify(options)})`);
}
