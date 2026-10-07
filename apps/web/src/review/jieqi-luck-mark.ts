// On-board luck mark for a jieqi reveal. The move list already carries the reveal's luck
// as an inline "🎲 +12%" badge; the board pins it to the square the revealed piece landed
// on as a die with no number: colour says which way, pips say how far (luckSizePips).
//
// Everything here is pure: the draw odds and the size buckets. The SVG lives in
// board-luck-mark.ts, the hover card in luck-mark-card.ts.
import type { JieqiGameState, JieqiMove, JieqiPieceRole } from '@mistboard/game';

/** One identity the face-down piece could have been, with how many of it were in the bag. */
export type RevealPoolEntry = { role: JieqiPieceRole; count: number };

export type RevealOdds = {
  /** The identity the reveal actually produced. */
  role: JieqiPieceRole;
  /** How many of `role` were in the mover's pool (the drawn one included). */
  count: number;
  /** Size of the pool: every identity the mover believed the piece could be. */
  total: number;
  /** The pool by identity, most likely first (ties in a fixed role order). */
  pool: RevealPoolEntry[];
};

// Display order for ties: the heavy pieces first, the way a reader scans a bag.
const ROLE_ORDER: readonly JieqiPieceRole[] = [
  'chariot',
  'cannon',
  'horse',
  'elephant',
  'advisor',
  'soldier',
];

/**
 * The odds behind a reveal, from the MOVER's knowledge just before it, in the exact pool
 * the server averages its luck baseline over (jieqi-analysis.ts poolMeanWin, #487): the
 * mover's face-down pieces on the board plus its own pieces the opponent captured while
 * still face-down, which it never saw. Using the same pool is what lets the card say
 * "2 in 9" next to a luck number computed against those same nine.
 *
 * Null when `move` is not a reveal (the piece on `from` is face-up or absent), or when any
 * identity in play was never determined (an imported game's lazy deal): there are no odds
 * to state for a piece nobody dealt.
 */
export function jieqiRevealOdds(before: JieqiGameState, move: JieqiMove): RevealOdds | null {
  const source = before.board[move.from];
  if (!source?.faceDown || source.unknown) return null;
  const mover = source.color;
  const counts = new Map<JieqiPieceRole, number>();
  let undetermined = false;
  const bump = (role: JieqiPieceRole, unknown: boolean | undefined): void => {
    if (unknown) undetermined = true;
    counts.set(role, (counts.get(role) ?? 0) + 1);
  };
  for (const piece of Object.values(before.board)) {
    if (piece?.color === mover && piece.faceDown) bump(piece.role, piece.unknown);
  }
  for (const capture of before.captures) {
    if (capture.owner === mover && !capture.revealedAtCapture) bump(capture.role, capture.unknown);
  }
  if (undetermined) return null;
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const pool = [...counts.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  return { role: source.role, count: counts.get(source.role) ?? 0, total, pool };
}

export type LuckTone = 'lucky' | 'unlucky' | 'even';

// ── Size buckets: the die face ───────────────────────────────────────────────────────
// The die carries the number without printing it: colour for direction, 1-6 pips for
// the size of the swing, in win-% points against the average reveal. Fixed buckets, so a
// given face always means the same range and the card can name it in words:
//   1  under 2   tiny      below the median reveal (~2): noise, drawn grey
//   2  2 to 5    small     up to the ?! bar (~5), the swing a slip in a choice costs
//   3  5 to 10   moderate  an inaccuracy's worth, up to about the top decile (p90 ~11)
//   4  10 to 20  big       a top-decile reveal, a mistake's worth
//   5  20 to 35  huge      a reveal that swings the game
//   6  35 and up decisive  the reveal the game turned on (a mate walked into reads 35+)

/** Lower bound (inclusive, rounded points) of pips 2..6. Exported for tests and the card. */
export const LUCK_SIZE_THRESHOLDS = [2, 5, 10, 20, 35] as const;

export type LuckSize = 'tiny' | 'small' | 'moderate' | 'big' | 'huge' | 'decisive';

const SIZE_BY_PIPS: readonly LuckSize[] = ['tiny', 'small', 'moderate', 'big', 'huge', 'decisive'];

/** Whole win-% points of the swing, unsigned: the number the card states ("14
 *  points"), and the one the buckets read, so the face and the words never disagree. */
export function luckPoints(luck: number): number {
  return Math.abs(Math.round(luck));
}

/** Die face: 1 + how many thresholds the rounded swing reaches. */
export function luckSizePips(luck: number): 1 | 2 | 3 | 4 | 5 | 6 {
  const m = luckPoints(luck);
  return (1 + LUCK_SIZE_THRESHOLDS.filter((bound) => m >= bound).length) as 1 | 2 | 3 | 4 | 5 | 6;
}

/** The bucket's name, for the card ("big swing"). */
export function luckSize(luck: number): LuckSize {
  return SIZE_BY_PIPS[luckSizePips(luck) - 1]!;
}

/** The die's colour: green or red only once the swing leaves the tiny bucket, so a one-pip
 *  die is always grey. */
export function luckSizeTone(luck: number): LuckTone {
  if (luckPoints(luck) < LUCK_SIZE_THRESHOLDS[0]) return 'even';
  return luck > 0 ? 'lucky' : 'unlucky';
}
