// Process-local raw RTT samples, independent of the five-second metrics drain.
// Keep the latest observed UTC day and the previous day so a later daily reader
// can inspect a completed day. Restarts lose these samples; persistence is #585.
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface RttStats {
  samples: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  // Strictly greater than each caller-supplied threshold; shares are 0..1.
  // Empty populations have null shares, rather than claiming a healthy zero.
  aboveThreshold: { thresholdMs: number; samples: number; share: number | null }[];
}

export interface DailyRttSnapshot {
  day: string;
  global: RttStats;
  byRegion: Record<string, RttStats>;
}

export class DailyRttAccumulator {
  private latestDay: number | null = null;
  private days = new Map<number, Map<string, number[]>>();

  record(region: string, rttMs: number, atMs = Date.now()): void {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    const day = this.advance(atMs);
    // Out-of-order samples in yesterday's bucket are fine; expired ones cannot
    // resurrect old buckets or move the retention window backwards.
    if (day < (this.latestDay ?? day) - DAY_MS) return;
    let regions = this.days.get(day);
    if (!regions) {
      regions = new Map();
      this.days.set(day, regions);
    }
    const key = normalizeLatencyRegion(region);
    const samples = regions.get(key) ?? [];
    samples.push(rttMs);
    regions.set(key, samples);
  }

  // Read without draining. atMs selects a UTC day and advances retention if it
  // is newer than the last observation. Thresholds are query policy, not storage
  // policy: the same raw samples can answer different thresholds later.
  snapshot(atMs = Date.now(), thresholdsMs: readonly number[] = []): DailyRttSnapshot {
    if (thresholdsMs.some((ms) => !Number.isFinite(ms) || ms < 0)) {
      throw new RangeError('RTT thresholds must be finite, non-negative milliseconds');
    }
    const day = this.advance(atMs);
    const regions = this.days.get(day);
    const all: number[] = [];
    const byRegion = Object.fromEntries(
      [...(regions ?? [])].map(([region, samples]) => {
        // No spread into push: a busy day can exceed V8's argument limit.
        for (const sample of samples) all.push(sample);
        return [region, summarize(samples, thresholdsMs)] as const;
      }),
    );
    return {
      day: new Date(day).toISOString().slice(0, 10),
      global: summarize(all, thresholdsMs),
      byRegion,
    };
  }

  private advance(atMs: number): number {
    if (!Number.isFinite(atMs) || !Number.isFinite(new Date(atMs).getTime())) {
      throw new RangeError('RTT timestamp must be a valid epoch millisecond value');
    }
    const day = Math.floor(atMs / DAY_MS) * DAY_MS;
    this.latestDay = Math.max(this.latestDay ?? day, day);
    for (const storedDay of this.days.keys()) {
      if (storedDay < this.latestDay - DAY_MS) this.days.delete(storedDay);
    }
    return day;
  }
}

export function normalizeLatencyRegion(region: string): string {
  return /^[a-z0-9-]{1,32}$/.test(region) ? region : 'global';
}

function summarize(samples: number[], thresholdsMs: readonly number[]): RttStats {
  const sorted = [...samples].sort((a, b) => a - b);
  // Nearest-rank percentiles, matching the existing metrics tick. Compute from
  // raw samples globally, never from averages of per-tick or regional quantiles.
  const percentile = (p: number): number | null => sorted[Math.ceil(sorted.length * p) - 1] ?? null;
  return {
    samples: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted[sorted.length - 1] ?? null,
    aboveThreshold: thresholdsMs.map((thresholdMs) => {
      const firstAbove = sorted.findIndex((ms) => ms > thresholdMs);
      const count = firstAbove < 0 ? 0 : sorted.length - firstAbove;
      return {
        thresholdMs,
        samples: count,
        share: sorted.length > 0 ? count / sorted.length : null,
      };
    }),
  };
}
