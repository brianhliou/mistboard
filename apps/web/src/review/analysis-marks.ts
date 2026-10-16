// Per-move analysis marks: the judgment glyph, the "Mistake. h3-e3 was best."
// advice, and which better move(s) to point at on the board, from a game's
// STORED server analysis (plus the decision-vs-luck layer on chance variants).
//
// One function, two surfaces. The review's move tree (tree-review.ts) and the
// game embed's score sheet (embed/embed-analysis.ts) both read their marks from
// analysisMarks, so a move graded "??" in the review is graded "??" in a frame,
// with the same words and the same arrow. Pure: no DOM, no fetch, no CSS.
//
// Where things show (lichess's convention, Brian 2026-10-02):
//  - the glyph and the advice attach to the MOVE (its ply N): the move list writes
//    "?? Blunder. e2-d1 was best." on it, and the board at ply N carries the glyph
//    as a badge on the square the move landed on (judgmentBadgeAtPly);
//  - the better-move arrow is "the best move from the position on the board", so it
//    shows one ply EARLIER, on the position the marked move was played FROM (ply
//    N-1), and the board at ply N draws no alternatives (betterFromPly).

import type { MoveJudgment } from '@mistboard/game';
import { type GameAnalysis, judgmentGlyph, type PlyEval, praiseGlyph } from './game-analysis.js';
import { ADVICE_LABEL, PRAISE_COMMENT } from './move-advice-text.js';

/** Per-reveal decision-vs-luck info the review overlays onto a chance-move game (jieqi). A
 *  reveal's eval swing splits into a DECISION (graded) and LUCK (shown, ungraded); this carries
 *  both per reveal ply plus per-player rollups. Variant-agnostic: the caller adapts its own
 *  decomposition shape (e.g. review/jieqi-decisions) to this. */
export type DecisionMoveInfo = {
  /** Decision-quality glyph for the reveal (null = a fine choice, or within engine noise). */
  judgment: MoveJudgment;
  /** Luck-free accuracy of the CHOICE in [0, 100] (best-vs-played pool means). Feeds the headline
   *  accuracy so a reveal ply is graded on skill, not the dice. */
  accuracy: number;
  /** Signed win% swing the reveal produced vs its own expectation (+ lucky, - unlucky).
   *  OPTIONAL: a variant whose luck axis is not a scalar omits it rather than sending 0, which
   *  would render as "average luck" instead of "no such number". Fog is the case — its error
   *  classes (belief_lost_truth / sample_error / decision_error) are categorical. */
  luck?: number;
  /** The played reveal's rank among the alternatives (1 = best), or null when off the table. */
  playedRank: number | null;
  /** Ranked alternatives for this chance ply, best first, ALREADY formatted by the variant
   *  (the move text is board notation, not engine UCI — this layer is variant-agnostic).
   *  Absent when the analysis predates candidate capture, or the variant cannot produce one. */
  candidates?: DecisionCandidate[];
};

/** One ranked alternative, display-ready. */
export type DecisionCandidate = {
  /** Board-notation move text, e.g. "e8-a8". */
  label: string;
  /**
   * The engine's OWN rank for this move, 1-based. Optional: where a variant's
   * candidate list is exactly the set it ranked (jieqi), row position already is
   * the rank and this can be omitted. Supply it wherever the displayed rows are a
   * SUBSET of what was ranked — otherwise the row index silently reads as a rank
   * and tells the reader their 21st-choice move was second best.
   */
  rank?: number;
  /** Luck-free win% for this choice, already rounded for display. */
  win: number;
  /** True when this is the move actually played. */
  played?: boolean;
  /** The move in the analysis engine's UCI dialect, for DRAWING it (an arrow on the
   *  board, parsed by the variant). Never shown as text; `label` is the text. Absent where
   *  the variant draws no candidate arrows. */
  uci?: string;
};

export type DecisionPlayerSummary = {
  reveals: number;
  /** Mean decision accuracy in [0, 100] (grades only the choice, not the outcome). */
  decisionAccuracy: number;
};

export type DecisionOverlay = {
  /** Per-reveal info keyed by ply, for move-list glyphs + the advice line. */
  byPly: Map<number, DecisionMoveInfo>;
  red: DecisionPlayerSummary;
  black: DecisionPlayerSummary;
};

