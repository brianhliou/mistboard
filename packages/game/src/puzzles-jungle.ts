// Jungle (Dou Shou Qi / 斗兽棋) forced-win puzzle model + solver.
//
// Parallels the deleted Fortress Xiangqi puzzle model, but for the single Jungle variant
// (7x9, dens, water lakes, traps, animal-rank capture). Jungle has NO check or
// checkmate: a game ends when a piece enters the opponent's den, the opponent
// has no pieces left, or the opponent has no legal move (stalemate) — each with
// a definite winner. So the fortress "mate-in-N" frame becomes "win-in-N", and
// the kernel is a self-contained terminal oracle (unlike fortress, which needed
// an external evaluator even to validate non-mate lines).
//
// A puzzle is a legal position with the solver to move and a forced-win solution
// line; solver plies are the even indices (0, 2, 4, ...), defender replies the
// odd ones. The generator lives in scripts/variant-lab/jungle-puzzle-miner.ts.
//
// Since #183 the SERVED corpus lives in the committed seed assets
// (packages/game/seed/puzzles/jungle.json + seed/source-games/jungle.json) and
// in the server's `puzzles` table; the JUNGLE_PUZZLES / JUNGLE_SOURCE_GAMES
// arrays below are small TEST fixture sets, not the serving set.

import type { JUNGLE_SPEC_ID } from './game-specs.js';
import { FIXTURE_JUNGLE_PUZZLES, FIXTURE_JUNGLE_SOURCE_GAMES } from './puzzles-jungle-fixtures.js';
import {
  applyJungleMove,
  createInitialJungleState,
  getJungleLegalMoves,
  isJungleLegalMove,
  type JungleBoard,
  type JungleColor,
  type JungleGameState,
  type JungleGameStatus,
  type JungleMove,
  type JunglePieceRole,
} from './variants-jungle.js';

export type JunglePuzzleTheme =
  | 'den-race'
  | 'capture-all'
  | 'stalemate'
  | 'trap'
  | 'water-leap'
  | 'rank-up'
  | 'rat'
  | 'elephant'
  | 'lion'
  | 'tiger'
  | 'winning';

export type JunglePuzzleGoal =
  | {
      // A forced win: the line ends in a finished position won by the solver
      // (den entry, all opponent pieces captured, or opponent stalemated). The
      // kernel re-verifies this at validation time.
      type: 'win';
      winner?: JungleColor;
    }
  // A forced material/positional win that does NOT end the game. The kernel has
  // no evaluator, so — unlike a `win` goal — it cannot re-verify that the final
  // position is "winning"; that judgment is the miner's (our MistyJungle engine).
  // Validation only guarantees a fully legal line that ends on the solver's move
  // (the payoff), and `centipawns` records the engine eval for reference/seeding.
  | {
      type: 'winning-advantage';
      winner?: JungleColor;
      centipawns?: number;
    };

export type JunglePuzzle = {
  id: string;
  variant: typeof JUNGLE_SPEC_ID;
  title: string;
  initial: JungleGameState;
  solution: JungleMove[];
  goal: JunglePuzzleGoal;
  themes: JunglePuzzleTheme[];
  // Optional pointer to the full game this position came from (engine self-play
  // for tactics). Enables a future "from game" analysis link, Lichess-style; the
  // game itself lives in JUNGLE_SOURCE_GAMES. `ply` = moves played from the start
  // before the puzzle position, so replaying the game to `ply` reproduces
  // `initial` (asserted by the corpus test).
  sourceGame?: { gameId: string; ply: number };
};

// A full recorded game a tactic was mined from (kernel-native, from the start
// position). Kept so the puzzle can link to the game in analysis later; not yet
// persisted to prod. Emitted by the tactics ingest.
export type JungleSourceGame = {
  id: string;
  variant: typeof JUNGLE_SPEC_ID;
  moves: JungleMove[];
};

export type JunglePuzzleValidationIssueCode =
  | 'ambiguous-immediate-win'
  | 'dominated-by-forced-win'
  | 'empty-solution'
  | 'illegal-move'
  | 'not-playing'
  | 'solution-continues-after-finish'
  | 'solution-ended-before-goal'
  | 'solution-must-end-on-solver-move'
  | 'wrong-winner';

export type JunglePuzzleValidationIssue = {
  code: JunglePuzzleValidationIssueCode;
  message: string;
  ply: number;
  move?: JungleMove;
};

