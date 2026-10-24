// The /stats payload (getPublicSiteStats), cached in memory for /api/stats/public.
// It runs a dozen aggregates over every counted game, seconds of database time
// (5 s on 2026-10-23), and the figures move by a game or two an hour, so one
// read per PUBLIC_STATS_CACHE_MS serves every visitor.
//
// Stale-while-revalidate: once a value exists, an expired read returns it at
// once and refreshes in the background, so only the first visitor after a
// boot waits on the query. Concurrent misses share one in-flight query, and a
// failed read keeps the last good value (the site-counters.ts pattern).

import type { PublicSiteStats } from './persistence.js';
import * as persistence from './persistence.js';

export const PUBLIC_STATS_CACHE_MS = 5 * 60_000;

type Loader = () => Promise<PublicSiteStats>;

let cached: { value: PublicSiteStats; at: number } | null = null;
let inFlight: Promise<PublicSiteStats | null> | null = null;

export function clearPublicStatsCache(): void {
  cached = null;
  inFlight = null;
}

function refresh(nowMs: number, load: Loader): Promise<PublicSiteStats | null> {
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

export async function getCachedPublicStats(
  nowMs: number = Date.now(),
  load: Loader = () => persistence.getPublicSiteStats(),
): Promise<PublicSiteStats | null> {
  if (!cached) return refresh(nowMs, load);
  if (nowMs - cached.at >= PUBLIC_STATS_CACHE_MS) void refresh(nowMs, load);
  return cached.value;
}
