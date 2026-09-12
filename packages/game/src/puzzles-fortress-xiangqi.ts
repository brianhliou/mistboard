// Fortress Xiangqi mate-puzzle model + solver.
//
// Puzzle kernel for the single Fortress Xiangqi
// variant (7x8, opposite-corner palaces, crazyhouse drops, Treasure). A puzzle
// is a legal position with the solver to move and a forced-checkmate solution
// line; solver plies are the even indices (0, 2, 4, ...), defender replies the
// odd ones. The generator lives in
// scripts/variant-lab/fortress-xiangqi-puzzle-miner.ts.
//
// Since #183 the SERVED corpus lives in the committed seed assets
// (packages/game/seed/puzzles/fortress-xiangqi.json +
// seed/source-games/fortress-xiangqi.json) and in the server's `puzzles`
// table; the FORTRESS_XIANGQI_PUZZLES / FORTRESS_XIANGQI_SOURCE_GAMES arrays
// below are small TEST fixture sets, not the serving set.

import type { FORTRESS_XIANGQI_SPEC_ID } from './game-specs.js';
import {
  FIXTURE_FORTRESS_XIANGQI_PUZZLES,
  FIXTURE_FORTRESS_XIANGQI_SOURCE_GAMES,
} from './puzzles-fortress-xiangqi-fixtures.js';
import {
  applyFortressXiangqiMove,
  createInitialFortressXiangqiState,
  type FortressXiangqiColor,
  type FortressXiangqiDropRole,
  type FortressXiangqiGameState,
  type FortressXiangqiGameStatus,
  type FortressXiangqiMove,
  getFortressXiangqiLegalMoves,
  isFortressXiangqiDropMove,
  isFortressXiangqiGeneralInCheckOnBoard,
  isFortressXiangqiLegalMove,
  oppositeFortressXiangqiColor,
} from './variants-fortress-xiangqi.js';

export type FortressXiangqiPuzzleTheme =
  | 'back-rank'
  | 'cannon'
  | 'chariot'
  | 'checkmate'
  | 'drop'
  | 'horse'
  | 'palace-net'
  | 'treasure'
  | 'winning';

export type FortressXiangqiPuzzleGoal =
  | {
      type: 'checkmate';
      winner?: FortressXiangqiColor;
    }
  // A forced material/positional win that does NOT end in mate. The kernel has
  // no evaluator, so — unlike a checkmate goal — it cannot re-verify that the
  // final position is "winning"; that judgment is the miner's (Fairy-Stockfish).
  // Validation only guarantees a fully legal line that ends on the solver's move
  // (the payoff), and `centipawns` records FSF's eval for reference/seeding.
  | {
      type: 'winning-advantage';
      winner?: FortressXiangqiColor;
      centipawns?: number;
    };

export type FortressXiangqiPuzzle = {
  id: string;
  variant: typeof FORTRESS_XIANGQI_SPEC_ID;
  title: string;
  initial: FortressXiangqiGameState;
  solution: FortressXiangqiMove[];
  goal: FortressXiangqiPuzzleGoal;
  themes: FortressXiangqiPuzzleTheme[];
  // Optional pointer to the full game this position came from (FSF self-play for
  // tactics). Enables a future "from game" analysis link, Lichess-style; the game
  // itself lives in FORTRESS_XIANGQI_SOURCE_GAMES. `ply` = moves played from the
  // start before the puzzle position, so replaying the game to `ply` reproduces
  // `initial` (asserted by the corpus test).
  sourceGame?: { gameId: string; ply: number };
};

// A full recorded game a tactic was mined from (kernel-native, from the start
// position). Kept so the puzzle can link to the game in analysis later; not yet
// persisted to prod. Emitted by the tactics ingest.
export type FortressXiangqiSourceGame = {
  id: string;
  variant: typeof FORTRESS_XIANGQI_SPEC_ID;
  moves: FortressXiangqiMove[];
};

