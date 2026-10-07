// Whole-game "Computer analysis" for Jieqi (揭棋): a fixed-strength eval of
// every ply, normalized to the RED SEAT's POV, cached + coalesced. Mirrors banqi-analysis.ts,
// with two jieqi-specific wrinkles:
//
//   1. Jieqi hides face-down piece IDENTITIES (positions are public), so reconstruction needs
//      the per-game DEAL (from the room-created event) to rebuild each position, and the engine
//      is fed the REDACTED (as-played info-state) FEN — jieqi-fen.ts emits `X`/`x` for a
//      face-down piece, so the engine never learns a hidden id, exactly as during live play.
//   2. A REVEAL is coupled to a normal move (a face-down piece reveals its identity WHEN it
//      moves — there is no separate from===to flip as in banqi). So a "chance" ply is a move
//      whose source piece was face-down beforehand; jieqiChancePlies() detects those by replay.
//
// The backend is a UCI binary (no in-process fallback): AB-JChess when its binary and net
// resolve (prod since 2026-10, #482), else PikaJieQi (Pikafish jieqi_old), chosen per compute
// by jieqiAnalysisEngine(). Each engine has its own profile below (budgets, cache ids, win
// curve), and a stored analysis keeps the id of the engine that computed it: the client draws
// and grades it on that engine's curve (winPercentK), and a read falls back to whichever
// engine's row exists, so games analysed before the switch keep their PikaJieQi analysis. A
// missing binary fails closed at the route (503), and an all-null sweep throws
// VacuousAnalysisError (never cached) — so a broken or score-less engine can't cache a flat,
// mistake-free game.

import {
  applyJieqiMove,
  createInitialJieqiState,
  type JieqiColor,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPieceRole,
  WIN_PCT_K,
  winPercent,
  winPercentK,
} from '@mistboard/game';
import {
  type AnalysisProgressStore,
  liveAnalysisProgressStore,
  mapWithConcurrency,
  resolveCachedComputation,
} from './game-analysis-kernel.js';
import {
  isVacuousAnalysis,
  type SweepPlyEval,
  VacuousAnalysisError,
} from './game-analysis-sweep.js';
import {
  ABJCHESS_ENGINE_REF,
  ABJCHESS_NET_FILE,
  evaluateJieqiFen,
  JIEQI_ANALYSIS_ENGINE_VERSION,
  type JieqiAnalysisEngine,
  type JieqiAnalysisEvaluators,
  type JieqiEvalBudget,
  jieqiAnalysisEngine,
  PIKAFISH_JIEQI_ENGINE_REF,
  withJieqiAnalysisSession,
} from './jieqi-engine.js';
import {
  jieqiMoveToPikafishUci,
  jieqiStateToPikafishFen,
  pikafishUciToJieqiMove,
} from './jieqi-fen.js';
import * as persistence from './persistence.js';
import type { UciMultiPvLine } from './uci-engine-harness.js';

// Search budget: fixed NODES, not fixed depth (see JieqiEvalBudget in jieqi-engine.ts for the
// full argument and the measurements). The short version: a fixed depth buys wildly different
// amounts of search per position, because extensions spend the budget for you. Measured over
// one 64-ply game at the old depth 16, per-ply cost ran 94k -> 7.8M nodes (median 173k, mean
// 845k). That made neighbouring plies incomparable and produced a visible false cliff: the
// position one ply BEFORE a discovered check got 94k nodes and missed it (+160 for the side
// about to be checked), while the position AFTER it was already in check, so check extensions
// pushed the same nominal depth 16 past the tactic (-104). The eval graph then blamed a quiet
// soldier step for a 264cp swing the mover could not have caused, and let the real blunder —
// the move before it — through ungraded.
//
// 500k nodes was picked by measurement, not feel. It is enough to resolve that position
// (it finds the tactic at effective depth 23, -504), and it is CHEAPER than depth 16 was:
// 29.3M nodes / 10.2s for the whole game against 54.1M / 18.6s, because it caps the tail
// instead of the median. Capping the tail is what the 2026-08-28 depth 20 -> 16 cut was
// actually trying to buy (a 146-ply game costing ~10min of sweep); a node budget buys it
// directly, without paying for it in the positions that needed the search.
const JIEQI_ANALYSIS_NODES = 500_000;

// Backstop only, on both arms of the budget. At 500k nodes and the 2-3M nps this binary runs
// at, a ply is ~200ms, so this cap must never bind; if it does, that ply stopped being
// reproducible.
const JIEQI_ANALYSIS_MOVETIME_CAP_MS = 6_000;

// ── Parent/child consistency (see reconcileJieqiSeries) ──────────────────────
//
// A DETERMINISTIC move cannot improve the mover's own position beyond what the parent search
// says was available: the mover could always have played it, so value(parent) >= value(child)
// in the mover's POV. A violation is proof the parent was under-searched.
//
// The threshold is not zero, because the invariant only holds for EXACT minimax and these are
// two fixed-budget estimates of a chance-node value. Measured over 92 deterministic plies in
// two real games at 500k nodes, 36% violate it by SOME amount (p90 +62cp, p95 +122cp) — that
// is ordinary search noise. Only the tail is a real defect: 3 pairs over 200cp. So 200 is set
// where the distribution stops being noise, not at a round number that felt safe.
const JIEQI_CONSISTENCY_THRESHOLD_CP = 200;

// One escalation, then stop. 4x clears the horizon cases (the discovered check above resolves
// well inside it) and costs ~600ms on the handful of plies that trip it. It deliberately does
// NOT clamp the ones it cannot clear: Pikafish's chance-node value is risk-averse by design
// (see the Layer-2 note below), so with dark pieces on the board a persistent violation is not
// proof the parent is wrong, and overwriting it would publish a number no search produced.
// Those plies are flagged `unstable` instead and left ungraded, the same treatment a reveal
// (chance) ply already gets.
const JIEQI_CONSISTENCY_RESEARCH_NODES = JIEQI_ANALYSIS_NODES * 4;

// Nominal cache dimension: `depth` only has to be STABLE for the (room, engine, depth) cache
// key, and since the 2026-08-29 move to a node budget it no longer describes the search at all
// — the real dial is JIEQI_ANALYSIS_NODES, carried in the engine id. Left at its historical
// value on purpose: changing it would churn the key for no reason, and the id already
// self-invalidates. Do not read this as "the sweep searched to depth 16".
export const JIEQI_ANALYSIS_DEPTH = 16;

// Red-SEAT-POV cp for a decisive finished position (no engine query is made there).
const TERMINAL_CP = 30_000;

// Suffixes invalidate earlier cached sweeps computed under a different contract: `history1`
// the FEN-only sweeps, `nodes…` the fixed-depth ones, `consistent1` the ones with no
// reconciliation pass. The stored `depth` column below is now just the other half of the cache
// key — the search dial is JIEQI_ANALYSIS_NODES and it lives here, in the id.
export const JIEQI_ANALYSIS_ENGINE_ID = `pikafish-jieqi-analysis@${JIEQI_ANALYSIS_ENGINE_VERSION}+${PIKAFISH_JIEQI_ENGINE_REF}+history1+nodes${JIEQI_ANALYSIS_NODES}+consistent1`;