export type JunglePuzzleValidationResult =
  | {
      ok: true;
      puzzleId: string;
      solver: JungleColor;
      // 'finished' for `win` goals; 'playing' for winning-advantage goals (the
      // line stops at the payoff move, the game continues).
      finalStatus: JungleGameStatus;
      plyCount: number;
    }
  | {
      ok: false;
      puzzleId: string;
      issue: JunglePuzzleValidationIssue;
    };

export type JunglePuzzleAttemptFailureCode = 'incorrect-move' | 'illegal-move' | 'line-too-long';

export type JunglePuzzleAttemptResult =
  | {
      ok: true;
      puzzleId: string;
      playedMoves: JungleMove[];
      solverMoves: JungleMove[];
      complete: boolean;
      ply: number;
      state: JungleGameState;
      lastMove?: JungleMove;
    }
  | {
      ok: false;
      puzzleId: string;
      code: JunglePuzzleAttemptFailureCode;
      ply: number;
      state: JungleGameState;
      move: JungleMove;
    };

export type JungleWinInOneCandidate = {
  state: JungleGameState;
  move: JungleMove;
  winner: JungleColor;
};

// TEST fixture registry, NOT the serving set (see the module header).
export const JUNGLE_PUZZLES: readonly JunglePuzzle[] = [...FIXTURE_JUNGLE_PUZZLES];

export function junglePuzzleById(id: string): JunglePuzzle | null {
  return JUNGLE_PUZZLES.find((puzzle) => puzzle.id === id) ?? null;
}

export const JUNGLE_SOURCE_GAMES: readonly JungleSourceGame[] = FIXTURE_JUNGLE_SOURCE_GAMES;

export function jungleSourceGameById(id: string): JungleSourceGame | null {
  return JUNGLE_SOURCE_GAMES.find((game) => game.id === id) ?? null;
}

// Replays a recorded source game's first `ply` moves from the start position.
// Returns null if any move is illegal (a broken recording). Used by the linkage
// test and the future "from game" analysis surface.
export function replayJungleSourceGameToPly(
  game: JungleSourceGame,
  ply: number,
): JungleGameState | null {
  let state = createInitialJungleState(game.id);
  for (let i = 0; i < ply; i += 1) {
    const move = game.moves[i];
    if (!move) return null;
    const next = applyPuzzleMove(state, move);
    if (!next) return null;
    state = next;
  }
  return state;
}

// All solver moves that immediately win for the side to move (den entry, final
// capture, or stalemating the opponent).
export function findJungleWinInOneCandidates(state: JungleGameState): JungleWinInOneCandidate[] {
  if (state.status.type !== 'playing') return [];
  const solver = state.status.turn;
  const candidates: JungleWinInOneCandidate[] = [];
  for (const move of getJungleLegalMoves(state)) {
    const next = applyPuzzleMove(state, move);
    if (next?.status.type === 'finished' && next.status.winner === solver) {
      candidates.push({ state, move, winner: solver });
    }
  }
  return candidates;
}

export type JungleForcedWinOptions = {
  // Require EVERY legal defender reply to allow a continuation (a true forced win,
  // not just one that survives the defender's best try). Default true.
  strictReplies?: boolean;
  // Recursive-node search budget. Default 200_000. On overrun the search bails and
  // returns [] (treated as "no forced win found within budget").
  nodeLimit?: number;
};

// All forced-win lines that win in EXACTLY `solverPlies` solver moves for the side
// to move (solver plies are the even indices; defender replies the odd ones). A
// position with a shorter forced win yields [] here, so "win-in-k" is unambiguous.
// Empty when no such line exists within the node budget.
export function findJungleForcedWinLines(
  state: JungleGameState,
  solverPlies: number,
  options: JungleForcedWinOptions = {},
): JungleMove[][] {
  if (state.status.type !== 'playing' || solverPlies < 1) return [];
  const budget: ForcedWinBudget = { remaining: options.nodeLimit ?? 200_000, cutOff: false };
  const strict = options.strictReplies ?? true;
  const attacker = state.status.turn;
  // Enforce EXACT depth: reject the whole position if a strictly shorter forced win
  // exists (else a win-in-2 would also be reported as a win-in-3 via a slower move).
  for (let shorter = 1; shorter < solverPlies; shorter += 1) {
    if (exactWinLines(state, attacker, shorter, strict, budget).length > 0) return [];
    if (budget.cutOff) return [];
  }
  const lines = exactWinLines(state, attacker, solverPlies, strict, budget);
  return budget.cutOff ? [] : lines;
}

