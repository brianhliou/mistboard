// The words of the "best move" advice ("Mistake. h3-e3 was best.") and the
// per-variant formatters that turn an analysis engine's UCI into board notation.
//
// Split out of move-advice.ts so a surface that only needs the TEXT (the game
// embed, review/analysis-marks.ts) does not pull the advice widget's stylesheet
// into a page framed by someone else. move-advice.ts re-exports all of it.
import { fsfUciToXiangqiSquares, type MoveJudgment } from '@mistboard/game';
import type { MovePraise } from './game-analysis.js';

export const ADVICE_LABEL: Record<Exclude<MoveJudgment, null>, string> = {
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

/** Inline note under a praised move (the positive counterpart of ADVICE_LABEL). */
export const PRAISE_COMMENT: Record<MovePraise, string> = {
  brilliant: 'Brilliant. A piece given up, and the engine agrees it does not come back.',
  great: 'Great move. The only good move in the position.',
};

// Default best-move formatter: FSF/xiangqi coordinate pair. Correct for xiangqi, fortress,
// and atomic (their board coords match the engine dialect and they have no flips). Variants
// whose engine UCI diverges from the board coords (banqi/jungle-flip/jieqi/jungle) pass
// their own via the presentation's `formatBestMove`.
export function defaultFormatBestMove(uci: string): string {
  const squares = fsfUciToXiangqiSquares(uci);
  return squares ? `${squares.from}-${squares.to}` : uci;
}

// Best-move formatter for the flip variants (banqi, jungle-flip). Their analysis engine emits
// 0-indexed ranks and encodes a flip as from === to, while the board displays 1-indexed ranks
// and labels a flip "<sq> flip" (matching the move list). Convert each square (rank + 1) and
// label flips; e.g. engine "b2b2" -> "b3 flip", "c3e3" -> "c4-e4".
export function formatFlipVariantBestMove(uci: string): string {
  if (uci.length < 4) return uci;
  const toDisplay = (sq: string): string => {
    const rank = Number(sq[1]);
    return Number.isNaN(rank) ? sq : `${sq[0]}${rank + 1}`;
  };
  const from = toDisplay(uci.slice(0, 2));
  const to = toDisplay(uci.slice(2, 4));
  return from === to ? `${from} flip` : `${from}-${to}`;
}

// Best-move formatter for Jieqi. PikaJieQi emits Pikafish UCI with 0-indexed
// ranks (rank 0..9) on the 9×10 xiangqi board, while the board displays 1-indexed ranks (1..10).
// Convert each square (rank + 1); jieqi has NO from===to flip (a reveal rides a normal move), so
// it is always a coordinate pair. e.g. engine "e7a7" -> "e8-a8". Single-digit ranks only here
// (0..9 -> 1..10), so a 4-char UCI is expected.
export function formatJieqiBestMove(uci: string): string {
  if (uci.length < 4) return uci;
  const toDisplay = (sq: string): string => {
    const rank = Number(sq[1]);
    return Number.isNaN(rank) ? sq : `${sq[0]}${rank + 1}`;
  };
  return `${toDisplay(uci.slice(0, 2))}-${toDisplay(uci.slice(2, 4))}`;
}

// Best-move formatter for Jungle: the engine's squares are the board's own, so the
// pair is split as written ("a3b3" -> "a3-b3").
export function formatJungleEngineMove(uci: string): string {
  if (uci.length < 4) return uci;
  return `${uci.slice(0, 2)}-${uci.slice(2, 4)}`;
}
