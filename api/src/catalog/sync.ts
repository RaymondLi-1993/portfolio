import { pool } from "../db/pool";
import { tcgdex } from "../tcgdex/client";
import { sleep } from "../utils/sleep";
import { toCardRow, toPrices, toPrintings, toSeriesRow, toSetRows} from "./map";
import type { CardRow, PriceRow, Printing } from "./map";

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
  // Steps 1–2: series + sets (every run: cheap, and how new sets are discovered).
  await syncSeriesAndSets();

  // Step 4, one set at a time. For now only with --set; picking every unsynced set comes later.
  if (options.setId) {
    await syncSetCards(options.setId);
  } else {
    console.log("Card sync for all sets not built yet: run with --set <id> (e.g. --set sv08).");
  }
}

/** Everything one set's card step collects before writing (part 2 writes it in one transaction). */
interface CollectedSet {
  setId: string;
  releaseDate: string | null; // from GET /sets/:id: fills sets.release_date
  cards: CardRow[];
  printings: { cardId: string; printing: Printing }[]; // card_printings rows
  prices: (PriceRow & { cardId: string })[]; // prices, still keyed by card + printing (ids come in part 2)
  failedCards: string[]; // ids of cards that couldn't be fetched or mapped
}

/**
 * Step 4 for ONE set: fetch every card, shape it, collect the rows.
 * PART 1 (now): fetch + map + collect, then log the counts. NO database writes yet.
 * PART 2 (next): write everything in one transaction, then set release_date and synced_at.
 *
 * TODO(you), part 1:
 *   1. const set = await tcgdex.getSet(setId)   (null → throw: the set doesn't exist on TCGdex)
 *   2. Start a CollectedSet: { setId, releaseDate: set.releaseDate ?? null, cards: [], printings: [],
 *      prices: [], failedCards: [] }
 *   3. For each card brief in set.cards (for…of, so requests stay one at a time, ~1/s):
 *        try {
 *          const card = await tcgdex.getCard(brief.id)
 *          null → console.warn + push brief.id into failedCards + continue
 *          push toCardRow(card) into cards
 *          for each printing of toPrintings(card): push { cardId: card.id, printing }
 *          for each price of toPrices(card):        push { cardId: card.id, ...price }
 *        } catch (err) {
 *          console.warn(...) + push brief.id into failedCards   (keep going with the next card)
 *        }
 *      Optional: log progress every 25 cards, e.g. "sv08: 50/252", since a set takes minutes.
 *   4. Log the counts: `${setId}: ${cards} cards, ${printings} printings, ${prices} prices, ${failed} failed`
 *   5. Return the CollectedSet (part 2 will use it).
 */
async function syncSetCards(setId: string): Promise<CollectedSet> {
  const set = await tcgdex.getSet(setId);
  if (!set) throw new Error(`There was an error fetching the cards from ${setId}`);

  const collected: CollectedSet = {
    setId,
    releaseDate: set.releaseDate ?? null,
    cards: [],
    printings: [],
    prices: [],
    failedCards: [],
  };

  // Pass 1: every card in the set. A failure is recorded, and the loop moves on to the next card.
  for (const brief of set.cards) {
    const ok = await collectCard(brief.id, collected);
    if (!ok) collected.failedCards.push(brief.id);
  }

  // Pass 2: retry ONLY the cards that failed, once, after a short pause. TCGdex's 503s are brief,
  // so most failures succeed the second time and the set can still finish in this run.
  // A card that fails again stays in failedCards (likely a real problem): the set stays unsynced.
  if (collected.failedCards.length > 0) {
    const toRetry = collected.failedCards;
    collected.failedCards = [];
    console.log(`${setId}: retrying ${toRetry.length} failed card(s) in ${RETRY_PAUSE_MS / 1000}s…`);
    await sleep(RETRY_PAUSE_MS);

    for (const cardId of toRetry) {
      const ok = await collectCard(cardId, collected);
      if (!ok) collected.failedCards.push(cardId);
    }
  }

  console.log(
    `${setId}: ${collected.cards.length} cards, ${collected.printings.length} printings, ` +
      `${collected.prices.length} prices, ${collected.failedCards.length} failed` +
      (collected.failedCards.length > 0 ? ` (${collected.failedCards.join(", ")})` : ""),
  );

  return collected;
}

const RETRY_PAUSE_MS = 5_000;

/**
 * Fetch ONE card, shape it, and add its rows to `collected`.
 * Returns true if it worked, false if it didn't (logged here; the caller decides what to record).
 * Never throws: one bad card must not stop the set.
 */
async function collectCard(cardId: string, collected: CollectedSet): Promise<boolean> {
  try {
    const card = await tcgdex.getCard(cardId); // the FULL card (the set only gave us a brief)
    if (!card) {
      console.warn(`${cardId}: not found on TCGdex`);
      return false;
    }

    // Map everything BEFORE pushing anything: if a mapper throws, nothing half-added is left behind.
    const cardRow = toCardRow(card);
    const printings = toPrintings(card);
    const prices = toPrices(card);

    collected.cards.push(cardRow);
    for (const printing of printings) {
      collected.printings.push({ cardId: card.id, printing });
    }
    for (const price of prices) {
      collected.prices.push({ cardId: card.id, ...price });
    }
    return true;
  } catch (err) {
    // A TCGdex error (503, timeout…) or bad data a mapper rejected. Record it; don't stop the set.
    console.warn(`${cardId}: failed (${err instanceof Error ? err.message : String(err)})`);
    return false;
  }
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
 *        Write the series row FIRST (sets.series_id points at it), then its sets. Each upsert is
 *        its own pool.query (no transaction: decided 2026-11-18; if a run fails partway, the
 *        re-run fills in anything missing, since the upserts are idempotent):
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
  let setsSaved = 0;

  for (const { id, name } of allSeries) {
    if (SKIPPED_SERIES.has(id)) continue;

    const series = await tcgdex.getSeries(id);
    if (!series) {
      console.warn(`The series was missing for id, ${id}, ${name}`);
      continue;
    }

    const row = toSeriesRow(series);
    const era = SERIES_ERAS[row.id] ?? null;
    const setRows = toSetRows(series);

    // The series row FIRST: each set's series_id must point at an existing series row.
    await pool.query(
      `insert into series (id, name, release_date, era)
       values ($1, $2, $3, $4)
       on conflict (id) do update
         set name = excluded.name,
             release_date = excluded.release_date,
             era = excluded.era`,
      [row.id, row.name, row.releaseDate, era],
    );

    // Then this series' sets. release_date and synced_at aren't listed, so the upsert never
    // touches them: the card step owns those.
    for (const set of setRows) {
      await pool.query(
        `insert into sets (id, series_id, name)
         values ($1, $2, $3)
         on conflict (id) do update
           set series_id = excluded.series_id,
               name = excluded.name`,
        [set.id, set.seriesId, set.name],
      );
    }

    saved++;
    setsSaved += setRows.length;
    console.log(`series ${row.id}: saved (${era ?? "no era"}), ${setRows.length} sets`);
  }

  console.log(`Series done: ${saved} series, ${setsSaved} sets saved`);
}
