// Pure (engine-free) core of the lichess-style standard-xiangqi puzzle miner.
//
// The driver script (scripts/variant-lab/xiangqi-puzzle-miner.ts) owns the
// Pikafish subprocess, the corpus loading (historical-games DB or a directory
// of game files), concurrency, and module emission. Everything decision-shaped
// lives here so it can be unit-tested without an engine:
//
//   - UCI score normalization. `score cp` / `score mate` are SIDE-TO-MOVE POV;
//     xiangqiUciScoreToCp maps both onto one comparable centipawn axis (mates
//     fold in near XIANGQI_MATE_SCORE_CP, closer mates scoring higher).
//   - Blunder detection over a per-position eval walk: position i's best eval
//     is mover-POV, so the value of the move actually played from position i
//     is MINUS position i+1's best eval (i+1's mover is the other side).
//   - The shared separation rule for mating and non-mating best moves, plus
//     explicit coverage of alternatives to immediate mates.
//   - PV -> solution-line building: kernel-replay for legality, truncation to
//     an odd length (lines end on the solver's move), mate/terminal handling.
//   - Deterministic theme tagging + title, and final puzzle assembly, which is
//     re-validated with validateStandardXiangqiPuzzle before it is accepted.

import { XIANGQI_SPEC_ID } from './game-specs.js';
import {
  validateStandardXiangqiPuzzle,
  type XiangqiPuzzle,
  type XiangqiPuzzleGoal,
  type XiangqiPuzzleTheme,
} from './puzzles-xiangqi.js';
import { xiangqiSourceAttribution } from './puzzles-xiangqi-attribution.js';
import {
  XIANGQI_PUZZLE_ENDPOINT_VERSION,
  xiangqiPuzzleSolutionEndpoint,
} from './puzzles-xiangqi-endpoint.js';
import {
  positionRepetitionKey,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
} from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
  isStandardXiangqiGeneralInCheck,
  isStandardXiangqiLegalMove,
} from './variants-xiangqi-standard.js';

// ── UCI score normalization (side-to-move POV) ───────────────────────────────

/** Raw UCI score: exactly one of cp / mate is set (mate = signed moves-to-mate
 *  for the side to move; mate 0 = the side to move is already mated). */
export type XiangqiUciScore = { cp: number | null; mate: number | null };

/** Mate scores fold onto the cp axis at this magnitude: mate in m maps to
 *  XIANGQI_MATE_SCORE_CP - m (closer mates score higher), getting mated in m
 *  maps to -(XIANGQI_MATE_SCORE_CP - m). Far above any reachable static eval. */
export const XIANGQI_MATE_SCORE_CP = 30_000;

/** Normalize a UCI score to one comparable centipawn number, still from the
 *  SIDE TO MOVE's point of view. Returns null for a malformed score. */
export function xiangqiUciScoreToCp(score: XiangqiUciScore): number | null {
  if (score.mate !== null) {
    if (score.mate > 0) return XIANGQI_MATE_SCORE_CP - score.mate;
    if (score.mate < 0) return -(XIANGQI_MATE_SCORE_CP + score.mate);
    // mate 0: the side to move is already checkmated.
    return -XIANGQI_MATE_SCORE_CP;
  }
  return score.cp;
}

// ── Phase 1: blunder detection over a scan walk ─────────────────────────────

export type XiangqiBlunderDetectOptions = {
  /** Skip candidate moments before this game ply (opening filter). */
  minPly: number;
  /** The game move must lose at least this much vs the engine best (mover POV). */
  swingCp: number;
  /** The post-blunder position must give the solver at least this eval. */
  winCp: number;
  /** Skip positions already decided before the blunder (|best| >= decidedCp). */
  decidedCp: number;
};

export type XiangqiBlunderCandidate = {
  /** Index of the blunder move in the game's move list. */
  ply: number;
  /** Best eval at the pre-blunder position, mover POV. */
  preBestCp: number;
  /** Best eval at the post-blunder position, solver POV. */
  postBestCp: number;
  /** How much the played move lost vs the engine best, mover POV. */
  swingCp: number;
};

