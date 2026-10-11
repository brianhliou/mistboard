// One reader for /api/live-stats, shared by every homepage widget that shows a
// piece of it. The homepage had three pollers on their own timers (the activity
// block every 15s, the play panel every 30s, the showcase pacing every 45s), so
// a visitor fired about three requests per 15s for one 30-second server cache.
// Each widget keeps its own cadence; a read younger than LIVE_STATS_MAX_AGE_MS
// (or still in flight) is handed back instead of hitting the network again, so
// the page makes at most about one request per window. A failed read is not
// kept, so the next caller retries.

export const LIVE_STATS_MAX_AGE_MS = 15_000;

export type LiveStatsPayload = {
  playing?: number;
  online?: number;
  playingBySpec?: Record<string, number>;
  totalCompletedGames?: number;
  last30dCompletedGames?: number;
  [key: string]: unknown;
};

let cached: { at: number; promise: Promise<LiveStatsPayload | null> } | null = null;

// `maxAgeMs` is how stale a shared read the caller accepts. The activity block
// passes its own poll interval, so its ticks always fetch and it paces the
// page; the slower widgets take the default and ride on its reads.
export function fetchLiveStats(
  options: { maxAgeMs?: number; now?: () => number } = {},
): Promise<LiveStatsPayload | null> {
  const at = (options.now ?? Date.now)();
  const maxAgeMs = options.maxAgeMs ?? LIVE_STATS_MAX_AGE_MS;
  if (cached && at - cached.at < maxAgeMs) return cached.promise;
  const promise = fetch('/api/live-stats', { headers: { accept: 'application/json' } })
    .then((resp) => (resp.ok ? (resp.json() as Promise<LiveStatsPayload>) : null))
    .then((data) => (data && typeof data === 'object' ? data : null))
    .catch(() => null);
  const entry = { at, promise };
  cached = entry;
  void promise.then((data) => {
    if (data === null && cached === entry) cached = null;
  });
  return promise;
}

export function resetLiveStatsCacheForTests(): void {
  cached = null;
}