export type FortressXiangqiPuzzleValidationIssueCode =
  | 'ambiguous-immediate-general-capture'
  | 'dominated-by-mate-in-one'
  | 'empty-solution'
  | 'illegal-move'
  | 'not-playing'
  | 'solution-continues-after-finish'
  | 'solution-ended-before-goal'
  | 'solution-must-end-on-solver-move'
  | 'wrong-finish-reason'
  | 'wrong-winner';

export type FortressXiangqiPuzzleValidationIssue = {
  code: FortressXiangqiPuzzleValidationIssueCode;
  message: string;
  ply: number;
  move?: FortressXiangqiMove;
};

export type FortressXiangqiPuzzleValidationResult =
  | {
      ok: true;
      puzzleId: string;
      solver: FortressXiangqiColor;
      // 'finished' for checkmate goals; 'playing' for winning-advantage goals
      // (the line stops at the payoff move, the game continues).
      finalStatus: FortressXiangqiGameStatus;
      plyCount: number;
    }
  | {
      ok: false;
      puzzleId: string;
      issue: FortressXiangqiPuzzleValidationIssue;
    };

export type FortressXiangqiPuzzleAttemptFailureCode =
  | 'incorrect-move'
  | 'illegal-move'
  | 'line-too-long';

export type FortressXiangqiPuzzleAttemptResult =
  | {
      ok: true;
      puzzleId: string;
      playedMoves: FortressXiangqiMove[];
      solverMoves: FortressXiangqiMove[];
      complete: boolean;
      ply: number;
      state: FortressXiangqiGameState;
      lastMove?: FortressXiangqiMove;
    }
  | {
      ok: false;
      puzzleId: string;
      code: FortressXiangqiPuzzleAttemptFailureCode;
      ply: number;
      state: FortressXiangqiGameState;
      move: FortressXiangqiMove;
    };

export type FortressXiangqiMateInOneCandidate = {
  state: FortressXiangqiGameState;
  move: FortressXiangqiMove;
  winner: FortressXiangqiColor;
};

// TEST fixture registry, NOT the serving set (see the module header).
export const FORTRESS_XIANGQI_PUZZLES: readonly FortressXiangqiPuzzle[] = [
  ...FIXTURE_FORTRESS_XIANGQI_PUZZLES,
];

export function fortressXiangqiPuzzleById(id: string): FortressXiangqiPuzzle | null {
  return FORTRESS_XIANGQI_PUZZLES.find((puzzle) => puzzle.id === id) ?? null;
}

export const FORTRESS_XIANGQI_SOURCE_GAMES: readonly FortressXiangqiSourceGame[] =
  FIXTURE_FORTRESS_XIANGQI_SOURCE_GAMES;

export function fortressXiangqiSourceGameById(id: string): FortressXiangqiSourceGame | null {
  return FORTRESS_XIANGQI_SOURCE_GAMES.find((game) => game.id === id) ?? null;
}

// Replays a recorded source game's first `ply` moves from the start position.
// Returns null if any move is illegal (a broken recording). Used by the linkage
// test and the future "from game" analysis surface.
export function replayFortressXiangqiSourceGameToPly(
  game: FortressXiangqiSourceGame,
  ply: number,
): FortressXiangqiGameState | null {
  let state = createInitialFortressXiangqiState(game.id);
  for (let i = 0; i < ply; i += 1) {
    const move = game.moves[i];
    if (!move) return null;
    const next = applyPuzzleMove(state, move);
    if (!next) return null;
    state = next;
  }
  return state;
}

// All solver moves that deliver immediate checkmate for the side to move.
// Skips positions where the defender is already in check (not a clean puzzle
// start: the mate has effectively already happened).
export function findFortressXiangqiMateInOneCandidates(
  state: FortressXiangqiGameState,
): FortressXiangqiMateInOneCandidate[] {
  if (state.status.type !== 'playing') return [];
  const attacker = state.status.turn;
  if (isDefenderAlreadyInCheck(state, attacker)) return [];
  const candidates: FortressXiangqiMateInOneCandidate[] = [];
  for (const move of getFortressXiangqiLegalMoves(state)) {
    const next = applyPuzzleMove(state, move);
    if (
      next?.status.type === 'finished' &&
      next.status.reason === 'checkmate' &&
      next.status.winner === attacker
    ) {
      candidates.push({ state, move, winner: attacker });
    }
  }
  return candidates;
}

