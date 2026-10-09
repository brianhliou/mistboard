// Whole-game "Computer analysis" for Banqi (半棋): a fixed-strength eval of every ply,
// normalized to the RED SEAT's POV, cached + coalesced. Mirrors jungle-analysis.ts, with
// one banqi-specific wrinkle: banqi hides face-down tile IDENTITIES, so reconstruction
// needs the per-game DEAL (from the room-created event) to rebuild each position, and the
// engine is fed the REDACTED (as-played info-state) FEN — banqi-fen.ts emits `X` for a
// face-down tile, so the engine never learns a hidden id, exactly as during live play.
//
// The backend is the MistyBanqi Rust binary ONLY (no in-process fallback): we read its
// `info … score` via evaluateBanqiFenNodes. A missing binary fails closed at the route
// (503), and an all-null sweep throws VacuousAnalysisError (never cached) — so a broken or
// score-less engine can't cache a flat, mistake-free game.

import {
  applyBanqiMove,
  type BanqiColor,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPieceRole,
  type BanqiSeat,
  type BanqiStoredSetup,
  createBanqiStateFromSetup,
  winPercent,
} from '@mistboard/game';
import { BANQI_ENGINE_VERSION, evaluateBanqiFenNodes } from './banqi-engine.js';
import { banqiMoveToEngineUci, banqiStateToEngineFen, engineUciToBanqiMove } from './banqi-fen.js';
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
import * as persistence from './persistence.js';

// Search budget. Node budget = CPU-independent strength, so the eval is reproducible across
// boxes (stable cache) and bounded in time and memory (an analysis sweep can't run away).
const BANQI_ANALYSIS_NODES = 500_000;
const BANQI_ANALYSIS_MOVETIME_CAP_MS = 4_000;

// Nominal cache dimension: `depth` only has to be STABLE for the (room, engine, depth) cache
// key (banqi's real dial is nodes, encoded in the engine id). Kept at the family default.
export const BANQI_ANALYSIS_DEPTH = 12;

// Red-SEAT-POV cp for a decisive finished position (no engine query is made there).
const TERMINAL_CP = 30_000;

// The history suffix invalidates earlier FEN-only cached sweeps.
export const BANQI_ANALYSIS_ENGINE_ID = `misty-banqi-analysis@${BANQI_ENGINE_VERSION}+history1`;

export type BanqiRepetitionWindow = {
  fen: string;
  moves: readonly string[];
};

export type BanqiPositionEval = {
  /** Centipawns from the RED SEAT's POV (positive = Red better); null when mate is set. */
  cp: number | null;
  /** Signed moves-to-mate from the RED SEAT's POV; null otherwise. */
  mate: number | null;
  /** Best move in engine UCI ("a0b0", flip "a0a0"); already our coords. */
  best: string | null;
};

/**
 * Evaluate a single PLAYING banqi position with the MistyBanqi engine, normalized to the
 * RED SEAT's POV. The engine reports the score from the side-to-move POV, and side-to-move
 * IS the mover seat (the FEN's ink turn field just encodes that seat), so we flip the sign
 * when Black is to move — exactly as jungle does. Throws (via banqiEnginePath) when the
 * binary is absent; callers pre-check availability and fail closed.
 */
export async function evaluateBanqiPosition(
  state: BanqiGameState,
  repetitionWindow: BanqiRepetitionWindow = {
    fen: banqiStateToEngineFen(state),
    moves: [],
  },
): Promise<BanqiPositionEval> {
  const mover: BanqiSeat = state.status.type === 'playing' ? state.status.turn : 'red';
  const sign = mover === 'red' ? 1 : -1;
  const evaluation = await evaluateBanqiFenNodes(repetitionWindow.fen, {
    nodes: BANQI_ANALYSIS_NODES,
    movetimeCapMs: BANQI_ANALYSIS_MOVETIME_CAP_MS,
    moves: repetitionWindow.moves,
  });
  return {
    cp: evaluation.cp == null ? null : evaluation.cp * sign,
    mate: evaluation.mate == null ? null : evaluation.mate * sign,
    best: evaluation.best,
  };
}

