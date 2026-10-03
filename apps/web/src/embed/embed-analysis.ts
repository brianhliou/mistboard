// The game embed's analysis marks: the glyphs (?!, ?, ??) and "X was best." the review
// shows, plus the better move drawn on the board, from the game's STORED server analysis.
//
// Read-only by construction: a GET of the cached analysis (204 = never analysed, and the
// embed is unchanged) and, for the chance variants, of the cached decision layer. Nothing
// here can start an engine pass; a reader framing a game never spends compute.
//
// The marks themselves come from review/analysis-marks.ts, the function the review's move
// tree reads, so a frame and the review page cannot disagree about a move. What this file
// owns is the per-variant wiring the review gets from its presentation bundle: where the
// analysis lives, how a best move is written, whether it may be quoted at all, and how an
// engine move becomes board squares for an arrow.

import {
  engineUciToBanqiMove,
  engineUciToJungleFlipMove,
  engineUciToJungleMove,
  fsfUciToXiangqiSquares,
  type GameEvent,
  type GameSpecId,
  hasOwnKey,
  type Move,
  pikafishUciToJieqiMove,
} from '@mistboard/game';
import type { ReplayBoardOverlay } from '../replay.js';
import {
  type AnalysisMark,
  analysisMarks,
  bestPlayedPliesFromSquares,
  betterFromPly,
  type DecisionOverlay,
  judgmentBadgeAtPly,
  type PlayedSquares,
} from '../review/analysis-marks.js';
import { banqiDecisionOverlay, fetchCachedBanqiDecisions } from '../review/banqi-decisions.js';
import {
  darkChessDecisionOverlay,
  fetchCachedDarkChessDecisions,
  formatDarkChessMove,
} from '../review/dark-chess-decisions.js';
import {
  betterMoveArrowsWithParser,
  parseFortressEngineMove,
} from '../review/engine/engine-arrows.js';
import { fetchCachedGameAnalysis, regradeBestPlayed } from '../review/game-analysis.js';
import { fetchCachedJieqiDecisions, jieqiDecisionOverlay } from '../review/jieqi-decisions.js';
import {
  fetchCachedJungleFlipDecisions,
  jungleFlipDecisionOverlay,
} from '../review/jungle-flip-decisions.js';
import {
  defaultFormatBestMove,
  formatFlipVariantBestMove,
  formatJieqiBestMove,
  formatJungleEngineMove,
} from '../review/move-advice-text.js';
import { moveGlyphTone } from '../review/move-glyph.js';
import type { MoveAnnotation } from '../review/move-list.js';
import type { SvgBoardSquareGlyph } from '../svg-board-arrow.js';

type ParseEngineMove = (uci: string) => { from?: string; to: string } | null;

/** What the embed needs to know about one variant's stored analysis. Mirrors the
 *  variant's review presentation (formatBestMove, quoteEvalBestMove, its arrow parser). */
export type EmbedAnalysisVariant = {
  /** The `/api/<route>/games/:id/analysis` segment. */
  route: string;
  /** False for imperfect-information variants: the eval's best move is hindsight the mover
   *  never had, so it is neither quoted nor drawn (TreePresentation.quoteEvalBestMove). */
  quoteEvalBestMove: boolean;
  formatBestMove: (uci: string) => string;
  /** Engine UCI to board squares: matches a stored best move against the move played
   *  (the review's best-played regrade) and places the arrows. */
  parseMove: ParseEngineMove;
  /** Whether the board draws the better move. False where the review draws none either. */
  arrows: boolean;
  /** The cached decision-vs-luck layer, for the chance variants. Never computes. */
  fetchDecisions?: (
    roomId: string,
    events: () => Promise<GameEvent[]>,
  ) => Promise<DecisionOverlay | null>;
};

/** Plain chess UCI split into squares; castling is written king-to-g/c-file by the analysis
 *  engine, so it can fail to match the record's king-onto-rook move and stays graded. */
const parseChessUci: ParseEngineMove = (uci) =>
  /^[a-h][1-8][a-h][1-8]/.test(uci) ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null;

const isMovePlayed = (event: GameEvent): event is Extract<GameEvent, { type: 'move-played' }> =>
  event.type === 'move-played';

/**
 * Every game spec, named: a spec with stored server analysis gets its wiring, the rest
 * an explicit null (no marks). Typed over the whole GameSpecId union, so a new variant
 * does not compile until someone decides which it is. Fail-closed: there is no default.
 */
