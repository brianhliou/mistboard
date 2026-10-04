// Durable game totals for the homepage counters, folded into /api/live-stats
// (routes/meta.ts). The homepage polls that endpoint while it is visible, so
// the totals are read from Postgres at most once per SITE_TOTALS_CACHE_MS no
// matter how many tabs are open: the database cost is fixed, and each request
// costs an in-memory read. A future push channel (SSE or a lobby socket) would
// broadcast this same snapshot rather than add a second source.
//
// Concurrent misses share one in-flight query. A failed read is not cached,
// and the last good value keeps serving until the next read lands, so a
// database blip shows slightly stale totals rather than none.

import type { SiteGameTotals } from './persistence.js';
import * as persistence from './persistence.js';

export const SITE_TOTALS_CACHE_MS = 30_000;

type Loader = () => Promise<SiteGameTotals>;

let cached: { value: SiteGameTotals; at: number } | null = null;
let inFlight: Promise<SiteGameTotals | null> | null = null;

export function clearSiteTotalsCache(): void {
  cached = null;
  inFlight = null;
}

export async function getCachedSiteTotals(
  nowMs: number = Date.now(),
  load: Loader = () => persistence.getSiteGameTotals(),
): Promise<SiteGameTotals | null> {
  if (cached && nowMs - cached.at < SITE_TOTALS_CACHE_MS) return cached.value;
  if (!inFlight) {
    inFlight = load()
      .then((value) => {
        cached = { value, at: nowMs };
        return value;
      })
      .catch(() => cached?.value ?? null)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