// The shortest forced win (1..maxSolverPlies) with a UNIQUE winning first move, or
// null. Turns an engine-flagged "forced win here" position into a clean, gradeable
// puzzle line: the engine finds the win fast, this extracts + de-dupes it.
export function findJungleForcedWinLine(
  state: JungleGameState,
  maxSolverPlies: number,
  options: JungleForcedWinOptions & { requireUnique?: boolean } = {},
): JungleMove[] | null {
  if (state.status.type !== 'playing') return null;
  const requireUnique = options.requireUnique ?? true;
  for (let plies = 1; plies <= maxSolverPlies; plies += 1) {
    const lines = findJungleForcedWinLines(state, plies, options);
    if (lines.length === 0) continue;
    const firstMoves = new Set(lines.map((line) => `${line[0]!.from}-${line[0]!.to}`));
    if (requireUnique && firstMoves.size > 1) return null;
    return lines[0]!;
  }
  return null;
}

// ── Material tactics (win a piece, game continues) ───────────────────────────
//
// A forced-win puzzle ends the game (den/capture/stalemate). A MATERIAL tactic
// instead wins decisive material with the game still going — "Black to move, win
// the lion". These are found by a pure-material minimax with quiescence (so an
// in-progress exchange is resolved before the balance is read), which is exact and
// kernel-verifiable: unlike the fortress engine "winning-advantage", the claim is a
// concrete piece-count delta, not a heuristic eval. Piece values weight the rat
// highly because it beats the elephant (mirrors the engine's material weights).

export const JUNGLE_MATERIAL_VALUE: Record<JunglePieceRole, number> = {
  rat: 65,
  cat: 22,
  dog: 30,
  wolf: 40,
  leopard: 50,
  tiger: 75,
  lion: 90,
  elephant: 100,
};

// A win/loss dwarfs any material swing, so a terminal dominates the search — the
// solver never trades material for a lost den, and does take a winning line if one
// exists (those get filtered out; they belong to the forced-win miner).
const JUNGLE_MATERIAL_MATE = 100_000;

// Horizon (in solver plies) within which a forced win DOMINATES a winning-advantage
// material payoff. findJungleMaterialTactic refuses a position with a win this shallow,
// and validateJunglePuzzle rejects a winning-advantage puzzle that sits on one — both
// use this bound so the mine-time filter and the ship-time gate stay in sync. Matches
// the default material search reach (maxSolverPlies 2, checked out to +2).
const WINNING_ADVANTAGE_DOMINATION_HORIZON = 4;

export type JungleMaterialTactic = {
  line: JungleMove[];
  // Guaranteed material the solver wins (in JUNGLE_MATERIAL_VALUE units) against
  // best defense, over the forced line.
  gain: number;
};

export type JungleMaterialTacticOptions = {
  maxSolverPlies?: number; // default 2 (win-material-in-1 and -in-2)
  minGain?: number; // minimum guaranteed material gain to count. default 30 (a dog)
  uniqueMargin?: number; // best first move must beat the 2nd best by this. default 20
  nodeLimit?: number; // per-position search budget. default 120_000
};

// Solver-perspective material balance of a playing position (own minus opponent).
export function jungleMaterialBalance(board: JungleBoard, color: JungleColor): number {
  let mine = 0;
  let theirs = 0;
  for (const square of Object.keys(board) as (keyof JungleBoard)[]) {
    const piece = board[square];
    if (!piece) continue;
    const value = JUNGLE_MATERIAL_VALUE[piece.role];
    if (piece.color === color) mine += value;
    else theirs += value;
  }
  return mine - theirs;
}

