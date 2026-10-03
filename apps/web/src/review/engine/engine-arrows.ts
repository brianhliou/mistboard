// Engine output → board-arrow specs for the review board's arrow overlay.
// Pure mapping (no DOM): the review glue feeds these to the interactive board's
// setArrows(). FSF xiangqi UCI matches our square notation, so
// fsfUciToXiangqiSquares is a plain split.
//
// Weight encodes how much the line GIVES UP against the best line, not its rank
// (ported from lila ui/analyse/src/autoShape.ts). Rank-indexed styling lies in
// both directions: three near-equal moves read as one good move and two bad
// ones, and a candidate that hangs a rook still gets a solid arrow. Here the
// best move is a fixed blue, alternates share one grey at constant opacity, and
// only the shaft width varies — so an alternate that is nearly as good is nearly
// as heavy, and one that is clearly worse thins out and then disappears.
//
// Opacity deliberately does NOT vary: two overlapping translucent arrows stack
// into a third apparent weight, which would read as a strength no line has.

import {
  fsfUciToFortressXiangqiMove,
  fsfUciToXiangqiSquares,
  isFortressXiangqiDropMove,
  winPercent,
} from '@mistboard/game';
import type { FortressXiangqiBoardArrow } from '../../fortress-xiangqi-render.js';
import type { SvgBoardArrowStyle } from '../../svg-board-arrow.js';
import type { SvgBoardMarkerStyle } from '../../svg-board-marker.js';
import type { XiangqiBoardArrow } from '../../xiangqi-board.js';
import type { MarkArrowMove, MarkBetter } from '../analysis-marks.js';
import type { CevalLine } from './ceval.js';

export type EngineBoardArrow<Square extends string> = SvgBoardArrowStyle & {
  from: Square;
  to: Square;
};

export type EngineBoardMarker<Square extends string> = SvgBoardMarkerStyle & {
  square: Square;
  kind: 'circle';
};

type ParseEngineMove<Square extends string> = (uci: string) => { from?: Square; to: Square } | null;

export type EngineBoardOverlays<Square extends string> = {
  arrows: EngineBoardArrow<Square>[];
  markers: EngineBoardMarker<Square>[];
};

/** PV1 can also show the expected reply as a faint dashed second segment (the
 *  "length encodes strength" nod). OFF for now (2026-07-10): the dashed enemy
 *  arrow read as noise next to the ranked candidate arrows. */
export const SHOW_PV1_REPLY_SEGMENT = false;

// There is deliberately NO cap on the number of arrows: the MultiPV setting says
// how many lines to draw and ALT_CUTOFF_SHIFT decides which of them earn ink. A
// rank cap was a second, cruder filter in front of the real one — with the
// slider at 5 it silently drew 3, so moving the control did nothing, and five
// moves within 20cp were shown as three playable and two not. Bounded in
// practice by the slider's max and by the cutoff.

/** The best line: fixed weight, always drawn. */
const BEST_STYLE = { opacity: 0.4, width: 14 } as const;

/** The best ACTION when it has no travel (a flip, a drop): a ring on one point.
 *  It deliberately does NOT inherit BEST_STYLE's opacity. An arrow is 14 units
 *  wide and can afford to be translucent; a 5-unit ring at 0.4 washed out against
 *  the board and read as decoration rather than as the engine's pick. */
const BEST_MARKER_STYLE = { opacity: 0.95, width: 8 } as const;

/** Alternates: constant opacity, width from the win% gap (see ALT_WIDTH_*). */
const ALT_OPACITY = 0.35;

// Width ramp over the win-probability gap, in lila's units: `shift` is the
// fraction of a full win the line concedes, so 0 = as good as the best move and
// 1 = the difference between winning and losing. Past the cutoff the arrow is
// not drawn at all, which is what lets a forcing position show a single arrow.
//
// CALIBRATION: these three numbers are Stockfish-tuned, and winPercent's
// logistic constant carries the same caveat (see packages/game/src/analysis.ts).
// Pikafish's centipawn scale is similar but not identical. Retune here.
const ALT_CUTOFF_SHIFT = 0.2;
const ALT_WIDTH_MAX = 12;
const ALT_WIDTH_SLOPE = 50; // 12 at shift 0, down to 2 at the cutoff

const REPLY_STYLE = { opacity: 0.25, width: 7, dashed: true } as const;

/** Win probability for a line, from the moving side's POV. Ceval scores are
 *  already side-to-move relative, so lines within one position are directly
 *  comparable and need no perspective flip. */