// ── AB-JChess budgets (#482) ─────────────────────────────────────────────────────
//
// AB-JChess is ~50x slower per node than PikaJieQi and stronger per node: single-threaded it
// searched ~30k nps on prod web (EPYC 9655, avx2 build) and, measured on an M-series dev box
// over a real 28-ply game (jq_23d2a761), ~35k nps in the all-dark opening rising to ~100k in
// the middlegame (its net is lazily loaded on the first `go`, ~0.5 s once per session). It
// prints no `info` line until a search is a few hundred ms old, but on every position measured
// the last scored line before `bestmove` was an exact score from the last completed iteration
// (never bound-only), which is what the reader keeps (a bound is only its last resort). A fixed depth is unreachable at these rates (depth 16 would be
// minutes), so it gets a node budget for the same reason PikaJieQi does (see
// JIEQI_ANALYSIS_NODES): every ply buys the same search.
//
// 50k nodes is ~1.7 s per ply on prod in the opening and ~1 s later (0.5-0.9 s locally), so
// a 100-ply sweep is ~2-3 min. It still reaches depth 8-9 in the all-dark opening and 11-19
// from the middlegame on, and finds the mate-in-1 that ends that game at once.
const ABJCHESS_ANALYSIS_NODES = 50_000;
const ABJCHESS_CONSISTENCY_RESEARCH_NODES = ABJCHESS_ANALYSIS_NODES * 4;
// A safety net, never the dial: 200k nodes (the re-search) at 30k nps is ~7 s. Binding it
// would take a box under ~7k nps, and that ply would stop being reproducible.
const ABJCHESS_ANALYSIS_MOVETIME_CAP_MS = 30_000;
// Decisions: a reveal costs one MultiPV search (it only names the candidate moves; its
// scores never reach the output) plus one eval per (candidate, hidden role), up to ~24. Each
// eval gets 20k nodes (~0.7 s on prod) and the MultiPV table 100k (~3 s), so a reveal is
// ~10-15 s and a game's decomposition a few minutes, like PikaJieQi's depth-16 pass was.
const ABJCHESS_DECISION_NODES = 20_000;
const ABJCHESS_DECISION_MULTIPV_NODES = 100_000;

const ABJCHESS_NET_TAG = ABJCHESS_NET_FILE.replace(/\.nnue$/, '');

// The re-search rule, stated in WIN% so it means the same on either engine's scale. 200cp
// was chosen on lila's curve, where it is a ~17.6-point swing out of equality; AB-JChess's
// cp are steeper (+112cp is already 75%), so the same 200cp there would be a ~38-point swing
// and would almost never fire. PikaJieQi keeps its original cp rule: its cache ids predate
// this and promise the evals they were computed with.
const JIEQI_CONSISTENCY_THRESHOLD_WIN = winPercent(JIEQI_CONSISTENCY_THRESHOLD_CP, null) - 50;

/** Everything about one analysis engine that a cached result depends on. */
export type JieqiAnalysisProfile = {
  engine: JieqiAnalysisEngine;
  /** Cache id of the Layer-1 sweep; also what the client reads the win curve off. */
  analysisEngineId: string;
  /** Cache id of the Layer-2 decisions blob. */
  decisionsEngineId: string;
  /** Win-curve constant for this engine's cp (winPercentK of its ids). */
  winK: number;
  sweepNodes: number;
  researchNodes: number;
  movetimeCapMs: number;
  /** Parent/child consistency rule (reconcileJieqiSeries). */
  consistency: { unit: 'cp'; threshold: number } | { unit: 'win'; threshold: number };
  /** Budget of one decisions eval (a pool-mean term). */
  decisionEval: JieqiEvalBudget;
  /** Budget of the decisions MultiPV table (candidate moves only). */
  decisionMultiPv: JieqiEvalBudget;
};

export const ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID = `ab-jchess-jieqi-analysis@1+${ABJCHESS_ENGINE_REF}+${ABJCHESS_NET_TAG}+nodes${ABJCHESS_ANALYSIS_NODES}+consistent-win1`;

export type JieqiRepetitionWindow = {
  fen: string;
  moves: readonly string[];
};

export type JieqiPositionEval = {
  /** Centipawns from the RED SEAT's POV (positive = Red better); null when mate is set. */
  cp: number | null;
  /** Signed moves-to-mate from the RED SEAT's POV; null otherwise. */
  mate: number | null;
  /** Best move in Pikafish UCI (rank 0..9, e.g. "e7a7"); the engine's own dialect. */
  best: string | null;
};

/**
 * Evaluate a single PLAYING jieqi position with PikaJieQi, normalized to the RED SEAT's POV.
 * Pikafish reports the score from the side-to-move POV, and side-to-move IS the mover seat
 * (the FEN's stm field just encodes that seat), so we flip the sign when Black is to move —
 * exactly as banqi/jungle do. Throws (via pikaJieqiPath) when the binary is absent; callers
 * pre-check availability and fail closed. `evaluateFen` is the engine backend: the default
 * spawns one process per call; the sweep binds it to a persistent session
 * (withJieqiAnalysisSession) with the same budget, so the POV math lives here once. `nodes`
 * is the search budget; the reconciliation pass re-searches a suspect ply at a larger one.
 */
export async function evaluateJieqiPosition(
  state: JieqiGameState,
  evaluateFen: (
    fen: string,
    opts: JieqiEvalBudget & { moves?: readonly string[] },
  ) => Promise<{ cp: number | null; mate: number | null; best: string | null }> = evaluateJieqiFen,
  repetitionWindow: JieqiRepetitionWindow = {
    fen: jieqiStateToPikafishFen(state),
    moves: [],
  },
  nodes: number = JIEQI_ANALYSIS_NODES,
  movetimeCapMs: number = JIEQI_ANALYSIS_MOVETIME_CAP_MS,
): Promise<JieqiPositionEval> {
  const mover: JieqiColor = state.status.type === 'playing' ? state.status.turn : 'red';
  const sign = mover === 'red' ? 1 : -1;
  const evaluation = await evaluateFen(repetitionWindow.fen, {
    nodes,
    movetimeMs: movetimeCapMs,
    moves: repetitionWindow.moves,
  });
  return {
    cp: evaluation.cp == null ? null : evaluation.cp * sign,
    mate: evaluation.mate == null ? null : evaluation.mate * sign,
    best: evaluation.best,
  };
}

// Red-SEAT-POV decisive eval for a finished position: the game is over, so the winner seat is
// known and no engine is queried. `winner` is a SEAT (red = first mover), so this is already
// in the red-seat POV the sweep normalizes to. A drawn finish (no-capture clock) scores 0.
function terminalPlyEval(ply: number, state: JieqiGameState): SweepPlyEval {
  if (state.status.type !== 'finished') return { ply, cp: 0, mate: null, best: null };
  const winner = state.status.winner;
  const cp = winner === 'red' ? TERMINAL_CP : winner === 'black' ? -TERMINAL_CP : 0;
  return { ply, cp, mate: null, best: null };
}

export type JieqiGameAnalysis = {
  engineId: string;
  depth: number;
  plies: SweepPlyEval[];
};

export function jieqiAnalysisRepetitionWindows(
  moves: readonly JieqiMove[],
  deal: JieqiDeal,
): JieqiRepetitionWindow[] {
  let state = createInitialJieqiState('analysis-window', deal);
  let startState = state;
  let windowMoves: JieqiMove[] = [];
  const windows: JieqiRepetitionWindow[] = [
    { fen: jieqiStateToPikafishFen(startState), moves: [] },
  ];
  for (const move of moves) {
    const irreversible = state.board[move.from]?.faceDown === true || state.board[move.to] != null;
    state = applyJieqiMove(state, move);
    if (irreversible) {
      startState = state;
      windowMoves = [];
    } else {
      windowMoves.push(move);
    }
    windows.push({
      fen: jieqiStateToPikafishFen(startState),
      moves: windowMoves.map(jieqiMoveToPikafishUci),
    });
  }
  return windows;
}

