import { pool } from "../db/pool";
import { tcgdex } from "../tcgdex/client";
import { sleep } from "../utils/sleep";
import {
  insertPrintings,
  listUnsyncedSets,
  upsertCards,
  upsertPrices,
  updateSetRow,
} from "./db";
import {
  toCardRow,
  toPrices,
  toPrintings,
  toSeriesRow,
  toSetRows,
} from "./map";
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
  lc: "vintage",
  ecard: "vintage",
  ex: "vintage",
  pop: "vintage",
  dp: "mid",
  pl: "mid",
  hgss: "mid",
  col: "mid",
  bw: "mid",
  xy: "mid",
  sm: "mid",
  swsh: "modern",
  sv: "modern",
  me: "modern",
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
 * Steps:
 *   1–2. syncSeriesAndSets: upsert every series (era from SERIES_ERAS) and its sets.
 *   3.   Pick the sets to sync: [--set] if given, otherwise every set not synced yet.
 *   4.   syncSets: for each set, syncSetCards fetches and shapes its cards (~1 card/s, no
 *        writes), then writeSet saves them in one transaction. synced_at is set only if no card
 *        failed, so the next run fetches an incomplete set again (re-saving good cards is harmless).
 */
export async function syncCatalog(options: SyncOptions = {}): Promise<void> {
  // Steps 1–2: series + sets (every run: cheap, and how new sets are discovered).
  await syncSeriesAndSets();

  // Step 3: which sets. --set re-syncs that one set even if it's already synced.
  const setIds = options.setId ? [options.setId] : await listUnsyncedSets(pool);

  // Step 4.
  await syncSets(setIds);
}

/**
 * Step 4: sync every set in `setIds`, one after another. A failing set is logged and skipped;
 * the run goes on. Logs progress, then a summary (time, sets, cards, failed and incomplete sets).
 *
 * @param setIds the sets to sync, in order
 * @throws if any set failed or was incomplete, so the script exits with code 1
 */
async function syncSets(setIds: string[]): Promise<void> {
  const results = {
    failedSets: [] as string[],
    incompleteSets: [] as { setId: string; cardIds: string[] }[],
    time: Date.now(),
    setsSynced: 0,
    cards: 0,
  };

  if (setIds.length === 0) {
    console.log("Nothing to sync: every set is already synced.");
    return;
  }

  for (const [i, setId] of setIds.entries()) {
    console.log(`${setId} (${i + 1}/${setIds.length})…`);
    try {
      const collected = await syncSetCards(setId);
      await writeSet(collected);
      results.setsSynced++;
      results.cards += collected.cards.length;

      if (collected.failedCards.length > 0) {
        results.incompleteSets.push({
          setId: setId,
          cardIds: collected.failedCards,
        });
      }
    } catch (e) {
      // The whole set failed (fetch, 404 or the save transaction): nothing was saved and the set
      // stays unsynced, so the next run tries it again. Record it, say why, move on.
      const reason = e instanceof Error ? e.message : String(e);
      // writeSet wraps the real database error in `cause`: show it, or you only see "Failed to save".
      const cause =
        e instanceof Error && e.cause instanceof Error
          ? ` (cause: ${e.cause.message})`
          : "";
      console.warn(`${setId}: failed: ${reason}${cause}`);
      results.failedSets.push(setId);
    }
  }

  const elapsedTime = Date.now() - results.time;
  const totalSeconds = Math.round(elapsedTime / 1000); // ms → seconds
  const hours = Math.floor(totalSeconds / 3600); // full hours
  const minutes = Math.floor((totalSeconds % 3600) / 60); // full minutes left over after the hours
  const seconds = totalSeconds % 60;

  console.log(
    `Here are the results of the sync duration ${hours}h ${minutes}m ${seconds}s, total sets synced ${results.setsSynced} and cards synced ${results.cards}`,
  );

  // Which sets need attention: printed only when there are any, so a clean run stays one line.
  if (results.failedSets.length > 0) {
    console.warn(
      `Failed (${results.failedSets.length}): ${results.failedSets.join(", ")}`,
    );
  }
  if (results.incompleteSets.length > 0) {
    const list = results.incompleteSets
      .map(({ setId, cardIds }) => `${setId} (${cardIds.join(", ")})`)
      .join("; ");
    console.warn(`Incomplete (${results.incompleteSets.length}): ${list}`);
  }

  // Anything failed or incomplete → end the run as an error, so the script exits with code 1.
  // Both kinds keep synced_at null, so the next run picks them up again.
  if (results.failedSets.length > 0 || results.incompleteSets.length > 0) {
    throw new Error(
      `${results.failedSets.length} set(s) failed, ${results.incompleteSets.length} incomplete. ` +
        "Re-run to retry them.",
    );
  }
}

