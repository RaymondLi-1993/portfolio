import { pool } from "../db/pool";
import { tcgdex } from "../tcgdex/client";
import { toCardRow, toPrices, toPrintings, toSeriesRow, toSetRows } from "./map";

/**
 * TCGdex series we don't sync (yet). Data, not scattered ifs: edit this list to change it.
 * - base, gym, neo: vintage. TCGdex merges 1st Edition / Shadowless / Unlimited into one card,
 *   and its pricing only has one block (the Unlimited price). Vintage is a fast follow, once we
 *   have per-edition prices (likely JustTCG). To add it later: remove these three and re-run.
 * - tcgp: Pokémon TCG Pocket, a digital game (no physical cards, no TCGplayer prices).
 */
const SKIPPED_SERIES = new Set(["base", "gym", "neo", "tcgp"]);

/**
 * Our era for each series: which market index it belongs to. OUR classification, not TCGdex's
 * (TCGdex has no era field). Written by the series upsert on every run, so editing this map and
 * re-running reclassifies a series. Not listed (misc, tk, mc, a brand-new series) → null = no index.
 * Note: vintage for the index (Base → POP) is wider than SKIPPED_SERIES (only base, gym, neo).
 */
const SERIES_ERAS: Record<string, "vintage" | "mid" | "modern"> = {
  lc: "vintage", ecard: "vintage", ex: "vintage", pop: "vintage",
  dp: "mid", pl: "mid", hgss: "mid", col: "mid", bw: "mid", xy: "mid", sm: "mid",
  swsh: "modern", sv: "modern", me: "modern",
};

export interface SyncOptions {
  /** Sync only this set (e.g. "sv08"), even if it was synced before. Default: every unsynced set. */
  setId?: string;
}

/**
 * Copy the TCGdex catalog into series → sets → cards → card_printings, plus each printing's
 * CURRENT price into `prices` (a starting price; the card response includes it for free).
 * Not written here: price history (`price_snapshots`) and the fetch notebook (`price_fetches`);
 * those belong to the daily price job.
 * Resumable: a set counts as done once its `synced_at` is set, so re-running skips it.
 * No retries inside the TCGdex client: a failed card leaves its set unsynced, and the next run
 * fetches the set again.
 *
 * TODO(you), in this order:
 *   1. Series: tcgdex.listSeries(), drop the ids in SKIPPED_SERIES, then getSeries(id) for each
 *      remaining one (for releaseDate + its sets).
 *      Upsert into `series` (insert … on conflict (id) do update set name, release_date, era),
 *      with era from our SERIES_ERAS map (TCGdex has no era).
 *   2. Sets: upsert each series' sets into `sets` (id, series_id, name, release_date).
 *      Never overwrite synced_at here.
 *   3. Pick the sets to sync: [options.setId] if given, otherwise
 *      `select id from sets where synced_at is null order by release_date`.
 *   4. For each set, inside a try/catch (a failing SET is logged, recorded, and skipped; the run
 *      continues with the next set). Log progress, e.g. "sv08 (12/221): 252 cards".
 *      a. tcgdex.getSet(id) → its card list
 *      b. for each card brief, inside its own try/catch:
 *           tcgdex.getCard(card.id) → null (404)? record it as failed.
 *           Otherwise toCardRow + toPrintings + toPrices, collected in arrays for this set.
 *           On error: log it, push the card id to `failedCards`, continue with the next card.
 *         (the client's rate limit makes this ~1 card/second; a 252-card set ≈ 4 minutes)
 *      c. ONE transaction per set:
 *           - upsert the cards that worked (on conflict (id) do update …)
 *           - insert their printings (on conflict (card_id, printing) do nothing)
 *           - look up those printings' ids, then upsert `prices`
 *             (on conflict (printing_id) do update set market_price, source_updated_at)
 *           - set synced_at = now() ONLY IF failedCards is empty. Otherwise leave it null,
 *             so the next run fetches the set again (re-saving the good cards is harmless).
 *         If a query fails: rollback, so nothing from this set is saved; the set's catch records it.
 *   5. Log a summary (sets synced, cards, printings, prices, failed sets/cards, time taken).
 *      If anything failed, throw at the end so the script exits with code 1.
 *
 * Transactions with pg: const client = await pool.connect(); await client.query("begin");
 * … await client.query("commit") (or "rollback" in catch); finally client.release().
 */


export async function syncCatalog(options: SyncOptions = {}): Promise<void> {
  // Slice 1: series + sets only (steps 1–2 above). Cards come in the next slice.
  await syncSeriesAndSets();

  // These references only keep the imports "used" until the card steps (3–5) are written.
  void toCardRow;
  void toPrintings;
  void toPrices;
  console.log(`Card sync not built yet (options: ${JSON.stringify(options)}).`);
}

/**
 * Steps 1–2: copy every series we sync, and the sets inside them, into `series` and `sets`.
 * About 18 requests (~20s at 1/s). Safe to re-run: upserts update rows that already exist.
 *
 * TODO(you):
 *   1. const all = await tcgdex.listSeries()  (null would mean TCGdex returned 404: throw)
 *      Keep only ids NOT in SKIPPED_SERIES  (SKIPPED_SERIES.has(id))
 *   2. For each kept series id (a for…of loop, so requests stay one at a time):
 *        const series = await tcgdex.getSeries(id)   (null → log it and skip this series)
 *        const seriesRow = toSeriesRow(series), setRows = toSetRows(series)
 *        Write both in ONE transaction (the series row FIRST: sets.series_id points at it):
 *          a. upsert the series row, with its era from our map (SERIES_ERAS[row.id] ?? null):
 *               insert into series (id, name, release_date, era) values ($1, $2, $3, $4)
 *               on conflict (id) do update set name = excluded.name,
 *                 release_date = excluded.release_date, era = excluded.era
 *          b. upsert each set row:
 *               insert into sets (id, series_id, name) values ($1, $2, $3)
 *               on conflict (id) do update set series_id = excluded.series_id, name = excluded.name
 *             (don't touch release_date or synced_at: the card sync owns those)
 *      `excluded` = the row you tried to insert, so "do update set name = excluded.name" means
 *      "if it already exists, overwrite its name with the new one".
 *   3. Log progress, e.g. "series sv: 19 sets", and a total at the end.
 *
 * Transactions with pg: const client = await pool.connect();
 *   try { await client.query("begin"); …queries with client.query(sql, params)…; await client.query("commit"); }
 *   catch (err) { await client.query("rollback"); throw err; }
 *   finally { client.release(); }
 */
async function syncSeriesAndSets(): Promise<void> {
  const allSeries = await tcgdex.listSeries();
  if (!allSeries) throw new Error("There was a failure fetching the list series from tcgdex");

  let saved = 0;

  for (const { id, name } of allSeries) {
    if (SKIPPED_SERIES.has(id)) continue;

    const series = await tcgdex.getSeries(id);
    if (!series) {
      console.warn(`The series was missing for id, ${id}, ${name}`);
      continue;
    }

    const row = toSeriesRow(series);
    const era = SERIES_ERAS[row.id] ?? null;
    await pool.query(
      `insert into series (id, name, release_date, era)
       values ($1, $2, $3, $4)
       on conflict (id) do update
         set name = excluded.name,
             release_date = excluded.release_date,
             era = excluded.era`,
      [row.id, row.name, row.releaseDate, era],
    );

    saved++;
    console.log(`series ${row.id}: saved (${era ?? "no era"})`);
  }

  console.log(`Series done: ${saved} saved`);
}