// The shortest forced line (1..maxSolverPlies solver moves) that wins >= minGain
// material with a UNIQUE first move, or null. The line ends on the solver's move
// (odd length), game still in progress — a `winning-advantage` puzzle shape.
export function findJungleMaterialTactic(
  state: JungleGameState,
  options: JungleMaterialTacticOptions = {},
): JungleMaterialTactic | null {
  if (state.status.type !== 'playing') return null;
  const maxSolverPlies = options.maxSolverPlies ?? 2;
  const minGain = options.minGain ?? 30;
  const uniqueMargin = options.uniqueMargin ?? 20;
  const budget: ForcedWinBudget = { remaining: options.nodeLimit ?? 120_000, cutOff: false };
  const solver = state.status.turn;
  const baseline = jungleMaterialBalance(state.board, solver);

  for (let plies = 1; plies <= maxSolverPlies; plies += 1) {
    const depth = plies * 2 - 1; // solver moves + interleaved defender replies
    const scored = rootMaterialScores(state, depth, budget);
    if (budget.cutOff || scored.length === 0) return null;
    const best = scored[0]!;
    const gain = best.score - baseline;
    // A forced WIN (mate value) is the forced-win miner's job, not a material tactic.
    if (best.score >= JUNGLE_MATERIAL_MATE - 1000) continue;
    if (gain < minGain) continue;
    // Uniqueness: the best move must beat every other first move by the margin, so
    // the puzzle has one clear answer.
    const second = scored[1]?.score ?? -Number.POSITIVE_INFINITY;
    if (best.score - second < uniqueMargin) return null;
    // A position with a forced WIN belongs to the forced-win miner, NOT here — even when
    // the win needs more solver plies than the material gain. The per-depth mate check
    // above only rejects a win found at the SAME depth as the gain, so a win-in-2 that
    // dominates a material-gain-in-1 slips through (a den-entry wins the game while
    // changing zero material, so a pure-material search can't see it without reaching the
    // terminal). Run this only now that a qualifying tactic exists — the exact forced-win
    // search is expensive, so it must not run on every scanned position.
    const dominatingWin = findJungleForcedWinLine(state, maxSolverPlies + 2, {
      nodeLimit: options.nodeLimit ?? 120_000,
      requireUnique: false,
    });
    if (dominatingWin !== null) return null;
    const line = buildMaterialLine(state, best.move, depth, budget);
    if (budget.cutOff || line.length === 0) return null;
    return { line, gain };
  }
  return null;
}

type ScoredMatMove = { move: JungleMove; score: number };