// Red-SEAT-POV decisive eval for a finished position: the game is over, so the winner seat
// is known and no engine is queried. `winner` is a SEAT (red = first mover), so this is
// already in the red-seat POV the sweep normalizes to.
function terminalPlyEval(ply: number, state: BanqiGameState): SweepPlyEval {
  if (state.status.type !== 'finished') return { ply, cp: 0, mate: null, best: null };
  const winner = state.status.winner;
  const cp = winner === 'red' ? TERMINAL_CP : winner === 'black' ? -TERMINAL_CP : 0;
  return { ply, cp, mate: null, best: null };
}

export type BanqiGameAnalysis = {
  engineId: string;
  depth: number;
  plies: SweepPlyEval[];
};

export function banqiAnalysisRepetitionWindow(
  states: readonly BanqiGameState[],
  moves: readonly BanqiMove[],
  ply: number,
): BanqiRepetitionWindow {
  const state = states[ply];
  if (!state) throw new Error(`missing Banqi analysis state at ply ${ply}`);
  const startPly = Math.max(0, ply - state.noProgressClock);
  const startState = states[startPly];
  if (!startState) throw new Error(`missing Banqi repetition-window state at ply ${startPly}`);
  return {
    fen: banqiStateToEngineFen(startState),
    moves: moves.slice(startPly, ply).map(banqiMoveToEngineUci),
  };
}

/**
 * Reconstruct every ply from the per-game DEAL + move list and evaluate it (red-seat POV).
 * Ply 0 is the initial position; ply k is the position after k moves. Reconstruction uses
 * the SAME kernel and rules the live game did (createBanqiStateFromSetup + applyBanqiMove), so
 * flip-reveals reproduce exactly (a flip is a move with from === to, revealing the deal's
 * tile deterministically). `evaluate` is injectable so tests drive the sweep without an
 * engine.
 */
export async function analyzeBanqiPostgame(
  moves: readonly BanqiMove[],
  setup: BanqiStoredSetup,
  evaluate: (
    state: BanqiGameState,
    repetitionWindow?: BanqiRepetitionWindow,
  ) => Promise<BanqiPositionEval> = evaluateBanqiPosition,
  progress?: AnalysisProgressStore<SweepPlyEval>,
): Promise<BanqiGameAnalysis> {
  let state = createBanqiStateFromSetup('analysis', setup);
  const states: BanqiGameState[] = [state];
  for (const move of moves) {
    state = applyBanqiMove(state, move);
    states.push(state);
  }
  // With a progress store the sweep checkpoints after every evaluated ply and
  // resumes from the last checkpoint (persist expensive output incrementally).
  const resumed = progress ? await progress.load() : null;
  const plies: SweepPlyEval[] = resumed ? [...resumed.items] : [];
  for (let ply = plies.length; ply < states.length; ply += 1) {
    const s = states[ply]!;
    if (s.status.type !== 'playing') {
      plies.push(terminalPlyEval(ply, s));
      continue;
    }
    const evaluation = await evaluate(s, banqiAnalysisRepetitionWindow(states, moves, ply));
    plies.push({ ply, cp: evaluation.cp, mate: evaluation.mate, best: evaluation.best });
    if (progress) await progress.save({ nextIndex: ply + 1, items: plies });
  }
  return { engineId: BANQI_ANALYSIS_ENGINE_ID, depth: BANQI_ANALYSIS_DEPTH, plies };
}

// ── Cache-first, coalesced resolution (mirrors resolveJungleAnalysis) ──────────────

// Cache read/write, injectable for tests. Live impl reads/writes the variant-agnostic
// game_analysis table (no-ops when persistence is disabled).
export type BanqiAnalysisCache = {
  get(roomId: string, engineId: string, depth: number): Promise<SweepPlyEval[] | null>;
  save(roomId: string, engineId: string, depth: number, plies: SweepPlyEval[]): Promise<void>;
};

const liveAnalysisCache: BanqiAnalysisCache = {
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
export async function resolveBanqiAnalysis(
  roomId: string,
  moves: readonly BanqiMove[],
  setup: BanqiStoredSetup,
  cache: BanqiAnalysisCache = liveAnalysisCache,
  analyze?: (moves: readonly BanqiMove[], setup: BanqiStoredSetup) => Promise<BanqiGameAnalysis>,
  computeIfMissing = true,
): Promise<BanqiGameAnalysis | null> {
  const engineId = BANQI_ANALYSIS_ENGINE_ID;
  const depth = BANQI_ANALYSIS_DEPTH;
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
        ? await analyze(moves, setup)
        : await analyzeBanqiPostgame(moves, setup, undefined, progress ?? undefined);
      return analysis.plies;
    },
    validate: (series) => {
      if (isVacuousAnalysis(series)) throw new VacuousAnalysisError('banqi');
    },
    afterSave: progress ? () => progress.clear() : undefined,
  });
  return plies ? { engineId, depth, plies } : null;
}