/** " e8-a8 was best." for a judged chance ply whose top-ranked alternative is
 *  not the move played; empty when the table is missing or the played move led it. */
export function decisionBestQuote(info: DecisionMoveInfo): string {
  // Best first; a table that is a subset carries ranks, and its first row is
  // only the best move when it says rank 1.
  const top = info.candidates?.[0];
  if (!top || top.played || (top.rank !== undefined && top.rank !== 1)) return '';
  return ` ${top.label} was best.`;
}

/** How many ranked alternatives a chance ply draws as arrows. */
export const MAX_CANDIDATE_ARROWS = 3;

/** One move to draw for a mark, in the analysis engine's UCI dialect. */
export type MarkArrowMove = {
  uci: string;
  /** Mover-POV win% (chance-ply candidates only), for weighting alternates against the best. */
  win?: number;
};

/** The better move(s) a judged mark points at. A quiet move has ONE best move (the eval
 *  track's); a chance move (a reveal or a flip) has a ranked SET and never a line: past a
 *  reveal nothing is knowable, so a continuation would be fiction. */
export type MarkBetter =
  | { kind: 'move'; uci: string }
  | { kind: 'candidates'; moves: MarkArrowMove[] };

export type AnalysisMark = {
  ply: number;
  /** Glyph after the move ('??', '?', '?!', or a praise '!!' / '!'); absent = none. */
  suffix?: string;
  /** Colour hook (.review-move--<class>). */
  suffixClass?: string;
  /** The advice under the move: "Blunder. h5-h0 was best.", or a praise note. */
  comment?: string;
  commentClass?: string;
  /** Signed, rounded luck of a reveal (decision layer, chance plies only). */
  luck?: number;
  /** The decision layer's full ranked table for a chance ply, unfiltered. */
  candidates?: DecisionCandidate[];
  /** What to point at on the board while on this move; null when the move is not judged,
   *  the variant may not quote the eval's best move, or nothing drawable was stored. */
  better: MarkBetter | null;
};

export type AnalysisMarksInput = {
  analysis: GameAnalysis;
  decisions?: DecisionOverlay | null;
  /** The variant's policy (TreePresentation.quoteEvalBestMove): false for imperfect-
   *  information variants, whose eval best move is hindsight the mover never had. */
  quoteEvalBestMove: boolean;
  /** Formats the eval track's best move (engine UCI) for the advice line. */
  formatBestMove: (uci: string) => string;
};

/**
 * Every analysed mainline ply's mark, keyed by ply. A ply with nothing to say (a fine
 * move, an ungraded reveal) carries an empty mark: no suffix, no comment, better null.
 * The decision layer, where present, owns its plies:
 * its glyph replaces the eval track's (a reveal is graded on the choice, not the
 * dice), its advice replaces the eval track's when it judged the choice, and its
 * ranked set replaces the single best move.
 */
export function analysisMarks(input: AnalysisMarksInput): Map<number, AnalysisMark> {
  const { analysis, decisions, quoteEvalBestMove, formatBestMove } = input;
  const evalByPly = new Map<number, PlyEval>(analysis.evals.map((entry) => [entry.ply, entry]));
  const marks = new Map<number, AnalysisMark>();
  for (const move of analysis.moves) {
    const glyph = judgmentGlyph(move.judgment) ?? praiseGlyph(move.praise);
    const best = move.judgment && quoteEvalBestMove ? evalByPly.get(move.ply - 1)?.best : null;
    const comment = move.judgment
      ? `${ADVICE_LABEL[move.judgment]}.${best ? ` ${formatBestMove(best)} was best.` : ''}`
      : move.praise
        ? PRAISE_COMMENT[move.praise]
        : undefined;
    marks.set(move.ply, {
      ply: move.ply,
      ...(glyph ? { suffix: glyph.suffix, suffixClass: glyph.suffixClass } : {}),
      ...(comment ? { comment } : {}),
      ...((move.judgment ?? move.praise) ? { commentClass: move.judgment ?? move.praise } : {}),
      better: best ? { kind: 'move', uci: best } : null,
    });
  }
  for (const [ply, info] of decisions?.byPly ?? []) {
    const prev = marks.get(ply) ?? { ply, better: null };
    const glyph = judgmentGlyph(info.judgment);
    const luck = info.luck === undefined ? undefined : Math.round(info.luck);
    const next: AnalysisMark = {
      ...prev,
      suffix: glyph?.suffix,
      suffixClass: glyph?.suffixClass,
      ...(luck === undefined ? {} : { luck }),
      // The word, then the move the decision layer ranked first ("Mistake.
      // i5-i0 was best."), as the eval track writes it for quiet plies. It names a
      // move the mover could have chosen from what they saw: advice, not hindsight.
      ...(info.judgment
        ? {
            comment: `${ADVICE_LABEL[info.judgment]}.${decisionBestQuote(info)}`,
            commentClass: info.judgment,
          }
        : {}),
      ...(info.candidates?.length ? { candidates: info.candidates } : {}),
      better: info.judgment ? candidateBetter(info.candidates) : null,
    };
    if (!next.suffix) delete next.suffix;
    if (!next.suffixClass) delete next.suffixClass;
    marks.set(ply, next);
  }
  return marks;
}