/**
 * Detect blunder moments from one cheap MultiPV scan per position.
 *
 * `scans[i]` is the normalized best-line cp of the position BEFORE move i,
 * from that position's mover POV (null = unscanned/terminal). The value of
 * the move actually played from position i, in the same mover's POV, is
 * `-scans[i + 1]` (position i+1's mover is the opponent). `moveCount` is the
 * game's ply count; `scans` covers indices 0..moveCount.
 */
export function detectXiangqiBlunderCandidates(
  scans: readonly (number | null)[],
  moveCount: number,
  opts: XiangqiBlunderDetectOptions,
): XiangqiBlunderCandidate[] {
  const candidates: XiangqiBlunderCandidate[] = [];
  for (let ply = Math.max(0, opts.minPly); ply < moveCount; ply += 1) {
    const pre = scans[ply];
    const post = scans[ply + 1];
    if (pre === null || pre === undefined || post === null || post === undefined) continue;
    // Already decided (won or lost) before the move: not a puzzle moment.
    if (Math.abs(pre) >= opts.decidedCp) continue;
    // The solver (mover at ply + 1) must end up winning.
    if (post < opts.winCp) continue;
    const playedCp = -post;
    const swing = pre - playedCp;
    if (swing < opts.swingCp) continue;
    candidates.push({ ply, preBestCp: pre, postBestCp: post, swingCp: swing });
  }
  return candidates;
}

// ── Phase 2: uniqueness rule ─────────────────────────────────────────────────

export type XiangqiVerifyLine = {
  /** Normalized cp (xiangqiUciScoreToCp), solver POV. */
  scoreCp: number;
  /** Raw signed mate distance when the line is a mate, else null. */
  mate: number | null;
};

/** Frozen CC0 score scale, matching analysis @6's paired-scale fit. This is a
 * reproducible score transform, not an independently fitted human win model. */
export const XIANGQI_SOLVER_SCORE_PROFILE = {
  id: 'pikafish-cc0-analysis-scale-v1',
  networkSha256: 'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11',
  winRateK: 0.00465696,
} as const;

export type XiangqiSolverUniquenessOptions = {
  winHi: number;
  /** Required best-versus-alternative separation on a [0,1] scale. */
  minWinRateGap: number;
  /** Mate-in-one admission still checks the strongest non-immediate answer. */
  mateInOneMaxWinRate: number;
  winRateK: number;
};

export const XIANGQI_SOLVER_GATE_DEFAULTS: XiangqiSolverUniquenessOptions = {
  winHi: 0.8,
  minWinRateGap: 0.35,
  mateInOneMaxWinRate: 0.8,
  winRateK: XIANGQI_SOLVER_SCORE_PROFILE.winRateK,
};

export const XIANGQI_SOLVER_GATE_VERSION = 'cc0-winning-chance-separation-v3';

export const XIANGQI_PUZZLE_ROOT_CHOICE_VERSION = 'root-choice-v1';
export const XIANGQI_PUZZLE_MINIMUM_ROOT_MOVES = 2;

/** Forced follow-ups may belong to a tactic; its initial move needs a choice. */
export function xiangqiPuzzleHasStartingChoice(state: XiangqiGameState): boolean {
  return (
    state.status.type === 'playing' &&
    getStandardXiangqiLegalMoves(state).length >= XIANGQI_PUZZLE_MINIMUM_ROOT_MOVES
  );
}

export const XIANGQI_PUZZLE_ADMISSION_PROFILE = {
  solverGateVersion: XIANGQI_SOLVER_GATE_VERSION,
  scoreProfileId: XIANGQI_SOLVER_SCORE_PROFILE.id,
  endpointVersion: XIANGQI_PUZZLE_ENDPOINT_VERSION,
  rootChoiceVersion: XIANGQI_PUZZLE_ROOT_CHOICE_VERSION,
  minimumRootLegalMoves: XIANGQI_PUZZLE_MINIMUM_ROOT_MOVES,
  ...XIANGQI_SOLVER_GATE_DEFAULTS,
} as const;

