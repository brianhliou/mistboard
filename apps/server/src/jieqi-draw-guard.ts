/**
 * Draw guard for the jieqi bots: keep a bot that believes it is winning from
 * walking into a draw (or a loss) that only the rules impose.
 *
 * The engines search under Pikafish's xiangqi repetition rules, which the
 * repetition window (server-jieqi-engine.ts) switches on: there a perpetual
 * CHASE loses, so a bot facing a repeating chase scores the repetition as a win
 * for itself and steps back into it. Our rules (variants-jieqi.ts,
 * jieqiPerpetualCheckLoser through the tenant) adjudicate only perpetual CHECK;
 * any other threefold is a draw, as is the 120-ply no-capture clock. On
 * 2026-10-06 and 10-07 AB-JChess drew four games it scored as mate in 1 or
 * +300 this way, each one completed by the human's reply.
 *
 * So before a bot's move is played, the guard asks the server's own rules
 * (jieqiTenant.rules.applyMove) whether the move, or any reply to it, ends the
 * game by rule rather than over the board. If the move hands the opponent a
 * rule LOSS, or a DRAW while the bot's own score says it is winning, the engine
 * searches again with `searchmoves` limited to the moves that do neither, and
 * the guard plays its answer unless that answer is clearly worse than the draw.
 * The alternative to all this is a chase rule in the game rules, a rules change
 * this guard deliberately does not make.
 *
 * Hidden information: the guard runs on the true state, but reads only what the
 * bot could know. A face-down piece never leaves its home square without
 * revealing, so within one repetition window every position, key and legal
 * move is public; only a REVEAL's outcome depends on the identity turned over.
 * For a reveal the guard reads the public part alone, the no-capture clock, and
 * never the kernel's mate or stalemate verdict on the revealed piece.
 */

import {
  DEFAULT_NO_CAPTURE_PLY_LIMIT,
  getJieqiLegalMoves,
  isJieqiLegalMove,
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
  jieqiPositionKey,
  oppositeJieqiColor,
  PRACTICE_DRAW_CP,
} from '@mistboard/game';
import { jieqiMoveToPikafishUci, pikafishUciToJieqiMove } from './jieqi-fen.js';
import { jieqiTenant } from './jieqi-tenant.js';
import type { UciEval } from './uci-engine-harness.js';

/** Endings the rules impose. Checkmate and stalemate are the engine's own business. */
const RULE_ENDINGS: ReadonlySet<string> = new Set(['repetition', 'chasing', 'no-capture-clock']);

/**
 * The drawing band: a score inside ±150 cp reads as level (PRACTICE_DRAW_CP, the
 * same band lila uses). Above it the bot is winning and a draw is worth avoiding;
 * an alternative below its negative is clearly worse than the draw it replaces.
 */
export const JIEQI_DRAW_GUARD_BAND_CP = PRACTICE_DRAW_CP;

export type JieqiRuleEnding = {
  /** From the side that played the move being judged. */
  outcome: 'draw' | 'loss';
  reason: 'repetition' | 'chasing' | 'no-capture-clock';
  /** The move itself ends the game, or the opponent can end it with a reply. */
  via: 'move' | 'reply';
};

type Ending = { winner: JieqiColor | null; reason: JieqiRuleEnding['reason'] } | null;

function isReveal(state: JieqiGameState, move: JieqiMove): boolean {
  return state.board[move.from]?.faceDown === true;
}

/** One ply under the server's rules: the rule ending it causes (if any), and the
 *  position to look past (null once the game is over, or after a reveal). */