/**
 * Reconstruct every ply from the per-game DEAL + move list and evaluate it (red-seat POV).
 * Ply 0 is the initial position; ply k is the position after k moves. Reconstruction uses the
 * SAME kernel the live game did (createInitialJieqiState(deal) + applyJieqiMove), so reveals
 * reproduce exactly (a face-down piece reveals its dealt identity the first time it moves).
 * `evaluate` is injectable so tests drive the sweep without an engine; the default path runs
 * the walk against ONE persistent PikaJieQi session (spawn + option setup once, then a
 * FEN-per-position round-trip at the same depth/movetime the per-spawn path used).
 *
 * The sweep reads every position as an all-knowing spectator (no `viewer`): both pools exact,
 * including dark pieces captured face-down. Reveals are graded from the mover's view in the
 * decisions layer (#487), but quiet-move judgments still come from this chart, so a quiet move
 * made after the mover lost a dark piece is judged with knowledge the mover lacked.
 */
export async function analyzeJieqiPostgame(
  moves: readonly JieqiMove[],
  deal: JieqiDeal,
  evaluate?: (
    state: JieqiGameState,
    repetitionWindow: JieqiRepetitionWindow,
    nodes?: number,
  ) => Promise<JieqiPositionEval>,
  progress?: AnalysisProgressStore<SweepPlyEval>,
  profile: JieqiAnalysisProfile = currentJieqiAnalysisProfile(),
): Promise<JieqiGameAnalysis> {
  let state = createInitialJieqiState('analysis', deal);
  const states: JieqiGameState[] = [state];
  for (const move of moves) {
    state = applyJieqiMove(state, move);
    states.push(state);
  }
  const repetitionWindows = jieqiAnalysisRepetitionWindows(moves, deal);
  const deterministic = new Set(jieqiDeterministicPlies(moves, deal));
  // With a progress store the sweep checkpoints after every evaluated ply and
  // resumes from the last checkpoint (persist expensive output incrementally).
  const sweep = async (
    evaluatePosition: (
      state: JieqiGameState,
      repetitionWindow: JieqiRepetitionWindow,
      nodes?: number,
    ) => Promise<JieqiPositionEval>,
  ): Promise<SweepPlyEval[]> => {
    const resumed = progress ? await progress.load() : null;
    const plies: SweepPlyEval[] = resumed ? [...resumed.items] : [];
    for (let ply = plies.length; ply < states.length; ply += 1) {
      const s = states[ply]!;
      if (s.status.type !== 'playing') {
        plies.push(terminalPlyEval(ply, s));
        continue;
      }
      const evaluation = await evaluatePosition(s, repetitionWindows[ply]!);
      plies.push({ ply, cp: evaluation.cp, mate: evaluation.mate, best: evaluation.best });
      if (progress) await progress.save({ nextIndex: ply + 1, items: plies });
    }
    return plies;
  };
  const withEvaluator = async (
    evaluatePosition: (
      state: JieqiGameState,
      repetitionWindow: JieqiRepetitionWindow,
      nodes?: number,
    ) => Promise<JieqiPositionEval>,
  ): Promise<SweepPlyEval[]> => {
    const swept = await sweep(evaluatePosition);
    return reconcileJieqiSeries(
      swept,
      states,
      repetitionWindows,
      deterministic,
      evaluatePosition,
      profile,
    );
  };
  const plies = evaluate
    ? await withEvaluator(evaluate)
    : await withJieqiAnalysisSession(
        (evaluateFen) =>
          withEvaluator((s, repetitionWindow, nodes) =>
            evaluateJieqiPosition(
              s,
              evaluateFen,
              repetitionWindow,
              nodes ?? profile.sweepNodes,
              profile.movetimeCapMs,
            ),
          ),
        profile.engine,
      );
  return { engineId: profile.analysisEngineId, depth: JIEQI_ANALYSIS_DEPTH, plies };
}

/** Red-seat-POV scalar that orders cp and mate scores together, so a ply that found a mate is
 *  comparable with one that did not. Null when the ply carries no score at all. */
function comparableCp(evaluation: { cp: number | null; mate: number | null }): number | null {
  if (evaluation.mate != null) {
    return evaluation.mate > 0 ? TERMINAL_CP - evaluation.mate : -TERMINAL_CP - evaluation.mate;
  }
  return evaluation.cp;
}

/**
 * Enforce the one thing a fixed-budget eval series can be checked against without a second
 * opinion: on a DETERMINISTIC ply, the mover cannot come out ahead of what the position before
 * it said was available, because playing that move was one of the parent's own options. When
 * `value(child) - value(parent)` favours the mover by more than the noise floor, the PARENT is
 * the under-searched one — the child is a ply closer to the truth and, when the move gives
 * check, got extensions the parent did not.
 *
 * Walks BACKWARDS so a parent that improves is re-checked against its own parent in the same
 * pass (the ply-51 fix in the motivating game moves the blunder onto ply 50, where it belongs).
 * Re-searches the parent once at JIEQI_CONSISTENCY_RESEARCH_NODES; if that clears the violation
 * the better numbers stand, and if it does not the ply is marked `unstable` rather than clamped
 * — see the constant's note on why overwriting would be dishonest here.
 *
 * Chance plies are skipped entirely: a reveal legitimately hands the mover value the parent
 * could only average over, so the invariant does not apply and a "violation" there is the
 * variance the Layer-2 decomposition exists to measure.
 */
export async function reconcileJieqiSeries(
  plies: SweepPlyEval[],
  states: readonly JieqiGameState[],
  repetitionWindows: readonly JieqiRepetitionWindow[],
  deterministic: ReadonlySet<number>,
  evaluatePosition: (
    state: JieqiGameState,
    repetitionWindow: JieqiRepetitionWindow,
    nodes?: number,
  ) => Promise<JieqiPositionEval>,
  rule: Pick<JieqiAnalysisProfile, 'consistency' | 'researchNodes' | 'winK'> = {
    consistency: { unit: 'cp', threshold: JIEQI_CONSISTENCY_THRESHOLD_CP },
    researchNodes: JIEQI_CONSISTENCY_RESEARCH_NODES,
    winK: WIN_PCT_K,
  },
): Promise<SweepPlyEval[]> {
  const out = plies.map((ply) => ({ ...ply }));
  // Move k is Red's when k is odd (Red moves first), so a gain for the mover of move k is a
  // rise in the red-seat POV series for Red and a fall for Black.
  const moverSign = (k: number): number => (k % 2 === 1 ? 1 : -1);
  // Red-seat-POV scalar on the rule's own unit: cp (PikaJieQi's original rule) or win% on
  // the engine's curve (AB-JChess), so one threshold means the same swing on either engine.
  const scalar = (evaluation: { cp: number | null; mate: number | null }): number | null => {
    if (rule.consistency.unit === 'cp') return comparableCp(evaluation);
    if (evaluation.cp == null && evaluation.mate == null) return null;
    return winPercent(evaluation.cp, evaluation.mate, rule.winK);
  };
  const threshold = rule.consistency.threshold;
  const moverGain = (k: number): number | null => {
    const child = scalar(out[k]!);
    const parent = scalar(out[k - 1]!);
    if (child == null || parent == null) return null;
    return (child - parent) * moverSign(k);
  };
  for (let k = out.length - 1; k >= 1; k -= 1) {
    if (!deterministic.has(k)) continue;
    const parentState = states[k - 1]!;
    if (parentState.status.type !== 'playing') continue;
    const gain = moverGain(k);
    if (gain == null || gain <= threshold) continue;
    const rescored = await evaluatePosition(
      parentState,
      repetitionWindows[k - 1]!,
      rule.researchNodes,
    );
    // Only a re-search that actually scored replaces the swept numbers. A scoreless answer
    // (a stalled or stale binary) would otherwise punch a null into a series that had a
    // perfectly good value, and enough of those drift the whole sweep toward vacuous.
    if (rescored.cp != null || rescored.mate != null) {
      out[k - 1] = { ...out[k - 1]!, cp: rescored.cp, mate: rescored.mate, best: rescored.best };
    }
    const after = moverGain(k);
    if (after != null && after > threshold) out[k - 1]!.unstable = true;
  }
  return out;
}