export function validateFortressXiangqiPuzzle(
  puzzle: FortressXiangqiPuzzle,
): FortressXiangqiPuzzleValidationResult {
  if (puzzle.initial.status.type !== 'playing') {
    return validationError(puzzle, 'not-playing', 0, 'Puzzle initial state must be playable.');
  }
  if (puzzle.solution.length === 0) {
    return validationError(puzzle, 'empty-solution', 0, 'Puzzle solution must contain a move.');
  }

  const immediateGeneralCaptures = immediateGeneralCaptureMoves(puzzle.initial);
  const firstMove = puzzle.solution[0] as FortressXiangqiMove;
  if (
    immediateGeneralCaptures.length > 0 &&
    !immediateGeneralCaptures.some((move) => fortressXiangqiPuzzleMoveEquals(move, firstMove))
  ) {
    return validationError(
      puzzle,
      'ambiguous-immediate-general-capture',
      0,
      'Puzzle initial state allows an immediate general capture outside the solution.',
      immediateGeneralCaptures[0],
    );
  }

  const solver = puzzle.initial.status.turn;
  let state: FortressXiangqiGameState = puzzle.initial;
  for (let ply = 0; ply < puzzle.solution.length; ply += 1) {
    const move = puzzle.solution[ply] as FortressXiangqiMove;
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
    // A winning-advantage puzzle must not sit on a checkmate-in-one: that mate ends the
    // game and dominates the material/positional payoff, making the puzzle degenerate.
    // The immediate-general-capture guard above catches wins-by-capture; this catches
    // wins-by-mate (checkmate without taking the general). Exact and cheap — a full
    // one-ply mate scan. Deeper forced mates that FSF scored as a big cp value rather
    // than `#` are not caught here (no cheap exact fortress mate search beyond one ply).
    const matesInOne = findFortressXiangqiMateInOneCandidates(puzzle.initial);
    if (matesInOne.length > 0) {
      return validationError(
        puzzle,
        'dominated-by-mate-in-one',
        0,
        'Winning-advantage puzzle sits on a checkmate-in-one that dominates the payoff.',
        matesInOne[0]?.move,
      );
    }
    // No checkmate to verify. The line must end on the solver's own move (the
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
      'Puzzle solution ended before the goal was reached.',
    );
  }
  if (state.status.reason !== 'checkmate') {
    return validationError(
      puzzle,
      'wrong-finish-reason',
      puzzle.solution.length,
      `Expected checkmate, got ${state.status.reason}.`,
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

export function fortressXiangqiPuzzleSideToMove(
  puzzle: FortressXiangqiPuzzle,
): FortressXiangqiColor | null {
  return puzzle.initial.status.type === 'playing' ? puzzle.initial.status.turn : null;
}

export function fortressXiangqiPuzzleNextMove(
  puzzle: FortressXiangqiPuzzle,
  playedPlyCount: number,
): FortressXiangqiMove | null {
  return (puzzle.solution[playedPlyCount] as FortressXiangqiMove | undefined) ?? null;
}

export function isFortressXiangqiPuzzleSolverPly(playedPlyCount: number): boolean {
  return playedPlyCount % 2 === 0;
}

export function fortressXiangqiPuzzleMoveEquals(
  left: FortressXiangqiMove,
  right: FortressXiangqiMove,
): boolean {
  if (isFortressXiangqiDropMove(left) || isFortressXiangqiDropMove(right)) {
    return (
      isFortressXiangqiDropMove(left) &&
      isFortressXiangqiDropMove(right) &&
      left.drop === right.drop &&
      left.to === right.to
    );
  }
  return left.from === right.from && left.to === right.to;
}

export function fortressXiangqiPuzzleMoveLabel(move: FortressXiangqiMove): string {
  if (isFortressXiangqiDropMove(move)) return `${dropRoleLetter(move.drop)}@${move.to}`;
  return `${move.from}-${move.to}`;
}

// Replays a solver's guesses against the solution. Even plies are the solver's
// moves (checked against the solution); after each correct solver move the
// scripted defender reply is auto-applied, so the caller only ever submits
// solver moves.
export function attemptFortressXiangqiPuzzleLine(
  puzzle: FortressXiangqiPuzzle,
  solverMoves: readonly FortressXiangqiMove[],
): FortressXiangqiPuzzleAttemptResult {
  let state: FortressXiangqiGameState = puzzle.initial;
  let lastMove: FortressXiangqiMove | null = null;
  let solutionPly = 0;
  const playedMoves: FortressXiangqiMove[] = [];
  const acceptedSolverMoves: FortressXiangqiMove[] = [];
  for (const move of solverMoves) {
    const expected = puzzle.solution[solutionPly] as FortressXiangqiMove | undefined;
    if (!expected) {
      return attemptFailure(puzzle, 'line-too-long', playedMoves.length, state, move);
    }
    if (!fortressXiangqiPuzzleMoveEquals(move, expected)) {
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
    const reply = puzzle.solution[solutionPly] as FortressXiangqiMove | undefined;
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
  // A checkmate puzzle is only complete once the board is actually mated; a
  // winning-advantage puzzle completes when the scripted line is exhausted (the
  // game is still in progress at the payoff move).
  const lineExhausted = solutionPly >= puzzle.solution.length;
  const complete =
    puzzle.goal.type === 'checkmate'
      ? lineExhausted && state.status.type === 'finished'
      : lineExhausted;
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

function applyPuzzleMove(
  state: FortressXiangqiGameState,
  move: FortressXiangqiMove,
): FortressXiangqiGameState | null {
  if (state.status.type !== 'playing') return null;
  if (!isFortressXiangqiLegalMove(state, move)) return null;
  return applyFortressXiangqiMove(state, move);
}

function immediateGeneralCaptureMoves(state: FortressXiangqiGameState): FortressXiangqiMove[] {
  if (state.status.type !== 'playing') return [];
  const defender = oppositeFortressXiangqiColor(state.status.turn);
  const defenderGeneral = findGeneralSquare(state, defender);
  if (!defenderGeneral) return [];
  return getFortressXiangqiLegalMoves(state).filter(
    (move) => !isFortressXiangqiDropMove(move) && move.to === defenderGeneral,
  );
}

function isDefenderAlreadyInCheck(
  state: FortressXiangqiGameState,
  attacker: FortressXiangqiColor,
): boolean {
  return isFortressXiangqiGeneralInCheckOnBoard(
    state.board,
    oppositeFortressXiangqiColor(attacker),
  );
}

function findGeneralSquare(
  state: FortressXiangqiGameState,
  color: FortressXiangqiColor,
): string | null {
  for (const [square, piece] of Object.entries(state.board)) {
    if (piece?.color === color && piece.role === 'general') return square;
  }
  return null;
}

function validationError(
  puzzle: FortressXiangqiPuzzle,
  code: FortressXiangqiPuzzleValidationIssueCode,
  ply: number,
  message: string,
  move?: FortressXiangqiMove,
): FortressXiangqiPuzzleValidationResult {
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
  puzzle: FortressXiangqiPuzzle,
  code: FortressXiangqiPuzzleAttemptFailureCode,
  ply: number,
  state: FortressXiangqiGameState,
  move: FortressXiangqiMove,
): FortressXiangqiPuzzleAttemptResult {
  return {
    ok: false,
    puzzleId: puzzle.id,
    code,
    ply,
    state,
    move,
  };
}

function dropRoleLetter(role: FortressXiangqiDropRole): string {
  switch (role) {
    case 'chariot':
      return 'R';
    case 'horse':
      return 'N';
    case 'cannon':
      return 'C';
    case 'soldier':
      return 'P';
    case 'treasure':
      return 'Q';
    case 'advisor':
      return 'A';
    case 'elephant':
      return 'E';
  }
}