export function assertXiangqiPuzzleAdmissionProfile(profile: Record<string, unknown>): void {
  for (const [name, expected] of Object.entries(XIANGQI_PUZZLE_ADMISSION_PROFILE)) {
    if (profile[name] !== expected)
      throw new Error(`Xiangqi puzzle admission profile mismatch: ${name}`);
  }
}

export function assertXiangqiSolverGateVersion(version: unknown): void {
  if (version !== XIANGQI_SOLVER_GATE_VERSION) {
    throw new Error(`Xiangqi puzzle evidence requires solver gate ${XIANGQI_SOLVER_GATE_VERSION}`);
  }
}

/** Score-based winning chance on the producing network's scale. */
export function xiangqiWinRate(
  cp: number,
  k: number = XIANGQI_SOLVER_SCORE_PROFILE.winRateK,
): number {
  return 1 / (1 + Math.exp(-k * cp));
}

export function xiangqiSolverLineWinRate(line: XiangqiVerifyLine, k: number): number {
  return line.mate === null ? xiangqiWinRate(line.scoreCp, k) : line.mate > 0 ? 1 : 0;
}

export type XiangqiSolverUniquenessReason =
  | 'missing-best'
  | 'invalid-score'
  | 'missing-alternative'
  | 'immediate-mate-alternatives-unchecked'
  | 'mate-in-one'
  | 'mate-not-unique'
  | 'best-not-winning'
  | 'only-move'
  | 'runner-up-mates'
  | 'insufficient-separation'
  | 'winning-chance-separation';

export type XiangqiSolverUniquenessVerdict = {
  unique: boolean;
  reason: XiangqiSolverUniquenessReason;
};

/** Kernel-verified immediate wins define equivalent answers accepted by the
 * grader, and how many MultiPV ranks admission must inspect beyond them. */
export function xiangqiSolverMoveCoverage(state: XiangqiGameState): {
  legalMoveCount: number;
  immediateWins: XiangqiMove[];
  requiredMultiPv: number;
} {
  if (state.status.type !== 'playing')
    return { legalMoveCount: 0, immediateWins: [], requiredMultiPv: 0 };
  const solver = state.status.turn;
  const legal = getStandardXiangqiLegalMoves(state);
  const immediateWins = legal.filter((move) => {
    const after = applyStandardXiangqiMove(state, move);
    return after.status.type === 'finished' && after.status.winner === solver;
  });
  return {
    legalMoveCount: legal.length,
    immediateWins,
    requiredMultiPv: Math.min(legal.length, Math.max(2, immediateWins.length + 1)),
  };
}

export type XiangqiSolverAlternativeCoverage = {
  /** Complete ranked lines from one search; enough ranks to pass all mate-in-ones. */
  lines: readonly XiangqiVerifyLine[];
  legalMoveCount: number;
};

/** One admission rule for mating and non-mating best moves. A mate is certainty
 * in the score comparison, not a bypass around a winning alternative.
 *
 * The grader's immediate-mate exception is separate from mining admission.
 * When multiple moves mate immediately, inspect the strongest remaining move;
 * a truncated MultiPV list cannot certify its absence. Only when all legal
 * moves were covered can a list containing nothing but immediate mates pass.
 */
