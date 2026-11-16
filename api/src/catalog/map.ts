import type { TcgdexCard } from "../tcgdex/types";

/**
 * Pure functions: TCGdex card → our rows. No network, no database, so they're easy to test
 * with saved TCGdex responses.
 */

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

/** The printing values our `card_printings.printing` check constraint allows. */
export type Printing =
  | "normal"
  | "holofoil"
  | "reverse_holofoil"
  | "1st_edition_normal"
  | "1st_edition_holofoil"
  | "unlimited_holofoil";

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
  throw new Error(`Not implemented: toCardRow(${card.id})`);
}

/**
 * TODO(you): which printings exist for this card.
 *   - Source: the printing keys in card.pricing.tcgplayer ("normal", "holofoil", "reverse-holofoil")
 *     → our values ("normal", "holofoil", "reverse_holofoil").
 *   - OPEN DECISION (discuss before writing): vintage cards. TCGdex merges 1st Edition /
 *     Shadowless / Unlimited into one card, and its pricing keys don't separate them.
 *     `variants_detailed` does separate them, but its TCGplayer pricing is often null.
 *   - OPEN DECISION: a card with no TCGplayer pricing at all (no keys) → no printings?
 *     Fall back to card.variants? Without a printing, nobody can add the card.
 */
export function toPrintings(card: TcgdexCard): Printing[] {
  throw new Error(`Not implemented: toPrintings(${card.id})`);
}
