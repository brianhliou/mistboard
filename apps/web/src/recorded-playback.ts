// Wall-clock-anchored playback of a recorded game at its TRUE timing.
//
// Doctrine (Brian, 2026-09-26: "always true timing, never faked"): a replay plays
// each move at the time it really took. No clamp, no scale, no fixed metronome over
// a game that carries timestamps. Because the playback window of every move IS its
// recorded think, the side to move may tick its clock at one real second per second
// during it and land exactly on the recorded value (lichess `realtime` autoplay).
//
// Playback is a pure function of the wall clock: the ply on the board is
// f(Date.now() - anchor), where `anchor` is the wall time at which the game's start
// is (or was) on air. A chain of per-move setTimeouts stalls in a hidden tab (the
// browser throttles timers to once a second, then once a minute), and a stalled
// chain resumes mid-game from wherever it stopped. Recomputing the position from the
// anchor on every tick means a tab that comes back simply catches up to the right
// ply instead of playing through the moves it missed.

/**
 * Per-ply offsets from per-move durations: offsets[p] is the ms after the game's
 * start at which ply p is on the board (offsets[0] = 0), so a game of n plies has
 * n + 1 entries. Negative or non-finite durations count as zero.
 */
export function offsetsFromDurations(durations: readonly number[]): number[] {
  const offsets = [0];
  let total = 0;
  for (const duration of durations) {
    total += Number.isFinite(duration) && duration > 0 ? duration : 0;
    offsets.push(total);
  }
  return offsets;
}

/**
 * Per-ply offsets from move timestamps (ms epoch, in ply order) and the game's start.
 * A start that is missing or later than the first move (inconsistent records)
 * anchors on the first move instead, so ply 1 lands at once rather than never.
 * Backwards timestamps are held level: time never runs in reverse on screen.
 */
export function offsetsFromTimestamps(
  startAt: number | null,
  moveAts: readonly number[],
): number[] {
  const first = moveAts[0];
  if (first === undefined) return [0];
  const start = startAt !== null && Number.isFinite(startAt) && startAt <= first ? startAt : first;
  const offsets = [0];
  let last = 0;
  for (const at of moveAts) {
    const offset = Number.isFinite(at) ? at - start : last;
    last = Math.max(last, offset);
    offsets.push(last);
  }
  return offsets;
}

export type PlaybackPosition = {
  /** The ply on the board. */
  ply: number;
  /** How long ply `ply` has been on the board (the think in progress). */
  plyElapsedMs: number;
  /** The full recorded length of that think; null once the last ply is on. */
  windowMs: number | null;
};

/** The position `elapsedMs` after the game's start. Before the start: ply 0. */
export function positionAt(offsets: readonly number[], elapsedMs: number): PlaybackPosition {
  const last = offsets.length - 1;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  // Largest p with offsets[p] <= elapsed (offsets are non-decreasing).
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((offsets[mid] ?? 0) <= elapsed) lo = mid;
    else hi = mid - 1;
  }
  const at = offsets[lo] ?? 0;
  return {
    ply: lo,
    plyElapsedMs: elapsed - at,
    windowMs: lo < last ? (offsets[lo + 1] ?? at) - at : null,
  };
}

/** The anchor that puts ply `ply` on the board, just landed, at wall time `nowMs`. */
export function anchorForPly(offsets: readonly number[], ply: number, nowMs: number): number {
  const index = Math.max(0, Math.min(ply, offsets.length - 1));
  return nowMs - (offsets[index] ?? 0);
}