export function classifyXiangqiSolverMoveUniqueness(
  best: XiangqiVerifyLine | undefined,
  second: XiangqiVerifyLine | undefined,
  opts: XiangqiSolverUniquenessOptions,
  coverage?: XiangqiSolverAlternativeCoverage,
): XiangqiSolverUniquenessVerdict {
  if (
    !Number.isFinite(opts.winRateK) ||
    opts.winRateK <= 0 ||
    !Number.isFinite(opts.winHi) ||
    opts.winHi <= 0.5 ||
    opts.winHi > 1 ||
    !Number.isFinite(opts.minWinRateGap) ||
    opts.minWinRateGap <= 0 ||
    opts.minWinRateGap >= 1 ||
    !Number.isFinite(opts.mateInOneMaxWinRate) ||
    opts.mateInOneMaxWinRate < 0.5 ||
    opts.mateInOneMaxWinRate >= 1
  )
    throw new Error('Invalid xiangqi solver separation options');
  if (!best) return { unique: false, reason: 'missing-best' };
  const valid = (line: XiangqiVerifyLine) =>
    Number.isFinite(line.scoreCp) && (line.mate === null || Number.isInteger(line.mate));
  if (!valid(best) || (second && !valid(second))) return { unique: false, reason: 'invalid-score' };
  const bestRate = xiangqiSolverLineWinRate(best, opts.winRateK);
  if (bestRate < opts.winHi) return { unique: false, reason: 'best-not-winning' };
  if (!second) {
    if (coverage && coverage.legalMoveCount > 1)
      return { unique: false, reason: 'missing-alternative' };
    return { unique: true, reason: best.mate === 1 ? 'mate-in-one' : 'only-move' };
  }
  if (best.mate === 1) {
    let alternative: XiangqiVerifyLine | undefined = second;
    if (second.mate === 1) {
      if (!coverage) return { unique: false, reason: 'immediate-mate-alternatives-unchecked' };
      alternative = coverage.lines.find((line) => line.mate !== 1);
      if (!alternative) {
        return coverage.lines.length >= coverage.legalMoveCount
          ? { unique: true, reason: 'mate-in-one' }
          : { unique: false, reason: 'immediate-mate-alternatives-unchecked' };
      }
    }
    if (!valid(alternative)) return { unique: false, reason: 'invalid-score' };
    if (alternative.mate !== null && alternative.mate > 0)
      return { unique: false, reason: 'mate-not-unique' };
    return xiangqiSolverLineWinRate(alternative, opts.winRateK) <= opts.mateInOneMaxWinRate
      ? { unique: true, reason: 'mate-in-one' }
      : { unique: false, reason: 'insufficient-separation' };
  }
  if (second.mate !== null && second.mate > 0) {
    return {
      unique: false,
      reason: best.mate !== null && best.mate > 0 ? 'mate-not-unique' : 'runner-up-mates',
    };
  }
  return bestRate - xiangqiSolverLineWinRate(second, opts.winRateK) > opts.minWinRateGap
    ? { unique: true, reason: 'winning-chance-separation' }
    : { unique: false, reason: 'insufficient-separation' };
}

export function isXiangqiSolverMoveUnique(
  best: XiangqiVerifyLine | undefined,
  second: XiangqiVerifyLine | undefined,
  opts: XiangqiSolverUniquenessOptions,
  coverage?: XiangqiSolverAlternativeCoverage,
): boolean {
  return classifyXiangqiSolverMoveUniqueness(best, second, opts, coverage).unique;
}

// ── Puzzle initial state ─────────────────────────────────────────────────────

/** Lift a mid-game state into a puzzle initial: reset the progress clock and
 *  repetition counts so the scripted line cannot trip the source game's
 *  history, but KEEP lastMove (the blunder) so the board can highlight it. */
export function makeXiangqiPuzzleInitial(state: XiangqiGameState, id: string): XiangqiGameState {
  const base: XiangqiGameState = {
    ...state,
    id,
    board: { ...state.board },
    progressClock: 0,
    positionCounts: {},
  };
  return { ...base, positionCounts: { [positionRepetitionKey(base)]: 1 } };
}

// ── Solution-line building (PV -> kernel-verified line) ─────────────────────

