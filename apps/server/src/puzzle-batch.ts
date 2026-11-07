/**
 * Pure batch selection for #632, the first server-side slice of #302. The
 * caller supplies discoverable puzzle metadata, effective ratings (Glicko or
 * the difficulty prior), account attempts and any seen/already-queued IDs.
 * HTTP, persistence and browser queue integration remain with #302.
 */
export type PuzzleBatchCandidate = {
  id: string;
  variant: string;
  rating: number;
  themes: readonly string[];
};

export type PuzzleBatchOptions = {
  variant: string;
  targetRating: number;
  limit: number;
  /** Every terminal account attempt, whether solved or failed. */
  attemptedIds: ReadonlySet<string>;
  /** Caller-owned exclusions, such as local seen IDs or outstanding batches. */
  excludedIds: ReadonlySet<string>;
  /** Explicit unsigned 32-bit seed: identical inputs reproduce the batch. */
  seed: number;
};

// Preserve the browser selector's rating match, theme penalty, jitter and
// every-fifth exploration policy. Stop at the batch limit instead of ordering
// the full corpus. Exclusions are hard: an exhausted pool returns a short or
// empty batch, never a previously attempted puzzle as a fallback.
export function selectPuzzleBatch<T extends PuzzleBatchCandidate>(
  puzzles: readonly T[],
  options: PuzzleBatchOptions,
): T[] {
  const { variant, targetRating, limit, attemptedIds, excludedIds, seed } = options;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('Puzzle batch limit must be a nonnegative safe integer');
  }
  if (!Number.isFinite(targetRating)) {
    throw new RangeError('Puzzle batch target rating must be finite');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new RangeError('Puzzle batch seed must be an unsigned 32-bit integer');
  }
  if (limit === 0) return [];

  const random = seededRandom(seed);
  const unavailableIds = new Set([...attemptedIds, ...excludedIds]);
  const remaining: { puzzle: T; jitter: number }[] = [];
  for (const puzzle of puzzles) {
    if (puzzle.variant !== variant || unavailableIds.has(puzzle.id)) continue;
    unavailableIds.add(puzzle.id);
    remaining.push({ puzzle, jitter: random() * 30 });
  }

  const selected: T[] = [];
  while (remaining.length > 0 && selected.length < limit) {
    let selectedIndex = 0;
    if (selected.length % 5 === 4) {
      selectedIndex = exploreIndex(remaining, targetRating, random);
    } else {
      const recentThemes = new Set(
        selected.slice(-2).flatMap((puzzle) => puzzle.themes.slice(0, 1)),
      );
      let bestScore = Number.POSITIVE_INFINITY;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index]!;
        const theme = candidate.puzzle.themes[0];
        const repeatPenalty = theme && recentThemes.has(theme) ? 75 : 0;
        const score =
          Math.abs(candidate.puzzle.rating - targetRating) + repeatPenalty + candidate.jitter;
        if (score < bestScore) {
          bestScore = score;
          selectedIndex = index;
        }
      }
    }
    selected.push(remaining.splice(selectedIndex, 1)[0]!.puzzle);
  }
  return selected;
}

const EXPLORE_WINDOWS = [300, 600, 1200] as const;

function exploreIndex(
  remaining: readonly { puzzle: PuzzleBatchCandidate }[],
  targetRating: number,
  random: () => number,
): number {
  for (const window of EXPLORE_WINDOWS) {
    const withinBand: number[] = [];
    for (let index = 0; index < remaining.length; index += 1) {
      if (Math.abs(remaining[index]!.puzzle.rating - targetRating) <= window) {
        withinBand.push(index);
      }
    }
    if (withinBand.length > 0) {
      return withinBand[Math.floor(random() * withinBand.length)]!;
    }
  }
  // Match the existing policy when even the widest band has no candidate.
  return Math.floor(random() * remaining.length);
}

// Mulberry32, with state local to this call rather than shared Math.random().
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