/**
 * The 1-based plies whose move resolved a hidden identity the mover could not see: it moved one
 * of its own face-down pieces (a REVEAL: the piece turns face-up as it moves) or it captured one
 * of the opponent's face-down pieces (a FACE-DOWN CAPTURE: the mover learns what it took only by
 * taking it). Either way the realized eval swing conflates the decision with the luck of the
 * draw, so the client leaves these plies unjudged on the chart and grades them from the
 * decision-vs-luck decomposition instead (analyzeJieqiDecisions computes a row for exactly this
 * set). Pure kernel replay (no engine), deterministic from (moves, deal).
 *
 * Face-down captures used to be graded as ordinary moves on the realized swing, so their marks
 * tracked what the capture happened to hit (a dark soldier taken drew ?! where the same capture
 * of a dark chariot drew nothing): measured 2026-10-07 over 104 prod games, 30 of 94 such
 * captures marked, 18 of 39 soldier captures against 0 of 6 chariot ones.
 */
export function jieqiChancePlies(moves: readonly JieqiMove[], deal: JieqiDeal): number[] {
  let state = createInitialJieqiState('analysis', deal);
  const chance: number[] = [];
  moves.forEach((move, i) => {
    if (isJieqiChanceMove(state, move)) chance.push(i + 1);
    state = applyJieqiMove(state, move);
  });
  return chance;
}

/** True when `move` reveals the mover's own dark piece or captures an opponent's dark piece. */
export function isJieqiChanceMove(state: JieqiGameState, move: JieqiMove): boolean {
  const source = state.board[move.from];
  const target = state.board[move.to];
  return (
    source?.faceDown === true ||
    (target?.faceDown === true && source != null && target.color !== source.color)
  );
}

/**
 * The 1-based plies whose move carried NO hidden information at all — the mover's piece was
 * already face-up AND it did not capture a face-down piece. Only these plies can be checked
 * for parent/child consistency (reconcileJieqiSeries), because only these have a value the
 * parent search could see in full. Since face-down captures became chance plies (2026-10-07)
 * this is exactly the complement of jieqiChancePlies; it stays a separate replay so the
 * consistency rule never silently widens if the chance set is ever narrowed again.
 */
export function jieqiDeterministicPlies(moves: readonly JieqiMove[], deal: JieqiDeal): number[] {
  let state = createInitialJieqiState('analysis', deal);
  const plies: number[] = [];
  moves.forEach((move, i) => {
    const source = state.board[move.from];
    const target = state.board[move.to];
    if (!source?.faceDown && !target?.faceDown) plies.push(i + 1);
    state = applyJieqiMove(state, move);
  });
  return plies;
}

// ── Cache-first, coalesced resolution (mirrors resolveBanqiAnalysis) ──────────────

// Cache read/write, injectable for tests. Live impl reads/writes the variant-agnostic
// game_analysis table (no-ops when persistence is disabled).
export type JieqiAnalysisCache = {
  get(roomId: string, engineId: string, depth: number): Promise<SweepPlyEval[] | null>;
  save(roomId: string, engineId: string, depth: number, plies: SweepPlyEval[]): Promise<void>;
};

const liveAnalysisCache: JieqiAnalysisCache = {
  get: (roomId, engineId, depth) => persistence.getGameAnalysis(roomId, engineId, depth),
  save: (roomId, engineId, depth, plies) =>
    persistence.saveGameAnalysis(roomId, engineId, depth, plies),
};

/**
 * Cache-first, coalesced whole-game analysis (shared skeleton: game-analysis-kernel).
 * A finished game's eval series is immutable given (room, engine, depth): serve a stored
 * result immediately, else compute once (sharing one in-flight promise), persist it, and
 * return. `computeIfMissing = false` makes it a pure cache read (204-on-miss for the GET
 * path). A scoreless (all-null) sweep throws VacuousAnalysisError and is never cached, so
 * a fixed engine can recompute later; the route maps it to 503 analysis_engine_unavailable.
 */
export async function resolveJieqiAnalysis(
  roomId: string,
  moves: readonly JieqiMove[],
  deal: JieqiDeal,
  cache: JieqiAnalysisCache = liveAnalysisCache,
  analyze?: (moves: readonly JieqiMove[], deal: JieqiDeal) => Promise<JieqiGameAnalysis>,
  computeIfMissing = true,
  profile: JieqiAnalysisProfile = currentJieqiAnalysisProfile(),
): Promise<JieqiGameAnalysis | null> {
  const engineId = profile.analysisEngineId;
  const depth = JIEQI_ANALYSIS_DEPTH;
  // A game analysed by the other engine keeps that analysis, under its own id, rather
  // than being recomputed: its cp are only meaningful on that engine's curve, and the id
  // travels with the plies so the client picks the right one.
  const stored = await firstStoredResult(
    cache,
    roomId,
    depth,
    jieqiStoredIdsFor(profile, 'analysisEngineId'),
  );
  if (stored) return { engineId: stored.engineId, depth, plies: stored.value };
  // Incremental checkpoints only on the real (default-analyzer) path; injected
  // analyzers (tests) keep the plain contract.
  const progress = analyze
    ? null
    : liveAnalysisProgressStore<SweepPlyEval>(roomId, engineId, depth);
  const plies = await resolveCachedComputation<SweepPlyEval[]>({
    roomId,
    engineId,
    depth,
    cache,
    computeIfMissing,
    compute: async () => {
      const analysis = analyze
        ? await analyze(moves, deal)
        : await analyzeJieqiPostgame(moves, deal, undefined, progress ?? undefined, profile);
      return analysis.plies;
    },
    validate: (series) => {
      if (isVacuousAnalysis(series)) throw new VacuousAnalysisError('jieqi');
    },
    afterSave: progress ? () => progress.clear() : undefined,
  });
  return plies ? { engineId, depth, plies } : null;
}

