// Stat helpers for load-harness summaries. Kept dependency-free.

export interface Summary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export function summarize(samples: number[]): Summary | null {
  if (samples.length === 0) return null;
  if (samples.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('latency samples must be finite and nonnegative');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx]!;
}

export function formatSummary(label: string, s: Summary | null): string {
  if (!s) return `${label.padEnd(28)} n=0 unavailable`;
  const fmt = (n: number) => `${n.toFixed(0)}ms`;
  return `${label.padEnd(28)} n=${String(s.count).padStart(5)}  p50=${fmt(s.p50).padStart(7)}  p95=${fmt(s.p95).padStart(7)}  p99=${fmt(s.p99).padStart(7)}  max=${fmt(s.max).padStart(7)}`;
}