export type XiangqiSolutionBuildOptions = {
  /** Hard cap on solution plies (normalized down to an odd number so lines end
   *  on the solver's move). Mates deeper than the cap are rejected. */
  maxSolutionPlies: number;
  /** Minimum solution plies (existing puzzle shapes want at least a solver
   *  move plus a continuation; bare mate-in-1s are out of scope for mining). */
  minSolutionPlies: number;
  /** True when the verify score was a mate for the solver: the line must then
   *  actually reach a terminal state within the cap. */
  mateExpected: boolean;
};

export type XiangqiSolutionBuildReject =
  | 'pv-empty'
  | 'pv-illegal'
  | 'line-lost'
  | 'mate-not-reached'
  | 'too-short';

export type XiangqiSolutionBuild =
  | { ok: true; moves: XiangqiMove[]; finalState: XiangqiGameState; endedByMate: boolean }
  | { ok: false; reason: XiangqiSolutionBuildReject };

export function buildXiangqiSolutionFromPv(
  initial: XiangqiGameState,
  pv: readonly XiangqiMove[],
  opts: XiangqiSolutionBuildOptions,
): XiangqiSolutionBuild {
  if (initial.status.type !== 'playing') return { ok: false, reason: 'pv-illegal' };
  if (pv.length === 0) return { ok: false, reason: 'pv-empty' };
  const solver = initial.status.turn;
  const maxPlies = Math.max(1, opts.maxSolutionPlies - ((opts.maxSolutionPlies + 1) % 2));

  // Replay the PV, keeping the state after each ply so truncation can land on
  // any earlier (odd) length without a second replay.
  const states: XiangqiGameState[] = [initial];
  const moves: XiangqiMove[] = [];
  let state = initial;
  for (const move of pv) {
    if (moves.length >= maxPlies) break;
    if (state.status.type !== 'playing') break;
    if (!isStandardXiangqiLegalMove(state, move)) return { ok: false, reason: 'pv-illegal' };
    state = applyStandardXiangqiMove(state, move);
    moves.push(move);
    states.push(state);
    if (state.status.type !== 'playing') break;
  }

  const finalState = states[moves.length] as XiangqiGameState;
  if (finalState.status.type === 'finished') {
    // Mate / xiangqi stalemate for the solver ends the line exactly there; any
    // other finish (draw, or somehow a loss) disqualifies the candidate.
    if (finalState.status.winner !== solver) return { ok: false, reason: 'line-lost' };
    if (moves.length < opts.minSolutionPlies) return { ok: false, reason: 'too-short' };
    return { ok: true, moves, finalState, endedByMate: true };
  }

  if (opts.mateExpected) return { ok: false, reason: 'mate-not-reached' };

  // Non-terminal winning line: truncate to the longest odd prefix (ends on the
  // solver's payoff move).
  const oddLength = moves.length - ((moves.length + 1) % 2);
  if (oddLength < opts.minSolutionPlies || oddLength < 1) {
    return { ok: false, reason: 'too-short' };
  }
  return {
    ok: true,
    moves: moves.slice(0, oddLength),
    finalState: states[oddLength] as XiangqiGameState,
    endedByMate: false,
  };
}

// ── Themes + title ───────────────────────────────────────────────────────────

/** Initial-board piece count at or below which a puzzle is tagged 'endgame'. */
export const XIANGQI_ENDGAME_MAX_PIECES = 14;

/** Swing size at or above which a puzzle is tagged 'crushing'. */
export const XIANGQI_CRUSHING_SWING_CP = 600;

export function tagXiangqiPuzzleThemes(input: {
  initial: XiangqiGameState;
  solution: readonly XiangqiMove[];
  goal: XiangqiPuzzleGoal;
  swingCp: number;
}): XiangqiPuzzleTheme[] {
  const themes: XiangqiPuzzleTheme[] = [];
  if (input.goal.type === 'checkmate') {
    themes.push('checkmate');
    const mateIn = Math.ceil(input.solution.length / 2);
    if (mateIn === 1) themes.push('matein1');
    else if (mateIn === 2) themes.push('matein2');
    else if (mateIn === 3) themes.push('matein3');
    else if (mateIn === 4) themes.push('matein4');
  } else {
    themes.push('winning');
  }
  const firstMove = input.solution[0];
  if (firstMove && input.initial.board[firstMove.to] !== undefined) {
    themes.push('winning-material');
  }
  if (input.swingCp >= XIANGQI_CRUSHING_SWING_CP) themes.push('crushing');
  const pieceCount = Object.keys(input.initial.board).length;
  themes.push(pieceCount <= XIANGQI_ENDGAME_MAX_PIECES ? 'endgame' : 'middlegame');
  return themes;
}