// ── Decision-vs-luck decomposition (Layer 2) ──────────────────────────────────────
//
// A jieqi REVEAL move bundles a decision (which dark piece to activate, and where) with a dice
// roll (what it reveals to); a FACE-DOWN CAPTURE bundles the decision to take with a roll on
// what was taken. Every such ply (jieqiChancePlies) gets a row here. Grading the whole eval swing blames the player for variance. We
// split it into two honest, non-god-view numbers per reveal ply, everything in WIN% (mover POV):
//
//   playedWin = the TRUE pool-mean EV of the played move — the win% you'd expect AVERAGING over
//               every piece that dark piece could have been. This is the decision, before the dice.
//   bestWin   = the same true pool-mean EV for the best available move — the decision ceiling.
//   realized  = the win% the reveal ACTUALLY produced (the actual role's term of that same mean).
//
//   decision loss = bestWin − playedWin   (skill; >= 0)
//   luck          = realized − playedWin   (variance; signed, 0 = the average piece in the bag)
//
// Why the TRUE pool-mean and not the engine's own EV: Pikafish's chance-node value has a
// downside/pessimism clamp (risk-averse play — it deliberately reports below the true mean so the
// search never leans on a lucky reveal). Great for strength, wrong for measuring luck: it would
// make "0" pessimistic, so an average reveal reads as positive luck. So we compute the baseline
// ourselves as an explicit, UNCLAMPED probability-weighted mean over the mover's remaining hidden
// pool — then 0 luck is exactly "the average outcome". realized is one term of that same mean, so
// luck is a clean, same-search, mean-zero-in-expectation quantity (no cross-depth noise).

// Budget (PikaJieQi; AB-JChess budgets nodes, see ABJCHESS_DECISION_NODES). Each candidate
// move's baseline is a small fan of single-position evals (one per distinct hidden role), all at
// this depth so realized and the mean share one search. MultiPV only picks the candidate ceiling
// moves; its clamped scores never reach the output. ~ a few evals per reveal → a couple of
// minutes for a whole game, one-time and cached.
export const JIEQI_DECISION_DEPTH = 16;
const JIEQI_DECISION_MOVETIME_CAP_MS = 6_000;
// One: every decisions eval runs on the run's single analysis session, which answers one
// `go` at a time, so a wider fan-out would only queue inside the session.
const JIEQI_DECISION_EVAL_CONCURRENCY = 1;
const JIEQI_DECISION_MULTIPV = 12;
// How many of the engine's top moves to true-baseline as the decision ceiling (plus the played
// move). The engine's own ranking is unreliable under the clamp, so we re-score a few and take the
// max true-mean rather than trusting rank 1.
const JIEQI_DECISION_CANDIDATES = 3;

/** One chance ply's (a reveal or a face-down capture) decision-vs-luck numbers, all in WIN% from
 *  the MOVER's POV. */
export type JieqiDecision = {
  /** The chance ply (1-based): move index i lands on ply i+1. */
  ply: number;
  mover: JieqiColor;
  /** True pool-mean EV (win%) of the best available move — the decision ceiling. */
  bestWin: number;
  /** True pool-mean EV (win%) of the move actually played — the decision, before the dice. */
  playedWin: number;
  /** Win% the reveal ACTUALLY produced (the actual role's term of the played move's mean). */
  realizedWin: number;
  /** Rank of the played move among the candidates by true baseline (1 = it WAS the best). */
  playedRank: number | null;
  /** The candidates that were true-baselined, best first. Every one of these was already
   *  computed to derive bestWin and playedRank — they used to be thrown away, which left the
   *  review page able to say "you ranked 3rd" without being able to say what the first two
   *  were. Absent on rows cached before this existed; the UI degrades to the rank alone. */
  candidates?: JieqiDecisionCandidate[];
};

/** One true-baselined alternative at a reveal ply, in the same WIN% units as bestWin. */
export type JieqiDecisionCandidate = {
  /** Engine UCI of the candidate's root move. */
  move: string;
  /** True pool-mean EV (win%) of this move, mover POV — luck stripped. */
  win: number;
  /** True when this is the move actually played. */
  played?: boolean;
};

export type JieqiDecisionDeps = {
  /** Top candidate moves (engine ranking) for a pre-move FEN — used only to pick which moves to
   *  true-baseline as the ceiling; the returned scores are not used in the output. */
  multiPv: (fen: string, repetitionWindow?: JieqiRepetitionWindow) => Promise<UciMultiPvLine[]>;
  /** Single-position eval (side-to-move POV) at decision depth — the pool-mean's per-role term. */
  evalPosition: (
    fen: string,
    repetitionWindow?: JieqiRepetitionWindow,
  ) => Promise<{ cp: number | null; mate: number | null }>;
};

/** Decision deps over one analysis session. Every search starts on a cleared hash
 *  (`fresh`), so each number depends only on its own position and budget: the same
 *  contract the old process-per-eval path had, without reloading the engine (and, for
 *  AB-JChess, its 133 MB net) several hundred times per game. */
export function jieqiDecisionDepsFromSession(
  session: JieqiAnalysisEvaluators,
  profile: JieqiAnalysisProfile,
): JieqiDecisionDeps {
  return {
    multiPv: (fen, repetitionWindow) =>
      session.multiPv(repetitionWindow?.fen ?? fen, {
        ...profile.decisionMultiPv,
        multiPv: JIEQI_DECISION_MULTIPV,
        moves: repetitionWindow?.moves,
        fresh: true,
      }),
    evalPosition: (fen, repetitionWindow) =>
      session
        .evaluateFen(repetitionWindow?.fen ?? fen, {
          ...profile.decisionEval,
          moves: repetitionWindow?.moves,
          fresh: true,
        })
        .then((e) => ({ cp: e.cp, mate: e.mate })),
  };
}

// The decisions layer keeps its repetition window as the anchor STATE (the position after the
// last irreversible move) plus the reversible moves since, and renders the anchor's FEN per
// reveal for that reveal's mover: the anchor's pool depends on who is reading it (see
// gradingFen). The moves after the anchor capture nothing, so rendering the anchor for a viewer
// is exactly that viewer's view of the window.
type JieqiDecisionWindow = {
  anchor: JieqiGameState;
  moves: readonly string[];
};

function jieqiDecisionWindowAfterMove(
  state: JieqiGameState,
  move: JieqiMove,
  post: JieqiGameState,
  repWindow: JieqiDecisionWindow,
): JieqiDecisionWindow {
  const irreversible = state.board[move.from]?.faceDown === true || state.board[move.to] != null;
  return irreversible
    ? { anchor: post, moves: [] }
    : { anchor: repWindow.anchor, moves: [...repWindow.moves, jieqiMoveToPikafishUci(move)] };
}

// A reveal is graded on what its MOVER could know (#487). Under capturer-only reveal a player
// never learns the identity of its own dark pieces the opponent took, so `viewer: mover` keeps
// those in the mover's hidden pool, exactly as the live bot sees its own (server-jieqi-engine).
// The opponent's pool stays exact: the mover captured those pieces and saw them.
function gradingFen(state: JieqiGameState, mover: JieqiColor): string {
  return jieqiStateToPikafishFen(state, { viewer: mover });
}

function renderDecisionWindow(
  repWindow: JieqiDecisionWindow,
  mover: JieqiColor,
): JieqiRepetitionWindow {
  return { fen: gradingFen(repWindow.anchor, mover), moves: repWindow.moves };
}

// Win% for a POST-move position from the MOVER's POV. Terminal positions score directly (no
// engine); otherwise the position has the OPPONENT to move, so the engine's side-to-move score is
// the opponent's — negate it for the mover.
async function moverWinAfter(
  post: JieqiGameState,
  mover: JieqiColor,
  evalPosition: JieqiDecisionDeps['evalPosition'],
  repWindow: JieqiDecisionWindow,
  winK: number,
): Promise<number> {
  if (post.status.type === 'finished') {
    const winner = post.status.winner;
    return winner === mover ? 100 : winner === null ? 50 : 0;
  }
  const { cp, mate } = await evalPosition(
    gradingFen(post, mover),
    renderDecisionWindow(repWindow, mover),
  );
  // The engine's own curve: AB-JChess cp mean more win% than PikaJieQi cp.
  return winPercent(cp == null ? null : -cp, mate == null ? null : -mate, winK);
}