function ruleStep(
  state: JieqiGameState,
  move: JieqiMove,
): { ending: Ending; next: JieqiGameState | null; clock: number } {
  const after = jieqiTenant.rules.applyMove(state, move);
  if (isReveal(state, move)) {
    // The identity is hidden from the bot; the clock is not. A reveal opens a new
    // repetition window, so the clock is the only rule ending it can cause.
    const ending: Ending =
      after.noCaptureClock >= DEFAULT_NO_CAPTURE_PLY_LIMIT
        ? { winner: null, reason: 'no-capture-clock' }
        : null;
    return { ending, next: null, clock: after.noCaptureClock };
  }
  const status = after.status;
  if (status.type === 'finished') {
    const ending: Ending = RULE_ENDINGS.has(status.reason)
      ? { winner: status.winner, reason: status.reason as JieqiRuleEnding['reason'] }
      : null;
    return { ending, next: null, clock: after.noCaptureClock };
  }
  return {
    ending: null,
    next: status.type === 'playing' ? after : null,
    clock: after.noCaptureClock,
  };
}

/**
 * A cheap necessary condition for `move` to end the game by rule, so the reply
 * scan runs the full kernel apply (~0.2 ms) only where it could matter: the guard
 * runs on the WS server's event loop. A capture resets both the clock and the
 * repetition window. A quiet move can reach the clock limit, or close a threefold
 * only onto a position already counted twice; a reveal never closes one. The
 * kernel's verdict (ruleStep) is still what decides.
 */
function replyMayEndByRule(state: JieqiGameState, move: JieqiMove): boolean {
  const piece = state.board[move.from];
  if (!piece || state.board[move.to] !== undefined) return false;
  if (state.noCaptureClock + 1 >= DEFAULT_NO_CAPTURE_PLY_LIMIT) return true;
  const counts = state.positionCounts;
  if (!counts || piece.faceDown || state.status.type !== 'playing') return false;
  const board = { ...state.board, [move.to]: piece };
  delete board[move.from];
  return (counts[jieqiPositionKey(board, oppositeJieqiColor(state.status.turn))] ?? 0) >= 2;
}

/**
 * Does `move` (legal, side to move in `state`) end the game by rule against its
 * mover, or let the opponent do so with one reply? A loss outranks a draw.
 */
export function jieqiRuleEndingRisk(
  state: JieqiGameState,
  move: JieqiMove,
): JieqiRuleEnding | null {
  if (state.status.type !== 'playing') return null;
  const mover = state.status.turn;
  const judge = (ending: Ending, via: JieqiRuleEnding['via']): JieqiRuleEnding | null => {
    if (ending === null || ending.winner === mover) return null;
    return { outcome: ending.winner === null ? 'draw' : 'loss', reason: ending.reason, via };
  };
  const own = ruleStep(state, move);
  if (own.ending) return judge(own.ending, 'move');
  if (own.next === null) {
    // After the bot's own reveal the replies are not public, but the clock is: any
    // quiet reply that takes it to the limit draws.
    return isReveal(state, move) && own.clock + 1 >= DEFAULT_NO_CAPTURE_PLY_LIMIT
      ? { outcome: 'draw', reason: 'no-capture-clock', via: 'reply' }
      : null;
  }
  let worst: JieqiRuleEnding | null = null;
  for (const reply of getJieqiLegalMoves(own.next)) {
    if (!replyMayEndByRule(own.next, reply)) continue;
    const risk = judge(ruleStep(own.next, reply).ending, 'reply');
    if (risk?.outcome === 'loss') return risk;
    worst ??= risk;
  }
  return worst;
}

function winning(search: Pick<UciEval, 'cp' | 'mate'>): boolean {
  if (search.mate !== null) return search.mate > 0;
  return search.cp !== null && search.cp > JIEQI_DRAW_GUARD_BAND_CP;
}

function noWorseThanDrawn(search: Pick<UciEval, 'cp' | 'mate'>): boolean {
  if (search.mate !== null) return search.mate > 0;
  return search.cp !== null && search.cp >= -JIEQI_DRAW_GUARD_BAND_CP;
}

export type JieqiDrawGuardReason =
  /** The engine's move drew by rule while it scored a win; its next best was played. */
  | 'avoided-draw'
  /** The engine's move lost by rule (its own perpetual check); its next best was played. */
  | 'avoided-rule-loss'
  /** Every alternative scored clearly worse than the draw, so the draw stands. */
  | 'kept-draw-alternatives-worse'
  /** No legal move avoids the ending. */
  | 'kept-no-alternative'
  /** The re-search failed or answered outside the allowed set; the engine's move stands. */
  | 'kept-research-failed';

