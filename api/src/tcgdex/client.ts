import { sleep } from "../utils/sleep";
import type { TcgdexCard, TcgdexSeries, TcgdexSeriesBrief, TcgdexSet } from "./types";

/**
 * The ONLY code that talks to TCGdex over HTTP (the adapter boundary).
 * If we ever swap data sources, this folder is what changes.
 *
 * TCGdex is free, needs no key, and publishes no rate limits, so we're considerate:
 * about 1 request per second, and never more than one request in flight.
 */
const BASE_URL = "https://api.tcgdex.net/v2/en";

// Rate limit: request STARTS are at least this far apart. Calls that come too soon wait
// their turn (they're delayed, never dropped). Fine for our sync, which awaits one request
// before making the next. If we ever fetch in parallel, this needs a real queue.
const MIN_GAP_MS = 1000;
let lastRequestAt = 0; // module-level: shared by every call (0 = no request yet)


/** Wait until at least MIN_GAP_MS has passed since the previous request started. */
async function waitForTurn(): Promise<void> {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

const TIMEOUT_MS = 10_000; // give up on a request that hasn't answered in 10s

/**
 * GET a TCGdex path (e.g. "/cards/sv08-238") and return the parsed JSON.
 *
 * - 2xx → the parsed JSON
 * - 404 → null (it doesn't exist; the caller decides what to do)
 * - any other status, network error, timeout → throws (no retries: that's the caller's job)
 */
export async function tcgdexGet<T>(path: string): Promise<T | null> {
  await waitForTurn(); // rate limit

  // fetch throws only when there's NO response (network down, DNS, timeout).
  // An HTTP error status (404, 500…) is a normal response: we check it ourselves below.
  const result = await fetch(`${BASE_URL}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // Check 404 BEFORE `ok`: a 404 isn't ok, but it's an answer, not a failure.
  if (result.status === 404) return null;
  if (result.ok) return (await result.json()) as T;

  throw new Error(`TCGdex GET ${path} failed: ${result.status} ${result.statusText}`);
}

/** One helper per endpoint we use. Ids go through encodeURIComponent (set ids can contain dots). */
export const tcgdex = {
  listSeries: () => tcgdexGet<TcgdexSeriesBrief[]>("/series"),
  getSeries: (id: string) => tcgdexGet<TcgdexSeries>(`/series/${encodeURIComponent(id)}`),
  getSet: (id: string) => tcgdexGet<TcgdexSet>(`/sets/${encodeURIComponent(id)}`),
  getCard: (id: string) => tcgdexGet<TcgdexCard>(`/cards/${encodeURIComponent(id)}`),
};
