import type { TcgdexCard, TcgdexSeries, TcgdexSeriesBrief, TcgdexSet } from "./types";

/**
 * The ONLY code that talks to TCGdex over HTTP (the adapter boundary).
 * If we ever swap data sources, this folder is what changes.
 *
 * TCGdex is free, needs no key, and publishes no rate limits, so we're considerate:
 * about 1 request per second, and never more than one request in flight.
 */
const BASE_URL = "https://api.tcgdex.net/v2/en";

/**
 * GET a TCGdex path (e.g. "/cards/sv08-238") and return the parsed JSON.
 *
 * TODO(you):
 *   1. Throttle: wait so that requests start at least ~1000 ms apart, across ALL calls
 *      (keep the time of the last request in a module-level variable).
 *   2. fetch(`${BASE_URL}${path}`).
 *   3. 404 → return null (the thing doesn't exist; the caller decides what to do).
 *   4. Other non-2xx, or a network error → retry a few times with a growing delay
 *      (e.g. 2s, 4s, 8s), then throw an Error that includes the path and status.
 *   5. Parse the JSON and return it as T.
 */
export async function tcgdexGet<T>(path: string): Promise<T | null> {
  throw new Error(`Not implemented: tcgdexGet(${path})`);
}

/** One helper per endpoint we use. Ids go through encodeURIComponent (set ids can contain dots). */
export const tcgdex = {
  listSeries: () => tcgdexGet<TcgdexSeriesBrief[]>("/series"),
  getSeries: (id: string) => tcgdexGet<TcgdexSeries>(`/series/${encodeURIComponent(id)}`),
  getSet: (id: string) => tcgdexGet<TcgdexSet>(`/sets/${encodeURIComponent(id)}`),
  getCard: (id: string) => tcgdexGet<TcgdexCard>(`/cards/${encodeURIComponent(id)}`),
};