export type JieqiDrawGuardResult = {
  /** The move to play, in engine UCI. */
  best: string | null;
  /** The search that chose `best`: the re-search when replaced, else the engine's own. */
  search: UciEval;
  replaced: boolean;
  /** Null when the guard had nothing to say (the common case). */
  reason: JieqiDrawGuardReason | null;
  /** What the decision artifact records about the guard's turn; null when it did nothing. */
  detail: Record<string, unknown> | null;
};

const DETAIL_EXCLUDED_MAX = 40;
const DETAIL_PV_MAX = 12;

/**
 * Judge the engine's answer and, when it walks into a rule ending it should not,
 * search again among the moves that avoid one. `research` runs the same engine
 * with `searchmoves` set to the list it is given; it is called at most once.
 */
export async function guardJieqiRuleEnding(input: {
  state: JieqiGameState;
  search: UciEval;
  research: (searchMoves: readonly string[]) => Promise<UciEval>;
  now?: () => number;
}): Promise<JieqiDrawGuardResult> {
  const { state, search } = input;
  const keep: JieqiDrawGuardResult = {
    best: search.best,
    search,
    replaced: false,
    reason: null,
    detail: null,
  };
  if (state.status.type !== 'playing' || !search.best) return keep;
  const move = pikafishUciToJieqiMove(search.best);
  // An illegal answer is the move validator's to reject, not this guard's.
  if (!move || !isJieqiLegalMove(state, move)) return keep;
  const risk = jieqiRuleEndingRisk(state, move);
  if (risk === null) return keep;
  const engineWinning = winning(search);
  if (risk.outcome === 'draw' && !engineWinning) return keep;

  // Drop every move that loses by rule, and, while the engine says it is winning,
  // every move that draws by rule: one re-search instead of one per excluded move.
  const allowed: string[] = [];
  const excluded: string[] = [];
  for (const candidate of getJieqiLegalMoves(state)) {
    const candidateRisk = jieqiRuleEndingRisk(state, candidate);
    const drop = candidateRisk !== null && (candidateRisk.outcome === 'loss' || engineWinning);
    (drop ? excluded : allowed).push(jieqiMoveToPikafishUci(candidate));
  }
  const detail: Record<string, unknown> = {
    risk,
    engine_move: search.best,
    engine_cp: search.cp,
    engine_mate: search.mate,
    band_cp: JIEQI_DRAW_GUARD_BAND_CP,
    excluded_count: excluded.length,
    excluded: excluded.slice(0, DETAIL_EXCLUDED_MAX),
    allowed_count: allowed.length,
  };
  const kept = (reason: JieqiDrawGuardReason, extra: Record<string, unknown> = {}) => ({
    ...keep,
    reason,
    detail: { ...detail, ...extra },
  });
  if (allowed.length === 0) return kept('kept-no-alternative');

  const now = input.now ?? Date.now;
  const startedAt = now();
  let alternative: UciEval;
  try {
    alternative = await input.research(allowed);
  } catch (err) {
    return kept('kept-research-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const altDetail = {
    research_ms: now() - startedAt,
    alternative: {
      move: alternative.best,
      cp: alternative.cp,
      mate: alternative.mate,
      depth: alternative.depth,
      pv: (alternative.pv ?? []).slice(0, DETAIL_PV_MAX),
    },
  };
  if (!alternative.best || !allowed.includes(alternative.best)) {
    return kept('kept-research-failed', altDetail);
  }
  if (risk.outcome === 'draw' && !noWorseThanDrawn(alternative)) {
    return kept('kept-draw-alternatives-worse', altDetail);
  }
  return {
    best: alternative.best,
    search: alternative,
    replaced: true,
    reason: risk.outcome === 'loss' ? 'avoided-rule-loss' : 'avoided-draw',
    detail: { ...detail, ...altDetail },
  };
}