export function xiangqiPuzzleTitle(
  solver: XiangqiColor,
  goal: XiangqiPuzzleGoal,
  solutionPlyCount: number,
): string {
  const side = solver === 'red' ? 'Red' : 'Black';
  if (goal.type === 'checkmate') {
    return `${side} mate in ${Math.ceil(solutionPlyCount / 2)}`;
  }
  return `${side} winning advantage`;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export type XiangqiMineCandidateInput = {
  /** Source game id (historical_xiangqi_games row id in db mode, file name in
   *  dir mode). */
  gameId: string;
  /** Index of the blunder move in the game's move list; the puzzle position is
   *  the state AFTER this move, so sourceGame.ply = blunderPly + 1. */
  blunderPly: number;
  /** State after the blunder move: the solver is to move. */
  postBlunderState: XiangqiGameState;
  /** Verify-pass best line (already converted to kernel moves). */
  pv: readonly XiangqiMove[];
  /** Verify-pass best-line score, solver POV. */
  verifyScore: XiangqiVerifyLine;
  /** Scan-pass swing of the blunder, mover POV. */
  swingCp: number;
  /** Denormalized attribution from the source game row (db mode only). Copied
   *  onto sourceGame so the "From game" card renders without hosting the game. */
  sourceMeta?: {
    event?: string | null;
    playedOn?: string | null;
    result?: string | null;
    redName?: string | null;
    blackName?: string | null;
    /** historical_xiangqi_sources.slug: selects the source's attribution
     *  policy (puzzles-xiangqi-attribution.ts). */
    sourceSlug?: string | null;
    /** The game's page in the source archive, when the row stored one. */
    sourceUrl?: string | null;
    /** The archive's own id for the game (e.g. DPXQ `view_m_140041`). */
    sourceGameId?: string | null;
  };
};

export type XiangqiMineReject =
  | XiangqiSolutionBuildReject
  | 'not-playing'
  | 'no-choice-at-root'
  | 'validation-failed'
  | 'loud-key'
  | 'too-short-after-trim'
  | 'no-tactical-endpoint'
  | 'missing-attribution';

/** Assembly knobs on top of the solution-length window (#712, harder puzzles). */
export type XiangqiMineAssembleOptions = Omit<XiangqiSolutionBuildOptions, 'mateExpected'> & {
  /** Require a quiet key move: the solver's first move neither captures nor
   *  gives check (isXiangqiQuietKeyMove). A capture or a check announces
   *  itself; a quiet key is the move a player has to find. */
  quietKey?: boolean;
  /** Retained for older callers. The configured minimum always applies after
   * trimming; this flag can no longer bypass it. */
  floorAfterTrim?: boolean;
};

/**
 * A key move is quiet when it captures nothing and does not put the defender's
 * general in check (the flying-general rule counts, as it does for legality).
 * Mate-in-one is therefore never quiet.
 */
export function isXiangqiQuietKeyMove(state: XiangqiGameState, move: XiangqiMove): boolean {
  if (state.status.type !== 'playing') return false;
  if (state.board[move.to] !== undefined) return false;
  const defender: XiangqiColor = state.status.turn === 'red' ? 'black' : 'red';
  const next = applyStandardXiangqiMove(state, move);
  return !isStandardXiangqiGeneralInCheck(next, defender);
}

export type XiangqiMineResult =
  | { ok: true; puzzle: XiangqiPuzzle }
  | { ok: false; reason: XiangqiMineReject };

/** Build (and kernel-re-validate) a mined puzzle from a verified candidate. */
export function assembleMinedXiangqiPuzzle(
  input: XiangqiMineCandidateInput,
  opts: XiangqiMineAssembleOptions,
): XiangqiMineResult {
  if (input.postBlunderState.status.type !== 'playing') {
    return { ok: false, reason: 'not-playing' };
  }
  if (!xiangqiPuzzleHasStartingChoice(input.postBlunderState))
    return { ok: false, reason: 'no-choice-at-root' };
  const credit = xiangqiSourceAttribution({
    sourceSlug: input.sourceMeta?.sourceSlug,
    sourceUrl: input.sourceMeta?.sourceUrl,
    sourceGameId: input.sourceMeta?.sourceGameId,
  });
  if (!credit.ok) return { ok: false, reason: credit.reason };
  const key = input.pv[0];
  if (opts.quietKey && (!key || !isXiangqiQuietKeyMove(input.postBlunderState, key))) {
    return { ok: false, reason: 'loud-key' };
  }
  const solver = input.postBlunderState.status.turn;
  const id = `xq-mined-${input.gameId}-${input.blunderPly + 1}`;
  const initial = makeXiangqiPuzzleInitial(input.postBlunderState, id);
  const mateExpected = input.verifyScore.mate !== null && input.verifyScore.mate > 0;
  const built = buildXiangqiSolutionFromPv(initial, input.pv, {
    maxSolutionPlies: opts.maxSolutionPlies,
    minSolutionPlies: opts.minSolutionPlies,
    mateExpected,
  });
  if (!built.ok) return built;

  const goal: XiangqiPuzzleGoal = built.endedByMate
    ? { type: 'checkmate', winner: solver }
    : { type: 'winning-advantage', winner: solver, centipawns: input.verifyScore.scoreCp };
  // A winning-advantage line ends on its payoff: trim the quiet PV tail back to
  // the solver's last capture. Re-apply the requested minimum afterward: a
  // long quiet PV must not turn a 5-ply candidate into a 1-ply published line.
  const endpoint = xiangqiPuzzleSolutionEndpoint(initial, built.moves, goal, opts.minSolutionPlies);
  if (!endpoint.ok)
    return {
      ok: false,
      reason: endpoint.reason === 'too-short' ? 'too-short-after-trim' : 'no-tactical-endpoint',
    };
  const solution = endpoint.moves;
  const puzzle: XiangqiPuzzle = {
    id,
    variant: XIANGQI_SPEC_ID,
    title: xiangqiPuzzleTitle(solver, goal, solution.length),
    initial,
    solution,
    goal,
    themes: tagXiangqiPuzzleThemes({
      initial,
      solution,
      goal,
      swingCp: input.swingCp,
    }),
    sourceGame: {
      gameId: input.gameId,
      ply: input.blunderPly + 1,
      ...cleanSourceMeta(input.sourceMeta),
      ...(credit.attribution ? { attribution: credit.attribution } : {}),
    },
  };
  if (!validateStandardXiangqiPuzzle(puzzle).ok) {
    return { ok: false, reason: 'validation-failed' };
  }
  return { ok: true, puzzle };
}

/** Drop null/undefined/blank attribution fields so sourceGame stays minimal
 *  ({ gameId, ply }) when the source row has no metadata. */
function cleanSourceMeta(
  meta: XiangqiMineCandidateInput['sourceMeta'],
): Partial<
  Pick<
    NonNullable<XiangqiPuzzle['sourceGame']>,
    'event' | 'playedOn' | 'result' | 'redName' | 'blackName'
  >
> {
  if (!meta) return {};
  const out: Record<string, string> = {};
  for (const key of ['event', 'playedOn', 'result', 'redName', 'blackName'] as const) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim().length > 0) out[key] = value;
  }
  return out;
}