function lineWinPercent(line: CevalLine): number {
  return winPercent(line.scoreCp, line.mate);
}

/** Arrows for the first move of every MultiPV line, weakest first so the
 *  strongest renders on top. Alternates that concede too much are dropped
 *  entirely, so the count tracks the MultiPV setting AND the position: five
 *  near-equal moves draw five arrows, a forcing position draws one. When
 *  enabled, PV1's reply move is prepended as a faint dashed segment (bottom of
 *  the stack). */
export function engineArrowsFromLinesWithParser<Square extends string>(
  lines: readonly CevalLine[],
  parseMove: ParseEngineMove<Square>,
): EngineBoardArrow<Square>[] {
  return engineOverlaysFromLinesWithParser(lines, parseMove).arrows;
}

export function engineMarkersFromLinesWithParser<Square extends string>(
  lines: readonly CevalLine[],
  parseMove: ParseEngineMove<Square>,
): EngineBoardMarker<Square>[] {
  return engineOverlaysFromLinesWithParser(lines, parseMove).markers;
}

export function engineOverlaysFromLinesWithParser<Square extends string>(
  lines: readonly CevalLine[],
  parseMove: ParseEngineMove<Square>,
): EngineBoardOverlays<Square> {
  const ranked = [...lines].sort((a, b) => a.multipv - b.multipv);
  const best = ranked[0];
  if (!best) return { arrows: [], markers: [] };
  const bestWin = lineWinPercent(best);

  const arrows: EngineBoardArrow<Square>[] = [];
  const markers: EngineBoardMarker<Square>[] = [];
  const push = (
    move: { from?: Square; to: Square },
    style: SvgBoardArrowStyle & { className: string },
  ): void => {
    if (move.from && move.from !== move.to) {
      arrows.push({ from: move.from, to: move.to, ...style });
    } else {
      markers.push({
        square: move.to,
        kind: 'circle',
        className: style.className.replace('xq-arrow', 'engine-marker'),
        color: style.className === 'xq-arrow--alt' ? '#4a4a4a' : '#2b6cb8',
        // A ring cannot carry an arrow's opacity: the arrow is a filled shape
        // several times the ring's stroke width, so the same alpha that reads as
        // "translucent arrow" reads as "barely there" on a thin outline. Lift the
        // alpha and floor the stroke, keeping the rank ordering (PV1 heavier than
        // its alternates) that the arrow widths encode.
        opacity: Math.min(0.95, (style.opacity ?? 0.4) + 0.5),
        width: Math.max(5, Math.round((style.width ?? 9) / 2)),
      });
    }
  };
  // Weakest first: later entries paint over earlier ones.
  for (let rank = ranked.length - 1; rank >= 1; rank -= 1) {
    const line = ranked[rank];
    if (!line) continue;
    const move = parseMove(line.pvUci[0] ?? '');
    if (!move) continue;
    // Negative shift = this line currently looks better than PV1, which happens
    // transiently mid-search before the ordering settles. Drop it rather than
    // drawing an alternate heavier than the best move.
    const shift = (bestWin - lineWinPercent(line)) / 100;
    if (shift < 0 || shift >= ALT_CUTOFF_SHIFT) continue;
    push(move, {
      opacity: ALT_OPACITY,
      width: Math.max(2, Math.round(ALT_WIDTH_MAX - shift * ALT_WIDTH_SLOPE)),
      className: 'xq-arrow--alt',
    });
  }

  const bestMove = parseMove(best.pvUci[0] ?? '');
  if (bestMove) push(bestMove, { ...BEST_STYLE, className: 'xq-arrow--pv1' });

  if (SHOW_PV1_REPLY_SEGMENT) {
    const reply = parseMove(best.pvUci[1] ?? '');
    if (reply?.from && reply.from !== reply.to) {
      arrows.unshift({
        from: reply.from,
        to: reply.to,
        ...REPLY_STYLE,
        className: 'xq-arrow--pv1-reply',
      });
    }
  }
  return { arrows, markers };
}

export function engineArrowsFromLines(lines: readonly CevalLine[]): XiangqiBoardArrow[] {
  return engineArrowsFromLinesWithParser(lines, fsfUciToXiangqiSquares);
}

/** Single best-move arrow from a whole-game analysis ply (server Pikafish path
 *  or the client sweep — both hand back our square notation). Empty when the
 *  move does not parse. */
