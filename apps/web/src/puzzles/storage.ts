/**
 * Local-storage persistence for the puzzles page (solved markers, seen-set
 * rotation, auto-next + rated preferences) and the visit-scoped queue rotation
 * built on the seen-set. All best-effort: puzzle play works without storage.
 */

import { PUZZLE_NEW_PLAYER_RATING } from '@mistboard/game';
import type { PuzzleSummary } from './adapter.js';

const SOLVED_PUZZLES_STORAGE_KEY = 'mistboard:puzzles:solved';
const SEEN_PUZZLES_STORAGE_KEY = 'mistboard:puzzles:seen';
const AUTO_NEXT_STORAGE_KEY = 'mistboard:puzzles:auto-next';
const RATED_STORAGE_KEY = 'mistboard:puzzles:rated';
// The cap bounds localStorage growth, but it MUST stay ahead of the served
// corpus or rotation quietly breaks: once eviction starts, "unseen first"
// re-serves evicted puzzles while genuinely unseen ones are still waiting. At
// 200 against 430 puzzles that was survivable; the corpus reached 1,605 on
// 2026-08-23 and the cap covered 12% of it, so a visitor hit repeats after 200
// puzzles with ~1,400 untouched.
//
// Each entry is an id plus a timestamp, roughly 55 bytes of JSON, so 5,000
// entries is about 275KB against a 5MB origin budget. Revisit if the corpus
// approaches this number; the full cleared corpus tops out near 3,700 puzzles.
const SEEN_PUZZLES_CAP = 5_000;

export function loadSolvedPuzzleIds(): Set<string> {
  try {
    const raw = window.localStorage?.getItem(SOLVED_PUZZLES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

export function saveSolvedPuzzleIds(ids: ReadonlySet<string>): void {
  try {
    window.localStorage?.setItem(SOLVED_PUZZLES_STORAGE_KEY, JSON.stringify([...ids].sort()));
  } catch {
    // Solved markers are a convenience only; puzzle play should work without storage.
  }
}

// Order puzzles for rotation: unseen first, matched to the viewer's per-variant
// rating with regular exploration and light theme diversity. Seen puzzles stay
// least- to most-recently-seen so old material eventually resurfaces.
export function rotatePuzzleOrder(
  puzzles: readonly PuzzleSummary[],
  seen: ReadonlyMap<string, number>,
  targetRatings: ReadonlyMap<string, number> = new Map(),
): PuzzleSummary[] {
  const unseen: PuzzleSummary[] = [];
  const seenList: PuzzleSummary[] = [];
  for (const puzzle of puzzles) {
    if (seen.has(puzzle.id)) seenList.push(puzzle);
    else unseen.push(puzzle);
  }
  const unseenByVariant = new Map<string, PuzzleSummary[]>();
  for (const puzzle of unseen) {
    const group = unseenByVariant.get(puzzle.variant) ?? [];
    group.push(puzzle);
    unseenByVariant.set(puzzle.variant, group);
  }
  const adaptive = [...unseenByVariant.values()].flatMap((group) =>
    adaptivePuzzleOrder(group, targetRatings.get(group[0]!.variant) ?? PUZZLE_NEW_PLAYER_RATING),
  );
  seenList.sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0));
  return [...adaptive, ...seenList];
}

// The explore pick deliberately ignores the rating match, so that a queue is not
// a monotone run of near-identical puzzles. It used to draw uniformly from the
// whole pool, which was harmless while every puzzle carried one of four
// depth-derived ratings -- "random" and "well matched" were the same draw. Once
// puzzles got a real difficulty prior the ratings spread across 1255-2600, and
// the same line started handing a 1300-rated player a 2600 puzzle: 35% of the
// pool sits more than 500 points from that target.
//
// So explore inside a window instead. Widen it when the band is empty rather
// than giving up, because a viewer far from the bulk of the corpus should still
// get variety -- just the closest variety available, not the whole range.
const EXPLORE_WINDOWS = [300, 600, 1200] as const;

// Match on the serving rating when the server sent one (#712): the rating
// folded with solution length and what players actually did. The displayed
// rating alone was the prior for nearly every puzzle.
function matchRating(puzzle: PuzzleSummary): number {
  return puzzle.servingRating ?? puzzle.rating;
}

function exploreIndex(
  remaining: readonly { puzzle: PuzzleSummary }[],
  targetRating: number,
): number {
  for (const window of EXPLORE_WINDOWS) {
    const withinBand: number[] = [];
    for (let index = 0; index < remaining.length; index += 1) {
      if (Math.abs(matchRating(remaining[index]!.puzzle) - targetRating) <= window)
        withinBand.push(index);
    }
    if (withinBand.length > 0) {
      return withinBand[Math.floor(Math.random() * withinBand.length)]!;
    }
  }
  // Nothing anywhere near the target: fall back to the old uniform draw rather
  // than refusing to explore.
  return Math.floor(Math.random() * remaining.length);
}

function adaptivePuzzleOrder(
  puzzles: readonly PuzzleSummary[],
  targetRating: number,
): PuzzleSummary[] {
  const remaining = puzzles.map((puzzle) => ({ puzzle, jitter: Math.random() * 30 }));
  const ordered: PuzzleSummary[] = [];
  while (remaining.length > 0) {
    const explore = ordered.length % 5 === 4;
    let selectedIndex = 0;
    if (explore) {
      selectedIndex = exploreIndex(remaining, targetRating);
    } else {
      const recentThemes = new Set(
        ordered.slice(-2).flatMap((puzzle) => puzzle.themes.slice(0, 1)),
      );
      let bestScore = Number.POSITIVE_INFINITY;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index]!;
        const primaryTheme = candidate.puzzle.themes[0];
        const repeatPenalty = primaryTheme && recentThemes.has(primaryTheme) ? 75 : 0;
        const score =
          Math.abs(matchRating(candidate.puzzle) - targetRating) + repeatPenalty + candidate.jitter;
        if (score < bestScore) {
          bestScore = score;
          selectedIndex = index;
        }
      }
    }
    ordered.push(remaining.splice(selectedIndex, 1)[0]!.puzzle);
  }
  return ordered;
}

export function loadSeenPuzzles(): Map<string, number> {
  try {
    const raw = window.localStorage?.getItem(SEEN_PUZZLES_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const seen = new Map<string, number>();
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) seen.set(id, at);
    }
    return seen;
  } catch {
    return new Map();
  }
}

export function saveSeenPuzzles(seen: ReadonlyMap<string, number>): void {
  try {
    // Keep only the most-recently-seen ids so the store stays bounded.
    const capped = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, SEEN_PUZZLES_CAP);
    window.localStorage?.setItem(
      SEEN_PUZZLES_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(capped)),
    );
  } catch {
    // Seen markers are a convenience only; puzzle play works without storage.
  }
}

export function loadAutoNextEnabled(): boolean {
  try {
    return window.localStorage?.getItem(AUTO_NEXT_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveAutoNextEnabled(enabled: boolean): void {
  try {
    window.localStorage?.setItem(AUTO_NEXT_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Puzzle preferences are best-effort convenience state.
  }
}

export function loadRatedEnabled(): boolean {
  try {
    // Rated is the default; only an explicit opt-out is stored.
    return window.localStorage?.getItem(RATED_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveRatedEnabled(enabled: boolean): void {
  try {
    window.localStorage?.setItem(RATED_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Puzzle preferences are best-effort convenience state.
  }
}