// Exact score of every root move (full window), best-first — the material analogue
// of the engine's MultiPV, used to pick the unique best material move.
function rootMaterialScores(
  state: JungleGameState,
  depth: number,
  budget: ForcedWinBudget,
): ScoredMatMove[] {
  if (state.status.type !== 'playing') return [];
  const solver = state.status.turn;
  const scored: ScoredMatMove[] = [];
  for (const move of orderMaterialMoves(state)) {
    const child = applyJungleMove(state, move);
    const terminal = materialTerminalValue(child, solver);
    const score =
      terminal !== null
        ? terminal
        : -jungleMaterialSearch(
            child,
            depth - 1,
            -JUNGLE_MATERIAL_MATE,
            JUNGLE_MATERIAL_MATE,
            budget,
          );
    if (budget.cutOff) return [];
    scored.push({ move, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// Greedy principal variation: at each node the mover plays its best material move,
// building a line of `depth` plies that ends on the solver's move.
function buildMaterialLine(
  state: JungleGameState,
  firstMove: JungleMove,
  depth: number,
  budget: ForcedWinBudget,
): JungleMove[] {
  const line: JungleMove[] = [firstMove];
  let cursor = applyJungleMove(state, firstMove);
  for (let ply = 1; ply < depth; ply += 1) {
    if (cursor.status.type !== 'playing') break;
    const scored = rootMaterialScores(cursor, depth - 1 - ply, budget);
    if (budget.cutOff || scored.length === 0) break;
    const move = scored[0]!.move;
    line.push(move);
    cursor = applyJungleMove(cursor, move);
  }
  return line;
}

// Negamax over material; side-to-move perspective. Terminals dominate; leaves are
// resolved by a capture-only quiescence search so a mid-exchange balance is never read.
function jungleMaterialSearch(
  state: JungleGameState,
  depth: number,
  alpha: number,
  beta: number,
  budget: ForcedWinBudget,
): number {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    budget.cutOff = true;
    return 0;
  }
  if (state.status.type !== 'playing') return 0;
  if (depth <= 0) return jungleMaterialQuiesce(state, alpha, beta, budget);
  const mover = state.status.turn;
  let best = -JUNGLE_MATERIAL_MATE;
  for (const move of orderMaterialMoves(state)) {
    const child = applyJungleMove(state, move);
    const terminal = materialTerminalValue(child, mover);
    const score =
      terminal !== null ? terminal : -jungleMaterialSearch(child, depth - 1, -beta, -alpha, budget);
    if (budget.cutOff) return 0;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function jungleMaterialQuiesce(
  state: JungleGameState,
  alpha: number,
  beta: number,
  budget: ForcedWinBudget,
): number {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    budget.cutOff = true;
    return 0;
  }
  if (state.status.type !== 'playing') return 0;
  const mover = state.status.turn;
  const standPat = jungleMaterialBalance(state.board, mover);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  for (const move of orderMaterialMoves(state)) {
    if (!state.board[move.to]) continue; // captures only
    const child = applyJungleMove(state, move);
    const terminal = materialTerminalValue(child, mover);
    const score =
      terminal !== null ? terminal : -jungleMaterialQuiesce(child, -beta, -alpha, budget);
    if (budget.cutOff) return 0;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// Value of a just-reached state from `mover`'s perspective, or null if still playing.
function materialTerminalValue(state: JungleGameState, mover: JungleColor): number | null {
  if (state.status.type !== 'finished') return null;
  if (state.status.winner === null) return 0;
  return state.status.winner === mover ? JUNGLE_MATERIAL_MATE : -JUNGLE_MATERIAL_MATE;
}

// Captures first (high-value target first), then quiet moves — alpha-beta ordering.
function orderMaterialMoves(state: JungleGameState): JungleMove[] {
  if (state.status.type !== 'playing') return [];
  const moves = getJungleLegalMoves(state);
  return moves
    .map((move) => {
      const target = state.board[move.to];
      return { move, rank: target ? 1000 + JUNGLE_MATERIAL_VALUE[target.role] : 0 };
    })
    .sort((a, b) => b.rank - a.rank)
    .map((entry) => entry.move);
}

export function validateJunglePuzzle(puzzle: JunglePuzzle): JunglePuzzleValidationResult {
  if (puzzle.initial.status.type !== 'playing') {
    return validationError(puzzle, 'not-playing', 0, 'Puzzle initial state must be playable.');
  }
  if (puzzle.solution.length === 0) {
    return validationError(puzzle, 'empty-solution', 0, 'Puzzle solution must contain a move.');
  }

  // If the position already has an immediate win available, the intended first
  // move must BE one of those wins — otherwise a trivial faster win exists and
  // the puzzle is degenerate (mirrors fortress's immediate-general-capture guard).
  const immediateWins = immediateJungleWinMoves(puzzle.initial);
  const firstMove = puzzle.solution[0] as JungleMove;
  if (
    immediateWins.length > 0 &&
    !immediateWins.some((move) => junglePuzzleMoveEquals(move, firstMove))
  ) {
    return validationError(
      puzzle,
      'ambiguous-immediate-win',
      0,
      'Puzzle initial state allows an immediate win outside the solution.',
      immediateWins[0],
    );
  }

  const solver = puzzle.initial.status.turn;
  let state: JungleGameState = puzzle.initial;
  for (let ply = 0; ply < puzzle.solution.length; ply += 1) {
    const move = puzzle.solution[ply] as JungleMove;
    if (state.status.type !== 'playing') {
      return validationError(
        puzzle,
        'solution-continues-after-finish',
        ply,
        'Puzzle solution continues after the game is already finished.',
        move,
      );
    }
    const applied = applyPuzzleMove(state, move);
    if (!applied) {
      return validationError(puzzle, 'illegal-move', ply, 'Illegal puzzle move.', move);
    }
    state = applied;
  }

  const expectedWinner = puzzle.goal.winner ?? solver;

  if (puzzle.goal.type === 'winning-advantage') {
    // A winning-advantage puzzle must not sit on a forced game-win: that win
    // dominates the material payoff and makes the puzzle degenerate. This is the
    // multi-ply generalization of the immediate-win guard above — findJungleMaterialTactic
    // refuses these at mine time, and this enforces the same invariant at the gate so a
    // dominated puzzle (from a finder regression or a hand-edit) can never ship.
    const dominatingWin = findJungleForcedWinLine(
      puzzle.initial,
      WINNING_ADVANTAGE_DOMINATION_HORIZON,
      { requireUnique: false },
    );
    if (dominatingWin !== null) {
      return validationError(
        puzzle,
        'dominated-by-forced-win',
        0,
        'Winning-advantage puzzle sits on a forced win that dominates the material payoff.',
        dominatingWin[0],
      );
    }
    // No terminal to verify. The line must end on the solver's own move (the
    // payoff): solver plies are the even indices, so the final index
    // (length - 1) must be even, i.e. the length must be odd.
    if (puzzle.solution.length % 2 === 0) {
      return validationError(
        puzzle,
        'solution-must-end-on-solver-move',
        puzzle.solution.length,
        'Winning-advantage solution must end on the solver move, so its length must be odd.',
      );
    }
    return {
      ok: true,
      puzzleId: puzzle.id,
      solver,
      finalStatus: state.status,
      plyCount: puzzle.solution.length,
    };
  }

  if (state.status.type !== 'finished') {
    return validationError(
      puzzle,
      'solution-ended-before-goal',
      puzzle.solution.length,
      'Puzzle solution ended before the win was reached.',
    );
  }
  if (state.status.winner !== expectedWinner) {
    return validationError(
      puzzle,
      'wrong-winner',
      puzzle.solution.length,
      `Expected ${expectedWinner} to win.`,
    );
  }

  return {
    ok: true,
    puzzleId: puzzle.id,
    solver,
    finalStatus: state.status,
    plyCount: puzzle.solution.length,
  };
}

export function junglePuzzleSideToMove(puzzle: JunglePuzzle): JungleColor | null {
  return puzzle.initial.status.type === 'playing' ? puzzle.initial.status.turn : null;
}

export function junglePuzzleNextMove(
  puzzle: JunglePuzzle,
  playedPlyCount: number,
): JungleMove | null {
  return (puzzle.solution[playedPlyCount] as JungleMove | undefined) ?? null;
}

export function isJunglePuzzleSolverPly(playedPlyCount: number): boolean {
  return playedPlyCount % 2 === 0;
}

export function junglePuzzleMoveEquals(left: JungleMove, right: JungleMove): boolean {
  return left.from === right.from && left.to === right.to;
}

export function junglePuzzleMoveLabel(move: JungleMove): string {
  return `${move.from}-${move.to}`;
}

// Replays a solver's guesses against the solution. Even plies are the solver's
// moves (checked against the solution); after each correct solver move the
// scripted defender reply is auto-applied, so the caller only ever submits
// solver moves.
export function attemptJunglePuzzleLine(
  puzzle: JunglePuzzle,
  solverMoves: readonly JungleMove[],
): JunglePuzzleAttemptResult {
  let state: JungleGameState = puzzle.initial;
  let lastMove: JungleMove | null = null;
  let solutionPly = 0;
  const playedMoves: JungleMove[] = [];
  const acceptedSolverMoves: JungleMove[] = [];
  for (const move of solverMoves) {
    const expected = puzzle.solution[solutionPly] as JungleMove | undefined;
    if (!expected) {
      return attemptFailure(puzzle, 'line-too-long', playedMoves.length, state, move);
    }
    if (!junglePuzzleMoveEquals(move, expected)) {
      return attemptFailure(puzzle, 'incorrect-move', playedMoves.length, state, move);
    }
    const applied = applyPuzzleMove(state, move);
    if (!applied) {
      return attemptFailure(puzzle, 'illegal-move', playedMoves.length, state, move);
    }
    state = applied;
    lastMove = move;
    playedMoves.push(move);
    acceptedSolverMoves.push(move);
    solutionPly += 1;

    if (state.status.type !== 'playing' || solutionPly >= puzzle.solution.length) continue;
    const reply = puzzle.solution[solutionPly] as JungleMove | undefined;
    if (!reply) continue;
    const replied = applyPuzzleMove(state, reply);
    if (!replied) {
      return attemptFailure(puzzle, 'illegal-move', playedMoves.length, state, reply);
    }
    state = replied;
    lastMove = reply;
    playedMoves.push(reply);
    solutionPly += 1;
  }

  const ply = playedMoves.length;
  // A `win` puzzle is only complete once the board is actually decided; a
  // winning-advantage puzzle completes when the scripted line is exhausted (the
  // game is still in progress at the payoff move).
  const lineExhausted = solutionPly >= puzzle.solution.length;
  const complete =
    puzzle.goal.type === 'win' ? lineExhausted && state.status.type === 'finished' : lineExhausted;
  return {
    ok: true,
    puzzleId: puzzle.id,
    playedMoves,
    solverMoves: acceptedSolverMoves,
    complete,
    ply,
    state,
    ...(lastMove ? { lastMove } : {}),
  };
}

function applyPuzzleMove(state: JungleGameState, move: JungleMove): JungleGameState | null {
  if (state.status.type !== 'playing') return null;
  if (!isJungleLegalMove(state, move)) return null;
  return applyJungleMove(state, move);
}

type ForcedWinBudget = { remaining: number; cutOff: boolean };

// All moves that immediately win for `attacker` (the side to move).
function winInOneMoves(
  state: JungleGameState,
  attacker: JungleColor,
  budget: ForcedWinBudget,
): JungleMove[] {
  if (state.status.type !== 'playing' || state.status.turn !== attacker) return [];
  const moves: JungleMove[] = [];
  for (const move of getJungleLegalMoves(state)) {
    budget.remaining -= 1;
    if (budget.remaining < 0) {
      budget.cutOff = true;
      return [];
    }
    const next = applyJungleMove(state, move);
    if (next.status.type === 'finished' && next.status.winner === attacker) moves.push(move);
  }
  return moves;
}

// Forced-win lines of EXACTLY `solverPlies` solver moves, from `attacker`'s turn.
// A node with an immediate win at depth > 1 returns [] (that win is shorter), so
// every returned line needs its full remaining depth. With `strict`, every legal
// defender reply must permit a continuation (a genuine forced win); otherwise the
// principal line suffices.
function exactWinLines(
  state: JungleGameState,
  attacker: JungleColor,
  solverPlies: number,
  strict: boolean,
  budget: ForcedWinBudget,
): JungleMove[][] {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    budget.cutOff = true;
    return [];
  }
  if (state.status.type !== 'playing' || state.status.turn !== attacker) return [];

  const immediateWins = winInOneMoves(state, attacker, budget);
  if (budget.cutOff) return [];
  if (solverPlies === 1) return immediateWins.map((move) => [move]);
  if (immediateWins.length > 0) return []; // a shorter win exists here

  const lines: JungleMove[][] = [];
  for (const firstMove of getJungleLegalMoves(state)) {
    const afterFirst = applyJungleMove(state, firstMove);
    if (afterFirst.status.type !== 'playing') continue;

    const defenderReplies = getJungleLegalMoves(afterFirst);
    if (defenderReplies.length === 0) continue;

    const replyLines: JungleMove[][] = [];
    let refuted = false;
    for (const reply of defenderReplies) {
      const afterReply = applyJungleMove(afterFirst, reply);
      if (afterReply.status.type !== 'playing' || afterReply.status.turn !== attacker) {
        // The defender's reply ended the game (or handed the turn away) without an
        // attacker win → this first move does not force the win.
        refuted = true;
        break;
      }
      const continuations = exactWinLines(afterReply, attacker, solverPlies - 1, strict, budget);
      if (budget.cutOff) return [];
      if (continuations.length === 0) {
        if (strict) {
          refuted = true;
          break;
        }
        continue;
      }
      replyLines.push([firstMove, reply, ...continuations[0]!]);
    }
    if (
      !refuted &&
      replyLines.length > 0 &&
      (!strict || replyLines.length === defenderReplies.length)
    ) {
      lines.push(...replyLines);
    }
  }
  return lines;
}

function immediateJungleWinMoves(state: JungleGameState): JungleMove[] {
  if (state.status.type !== 'playing') return [];
  const solver = state.status.turn;
  return getJungleLegalMoves(state).filter((move) => {
    const next = applyPuzzleMove(state, move);
    return next?.status.type === 'finished' && next.status.winner === solver;
  });
}

function validationError(
  puzzle: JunglePuzzle,
  code: JunglePuzzleValidationIssueCode,
  ply: number,
  message: string,
  move?: JungleMove,
): JunglePuzzleValidationResult {
  return {
    ok: false,
    puzzleId: puzzle.id,
    issue: {
      code,
      message,
      ply,
      ...(move ? { move } : {}),
    },
  };
}

function attemptFailure(
  puzzle: JunglePuzzle,
  code: JunglePuzzleAttemptFailureCode,
  ply: number,
  state: JungleGameState,
  move: JungleMove,
): JunglePuzzleAttemptResult {
  return {
    ok: false,
    puzzleId: puzzle.id,
    code,
    ply,
    state,
    move,
  };
}
