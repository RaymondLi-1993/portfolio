import type { TcgdexCard, TcgdexSeries, TcgdexTcgplayerPrice } from "../tcgdex/types";

/**
 * Pure functions: TCGdex card → our rows. No network, no database, so they're easy to test
 * with saved TCGdex responses.
 */

/** One row of our `series` table. `era` isn't here: it's our classification, never TCGdex's. */
export interface SeriesRow {
  id: string; // "sv"
  name: string; // "Scarlet & Violet"
  releaseDate: string | null; // "2023-03-31" (the series' date: start of the era)
}

/**
 * One row of our `sets` table, as far as a SERIES response can tell us.
 * No releaseDate: GET /series/:id doesn't include set dates. The card sync fills
 * sets.release_date later from GET /sets/:id. No syncedAt either: only the card sync sets it.
 */
export interface SetRow {
  id: string; // "sv08" (can contain dots: "sv03.5")
  seriesId: string; // "sv": the foreign key to series
  name: string; // "Surging Sparks"
}

/** One row of our `cards` table (column names in camelCase; sync.ts maps them to SQL). */
export interface CardRow {
  id: string; // "sv08-238"
  setId: string; // "sv08"
  number: string; // "238" (TCGdex's localId)
  name: string; // "Pikachu ex"
  rarity: string | null;
  regulationMark: string | null;
  legalStandard: boolean | null;
  imagePath: string | null; // "en/sv/sv08/238": the PATH only; the API builds the URL (images-off switch)
  tcgplayerProductId: number | null;
}

/** The current TCGplayer market price of one printing (one row of our `prices` table, minus the id). */
export interface PriceRow {
  printing: Printing; // sync.ts turns this into the printing's id
  marketPrice: number | null; // USD; null = TCGplayer has no market price right now
  sourceUpdatedAt: string | null; // TCGdex's pricing.tcgplayer.updated (ISO): the "as of" date
}


/** TCGdex series → our `series` row. */
export function toSeriesRow(series: TcgdexSeries): SeriesRow {
  return {
    id: series.id,
    name: series.name,
    releaseDate: series.releaseDate ?? null, // missing → null (the column allows it)
  };
}

/** TCGdex series → one `sets` row per set it lists. Each row points back at this series. */
export function toSetRows(series: TcgdexSeries): SetRow[] {
  return series.sets.map((set) => ({
    id: set.id,
    seriesId: series.id, // the PARENT series' id: this is the foreign key
    name: set.name,
  }));
}



/** The printing values our `card_printings.printing` check constraint allows. */
export type Printing =
  | "normal"
  | "holofoil"
  | "reverse_holofoil"
  | "1st_edition_normal"
  | "1st_edition_holofoil"
  | "unlimited_holofoil";

const PRINTING_BY_TCGPLAYER_KEY: Record<string, Printing> = {
  normal: "normal",
  holofoil: "holofoil",
  "reverse-holofoil": "reverse_holofoil",
};
/**
 * TODO(you): TCGdex card → CardRow.
 *   - number ← card.localId
 *   - setId ← card.set.id
 *   - imagePath ← card.image without "https://assets.tcgdex.net/" (null if there's no image)
 *   - legalStandard ← card.legal?.standard
 *   - tcgplayerProductId ← a productId from card.pricing.tcgplayer (which printing's? usually they match)
 *   - missing optional fields → null (our columns allow null)
 */
export function toCardRow(card: TcgdexCard): CardRow {

  if (!card.localId || !card.name || !card.set?.id) {
    throw new Error(`TCGdex card ${card.id} is missing a required field (localId, name or set.id)`);
  }

  const {
  id,
  name,
  localId: number,
  rarity = null,
  regulationMark = null,
  image,
  set: { id: setId },
  legal: { standard: legalStandard = null } = {},
  pricing: { tcgplayer } = {}, // stop here: tcgplayer can be null, and the printing keys vary
} = card;

  // tcgplayer looks like { unit: "USD", updated: "…", holofoil: { productId, … }, normal: { … } }.
  // Take the first value that is a printing block (an object with a productId); skip unit/updated.
  const firstPrinting = Object.values(tcgplayer ?? {}).find(
    // `value is TcgdexTcgplayerPrice` tells TypeScript what this check proves, so .productId is allowed below
    (value): value is TcgdexTcgplayerPrice =>
      typeof value === "object" && value !== null && "productId" in value,
  );
  const tcgplayerProductId = firstPrinting?.productId ?? null;




  return {
    id,
    setId,
    number,
    name,
    rarity,
    regulationMark,
    legalStandard,
    // Store only the path ("en/sv/sv08/238"): the API builds the full URL, so images can be switched off.
    imagePath: image ? image.replace("https://assets.tcgdex.net/", "") : null,
    tcgplayerProductId,
  };
}