// The identities the MOVER believes one of its dark squares may hold (#487): its dark tiles on
// the board plus its own pieces the opponent captured while still dark, which it never saw. That
// is the pool gradingFen gives the engine for the mover, so the weights and the positions agree.
// Exported for the test that pins the review's luck card (apps/web jieqi-luck-mark.ts, which
// mirrors both pools) to the same counts.
export function believedMoverPool(
  state: JieqiGameState,
  mover: JieqiColor,
): Map<JieqiPieceRole, number> {
  const pool = new Map<JieqiPieceRole, number>();
  for (const piece of Object.values(state.board)) {
    if (piece?.color === mover && piece.faceDown) bumpRole(pool, piece.role);
  }
  for (const capture of state.captures) {
    if (capture.owner === mover && !capture.revealedAtCapture) bumpRole(pool, capture.role);
  }
  return pool;
}

// The identities a CAPTURER believes one of its opponent's dark squares may hold: the victim's
// face-down pieces still on the board. Under capturer-only reveal the capturer saw every victim
// piece it took (dark or not) and every one the victim revealed by moving, so the victim's dealt
// set minus everything seen is exactly this on-board multiset: no more, no less.
export function victimDarkPool(
  state: JieqiGameState,
  victim: JieqiColor,
): Map<JieqiPieceRole, number> {
  const pool = new Map<JieqiPieceRole, number>();
  for (const piece of Object.values(state.board)) {
    if (piece?.color === victim && piece.faceDown) bumpRole(pool, piece.role);
  }
  return pool;
}

function bumpRole(pool: Map<JieqiPieceRole, number>, role: JieqiPieceRole): void {
  pool.set(role, (pool.get(role) ?? 0) + 1);
}

// Counterfactual: the dark piece of `color` on `square` is `role` instead of its true role, with
// that colour's hidden-role MULTISET held fixed. Relabeling the square ALONE would add a phantom
// `role` and drop a real one, skewing every pool count the FEN carries; so the true role moves to
// a donor that held `role`: another dark tile of that colour, else (the mover's own pool only) one
// of its pieces captured face-down, a role it believes possible though no tile holds it. Donors
// are looked up on the ORIGINAL `state`, so a reveal's swap and a capture's swap (two colours,
// disjoint tiles) compose without seeing each other.
function relabelDarkSquare(
  cf: JieqiGameState,
  state: JieqiGameState,
  square: JieqiMove['from'],
  role: JieqiPieceRole,
): JieqiGameState {
  const truth = state.board[square];
  if (!truth?.faceDown) return cf;
  const color = truth.color;
  const next: JieqiGameState = {
    ...cf,
    board: { ...cf.board, [square]: { color, role, faceDown: true } },
  };
  if (role === truth.role) return next;
  const donor = (Object.keys(state.board) as (keyof typeof state.board)[]).find(
    (sq) =>
      sq !== square &&
      state.board[sq]?.faceDown === true &&
      state.board[sq]?.color === color &&
      state.board[sq]?.role === role,
  );
  if (donor) {
    next.board[donor] = { color, role: truth.role, faceDown: true };
    return next;
  }
  const captured = cf.captures.findIndex(
    (c) => c.owner === color && !c.revealedAtCapture && c.role === role,
  );
  if (captured >= 0) {
    next.captures = cf.captures.map((c, idx) =>
      idx === captured ? { ...c, role: truth.role } : c,
    );
  }
  return next;
}

// The TRUE pool-mean baseline (win%, mover POV) of `move` from a pre-move `state`, plus the
// realized win% (the true identities' term). Two hidden identities can be in play, and the mover
// knows neither when it chooses:
//
//   - a REVEAL: the moved dark square is one of the identities the mover believes it may hold
//     (believedMoverPool, #487);
//   - a FACE-DOWN CAPTURE: the taken square is one of the victim's dark pieces still on the board
//     (victimDarkPool), whatever it turns out to be.
//
// A move that is neither has one term, so baseline === realized === a single eval. Grading a
// capture on the identity it actually hit is hindsight: it marked the capture of a dark soldier
// and spared the same capture of a dark chariot, when the mover could not tell them apart. The
// same goes for an UNPLAYED candidate that captures a dark piece, which is why every candidate
// runs through here: valued on its true target, "best" absorbed the luck of whatever it would
// have hit.
//
// A move that is both averages over the PRODUCT of the two pools. That is exact, not an
// approximation: given what the mover knows, its own bag and its opponent's are independent
// draws, so the joint weight is the product of the marginals. It costs at most 6 x 6 = 36 evals
// for one candidate (six hideable roles a side), and only while both bags are still full.
async function poolMeanWin(
  state: JieqiGameState,
  move: JieqiMove,
  mover: JieqiColor,
  evalPosition: JieqiDecisionDeps['evalPosition'],
  repWindow: JieqiDecisionWindow,
  winK: number,
): Promise<{ baseline: number; realized: number }> {
  const source = state.board[move.from];
  const target = state.board[move.to];
  const victim: JieqiColor = mover === 'red' ? 'black' : 'red';
  const moverPool = source?.faceDown ? believedMoverPool(state, mover) : null;
  const victimPool =
    target?.faceDown && target.color === victim ? victimDarkPool(state, victim) : null;
  type Term = { sourceRole: JieqiPieceRole | null; targetRole: JieqiPieceRole | null };
  const terms: Term[] = [];
  for (const sourceRole of moverPool ? [...moverPool.keys()] : [null]) {
    for (const targetRole of victimPool ? [...victimPool.keys()] : [null]) {
      terms.push({ sourceRole, targetRole });
    }
  }
  // Bounded fan-out (mirrors banqi), width 1: every eval goes to the one session this decisions
  // run holds, which answers one search at a time anyway.
  const wins = await mapWithConcurrency(
    terms,
    JIEQI_DECISION_EVAL_CONCURRENCY,
    ({ sourceRole, targetRole }) => {
      let cf = state;
      if (sourceRole) cf = relabelDarkSquare(cf, state, move.from, sourceRole);
      if (targetRole) cf = relabelDarkSquare(cf, state, move.to, targetRole);
      const post = applyJieqiMove(cf, move);
      return moverWinAfter(
        post,
        mover,
        evalPosition,
        jieqiDecisionWindowAfterMove(cf, move, post, repWindow),
        winK,
      );
    },
  );
  const share = (pool: Map<JieqiPieceRole, number> | null, role: JieqiPieceRole | null) => {
    if (!pool || !role) return 1;
    const total = [...pool.values()].reduce((a, b) => a + b, 0);
    return (pool.get(role) ?? 0) / total;
  };
  let baseline = 0;
  let realized = 50;
  terms.forEach(({ sourceRole, targetRole }, idx) => {
    baseline += share(moverPool, sourceRole) * share(victimPool, targetRole) * wins[idx]!;
    const trueSource = !sourceRole || sourceRole === source?.role;
    const trueTarget = !targetRole || targetRole === target?.role;
    if (trueSource && trueTarget) realized = wins[idx]!;
  });
  return { baseline, realized };
}