// ── Decision-vs-luck decomposition (Layer 2) ──────────────────────────────────────
//
// A banqi FLIP (the self-move from === to) bundles a decision (which tile to turn over) with a
// dice roll (what it reveals to). Grading the whole eval swing blames the player for variance.
// We split it into two honest, non-god-view numbers per flip ply, everything in WIN% (mover POV):
//
//   playedWin = the TRUE pool-mean EV of the played flip — the win% you'd expect AVERAGING over
//               every tile that face-down square could have been. This is the decision, pre-dice.
//   bestWin   = the same true pool-mean EV for the best available move — the decision ceiling.
//   realized  = the win% the flip ACTUALLY produced (the actual tile's term of that same mean).
//
//   decision loss = bestWin − playedWin   (skill; >= 0)
//   luck          = realized − playedWin   (variance; signed, 0 = the average tile in the bag)
//
// The KEY contrast with jieqi: a jieqi reveal draws from the MOVER's own remaining dark pieces
// (one colour, known ink). A banqi tile is hidden from BOTH seats — its colour is unknown too —
// so the pool is EVERY still-face-down tile of EITHER ink, and the counterfactual varies both
// colour and role. At ply 0 the flip also BINDS the first mover's ink; createInitialBanqiState +
// applyBanqiMove handles that per counterfactual, so a red-tile draw and a black-tile draw bind
// opposite inks and the pool-mean averages over "which ink do I get" honestly.
//
// Why the TRUE pool-mean and not the engine's own move eval: a flip engine tends to over/under-
// value its own reveals (jieqi's PikaJieQi over-values them → gambly; #209). Averaging each fixed
// counterfactual ourselves (no chance node → clean per-branch eval → correct pool-average) sidesteps
// that bias, so 0 luck is exactly "the average outcome" and realized is one term of the same mean.

// Search budget. Each candidate's baseline is a small fan of single-position evals (one per distinct
// hidden tile), all at this node budget so realized and the mean share one search. A whole game is a
// couple of minutes, one-time and cached. Lighter than the Layer-1 sweep since a flip fans out.
const BANQI_DECISION_NODES = 250_000;
const BANQI_DECISION_MOVETIME_CAP_MS = 4_000;
// Matches the banqi-analysis engine pool's slot count: with launch concurrency ==
// pool slots, no fan-out eval ever waits in the pool queue (headroom, not shedding).
const BANQI_DECISION_EVAL_CONCURRENCY = 2;

/** One flip ply's decision-vs-luck numbers, all in WIN% from the MOVER's (seat's) POV. */
export type BanqiDecision = {
  /** The flip ply (1-based): move index i lands on ply i+1. */
  ply: number;
  mover: BanqiSeat;
  /** True pool-mean EV (win%) of the best available move — the decision ceiling. */
  bestWin: number;
  /** True pool-mean EV (win%) of the flip actually played — the decision, before the dice. */
  playedWin: number;
  /** Win% the flip ACTUALLY produced (the actual tile's term of the played flip's mean). */
  realizedWin: number;
  /** Rank of the played move among the candidates by true baseline (1 = it WAS the best). */
  playedRank: number | null;
};

export type BanqiDecisionDeps = {
  /** The engine's single best move (UCI) for a pre-move FEN — the ceiling candidate to true-
   *  baseline alongside the played move. Unlike jieqi we use rank-1 only (MistyBanqi is a custom
   *  αβ engine with no verified MultiPV), which makes the ceiling conservative: a better move the
   *  engine ranked #2 is missed, so decision loss is only ever UNDER-reported (never a false flag). */
  bestMove: (fen: string, repetitionWindow?: BanqiRepetitionWindow) => Promise<string | null>;
  /** Single-position eval (side-to-move POV) at decision budget — the pool-mean's per-tile term. */
  evalPosition: (
    fen: string,
    repetitionWindow?: BanqiRepetitionWindow,
  ) => Promise<{ cp: number | null; mate: number | null }>;
};

