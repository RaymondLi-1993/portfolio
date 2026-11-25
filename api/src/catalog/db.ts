import type { Pool, PoolClient } from "pg";
import type { CardRow, PriceRow, Printing } from "./map";

/**
 * The catalog's SQL: one small function per table. sync.ts decides WHAT to write and WHEN;
 * this file knows HOW (the SQL). No fetching here, no TCGdex.
 *
 * Every function takes `db` as its first argument: pass `pool` for a standalone write, or the
 * transaction's `client` (from pool.connect()) so the write is part of that transaction.
 * Both have the same .query(sql, params) method.
 */
export type Db = Pool | PoolClient;

/** Key for the printing-id map: "sv08-001|normal". */
export const printingKey = (cardId: string, printing: Printing) =>
  `${cardId}|${printing}`;

/**
 * Insert or update every card (one query per card). On a re-sync, `do update` overwrites every
 * column except `id`, so TCGdex corrections and legality changes are picked up.
 */
export async function upsertCards(db: Db, cards: CardRow[]): Promise<void> {
  const sql = `
    insert into cards (
      id, set_id, number, name, rarity,
      regulation_mark, legal_standard, image_path, tcgplayer_product_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    on conflict (id) do update set
      set_id               = excluded.set_id,
      number               = excluded.number,
      name                 = excluded.name,
      rarity               = excluded.rarity,
      regulation_mark      = excluded.regulation_mark,
      legal_standard       = excluded.legal_standard,
      image_path           = excluded.image_path,
      tcgplayer_product_id = excluded.tcgplayer_product_id
  `;

  for (const card of cards) {
    await db.query(sql, [
      card.id,
      card.setId,
      card.number,
      card.name,
      card.rarity,
      card.regulationMark,
      card.legalStandard,
      card.imagePath,
      card.tcgplayerProductId,
    ]);
  }
}

/**
 * Insert every printing and return a map from printingKey(cardId, printing) → its id
 * (upsertPrices uses it to fill in prices.printing_id).
 *   - The no-op "do update" makes `returning id` give the id for rows that already existed too
 *     ("do nothing" returns no row for them).
 *   - pg returns bigint columns as strings ("1042"), hence Number(row.id).
 */
export async function insertPrintings(
  db: Db,
  printings: { cardId: string; printing: Printing }[],
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const sql = `
    insert into card_printings (card_id, printing)
     values ($1, $2)
     on conflict (card_id, printing) do update set
       printing = excluded.printing
     returning id
  `;

  for (const { cardId, printing } of printings) {
    const { rows } = await db.query<{ id: string }>(sql, [cardId, printing]);
    const row = rows[0];
    if (!row) throw new Error(`No id returned for ${cardId} ${printing}`);

    ids.set(printingKey(cardId, printing), Number(row.id));
  }

  return ids;
}

/**
 * Insert or update each printing's current price, using the ids from insertPrintings.
 * A price whose printing has no id is logged and skipped (it shouldn't happen).
 */
export async function upsertPrices(
  db: Db,
  prices: (PriceRow & { cardId: string })[],
  printingIds: Map<string, number>,
): Promise<void> {
  const sql = `
       insert into prices (printing_id, market_price, source_updated_at)
       values ($1, $2, $3)
        on conflict (printing_id) do update set
          market_price = excluded.market_price,
          source_updated_at = excluded.source_updated_at
    `;

  for (const { cardId, printing, marketPrice, sourceUpdatedAt } of prices) {
    const printingId = printingIds.get(printingKey(cardId, printing));
    if (printingId === undefined) {
      console.warn(
        `No printing id for ${cardId} ${printing}; skipping its price`,
      );
      continue;
    }

    await db.query(sql, [printingId, marketPrice, sourceUpdatedAt]);
  }
}

/**
 * @param db a pool or transaction
 * @returns ["sv01", "sv02"]
 * Fetches a set of ids and returns an array of those ids
 */
export async function listUnsyncedSets(db: Db): Promise<string[]> {
  const sql = `
    select id from sets
    where synced_at is null
    order by release_date asc, id asc
  `;

  const { rows } = await db.query<{ id: string }>(sql);

  return rows.map((row) => row.id);
}

/**
 * Fill in the set's release date, and mark it synced only if nothing failed.
 * `synced` false → synced_at keeps its old value, so the next run fetches the set again.
 */
export async function updateSetRow(
  db: Db,
  setId: string,
  releaseDate: string | null,
  synced: boolean,
): Promise<void> {
  const sql = `
    update sets
    set release_date = $1,
           synced_at = case when $2 then now() else synced_at end
    where id = $3
  `;

  await db.query(sql, [releaseDate, synced, setId]);
}