/**
 * Which printings exist for this card.
 *   - Source: the printing keys in card.pricing.tcgplayer ("normal", "holofoil", "reverse-holofoil")
 *     → our values ("normal", "holofoil", "reverse_holofoil").
 *   - DECIDED: printings come from the pricing keys only. Vintage (where TCGdex merges
 *     1st Edition / Shadowless / Unlimited) isn't synced for now (see SKIPPED_SERIES in sync.ts),
 *     so this rule doesn't need an edition special case.
 *   - DECIDED: no TCGplayer printing keys (tcgplayer null/missing, or only unit/updated)
 *     → fall back to card.variants, so the card can still be added (its price shows as
 *     "no price yet"): normal → "normal", reverse → "reverse_holofoil", holo → "holofoil".
 *     Ignore firstEdition (vintage isn't synced). Mostly matters for brand-new sets.
 *   - Neither source gives anything → [] (the card is searchable but can't be added).
 */
export function toPrintings(card: TcgdexCard): Printing[] {
  // 1. Main source: the printing keys in pricing.tcgplayer, translated to our names.
  //    flatMap: return [x] to keep x, [] to drop the key; the results are joined into one array.
  //    (Inside a callback, `return []` plays the role `continue` plays in a for loop.)
  const printings = Object.keys(card.pricing?.tcgplayer ?? {}).flatMap((key) => {
    if (key === "unit" || key === "updated") return []; // not printings: skip silently

    const printing = PRINTING_BY_TCGPLAYER_KEY[key];
    if (!printing) {
      // A key we don't model yet: skip it, but say so (the first full run shows which ones exist).
      console.warn(`${card.id}: unknown printing key "${key}", skipped`);
      return [];
    }
    return [printing];
  });

  if (printings.length > 0) return printings;

  // 2. Fallback: no TCGplayer pricing → TCGdex's variant flags, so the card can still be added.
  //    (firstEdition is ignored: vintage isn't synced.)
  const fallback: Printing[] = [];
  if (card.variants?.normal) fallback.push("normal");
  if (card.variants?.holo) fallback.push("holofoil");
  if (card.variants?.reverse) fallback.push("reverse_holofoil");

  // 3. Neither source gave anything → [] (the card is still saved and searchable, just not addable).
  return fallback;
}


/**
 * TODO(you): the card's current prices, one per printing (the catalog sync's starting prices;
 * the daily price job keeps them current later).
 *   - Source: the same printing blocks as toPrintings, in card.pricing.tcgplayer
 *     (e.g. holofoil: { marketPrice: 227.31, … }), and its `updated` for sourceUpdatedAt.
 *   - Use the SAME printing-key mapping as toPrintings ("reverse-holofoil" → "reverse_holofoil"),
 *     so every price points at a printing that exists. A shared helper avoids writing it twice.
 *   - Only marketPrice (never low/mid/high: CLAUDE.md uses TCGplayer market price).
 *   - No tcgplayer pricing → [] (no prices; the printings may still exist).
 */
export function toPrices(card: TcgdexCard): PriceRow[] {

  const tcgplayer = card.pricing?.tcgplayer;     
  if (!tcgplayer) return [];

  const prices = Object.entries(card.pricing?.tcgplayer ?? {}).flatMap(([key, value]) => {

   const printing = PRINTING_BY_TCGPLAYER_KEY[key];
   if(!printing) return [];
   if (typeof value !== "object" || value === null) return []; 

   return [{printing, marketPrice: value.marketPrice ?? null, sourceUpdatedAt: tcgplayer.updated ?? null }] 
  })


  return prices;
}
