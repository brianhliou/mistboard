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
  banqiNoProgressLimitOf,
  createBanqiStateFromSetup,
  getBanqiForbiddenChaseMoves,
  getBanqiLegalMoves,
  winPercent,
} from '@mistboard/game';
import { BANQI_ENGINE_VERSION, banqiEngineTierFor, evaluateBanqiFenNodes } from './banqi-engine.js';
import { banqiMoveToEngineUci, banqiStateToEngineFen } from './banqi-fen.js';
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
const BANQI_ANALYSIS_NODES = banqiEngineTierFor('misty-banqi-level-8')!.nodes;
// Offline work has no player clock. Leave ample headroom for NNUE on a busy CPU
// so the node budget binds; the hard cap still bounds a stalled engine process.
const BANQI_ANALYSIS_MOVETIME_CAP_MS = 30_000;

// Nominal cache dimension: `depth` only has to be STABLE for the (room, engine, depth) cache
// key (banqi's real dial is nodes, encoded in the engine id). Kept at the family default.
export const BANQI_ANALYSIS_DEPTH = 12;

// Red-SEAT-POV cp for a decisive finished position (no engine query is made there).
const TERMINAL_CP = 30_000;

// Invalidate classical sweeps and incremental checkpoints as well as FEN-only history.
export const BANQI_ANALYSIS_ENGINE_ID = `misty-banqi-analysis@${BANQI_ENGINE_VERSION}+nnue-nodes-${BANQI_ANALYSIS_NODES}+history2`;