/**
 * Compute the decision-vs-luck numbers for every CHANCE ply (a reveal or a face-down capture,
 * jieqiChancePlies). Reconstructs the game from the deal (same kernel as the Layer-1 sweep). For
 * each, MultiPV names a few candidate ceiling moves; we true-baseline the played move plus those
 * candidates (unclamped pool-mean win% over every hidden identity the move touches, poolMeanWin),
 * take the max as `bestWin`, and read the played move's true-identity term as `realizedWin`. `deps` is
 * injectable so tests drive it without an engine. No dependency on the Layer-1 sweep — realized is
 * computed here, same-search as the mean it is compared against.
 *
 * Every position a reveal is graded on (the MultiPV table, each candidate's terms, the played
 * move's and its realized term, and their repetition windows) is encoded from the MOVER's view
 * (gradingFen, #487): a player's dark pieces captured face-down stay in its own pool, because it
 * never saw them, and the pool mean averages over that same believed pool (poolMeanWin).
 * Plies that resolve no hidden identity are not graded here: the review judges them off the
 * Layer-1 sweep, which stays all-knowing (no viewer) because a spectator reads the chart after
 * the game.
 */
export async function analyzeJieqiDecisions(
  moves: readonly JieqiMove[],
  deal: JieqiDeal,
  deps?: JieqiDecisionDeps,
  progress?: AnalysisProgressStore<JieqiDecision>,
  profile: JieqiAnalysisProfile = currentJieqiAnalysisProfile(),
): Promise<JieqiDecision[]> {
  if (!deps) {
    // The live path: one analysis session for the whole decomposition.
    return withJieqiAnalysisSession(
      (evaluateFen, multiPv) =>
        analyzeJieqiDecisions(
          moves,
          deal,
          jieqiDecisionDepsFromSession({ evaluateFen, multiPv }, profile),
          progress,
          profile,
        ),
      profile.engine,
    );
  }
  let state = createInitialJieqiState('analysis', deal);
  let repWindow: JieqiDecisionWindow = { anchor: state, moves: [] };
  // With a progress store, checkpoint after every graded chance ply and resume from
  // the saved move cursor (quiet moves before it just re-advance the state —
  // kernel replay is free; the engine fan-outs are what we refuse to redo).
  const resumed = progress ? await progress.load() : null;
  const decisions: JieqiDecision[] = resumed ? [...resumed.items] : [];
  const startIndex = resumed?.nextIndex ?? 0;
  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i]!;
    if (i < startIndex) {
      const post = applyJieqiMove(state, move);
      repWindow = jieqiDecisionWindowAfterMove(state, move, post, repWindow);
      state = post;
      continue;
    }
    const mover: JieqiColor = state.status.type === 'playing' ? state.status.turn : 'red';
    if (state.status.type === 'playing' && isJieqiChanceMove(state, move)) {
      const fen = gradingFen(state, mover);
      const playedUci = jieqiMoveToPikafishUci(move);
      const table = await deps.multiPv(fen, renderDecisionWindow(repWindow, mover));
      // Candidate ceiling moves: the engine's top-N plus the played move (deduped).
      const candidateUcis = new Set<string>([
        ...table.slice(0, JIEQI_DECISION_CANDIDATES).map((row) => row.move),
        playedUci,
      ]);
      let playedWin = 50;
      let realizedWin = 50;
      const scored: JieqiDecisionCandidate[] = [];
      for (const uci of candidateUcis) {
        const candidate = uci === playedUci ? move : pikafishUciToJieqiMove(uci);
        if (!candidate) continue;
        const { baseline, realized } = await poolMeanWin(
          state,
          candidate,
          mover,
          deps.evalPosition,
          repWindow,
          profile.winK,
        );
        scored.push({ move: uci, win: baseline, ...(uci === playedUci ? { played: true } : {}) });
        if (uci === playedUci) {
          playedWin = baseline;
          realizedWin = realized;
        }
      }
      const baselines = scored.map((c) => c.win);
      const bestWin = baselines.length ? Math.max(...baselines) : playedWin;
      // Rank by true baseline: 1 + how many candidates strictly beat the played move.
      const playedRank = 1 + baselines.filter((b) => b > playedWin + 1e-9).length;
      const candidates = [...scored].sort((a, b) => b.win - a.win);
      decisions.push({
        ply: i + 1,
        mover,
        bestWin,
        playedWin,
        realizedWin,
        playedRank,
        ...(candidates.length ? { candidates } : {}),
      });
      if (progress) await progress.save({ nextIndex: i + 1, items: decisions });
    }
    const post = applyJieqiMove(state, move);
    repWindow = jieqiDecisionWindowAfterMove(state, move, post, repWindow);
    state = post;
  }
  return decisions;
}

// Cache engine id for the decomposition blob — a DIFFERENT engine_id than the basic analysis, so
// both live in the same game_analysis table without collision (see persistence-game-analysis).
// The `+dN` suffix versions the DECOMPOSITION ALGORITHM independently of the engine binary: bump it
// to invalidate cached decisions when the algorithm changes without an engine change. d5 grades
// face-down captures (played and candidate) on the capturer's pool mean, not the identity hit;
// d4 grades each reveal from its mover's view (#487); d3 added the live repetition window; d2
// fixed counterfactual hidden-role-multiset preservation.
export const JIEQI_DECISIONS_ENGINE_ID = `pikafish-jieqi-decisions@${JIEQI_ANALYSIS_ENGINE_VERSION}+${PIKAFISH_JIEQI_ENGINE_REF}+d5-capture`;
export const ABJCHESS_JIEQI_DECISIONS_ENGINE_ID = `ab-jchess-jieqi-decisions@2+${ABJCHESS_ENGINE_REF}+${ABJCHESS_NET_TAG}+nodes${ABJCHESS_DECISION_NODES}+mpv${ABJCHESS_DECISION_MULTIPV_NODES}+d5-capture`;
/** Decisions ids of earlier algorithms, newest first. Never computed again, but rows stored
 *  under them are still served, after every current id, so a game analysed before a re-key
 *  keeps its decomposition instead of recomputing on the shared prod lane. Such a row is STALE
 *  and identifiable by its id: a d4 row has no entries for face-down captures (the review
 *  leaves them ungraded) and values candidate captures on their true target. The regrade path
 *  (resolveJieqiDecisions with servePreviousAlgorithms: false, scripts/backfill-jieqi-analysis.mjs
 *  --regrade-decisions) recomputes those games under the current ids. */
export const JIEQI_LEGACY_DECISIONS_ENGINE_IDS: readonly string[] = [
  `ab-jchess-jieqi-decisions@2+${ABJCHESS_ENGINE_REF}+${ABJCHESS_NET_TAG}+nodes${ABJCHESS_DECISION_NODES}+mpv${ABJCHESS_DECISION_MULTIPV_NODES}+d4-mover`,
  `pikafish-jieqi-decisions@${JIEQI_ANALYSIS_ENGINE_VERSION}+${PIKAFISH_JIEQI_ENGINE_REF}+d4-mover`,
  `ab-jchess-jieqi-decisions@1+${ABJCHESS_ENGINE_REF}+${ABJCHESS_NET_TAG}+nodes${ABJCHESS_DECISION_NODES}+mpv${ABJCHESS_DECISION_MULTIPV_NODES}+d3`,
  `pikafish-jieqi-decisions@${JIEQI_ANALYSIS_ENGINE_VERSION}+${PIKAFISH_JIEQI_ENGINE_REF}+d3`,
];

// ── Engine profiles ───────────────────────────────────────────────────────────────