const liveDecisionDeps: BanqiDecisionDeps = {
  bestMove: (fen, repetitionWindow) =>
    evaluateBanqiFenNodes(repetitionWindow?.fen ?? fen, {
      nodes: BANQI_DECISION_NODES,
      movetimeCapMs: BANQI_DECISION_MOVETIME_CAP_MS,
      moves: repetitionWindow?.moves,
    }).then((e) => e.best),
  evalPosition: (fen, repetitionWindow) =>
    evaluateBanqiFenNodes(repetitionWindow?.fen ?? fen, {
      nodes: BANQI_DECISION_NODES,
      movetimeCapMs: BANQI_DECISION_MOVETIME_CAP_MS,
      moves: repetitionWindow?.moves,
    }).then((e) => ({ cp: e.cp, mate: e.mate })),
};

function banqiRepetitionWindowAfterMove(
  state: BanqiGameState,
  move: BanqiMove,
  post: BanqiGameState,
  repetitionWindow: BanqiRepetitionWindow,
): BanqiRepetitionWindow {
  const irreversible = move.from === move.to || state.board[move.to] != null;
  return irreversible
    ? { fen: banqiStateToEngineFen(post), moves: [] }
    : {
        fen: repetitionWindow.fen,
        moves: [...repetitionWindow.moves, banqiMoveToEngineUci(move)],
      };
}

// Win% for a POST-move position from the MOVER's (seat's) POV. Terminal positions score directly
// (no engine); otherwise the position has the OPPONENT to move, so the engine's side-to-move score
// is the opponent's — negate it for the mover.
async function moverWinAfter(
  post: BanqiGameState,
  mover: BanqiSeat,
  evalPosition: BanqiDecisionDeps['evalPosition'],
  repetitionWindow: BanqiRepetitionWindow,
): Promise<number> {
  if (post.status.type === 'finished') {
    const winner = post.status.winner;
    return winner === mover ? 100 : winner === null ? 50 : 0;
  }
  const { cp, mate } = await evalPosition(banqiStateToEngineFen(post), repetitionWindow);
  return winPercent(cp == null ? null : -cp, mate == null ? null : -mate);
}

// The TRUE pool-mean baseline (win%, mover POV) of `move` from a pre-move `state`, plus the realized
// win% (the actual tile's term). For a NON-flip move (from !== to; a known-piece move/capture) there
// is no chance node, so baseline === realized === a single eval. For a FLIP, the turned square is
// uniformly one of ALL remaining face-down tiles (either ink), so we average the post-move win% over
// that (colour, role) multiset (per-tile evals run concurrently; the shared engine pool throttles).
async function poolMeanWin(
  state: BanqiGameState,
  move: BanqiMove,
  mover: BanqiSeat,
  evalPosition: BanqiDecisionDeps['evalPosition'],
  repetitionWindow: BanqiRepetitionWindow,
): Promise<{ baseline: number; realized: number }> {
  const source = state.board[move.from];
  const isFlip = move.from === move.to;
  if (!isFlip || !source?.faceDown) {
    const post = applyBanqiMove(state, move);
    const win = await moverWinAfter(
      post,
      mover,
      evalPosition,
      banqiRepetitionWindowAfterMove(state, move, post, repetitionWindow),
    );
    return { baseline: win, realized: win };
  }
  // Pool: every still-face-down tile, keyed by ink+role (both colours — the deal is hidden from
  // both seats). The turned square's own true tile is included (the flipper doesn't know it either).
  type PoolEntry = { color: BanqiColor; role: BanqiPieceRole; count: number };
  const pool = new Map<string, PoolEntry>();
  for (const piece of Object.values(state.board)) {
    if (!piece?.faceDown) continue;
    const key = `${piece.color}-${piece.role}`;
    const entry = pool.get(key);
    if (entry) entry.count += 1;
    else pool.set(key, { color: piece.color, role: piece.role, count: 1 });
  }
  const entries = [...pool.values()];
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  // Bounded fan-out: an early flip has ~14 distinct counterfactual tiles. A bare
  // Promise.all fired them all into the 2-slot engine pool at once — everything
  // past the slots sat in the pool queue burning its timeout, and ONE timeout
  // rejected the whole batch (discarding minutes of compute). Capping launch
  // concurrency at the pool's slot count keeps the queue empty.
  const wins = await mapWithConcurrency(entries, BANQI_DECISION_EVAL_CONCURRENCY, (entry) => {
    // Counterfactual: the flipped square is (entry.color, entry.role) instead of its true tile.
    // The MULTISET of hidden pieces is FIXED — we only relocate which one lies under move.from —
    // so we SWAP move.from's identity with a donor face-down square that holds `entry`, moving
    // the true tile (`source`) there. Relabeling move.from ALONE would change the global counts
    // (an off-colour draw adds a phantom piece of that ink and drops a real one of the other),
    // which materially unbalances the position by ~2 pieces and inflates the pool-mean baseline.
    const cf: BanqiGameState = {
      ...state,
      board: {
        ...state.board,
        [move.from]: { color: entry.color, role: entry.role, faceDown: true },
      },
    };
    if (entry.color !== source.color || entry.role !== source.role) {
      const donor = (Object.keys(state.board) as (keyof typeof state.board)[]).find(
        (sq) =>
          sq !== move.from &&
          state.board[sq]?.faceDown === true &&
          state.board[sq]?.color === entry.color &&
          state.board[sq]?.role === entry.role,
      );
      // `entry` is drawn from the hidden tiles OTHER than move.from (which holds `source` ≠
      // `entry`), so a donor always exists; guard defensively regardless.
      if (donor) cf.board[donor] = { color: source.color, role: source.role, faceDown: true };
    }
    const post = applyBanqiMove(cf, move);
    return moverWinAfter(
      post,
      mover,
      evalPosition,
      banqiRepetitionWindowAfterMove(cf, move, post, repetitionWindow),
    );
  });
  let baseline = 0;
  let realized = 50;
  entries.forEach((entry, idx) => {
    baseline += (entry.count / total) * wins[idx]!;
    if (entry.color === source.color && entry.role === source.role) realized = wins[idx]!;
  });
  return { baseline, realized };
}