export function bestMoveArrowWithParser<Square extends string>(
  uci: string | null | undefined,
  parseMove: ParseEngineMove<Square>,
): EngineBoardArrow<Square>[] {
  return bestMoveOverlaysWithParser(uci, parseMove).arrows;
}

export function bestMoveMarkerWithParser<Square extends string>(
  uci: string | null | undefined,
  parseMove: ParseEngineMove<Square>,
): EngineBoardMarker<Square>[] {
  return bestMoveOverlaysWithParser(uci, parseMove).markers;
}

export function bestMoveOverlaysWithParser<Square extends string>(
  uci: string | null | undefined,
  parseMove: ParseEngineMove<Square>,
): EngineBoardOverlays<Square> {
  const move = parseMove(uci ?? '');
  if (!move) return { arrows: [], markers: [] };
  if (move.from && move.from !== move.to) {
    return {
      arrows: [{ from: move.from, to: move.to, ...BEST_STYLE, className: 'xq-arrow--best' }],
      markers: [],
    };
  }
  return {
    arrows: [],
    markers: [
      {
        square: move.to,
        kind: 'circle',
        className: 'engine-marker--best',
        color: '#2b6cb8',
        ...BEST_MARKER_STYLE,
      },
    ],
  };
}

export function bestMoveArrow(uci: string | null | undefined): XiangqiBoardArrow[] {
  return bestMoveArrowWithParser(uci, fsfUciToXiangqiSquares);
}

/**
 * A chance ply's ranked alternatives (a reveal's or a flip's), as arrows: one move
 * each, never a line, because past a reveal there is no line to draw. The board-arrow
 * renderer has no labels, so rank reads the way the live engine's MultiPV arrows read:
 * the best is the fixed blue arrow, the others share one grey and thin out with the
 * win% they concede to it (same ramp and cutoff as engineOverlaysFromLinesWithParser),
 * so two near-equal choices look near-equal. Weakest first, so the best paints on top.
 * Moves that do not parse, or have no travel, are skipped.
 */
export function candidateArrowsWithParser<Square extends string>(
  moves: readonly MarkArrowMove[],
  parseMove: ParseEngineMove<Square>,
): EngineBoardArrow<Square>[] {
  const parsed = moves.flatMap((move) => {
    const squares = parseMove(move.uci);
    return squares?.from && squares.from !== squares.to
      ? [{ from: squares.from, to: squares.to, win: move.win }]
      : [];
  });
  const best = parsed[0];
  if (!best) return [];
  const arrows: EngineBoardArrow<Square>[] = [];
  for (let rank = parsed.length - 1; rank >= 1; rank -= 1) {
    const alt = parsed[rank];
    if (!alt) continue;
    const shift = best.win === undefined || alt.win === undefined ? 0 : (best.win - alt.win) / 100;
    if (shift < 0 || shift >= ALT_CUTOFF_SHIFT) continue;
    arrows.push({
      from: alt.from,
      to: alt.to,
      opacity: ALT_OPACITY,
      width: Math.max(2, Math.round(ALT_WIDTH_MAX - shift * ALT_WIDTH_SLOPE)),
      className: 'xq-arrow--alt',
    });
  }
  arrows.push({ from: best.from, to: best.to, ...BEST_STYLE, className: 'xq-arrow--best' });
  return arrows;
}

/** The arrows for a judged move's better move(s), whatever kind the mark carries: the
 *  eval track's single best move, or a chance ply's weighted ranked set. Moves without
 *  travel (a flip, a drop) draw nothing here; the review rings them instead. */
export function betterMoveArrowsWithParser<Square extends string>(
  better: MarkBetter | null | undefined,
  parseMove: ParseEngineMove<Square>,
): EngineBoardArrow<Square>[] {
  if (!better) return [];
  return better.kind === 'move'
    ? bestMoveArrowWithParser(better.uci, parseMove)
    : candidateArrowsWithParser(better.moves, parseMove);
}

/** Fortress Xiangqi engine UCI -> board squares: a board move travels, a reserve drop
 *  ('Q@e5') has only its destination (so it rings instead of pointing). Shared by the
 *  review's overlays and the game embed's stored best-move arrows. */
export function parseFortressEngineMove(
  uci: string,
): { from?: FortressXiangqiBoardArrow['from']; to: FortressXiangqiBoardArrow['to'] } | null {
  const move = fsfUciToFortressXiangqiMove(uci);
  if (!move) return null;
  return isFortressXiangqiDropMove(move) ? { to: move.to } : move;
}