export const EMBED_ANALYSIS_VARIANTS: Record<GameSpecId, EmbedAnalysisVariant | null> = {
  xiangqi: {
    route: 'xiangqi',
    quoteEvalBestMove: true,
    formatBestMove: defaultFormatBestMove,
    parseMove: fsfUciToXiangqiSquares,
    arrows: true,
  },
  'atomic-xiangqi': {
    route: 'atomic-xiangqi',
    quoteEvalBestMove: true,
    formatBestMove: defaultFormatBestMove,
    parseMove: fsfUciToXiangqiSquares,
    arrows: true,
  },
  'fortress-xiangqi': {
    route: 'fortress-xiangqi',
    quoteEvalBestMove: true,
    formatBestMove: defaultFormatBestMove,
    parseMove: parseFortressEngineMove,
    arrows: true,
  },
  jungle: {
    route: 'jungle',
    quoteEvalBestMove: true,
    formatBestMove: formatJungleEngineMove,
    parseMove: (uci) => engineUciToJungleMove(uci),
    arrows: true,
  },
  jieqi: {
    route: 'jieqi',
    quoteEvalBestMove: true,
    formatBestMove: formatJieqiBestMove,
    parseMove: pikafishUciToJieqiMove,
    arrows: true,
    fetchDecisions: async (roomId) => {
      const summary = await fetchCachedJieqiDecisions(roomId);
      return summary ? jieqiDecisionOverlay(summary) : null;
    },
  },
  banqi: {
    route: 'banqi',
    quoteEvalBestMove: true,
    formatBestMove: formatFlipVariantBestMove,
    parseMove: engineUciToBanqiMove,
    arrows: true,
    fetchDecisions: async (roomId) => {
      const summary = await fetchCachedBanqiDecisions(roomId);
      return summary ? banqiDecisionOverlay(summary) : null;
    },
  },
  'jungle-flip': {
    route: 'jungle-flip',
    quoteEvalBestMove: true,
    formatBestMove: formatFlipVariantBestMove,
    parseMove: engineUciToJungleFlipMove,
    arrows: true,
    fetchDecisions: async (roomId) => {
      const summary = await fetchCachedJungleFlipDecisions(roomId);
      return summary ? jungleFlipDecisionOverlay(summary) : null;
    },
  },
  // Fog chess: the eval is Stockfish on the revealed truth, so its best move is never
  // quoted or drawn; the decision layer names the belief-relative better move in words.
  // No arrows: the review has no board overlay for fog chess either (engine: null).
  'dark-chess': {
    route: 'dark-chess',
    quoteEvalBestMove: false,
    formatBestMove: formatDarkChessMove,
    parseMove: parseChessUci,
    arrows: false,
    fetchDecisions: async (roomId, events) => {
      const summary = await fetchCachedDarkChessDecisions(roomId);
      if (!summary) return null;
      const moves: Move[] = (await events()).filter(isMovePlayed).map((event) => event.move);
      return darkChessDecisionOverlay(summary, moves);
    },
  },
  // No stored server analysis for these.
  'dark-xiangqi': null,
  'duck-xiangqi': null,
  'crazyhouse-xiangqi': null,
  mahjong: null,
  chess: null,
};

export function embedAnalysisVariant(specId: string): EmbedAnalysisVariant | null {
  return hasOwnKey(EMBED_ANALYSIS_VARIANTS, specId)
    ? EMBED_ANALYSIS_VARIANTS[specId as GameSpecId]
    : null;
}

export type EmbedAnalysis = {
  /** Per-ply glyph and advice for the score sheet. */
  annotations: Map<number, EmbedMoveAnnotation>;
  /** What the board draws at `ply` (lichess's convention, shared with the review): the
   *  stored alternatives to the NEXT move when it was judged, and the judgment badge of
   *  the move that produced this position on the square it landed on. */
  overlayAtPly: (ply: number) => ReplayBoardOverlay;
};

/** A score-sheet mark: the glyph after the move and the advice under it. */
export type EmbedMoveAnnotation = MoveAnnotation & { note?: string };

/**
 * Load the stored analysis for a finished game and turn it into the embed's marks, or
 * null when the variant has none or the game was never analysed. `playedMoves` gives the
 * moves as board squares (for the best-played regrade the review does against its tree).
 */
export async function loadEmbedAnalysis(
  specId: string,
  roomId: string,
  options: {
    playedMoves: () => Promise<PlayedSquares[]>;
    events: () => Promise<GameEvent[]>;
  },
): Promise<EmbedAnalysis | null> {
  const variant = embedAnalysisVariant(specId);
  if (!variant) return null;
  const [raw, decisions] = await Promise.all([
    fetchCachedGameAnalysis(variant.route, roomId).catch(() => null),
    variant.fetchDecisions?.(roomId, options.events).catch(() => null) ?? null,
  ]);
  if (!raw) return null;
  const played = await options.playedMoves().catch(() => []);
  const analysis = regradeBestPlayed(
    raw,
    bestPlayedPliesFromSquares(raw.evals, played, variant.parseMove),
  );
  const marks = analysisMarks({
    analysis,
    decisions,
    quoteEvalBestMove: variant.quoteEvalBestMove,
    formatBestMove: variant.formatBestMove,
  });
  return embedAnalysisFromMarks(marks, variant, played);
}

/** The score-sheet annotations and board overlay for a set of marks (exported for tests). */
export function embedAnalysisFromMarks(
  marks: ReadonlyMap<number, AnalysisMark>,
  variant: Pick<EmbedAnalysisVariant, 'arrows' | 'parseMove'>,
  played: readonly PlayedSquares[] = [],
): EmbedAnalysis {
  const annotations = new Map<number, EmbedMoveAnnotation>();
  for (const [ply, mark] of marks) {
    if (!mark.suffix && !mark.comment) continue;
    annotations.set(ply, {
      ...(mark.suffix ? { suffix: mark.suffix, suffixClass: mark.suffixClass } : {}),
      ...(mark.comment ? { note: mark.comment } : {}),
    });
  }
  const landedOn = new Map(played.map((move) => [move.ply, move.to]));
  const overlayAtPly = (ply: number): ReplayBoardOverlay => {
    const arrows = variant.arrows
      ? betterMoveArrowsWithParser(betterFromPly(marks, ply), variant.parseMove)
      : [];
    // The badge sits where the move landed (a reveal's or a flip's square too). A variant
    // that will not draw best moves still shows the verdict on the move played.
    const badge = judgmentBadgeAtPly(marks, ply);
    const square = landedOn.get(ply);
    const tone = badge ? moveGlyphTone(badge.text, badge.suffixClass) : null;
    const glyphs: SvgBoardSquareGlyph[] =
      badge && square && tone
        ? [{ square, kind: 'glyph', text: badge.text, className: `xq-marker--${tone}` }]
        : [];
    return { arrows, glyphs };
  };
  return { annotations, overlayAtPly };
}