function banqiAnalysisSearchMoves(state: BanqiGameState): readonly string[] | undefined {
  return getBanqiForbiddenChaseMoves(state).length > 0
    ? getBanqiLegalMoves(state).map(banqiMoveToEngineUci)
    : undefined;
}

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
    searchMoves: banqiAnalysisSearchMoves(state),
    noProgressLimit: banqiNoProgressLimitOf(state),
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
  // Two workers fit the existing analysis pool's two slots. Each search is
  // cold/reset and keeps its full node budget. Buffer out-of-order completions;
  // only serialized, contiguous checkpoints are durable/reusable on restart.
  let nextPly = plies.length;
  let failed = false;
  const completed = new Map<number, SweepPlyEval>();
  let checkpoint: Promise<void> = Promise.resolve();
  const commit = (ply: number, value: SweepPlyEval): Promise<void> => {
    completed.set(ply, value);
    checkpoint = checkpoint.then(async () => {
      const before = plies.length;
      while (completed.has(plies.length)) {
        const cursor = plies.length;
        plies.push(completed.get(cursor)!);
        completed.delete(cursor);
      }
      if (progress && plies.length > before)
        await progress.save({ nextIndex: plies.length, items: [...plies] });
    });
    return checkpoint;
  };
  const worker = async (): Promise<void> => {
    while (!failed && nextPly < states.length) {
      const ply = nextPly++;
      try {
        const s = states[ply]!;
        let value: SweepPlyEval;
        if (s.status.type !== 'playing') value = terminalPlyEval(ply, s);
        else {
          const evaluation = await evaluate(s, banqiAnalysisRepetitionWindow(states, moves, ply));
          value = { ply, cp: evaluation.cp, mate: evaluation.mate, best: evaluation.best };
        }
        await commit(ply, value);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  // Promise.all would return on the first error while another search/write was
  // still running, allowing a retry/next job to race its checkpoint. Drain both.
  const settled = await Promise.allSettled([worker(), worker()]);
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  await checkpoint;
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

// Rank every legal move, then spend the baseline budget only on the shortlist.
// Ranking searches each public root move once. Only baseline identities share a
// budget; their per-identity floor can exceed it.
export const BANQI_DECISION_RANK_NODES = 200_000;
export const BANQI_DECISION_BASELINE_NODES = 200_000;
export const BANQI_DECISION_MIN_NODES = 200_000;
// Bound each game's fan-out to the default analysis pool size. Concurrent reviews
// share that pool and may queue; live bot searches use a separate pool.
const BANQI_DECISION_EVAL_CONCURRENCY = 2;
// True-baseline the top three cheap ranks plus the played move.
export const BANQI_DECISION_CANDIDATES = 3;

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
  /** True-baselined candidates, best first. Absent on older cached rows. */
  candidates?: BanqiDecisionCandidate[];
};

export type BanqiDecisionCandidate = {
  move: string;
  /** Mover-POV win%: pool mean in published candidates, root estimate during ranking. */
  win: number;
  played?: boolean;
};

export type BanqiDecisionDeps = {
  /** Injectable ranking pass; its scores select candidates and never become published grades. */
  rankMoves?: typeof rankBanqiDecisionMoves;
  /** Single-position eval (side-to-move POV) at the supplied ranking/baseline budget. */
  evalPosition: (
    fen: string,
    repetitionWindow?: BanqiRepetitionWindow,
    search?: { nodes: number; searchMoves?: readonly string[] },
  ) => Promise<{ cp: number | null; mate: number | null }>;
};

/** The live engine deps for one game, searched under that game's no-progress limit. */
function liveDecisionDeps(noProgressLimit: number): BanqiDecisionDeps {
  return {
    evalPosition: (fen, repetitionWindow, search) =>
      evaluateBanqiFenNodes(repetitionWindow?.fen ?? fen, {
        nodes: search?.nodes ?? BANQI_ANALYSIS_NODES,
        movetimeCapMs: BANQI_ANALYSIS_MOVETIME_CAP_MS,
        moves: repetitionWindow?.moves,
        searchMoves: search?.searchMoves,
        noProgressLimit,
      }).then((e) => ({ cp: e.cp, mate: e.mate })),
  };
}

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
  nodes: number,
): Promise<number> {
  if (post.status.type === 'finished') {
    const winner = post.status.winner;
    return winner === mover ? 100 : winner === null ? 50 : 0;
  }
  const { cp, mate } = await evalPosition(banqiStateToEngineFen(post), repetitionWindow, {
    nodes,
    searchMoves: banqiAnalysisSearchMoves(post),
  });
  return winPercent(
    cp == null ? null : -cp,
    mate == null ? null : -mate,
    BANQI_DECISIONS_ENGINE_ID,
  );
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
  nodesBudget: number,
  candidateCount = 1,
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
      Math.max(BANQI_DECISION_MIN_NODES, Math.floor(nodesBudget / candidateCount)),
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
  // Canonical order keeps tie-breaking and floating-point sums independent of
  // the secret placement of the remaining tiles.
  const entries = [...pool.values()].sort((a, b) =>
    `${a.color}-${a.role}`.localeCompare(`${b.color}-${b.role}`),
  );
  const nodes = Math.max(
    BANQI_DECISION_MIN_NODES,
    Math.floor(nodesBudget / (candidateCount * entries.length)),
  );
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  // Bounded fan-out: an early flip has ~14 distinct counterfactual tiles. A bare
  // Promise.all fired them all into the 2-slot engine pool at once — everything
  // past the slots sat in the pool queue burning its timeout, and ONE timeout
  // rejected the whole batch (discarding minutes of compute). Capping launch
  // concurrency bounds each review's contribution to the shared queue.
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
      nodes,
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

/** Cheap public-information ranking: one restricted root search per legal move.
 * The engine handles flips as pool-weighted chance nodes. Its mover-POV scores
 * select the shortlist only; published grades still use per-identity win% means. */
export async function rankBanqiDecisionMoves(
  state: BanqiGameState,
  _mover: BanqiSeat,
  evalPosition: BanqiDecisionDeps['evalPosition'],
  repetitionWindow: BanqiRepetitionWindow,
): Promise<BanqiDecisionCandidate[]> {
  const fen = banqiStateToEngineFen(state);
  const ranked = await mapWithConcurrency(
    getBanqiLegalMoves(state),
    BANQI_DECISION_EVAL_CONCURRENCY,
    async (move) => {
      const uci = banqiMoveToEngineUci(move);
      // Restrict only the root, retaining the public pre-move repetition window.
      // No reveal is applied here, so neither flip identity nor seat binding leaks.
      const { cp, mate } = await evalPosition(fen, repetitionWindow, {
        nodes: BANQI_DECISION_RANK_NODES,
        searchMoves: [uci],
      });
      return { move: uci, win: winPercent(cp, mate, BANQI_DECISIONS_ENGINE_ID) };
    },
  );
  return ranked.sort((a, b) => b.win - a.win);
}

/**
 * Grade each flip by true-baselining the top three cheap ranks plus played.
 * Published best/played/realized values all come from the baseline pass. The
 * played flip is always included, even when its cheap rank misses the shortlist.
 * Both passes use public counterfactuals; only realized selects the actual tile.
 */
export async function analyzeBanqiDecisions(
  moves: readonly BanqiMove[],
  setup: BanqiStoredSetup,
  injectedDeps?: BanqiDecisionDeps,
  progress?: AnalysisProgressStore<BanqiDecision>,
): Promise<BanqiDecision[]> {
  let state = createBanqiStateFromSetup('analysis', setup);
  const deps = injectedDeps ?? liveDecisionDeps(banqiNoProgressLimitOf(state));
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
      const playedUci = banqiMoveToEngineUci(move);
      let playedWin = 50;
      let realizedWin = 50;
      const scored: BanqiDecisionCandidate[] = [];
      const legal = getBanqiLegalMoves(state);
      const ranked = await (deps.rankMoves ?? rankBanqiDecisionMoves)(
        state,
        mover,
        deps.evalPosition,
        repetitionWindow,
      );
      const selected = new Set([
        ...ranked.slice(0, BANQI_DECISION_CANDIDATES).map((row) => row.move),
        playedUci,
      ]);
      for (const uci of selected) {
        const candidate = legal.find((m) => banqiMoveToEngineUci(m) === uci);
        if (!candidate) throw new Error('Invalid Banqi decision candidate');
        const { baseline, realized } = await poolMeanWin(
          state,
          candidate,
          mover,
          deps.evalPosition,
          repetitionWindow,
          BANQI_DECISION_BASELINE_NODES,
          selected.size,
        );
        scored.push({ move: uci, win: baseline, ...(uci === playedUci ? { played: true } : {}) });
        if (uci === playedUci) {
          playedWin = baseline;
          realizedWin = realized;
        }
      }
      const candidates = scored.sort((a, b) => b.win - a.win);
      const baselines = candidates.map((c) => c.win);
      const bestWin = baselines.length ? Math.max(...baselines) : playedWin;
      // Rank by true baseline: 1 + how many candidates strictly beat the played move.
      const playedRank = 1 + baselines.filter((b) => b > playedWin + 1e-9).length;
      decisions.push({
        ply: i + 1,
        mover,
        bestWin,
        playedWin,
        realizedWin,
        playedRank,
        candidates,
      });
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
// to invalidate cached decisions when the algorithm changes without an engine change.
// d7 ranks each legal root move with one chance-aware search.
// d6 true-baselines only three plus played at 200K shared, with a
// 200K per-term floor. d4 adds
// ranked alternatives selected by pool mean. d5 uses L8 NNUE, split flip budgets and legal roots,
// invalidating both old results and checkpoints. d3 adds
// the live repetition window; d2 fixed counterfactual hidden-multiset preservation.
export const BANQI_DECISIONS_ENGINE_ID = `misty-banqi-decisions@${BANQI_ENGINE_VERSION}+nnue+rank${BANQI_DECISION_RANK_NODES}+baseline${BANQI_DECISION_BASELINE_NODES}+floor${BANQI_DECISION_MIN_NODES}+d7`;

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
