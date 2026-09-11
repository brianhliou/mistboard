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
//   - The uniqueness rule for the verify pass (best must win AND clear the
//     second line by a gap, or be the only mate).
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
import { trimXiangqiWinningAdvantageMoves } from './puzzles-xiangqi-trim.js';
import {
  positionRepetitionKey,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
} from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
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

export type XiangqiUniquenessOptions = {
  winCp: number;
  uniqueGapCp: number;
};

/** MultiPV(2) verify rule: the best line must still be winning AND uniquely
 *  best — either it is the only legal move (no second line), it mates while
 *  the second line does not, or it clears the second line by uniqueGapCp. */
export function isXiangqiUniquelyWinning(
  lines: readonly XiangqiVerifyLine[],
  opts: XiangqiUniquenessOptions,
): boolean {
  const best = lines[0];
  if (!best) return false;
  if (best.scoreCp < opts.winCp) return false;
  const second = lines[1];
  if (!second) return true; // only move
  const bestMates = best.mate !== null && best.mate > 0;
  const secondMates = second.mate !== null && second.mate > 0;
  if (bestMates && !secondMates) return true;
  return best.scoreCp - second.scoreCp >= opts.uniqueGapCp;
}

// ── Winning-floor uniqueness (per-ply gate for the gated re-mine) ────────────
//
// A relative cp gap is the wrong test for a puzzle move: two moves 50cp apart
// are both good, so forcing one is unfair. What makes a solver move THE answer
// is that every alternative is actually wrong — it loses the win, or it wins a
// whole piece less. This gate encodes that: best must keep a clear win, and the
// runner-up must either drop out of "winning" or trail by a decisive material
// margin. Mates bypass cp/win% (both saturate): unique only when nothing else mates.
//
// win% is a logistic map of cp; K is the eval scale (matches the audit tool's
// mapping, so the miner and the audit agree on "unique"). The knobs are win%
// thresholds plus one cp material margin.

const XIANGQI_WINRATE_K = 400;

/** Logistic cp -> win probability for the side to move. */
export function xiangqiWinRate(cp: number): number {
  return 1 / (1 + 10 ** (-cp / XIANGQI_WINRATE_K));
}

export type XiangqiSolverUniquenessOptions = {
  /** Best line must reach at least this win probability to be a puzzle move. */
  winHi: number;
  /** A runner-up at or below this win probability has lost the win (=> wrong). */
  winLo: number;
  /** Hard stability floor: reject any non-mate runner-up closer than this even
   *  when it happens to straddle the winLo boundary in one engine process. */
  minGapCp: number;
  /** ...or a runner-up trailing best by at least this many cp is wrong even if
   *  it is still nominally winning (win the chariot, not the horse). */
  materialGapCp: number;
};

export type XiangqiSolverUniquenessReason =
  | 'missing-best'
  | 'only-mate'
  | 'mate-in-one'
  | 'mate-not-unique'
  | 'best-not-winning'
  | 'only-move'
  | 'runner-up-mates'
  | 'near-tie'
  | 'runner-up-loses-win'
  | 'material-gap'
  | 'alternative-still-good';

export type XiangqiSolverUniquenessVerdict = {
  unique: boolean;
  reason: XiangqiSolverUniquenessReason;
};

/** Per-ply gate for a solver move: is the best line uniquely correct? True when
 *  best keeps a clear win AND the runner-up is actually wrong (lost the win or
 *  trails by a whole piece). Mates: unique iff no other move mates at all,
 *  whatever its length, except that a mate-in-one ply is always unique. This
 *  is the lichess rule (adopted 2026-09-11): the grader accepts a stored line
 *  plus any move that mates on the spot, nothing else, so a position with a
 *  second, slower mate is a trap and not a puzzle, while a second mate-in-one
 *  is simply another accepted answer. Before this
 *  the branch admitted "strictly fastest of two mates", which put 237 puzzles
 *  with a known second answer on the site. MultiPV 2 is sufficient: if the
 *  runner-up does not mate, no lower line does. No runner-up => the only move
 *  => unique. */