/**
 * Compute the decision-vs-luck numbers for every FLIP ply. Reconstructs the game from the deal
 * (same kernel as the Layer-1 sweep). For each flip, the engine names one ceiling candidate (its
 * best move); we true-baseline the played flip plus that candidate (unclamped pool-mean win%), take
 * the max as `bestWin`, and read the played flip's actual-tile term as `realizedWin`. `deps` is
 * injectable so tests drive it without an engine. No dependency on the Layer-1 sweep — realized is
 * computed here, same-search as the mean it is compared against.
 */
export async function analyzeBanqiDecisions(
  moves: readonly BanqiMove[],
  setup: BanqiStoredSetup,
  deps: BanqiDecisionDeps = liveDecisionDeps,
  progress?: AnalysisProgressStore<BanqiDecision>,
): Promise<BanqiDecision[]> {
  let state = createBanqiStateFromSetup('analysis', setup);
  let repetitionWindow: BanqiRepetitionWindow = {
    fen: banqiStateToEngineFen(state),
    moves: [],
  };
  // With a progress store, checkpoint after every graded flip and resume from
  // the saved move cursor (quiet moves before it just re-advance the state —
  // kernel replay is free; the engine fan-outs are what we refuse to redo).
  const resumed = progress ? await progress.load() : null;
  const decisions: BanqiDecision[] = resumed ? [...resumed.items] : [];
  const startIndex = resumed?.nextIndex ?? 0;
  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i]!;
    if (i < startIndex) {
      const post = applyBanqiMove(state, move);
      repetitionWindow = banqiRepetitionWindowAfterMove(state, move, post, repetitionWindow);
      state = post;
      continue;
    }
    const source = state.board[move.from];
    const mover: BanqiSeat = state.status.type === 'playing' ? state.status.turn : 'red';
    const isFlip =
      move.from === move.to && source?.faceDown === true && state.status.type === 'playing';
    if (isFlip) {
      const fen = banqiStateToEngineFen(state);
      const playedUci = banqiMoveToEngineUci(move);
      const best = await deps.bestMove(fen, repetitionWindow);
      // Candidate ceiling moves: the engine's best plus the played flip (deduped).
      const candidateUcis = new Set<string>([playedUci]);
      if (best) candidateUcis.add(best);
      let playedWin = 50;
      let realizedWin = 50;
      const baselines: number[] = [];
      for (const uci of candidateUcis) {
        const candidate = uci === playedUci ? move : engineUciToBanqiMove(uci);
        if (!candidate) continue;
        const { baseline, realized } = await poolMeanWin(
          state,
          candidate,
          mover,
          deps.evalPosition,
          repetitionWindow,
        );
        baselines.push(baseline);
        if (uci === playedUci) {
          playedWin = baseline;
          realizedWin = realized;
        }
      }
      const bestWin = baselines.length ? Math.max(...baselines) : playedWin;
      // Rank by true baseline: 1 + how many candidates strictly beat the played move.
      const playedRank = 1 + baselines.filter((b) => b > playedWin + 1e-9).length;
      decisions.push({ ply: i + 1, mover, bestWin, playedWin, realizedWin, playedRank });
      if (progress) await progress.save({ nextIndex: i + 1, items: decisions });
    }
    const post = applyBanqiMove(state, move);
    repetitionWindow = banqiRepetitionWindowAfterMove(state, move, post, repetitionWindow);
    state = post;
  }
  return decisions;
}

