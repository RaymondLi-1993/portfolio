/**
 * TCGdex response shapes: only the fields we read (TCGdex returns many more).
 * Checked against real responses on 2026-11-13 (cards sv08-238 and base1-4, set sv08).
 * Fields marked "unverified" haven't been checked against a real response yet.
 * Docs: https://tcgdex.dev
 */

// ── Series ───────────────────────────────────────────────────────────────────

/** GET /series → one item of the list */
export interface TcgdexSeriesBrief {
  id: string; // "swsh"
  name: string; // "Sword & Shield"
}

/** GET /series/:id (unverified) */
export interface TcgdexSeries extends TcgdexSeriesBrief {
  releaseDate?: string; // unverified: "2019-11-15"
  sets: TcgdexSetBrief[];
}

// ── Sets ─────────────────────────────────────────────────────────────────────

/** A set as it appears inside a list (GET /sets, or a series' `sets`) */
export interface TcgdexSetBrief {
  id: string; // "sv08" (can contain dots: "sv03.5")
  name: string; // "Surging Sparks"
}

/** GET /sets/:id */
export interface TcgdexSet extends TcgdexSetBrief {
  releaseDate?: string; // "2024-11-08"
  serie: { id: string; name: string }; // the series it belongs to (TCGdex spells it "serie")
  cardCount: { total: number; official: number };
  cards: TcgdexCardBrief[];
}

/** A card as listed inside a set: just enough to fetch the full card */
export interface TcgdexCardBrief {
  id: string; // "sv08-001"
  localId: string; // "001": the collector number
  name: string; // "Exeggcute"
  image?: string; // "https://assets.tcgdex.net/en/sv/sv08/001" (missing for some cards)
}

// ── Cards ────────────────────────────────────────────────────────────────────

/** GET /cards/:id: the only endpoint that includes `pricing` */
export interface TcgdexCard extends TcgdexCardBrief {
  rarity?: string; // "Special illustration rare"
  regulationMark?: string | null; // "H"; null for old cards
  legal?: { standard: boolean; expanded: boolean };
  set: { id: string; name: string };
  variants?: {
    normal: boolean;
    reverse: boolean;
    holo: boolean;
    firstEdition: boolean;
  };
  // Per-printing detail. For vintage it separates Unlimited / Shadowless / 1st Edition,
  // but TCGplayer pricing is often null there. Whether we use it is an OPEN decision (see catalog/map.ts).
  variants_detailed?: unknown[];
  pricing?: {
    tcgplayer?: TcgdexTcgplayerPricing | null;
  };
}

/**
 * pricing.tcgplayer: one key per printing TCGplayer prices, plus `unit` and `updated`.
 * Seen so far: "holofoil". CLAUDE.md also lists "normal" and "reverse-holofoil".
 * Other keys (e.g. 1st edition) are unverified.
 */
export type TcgdexTcgplayerPricing = {
  unit: "USD";
  updated: string; // ISO timestamp
} & Partial<Record<TcgplayerPrintingKey, TcgdexTcgplayerPrice>>;

export type TcgplayerPrintingKey = "normal" | "holofoil" | "reverse-holofoil";

/** The price block for one printing. We only use productId here; prices are the daily job's concern. */
export interface TcgdexTcgplayerPrice {
  productId: number; // TCGplayer's product id (same product for a card's normal + reverse, usually)
  marketPrice: number | null;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  directLowPrice: number | null;
}