export function classifyXiangqiSolverMoveUniqueness(
  best: XiangqiVerifyLine | undefined,
  second: XiangqiVerifyLine | undefined,
  opts: XiangqiSolverUniquenessOptions,
): XiangqiSolverUniquenessVerdict {
  if (!best) return { unique: false, reason: 'missing-best' };
  const bestMates = best.mate !== null && best.mate > 0;
  if (bestMates) {
    // The grader accepts any move that mates on the spot, so a mate-in-one ply
    // is unique whatever else mates: every alternative the solver could pick is
    // either accepted (mates now) or genuinely worse (mates later).
    if (best.mate === 1) return { unique: true, reason: 'mate-in-one' };
    if (!second) return { unique: true, reason: 'only-mate' };
    const secondMate = second.mate;
    if (secondMate === null || secondMate <= 0) return { unique: true, reason: 'only-mate' };
    return { unique: false, reason: 'mate-not-unique' };
  }
  if (xiangqiWinRate(best.scoreCp) < opts.winHi) {
    return { unique: false, reason: 'best-not-winning' };
  }
  if (!second) return { unique: true, reason: 'only-move' };
  if (second.mate !== null && second.mate > 0) {
    return { unique: false, reason: 'runner-up-mates' };
  }
  const gapCp = best.scoreCp - second.scoreCp;
  if (gapCp < opts.minGapCp) return { unique: false, reason: 'near-tie' };
  if (xiangqiWinRate(second.scoreCp) <= opts.winLo) {
    return { unique: true, reason: 'runner-up-loses-win' };
  }
  if (gapCp >= opts.materialGapCp) return { unique: true, reason: 'material-gap' };
  return { unique: false, reason: 'alternative-still-good' };
}

export function isXiangqiSolverMoveUnique(
  best: XiangqiVerifyLine | undefined,
  second: XiangqiVerifyLine | undefined,
  opts: XiangqiSolverUniquenessOptions,
): boolean {
  return classifyXiangqiSolverMoveUniqueness(best, second, opts).unique;
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
  };
};

export type XiangqiMineReject = XiangqiSolutionBuildReject | 'not-playing' | 'validation-failed';

export type XiangqiMineResult =
  | { ok: true; puzzle: XiangqiPuzzle }
  | { ok: false; reason: XiangqiMineReject };

/** Build (and kernel-re-validate) a mined puzzle from a verified candidate. */
export function assembleMinedXiangqiPuzzle(
  input: XiangqiMineCandidateInput,
  opts: Omit<XiangqiSolutionBuildOptions, 'mateExpected'>,
): XiangqiMineResult {
  if (input.postBlunderState.status.type !== 'playing') {
    return { ok: false, reason: 'not-playing' };
  }
  const solver = input.postBlunderState.status.turn;
  const id = `xq-mined-${input.gameId}-${input.blunderPly + 1}`;
  const initial = makeXiangqiPuzzleInitial(input.postBlunderState, id);
  const mateExpected = input.verifyScore.mate !== null && input.verifyScore.mate > 0;
  const built = buildXiangqiSolutionFromPv(initial, input.pv, { ...opts, mateExpected });
  if (!built.ok) return built;

  const goal: XiangqiPuzzleGoal = built.endedByMate
    ? { type: 'checkmate', winner: solver }
    : { type: 'winning-advantage', winner: solver, centipawns: input.verifyScore.scoreCp };
  // A winning-advantage line ends on its payoff: trim the quiet PV tail back to
  // the solver's last capture. This can leave a bare 1-ply capture ("win the
  // hanging piece") — kept as a legitimate easy puzzle, not re-floored.
  const solution =
    goal.type === 'winning-advantage'
      ? trimXiangqiWinningAdvantageMoves(initial, built.moves)
      : built.moves;
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