export const PIKAFISH_JIEQI_ANALYSIS_PROFILE: JieqiAnalysisProfile = {
  engine: 'pikafish-jieqi',
  analysisEngineId: JIEQI_ANALYSIS_ENGINE_ID,
  decisionsEngineId: JIEQI_DECISIONS_ENGINE_ID,
  winK: winPercentK(JIEQI_ANALYSIS_ENGINE_ID),
  sweepNodes: JIEQI_ANALYSIS_NODES,
  researchNodes: JIEQI_CONSISTENCY_RESEARCH_NODES,
  movetimeCapMs: JIEQI_ANALYSIS_MOVETIME_CAP_MS,
  consistency: { unit: 'cp', threshold: JIEQI_CONSISTENCY_THRESHOLD_CP },
  decisionEval: { depth: JIEQI_DECISION_DEPTH, movetimeMs: JIEQI_DECISION_MOVETIME_CAP_MS },
  decisionMultiPv: { depth: JIEQI_DECISION_DEPTH, movetimeMs: JIEQI_DECISION_MOVETIME_CAP_MS },
};

export const ABJCHESS_JIEQI_ANALYSIS_PROFILE: JieqiAnalysisProfile = {
  engine: 'ab-jchess',
  analysisEngineId: ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID,
  decisionsEngineId: ABJCHESS_JIEQI_DECISIONS_ENGINE_ID,
  winK: winPercentK(ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID),
  sweepNodes: ABJCHESS_ANALYSIS_NODES,
  researchNodes: ABJCHESS_CONSISTENCY_RESEARCH_NODES,
  movetimeCapMs: ABJCHESS_ANALYSIS_MOVETIME_CAP_MS,
  consistency: { unit: 'win', threshold: JIEQI_CONSISTENCY_THRESHOLD_WIN },
  decisionEval: { nodes: ABJCHESS_DECISION_NODES, movetimeMs: ABJCHESS_ANALYSIS_MOVETIME_CAP_MS },
  decisionMultiPv: {
    nodes: ABJCHESS_DECISION_MULTIPV_NODES,
    movetimeMs: ABJCHESS_ANALYSIS_MOVETIME_CAP_MS,
  },
};

const JIEQI_ANALYSIS_PROFILES: readonly JieqiAnalysisProfile[] = [
  ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  PIKAFISH_JIEQI_ANALYSIS_PROFILE,
];

export function jieqiAnalysisProfileFor(engine: JieqiAnalysisEngine): JieqiAnalysisProfile {
  return engine === 'ab-jchess' ? ABJCHESS_JIEQI_ANALYSIS_PROFILE : PIKAFISH_JIEQI_ANALYSIS_PROFILE;
}

/** The profile NEW analysis is computed with: AB-JChess when it resolves, else PikaJieQi. */
export function currentJieqiAnalysisProfile(): JieqiAnalysisProfile {
  return jieqiAnalysisProfileFor(jieqiAnalysisEngine());
}

/** The ids a read may serve, in preference order: the computing engine's own first, then
 *  every other engine's, then (decisions only, unless `previousAlgorithms` is false) the
 *  pre-re-key ids, so no existing row is ever orphaned. */
export function jieqiStoredIdsFor(
  profile: JieqiAnalysisProfile,
  key: 'analysisEngineId' | 'decisionsEngineId',
  previousAlgorithms = true,
): string[] {
  return [
    profile[key],
    ...JIEQI_ANALYSIS_PROFILES.filter((p) => p !== profile).map((p) => p[key]),
    ...(key === 'decisionsEngineId' && previousAlgorithms ? JIEQI_LEGACY_DECISIONS_ENGINE_IDS : []),
  ];
}

async function firstStoredResult<T>(
  cache: { get(roomId: string, engineId: string, depth: number): Promise<T | null> },
  roomId: string,
  depth: number,
  engineIds: readonly string[],
): Promise<{ engineId: string; value: T } | null> {
  for (const engineId of engineIds) {
    const value = await cache.get(roomId, engineId, depth);
    if (value) return { engineId, value };
  }
  return null;
}

export type JieqiDecisionsCache = {
  get(roomId: string, engineId: string, depth: number): Promise<JieqiDecision[] | null>;
  save(roomId: string, engineId: string, depth: number, decisions: JieqiDecision[]): Promise<void>;
};

const liveDecisionsCache: JieqiDecisionsCache = {
  get: (roomId, engineId, depth) =>
    persistence.getGameAnalysisBlob<JieqiDecision[]>(roomId, engineId, depth),
  save: (roomId, engineId, depth, decisions) =>
    persistence.saveGameAnalysisBlob(roomId, engineId, depth, decisions),
};

export type JieqiDecisionsResult = { engineId: string; depth: number; decisions: JieqiDecision[] };

/**
 * Cache-first, coalesced decision-vs-luck decomposition (the heavier, opt-in tier on top of the
 * basic eval sweep; shared skeleton: game-analysis-kernel). Self-contained — it recomputes
 * realized in the same search as the mean it is compared against, so it needs no Layer-1 sweep
 * input. A scoreless decomposition (reveals exist but every win% is the null-eval 50/50) fails
 * closed like the basic sweep: throws, caches nothing; the route maps it to 503. A game with no
 * chance plies caches an empty array (a valid, terminal result).
 */
export async function resolveJieqiDecisions(
  roomId: string,
  moves: readonly JieqiMove[],
  deal: JieqiDeal,
  cache: JieqiDecisionsCache = liveDecisionsCache,
  analyze?: (moves: readonly JieqiMove[], deal: JieqiDeal) => Promise<JieqiDecision[]>,
  computeIfMissing = true,
  profile: JieqiAnalysisProfile = currentJieqiAnalysisProfile(),
  options: {
    /** False for a REGRADE: a row stored by an earlier decomposition algorithm (a legacy id)
     *  no longer counts as a hit, so the game recomputes under the current id. */
    servePreviousAlgorithms?: boolean;
  } = {},
): Promise<JieqiDecisionsResult | null> {
  const engineId = profile.decisionsEngineId;
  const depth = JIEQI_DECISION_DEPTH;
  // Decisions are stored in win%, already on their engine's curve, so either engine's
  // blob reads correctly; serve whichever exists before computing.
  const stored = await firstStoredResult(
    cache,
    roomId,
    depth,
    jieqiStoredIdsFor(profile, 'decisionsEngineId', options.servePreviousAlgorithms ?? true),
  );
  if (stored) return { engineId: stored.engineId, depth, decisions: stored.value };
  const progress = analyze
    ? null
    : liveAnalysisProgressStore<JieqiDecision>(roomId, engineId, depth);
  const decisions = await resolveCachedComputation<JieqiDecision[]>({
    roomId,
    engineId,
    depth,
    cache,
    computeIfMissing,
    compute: () =>
      analyze
        ? analyze(moves, deal)
        : analyzeJieqiDecisions(moves, deal, undefined, progress ?? undefined, profile),
    validate: (series) => {
      // A scoreless engine makes every position eval null, so every win% collapses to 50
      // (best === played === realized). Never cache that; a fixed engine recomputes.
      if (
        series.length > 0 &&
        series.every((d) => d.bestWin === 50 && d.playedWin === 50 && d.realizedWin === 50)
      ) {
        throw new VacuousAnalysisError('jieqi');
      }
    },
    afterSave: progress ? () => progress.clear() : undefined,
  });
  return decisions ? { engineId, depth, decisions } : null;
}