// Cache engine id for the decomposition blob — a DIFFERENT engine_id than the basic analysis, so
// both live in the same game_analysis table without collision (see persistence-game-analysis).
// The `+dN` suffix versions the DECOMPOSITION ALGORITHM independently of the engine binary: bump it
// to invalidate cached decisions when the algorithm changes without an engine change. d3 adds
// the live repetition window; d2 fixed counterfactual hidden-multiset preservation.
export const BANQI_DECISIONS_ENGINE_ID = `misty-banqi-decisions@${BANQI_ENGINE_VERSION}+d3`;

export type BanqiDecisionsCache = {
  get(roomId: string, engineId: string, depth: number): Promise<BanqiDecision[] | null>;
  save(roomId: string, engineId: string, depth: number, decisions: BanqiDecision[]): Promise<void>;
};

const liveDecisionsCache: BanqiDecisionsCache = {
  get: (roomId, engineId, depth) =>
    persistence.getGameAnalysisBlob<BanqiDecision[]>(roomId, engineId, depth),
  save: (roomId, engineId, depth, decisions) =>
    persistence.saveGameAnalysisBlob(roomId, engineId, depth, decisions),
};

export type BanqiDecisionsResult = { engineId: string; depth: number; decisions: BanqiDecision[] };

/**
 * Cache-first, coalesced decision-vs-luck decomposition (the heavier, opt-in tier on top of the
 * basic eval sweep; shared skeleton: game-analysis-kernel). Self-contained — it recomputes
 * realized in the same search as the mean it is compared against, so it needs no Layer-1 sweep
 * input. A scoreless decomposition (flips exist but every win% is the null-eval 50/50) fails
 * closed like the basic sweep: throws, caches nothing; the route maps it to 503. A game with no
 * flip plies caches an empty array (a valid, terminal result). The `depth` cache dimension is the
 * family nominal (banqi's real dial is the node budget, encoded in the engine id).
 */
export async function resolveBanqiDecisions(
  roomId: string,
  moves: readonly BanqiMove[],
  setup: BanqiStoredSetup,
  cache: BanqiDecisionsCache = liveDecisionsCache,
  analyze?: (moves: readonly BanqiMove[], setup: BanqiStoredSetup) => Promise<BanqiDecision[]>,
  computeIfMissing = true,
): Promise<BanqiDecisionsResult | null> {
  const engineId = BANQI_DECISIONS_ENGINE_ID;
  const depth = BANQI_ANALYSIS_DEPTH;
  const progress = analyze
    ? null
    : liveAnalysisProgressStore<BanqiDecision>(roomId, engineId, depth);
  const decisions = await resolveCachedComputation<BanqiDecision[]>({
    roomId,
    engineId,
    depth,
    cache,
    computeIfMissing,
    compute: () =>
      analyze
        ? analyze(moves, setup)
        : analyzeBanqiDecisions(moves, setup, undefined, progress ?? undefined),
    validate: (series) => {
      // A scoreless engine makes every position eval null, so every win% collapses to 50
      // (best === played === realized). Never cache that; a fixed engine recomputes.
      if (
        series.length > 0 &&
        series.every((d) => d.bestWin === 50 && d.playedWin === 50 && d.realizedWin === 50)
      ) {
        throw new VacuousAnalysisError('banqi');
      }
    },
    afterSave: progress ? () => progress.clear() : undefined,
  });
  return decisions ? { engineId, depth, decisions } : null;
}