/** The top alternatives of a judged chance ply, best first, without the move played (the
 *  board already shows it) and only those the variant can draw. */
function candidateBetter(candidates: readonly DecisionCandidate[] | undefined): MarkBetter | null {
  const ranked = [...(candidates ?? [])]
    .map((candidate, index) => ({ candidate, rank: candidate.rank ?? index + 1 }))
    .sort((a, b) => a.rank - b.rank);
  const moves: MarkArrowMove[] = [];
  for (const { candidate } of ranked) {
    if (candidate.played || !candidate.uci) continue;
    if (moves.length >= MAX_CANDIDATE_ARROWS) break;
    moves.push({ uci: candidate.uci, win: candidate.win });
  }
  return moves.length ? { kind: 'candidates', moves } : null;
}

/** The engine-UCI moves to draw for a mark, best first (empty when there are none). */
export function markArrowMoves(mark: AnalysisMark | null | undefined): MarkArrowMove[] {
  const better = mark?.better;
  if (!better) return [];
  return better.kind === 'move' ? [{ uci: better.uci }] : better.moves;
}

/** A played move as the board records it: from/to squares (a drop has no `from`; a flip
 *  has from === to). */
export type PlayedSquares = { ply: number; from?: string; to?: string };

/**
 * Plies whose played move IS the analysis engine's best move for the position before it,
 * for a surface that has the moves only as board squares (the embed; the review decodes
 * against its tree instead). `parse` turns the engine's UCI into the same squares the board
 * records, the parser the variant already trusts for its arrows. A drop compares on its
 * destination alone, since the parsed shape carries no role.
 */
export function bestPlayedPliesFromSquares(
  evals: readonly PlyEval[],
  played: readonly PlayedSquares[],
  parse: (uci: string) => { from?: string; to: string } | null,
): Set<number> {
  const byPly = new Map(played.map((move) => [move.ply, move]));
  const plies = new Set<number>();
  for (const entry of evals) {
    const move = byPly.get(entry.ply + 1);
    if (!entry.best || !move?.to) continue;
    const best = parse(entry.best);
    if (!best) continue;
    if (best.to === move.to && (best.from ?? null) === (move.from ?? null)) {
      plies.add(entry.ply + 1);
    }
  }
  return plies;
}

/** The better move(s) to draw on the board at `ply`: the stored alternatives to the move
 *  played FROM this position, when that move (ply + 1) was judged. Null otherwise, so a
 *  position whose next move was fine stays clean. */
export function betterFromPly(
  marks: ReadonlyMap<number, AnalysisMark>,
  ply: number,
): MarkBetter | null {
  return marks.get(ply + 1)?.better ?? null;
}

/** The judgment badge for the board at `ply`: the glyph of the move that produced this
 *  position (?!, ?, ??), for the square it landed on. Null for an unjudged move. */
export function judgmentBadgeAtPly(
  marks: ReadonlyMap<number, AnalysisMark>,
  ply: number,
): { text: string; suffixClass: string } | null {
  const mark = marks.get(ply);
  if (!mark?.suffix || !mark.suffixClass) return null;
  return { text: mark.suffix, suffixClass: mark.suffixClass };
}