/**
 * Write one collected set in ONE transaction, so the set is either fully saved (cards +
 * printings + prices + its sets row) or not at all. Only database work happens here: every
 * TCGdex request is already done (syncSetCards), so the transaction stays short.
 * Foreign-key order: cards → printings → prices → the sets row. On any error: rollback, then
 * rethrow with the set id (the original error is kept as `cause`).
 */
async function writeSet(collected: CollectedSet): Promise<void> {
  const { setId, releaseDate, cards, printings, prices } = collected;
  const client = await pool.connect();

  try {
    await client.query("begin");
    await upsertCards(client, cards);
    const printingIds = await insertPrintings(client, printings);
    await upsertPrices(client, prices, printingIds);
    await updateSetRow(
      client,
      setId,
      releaseDate,
      collected.failedCards.length === 0,
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw new Error(`Failed to save set ${setId}`, { cause: e });
  } finally {
    client.release();
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
 * Step 4 for ONE set, before any writes: fetch every card, shape it, and collect the rows for
 * writeSet. Requests stay one at a time (~1/s). A card that fails is retried once; if it fails
 * again, it stays in failedCards and the set isn't marked synced.
 */
async function syncSetCards(setId: string): Promise<CollectedSet> {
  const set = await tcgdex.getSet(setId);
  if (!set)
    throw new Error(`There was an error fetching the cards from ${setId}`);

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
    console.log(
      `${setId}: retrying ${toRetry.length} failed card(s) in ${RETRY_PAUSE_MS / 1000}s…`,
    );
    await sleep(RETRY_PAUSE_MS);

    for (const cardId of toRetry) {
      const ok = await collectCard(cardId, collected);
      if (!ok) collected.failedCards.push(cardId);
    }
  }

  console.log(
    `${setId}: ${collected.cards.length} cards, ${collected.printings.length} printings, ` +
      `${collected.prices.length} prices, ${collected.failedCards.length} failed` +
      (collected.failedCards.length > 0
        ? ` (${collected.failedCards.join(", ")})`
        : ""),
  );

  return collected;
}

const RETRY_PAUSE_MS = 5_000;

/**
 * Fetch ONE card, shape it, and add its rows to `collected`.
 * Returns true if it worked, false if it didn't (logged here; the caller decides what to record).
 * Never throws: one bad card must not stop the set.
 */
async function collectCard(
  cardId: string,
  collected: CollectedSet,
): Promise<boolean> {
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
    console.warn(
      `${cardId}: failed (${err instanceof Error ? err.message : String(err)})`,
    );
    return false;
  }
}

/**
 * Steps 1–2: copy every series we sync, and the sets inside them, into `series` and `sets`.
 * About 18 requests (~20s at 1/s). Safe to re-run: upserts update rows that already exist.
 *   - Each series row is written before its sets (sets.series_id points at it).
 *   - No transaction (decided 2026-11-18): each upsert is its own query; if a run fails
 *     partway, the re-run fills in anything missing.
 *   - Sets: only series_id and name are upserted. release_date and synced_at belong to the
 *     card sync (updateSetRow).
 */
async function syncSeriesAndSets(): Promise<void> {
  const allSeries = await tcgdex.listSeries();
  if (!allSeries)
    throw new Error("There was a failure fetching the list series from tcgdex");

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
    console.log(
      `series ${row.id}: saved (${era ?? "no era"}), ${setRows.length} sets`,
    );
  }

  console.log(`Series done: ${saved} series, ${setsSaved} sets saved`);
}
