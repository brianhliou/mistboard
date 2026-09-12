import { type GameSpecId, MINI_XIANGQI_SPEC_ID } from './game-specs.js';
import {
  applyMiniXiangqiOpenMove,
  getMiniXiangqiLegalMoves,
  getMiniXiangqiOpenLegalMoves,
  isMiniXiangqiGeneralInCheckOnBoard,
  isMiniXiangqiOpenLegalMove,
  type MiniXiangqiBoard,
  type MiniXiangqiColor,
  type MiniXiangqiGameState,
  type MiniXiangqiGameStatus,
  type MiniXiangqiMove,
  type MiniXiangqiSquare,
  miniXiangqiPositionRepetitionKey,
  oppositeMiniXiangqiColor,
} from './variants-mini-xiangqi.js';

export type MiniXiangqiPuzzleVariant = typeof MINI_XIANGQI_SPEC_ID;

export type MiniXiangqiPuzzleTheme = 'back-rank' | 'checkmate' | 'chariot' | 'palace-net';

export type MiniXiangqiPuzzleGoal = {
  type: 'checkmate';
  winner?: MiniXiangqiColor;
};

type MiniXiangqiPuzzleBase<Variant extends MiniXiangqiPuzzleVariant, State, Move> = {
  id: string;
  variant: Variant;
  title: string;
  initial: State;
  solution: Move[];
  goal: MiniXiangqiPuzzleGoal;
  themes: MiniXiangqiPuzzleTheme[];
};

export type OpenMiniXiangqiPuzzle = MiniXiangqiPuzzleBase<
  typeof MINI_XIANGQI_SPEC_ID,
  MiniXiangqiGameState,
  MiniXiangqiMove
>;

export type MiniXiangqiPuzzle = OpenMiniXiangqiPuzzle;
export type MiniXiangqiPuzzleMove = MiniXiangqiMove;
export type MiniXiangqiPuzzleState = MiniXiangqiGameState;

export type MiniXiangqiPuzzleValidationIssueCode =
  | 'ambiguous-immediate-general-capture'
  | 'empty-solution'
  | 'illegal-move'
  | 'not-playing'
  | 'solution-continues-after-finish'
  | 'solution-ended-before-goal'
  | 'unsupported-variant'
  | 'wrong-finish-reason'
  | 'wrong-move-shape'
  | 'wrong-winner';

export type MiniXiangqiPuzzleValidationIssue = {
  code: MiniXiangqiPuzzleValidationIssueCode;
  message: string;
  ply: number;
  move?: MiniXiangqiPuzzleMove;
};

export type MiniXiangqiPuzzleValidationResult =
  | {
      ok: true;
      puzzleId: string;
      variant: MiniXiangqiPuzzleVariant;
      solver: MiniXiangqiColor;
      finalStatus: Extract<MiniXiangqiGameStatus, { type: 'finished' }>;
      plyCount: number;
    }
  | {
      ok: false;
      puzzleId: string;
      variant: MiniXiangqiPuzzleVariant | GameSpecId;
      issue: MiniXiangqiPuzzleValidationIssue;
    };

export type MiniXiangqiPuzzleAttemptFailureCode =
  | 'incorrect-move'
  | 'illegal-move'
  | 'line-too-long'
  | 'wrong-move-shape';

export type MiniXiangqiPuzzleAttemptResult =
  | {
      ok: true;
      puzzleId: string;
      variant: MiniXiangqiPuzzleVariant;
      playedMoves: MiniXiangqiPuzzleMove[];
      solverMoves: MiniXiangqiPuzzleMove[];
      complete: boolean;
      ply: number;
      state: MiniXiangqiPuzzleState;
      lastMove?: MiniXiangqiPuzzleMove;
    }
  | {
      ok: false;
      puzzleId: string;
      variant: MiniXiangqiPuzzleVariant;
      code: MiniXiangqiPuzzleAttemptFailureCode;
      ply: number;
      state: MiniXiangqiPuzzleState;
      move: MiniXiangqiPuzzleMove;
    };

export type MiniXiangqiMateInOneCandidate = {
  variant: MiniXiangqiPuzzleVariant;
  state: MiniXiangqiPuzzleState;
  move: MiniXiangqiPuzzleMove;
  winner: MiniXiangqiColor;
};

// Hand-built TEST fixture registry. Since #183 the SERVED corpus (these twelve
// hand-built puzzles plus the mined drop-mini set) lives in the committed seed
// asset packages/game/seed/puzzles/mini-xiangqi.json and in the server's
// `puzzles` table; this array exists for kernel/unit/adapter tests. Assembled
// by a named builder behind a @__PURE__ annotation (instead of an inline
// module-scope array literal full of helper calls) so bundlers can prove the
// initializer is side-effect-free and drop the corpus from chunks that never
// read it: the raw module-scope construction defeated tree-shaking and shipped
// the puzzle data in the web entry chunk.
export const MINI_XIANGQI_PUZZLES: readonly MiniXiangqiPuzzle[] =
  /* @__PURE__ */ buildMiniXiangqiPuzzles();

function buildMiniXiangqiPuzzles(): readonly MiniXiangqiPuzzle[] {
  return [
    {
      id: 'mini-xiangqi-red-back-rank-net-1',
      variant: MINI_XIANGQI_SPEC_ID,
      title: 'Red back-rank net',
      initial: miniPuzzleState(
        'mini-xiangqi-red-back-rank-net-1',
        {
          c1: { color: 'red', role: 'chariot' },
          c4: { color: 'red', role: 'chariot' },
          d1: { color: 'red', role: 'general' },
          d2: { color: 'red', role: 'soldier' },
          e1: { color: 'red', role: 'chariot' },
          d7: { color: 'black', role: 'general' },
        },
        'red',
      ),
      solution: [{ from: 'c4', to: 'd4' }],
      goal: { type: 'checkmate', winner: 'red' },
      themes: ['back-rank', 'checkmate', 'chariot', 'palace-net'],
    },
    {
      id: 'mini-xiangqi-black-back-rank-net-1',
      variant: MINI_XIANGQI_SPEC_ID,
      title: 'Black back-rank net',
      initial: miniPuzzleState(
        'mini-xiangqi-black-back-rank-net-1',
        {
          c7: { color: 'black', role: 'chariot' },
          c4: { color: 'black', role: 'chariot' },
          d7: { color: 'black', role: 'general' },
          d6: { color: 'black', role: 'soldier' },
          e7: { color: 'black', role: 'chariot' },
          d1: { color: 'red', role: 'general' },
        },
        'black',
      ),
      solution: [{ from: 'c4', to: 'd4' }],
      goal: { type: 'checkmate', winner: 'black' },
      themes: ['back-rank', 'checkmate', 'chariot', 'palace-net'],
    },
    {
      id: 'mini-xiangqi-black-two-step-file-net-1',
      variant: MINI_XIANGQI_SPEC_ID,
      title: 'Black two-step file net',
      initial: miniPuzzleState(
        'mini-xiangqi-black-two-step-file-net-1',
        {
          b3: { color: 'black', role: 'soldier' },
          c5: { color: 'black', role: 'general' },
          e2: { color: 'red', role: 'general' },
          f1: { color: 'black', role: 'chariot' },
        },
        'black',
      ),
      solution: [
        { from: 'c5', to: 'd5' },
        { from: 'e2', to: 'e3' },
        { from: 'f1', to: 'e1' },
      ],
      goal: { type: 'checkmate', winner: 'black' },
      themes: ['back-rank', 'checkmate', 'chariot', 'palace-net'],
    },
    {
      id: 'mini-xiangqi-red-cannon-switch-mate-1',
      variant: MINI_XIANGQI_SPEC_ID,
      title: 'Red cannon switch mate',
      initial: miniPuzzleState(
        'mini-xiangqi-red-cannon-switch-mate-1',
        {
          a1: { color: 'red', role: 'chariot' },
          a2: { color: 'red', role: 'soldier' },
          a6: { color: 'black', role: 'soldier' },
          b3: { color: 'red', role: 'soldier' },
          b7: { color: 'black', role: 'chariot' },
          c1: { color: 'red', role: 'horse' },
          c6: { color: 'black', role: 'soldier' },
          c7: { color: 'black', role: 'horse' },
          d1: { color: 'red', role: 'general' },
          d3: { color: 'red', role: 'soldier' },
          d6: { color: 'black', role: 'general' },
          e2: { color: 'red', role: 'cannon' },
          f2: { color: 'red', role: 'soldier' },
          f4: { color: 'black', role: 'cannon' },
          f6: { color: 'black', role: 'soldier' },
          g1: { color: 'red', role: 'chariot' },
        },
        'red',
      ),
      solution: [
        { from: 'e2', to: 'd2' },
        { from: 'd6', to: 'e6' },
        { from: 'g1', to: 'e1' },
        { from: 'f4', to: 'e4' },
        { from: 'e1', to: 'e4' },
      ],
      goal: { type: 'checkmate', winner: 'red' },
      themes: ['checkmate', 'chariot', 'palace-net'],
    },
    {
      id: 'mini-xiangqi-red-double-chariot-file-mate-1',
      variant: MINI_XIANGQI_SPEC_ID,
      title: 'Red double chariot file mate',
      initial: miniPuzzleState(
        'mini-xiangqi-red-double-chariot-file-mate-1',
        {
          c1: { color: 'red', role: 'horse' },
          c2: { color: 'red', role: 'soldier' },
          c4: { color: 'black', role: 'soldier' },
          c7: { color: 'black', role: 'horse' },
          d1: { color: 'red', role: 'general' },
          d2: { color: 'red', role: 'cannon' },
          d6: { color: 'black', role: 'general' },
          e1: { color: 'red', role: 'horse' },
          e2: { color: 'red', role: 'soldier' },
          e6: { color: 'black', role: 'soldier' },
          e7: { color: 'black', role: 'horse' },
          f3: { color: 'black', role: 'cannon' },
          f5: { color: 'red', role: 'chariot' },
          g2: { color: 'red', role: 'soldier' },
          g5: { color: 'red', role: 'chariot' },
        },
        'red',
      ),
      solution: [
        { from: 'f5', to: 'd5' },
        { from: 'd6', to: 'c6' },
        { from: 'd5', to: 'c5' },
        { from: 'c6', to: 'd6' },
        { from: 'g5', to: 'd5' },
      ],
      goal: { type: 'checkmate', winner: 'red' },
      themes: ['checkmate', 'chariot', 'palace-net'],
    },
    {
      id: 'mini-xiangqi-red-horse-return-mate-1',
      variant: MINI_XIANGQI_SPEC_ID,
      title: 'Red horse return mate',
      initial: miniPuzzleState(
        'mini-xiangqi-red-horse-return-mate-1',
        {
          a6: { color: 'red', role: 'horse' },
          b3: { color: 'black', role: 'soldier' },
          d2: { color: 'red', role: 'general' },
          d7: { color: 'red', role: 'chariot' },
          e6: { color: 'black', role: 'general' },
          f6: { color: 'black', role: 'soldier' },
          g1: { color: 'black', role: 'chariot' },
        },
        'red',
      ),
      solution: [
        { from: 'a6', to: 'c5' },
        { from: 'e6', to: 'e5' },
        { from: 'd7', to: 'e7' },
        { from: 'f6', to: 'e6' },
        { from: 'c5', to: 'd7' },
      ],
      goal: { type: 'checkmate', winner: 'red' },
      themes: ['checkmate', 'palace-net'],
    },
  ];
}

export function miniXiangqiPuzzleById(id: string): MiniXiangqiPuzzle | null {
  return MINI_XIANGQI_PUZZLES.find((puzzle) => puzzle.id === id) ?? null;
}

export function miniXiangqiPuzzlesForVariant(
  variant: MiniXiangqiPuzzleVariant,
): MiniXiangqiPuzzle[] {
  return MINI_XIANGQI_PUZZLES.filter((puzzle) => puzzle.variant === variant);
}

export function findMiniXiangqiMateInOneCandidates(
  variant: MiniXiangqiPuzzleVariant,
  state: MiniXiangqiPuzzleState,
): MiniXiangqiMateInOneCandidate[] {
  if (state.status.type !== 'playing') return [];
  const attacker = state.status.turn;
  if (isDefenderAlreadyInCheck(variant, state, attacker)) return [];
  const moves = legalPuzzleMoves(variant, state);
  const candidates: MiniXiangqiMateInOneCandidate[] = [];
  for (const move of moves) {
    const next = applyPuzzleMove(variant, state, move);
    if (
      next?.status.type === 'finished' &&
      next.status.reason === 'checkmate' &&
      next.status.winner === attacker
    ) {
      candidates.push({ variant, state, move, winner: attacker });
    }
  }
  return candidates;
}

export function validateMiniXiangqiPuzzle(
  puzzle: MiniXiangqiPuzzle,
): MiniXiangqiPuzzleValidationResult {
  if (puzzle.initial.status.type !== 'playing') {
    return validationError(puzzle, 'not-playing', 0, 'Puzzle initial state must be playable.');
  }
  if (puzzle.solution.length === 0) {
    return validationError(puzzle, 'empty-solution', 0, 'Puzzle solution must contain a move.');
  }
  const immediateGeneralCaptures = immediateGeneralCaptureMoves(puzzle.initial);
  const firstMove = puzzle.solution[0] as MiniXiangqiPuzzleMove;
  if (
    immediateGeneralCaptures.length > 0 &&
    !immediateGeneralCaptures.some((move) => miniXiangqiPuzzleMoveEquals(move, firstMove))
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
  let state: MiniXiangqiPuzzleState = puzzle.initial;
  for (let ply = 0; ply < puzzle.solution.length; ply += 1) {
    const move = puzzle.solution[ply] as MiniXiangqiPuzzleMove;
    if (state.status.type !== 'playing') {
      return validationError(
        puzzle,
        'solution-continues-after-finish',
        ply,
        'Puzzle solution continues after the game is already finished.',
        move,
      );
    }

    const applied = applyPuzzleMove(puzzle.variant, state, move);
    if (!applied) {
      return validationError(
        puzzle,
        moveShapeIssueCode(puzzle.variant, move),
        ply,
        'Illegal puzzle move.',
        move,
      );
    }
    state = applied;
  }

  if (state.status.type !== 'finished') {
    return validationError(
      puzzle,
      'solution-ended-before-goal',
      puzzle.solution.length,
      'Puzzle solution ended before the goal was reached.',
    );
  }

  const expectedWinner = puzzle.goal.winner ?? solver;
  if (puzzle.goal.type === 'checkmate' && state.status.reason !== 'checkmate') {
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
    variant: puzzle.variant,
    solver,
    finalStatus: state.status,
    plyCount: puzzle.solution.length,
  };
}

export function miniXiangqiPuzzleSideToMove(puzzle: MiniXiangqiPuzzle): MiniXiangqiColor | null {
  return puzzle.initial.status.type === 'playing' ? puzzle.initial.status.turn : null;
}

export function miniXiangqiPuzzleNextMove(
  puzzle: MiniXiangqiPuzzle,
  playedPlyCount: number,
): MiniXiangqiPuzzleMove | null {
  return (puzzle.solution[playedPlyCount] as MiniXiangqiPuzzleMove | undefined) ?? null;
}

export function isMiniXiangqiPuzzleSolverPly(playedPlyCount: number): boolean {
  return playedPlyCount % 2 === 0;
}

export function miniXiangqiPuzzleMoveEquals(
  left: MiniXiangqiPuzzleMove,
  right: MiniXiangqiPuzzleMove,
): boolean {
  return left.from === right.from && left.to === right.to;
}

export function miniXiangqiPuzzleMoveLabel(move: MiniXiangqiPuzzleMove): string {
  return `${move.from}-${move.to}`;
}

export function attemptMiniXiangqiPuzzleLine(
  puzzle: MiniXiangqiPuzzle,
  solverMoves: readonly MiniXiangqiPuzzleMove[],
): MiniXiangqiPuzzleAttemptResult {
  let state: MiniXiangqiPuzzleState = puzzle.initial;
  let lastMove: MiniXiangqiPuzzleMove | null = null;
  let solutionPly = 0;
  const playedMoves: MiniXiangqiPuzzleMove[] = [];
  const acceptedSolverMoves: MiniXiangqiPuzzleMove[] = [];
  for (const move of solverMoves) {
    const expected = puzzle.solution[solutionPly] as MiniXiangqiPuzzleMove | undefined;
    if (!expected) {
      return attemptFailure(puzzle, 'line-too-long', playedMoves.length, state, move);
    }
    if (!miniXiangqiPuzzleMoveEquals(move, expected)) {
      const code = moveShapeIssueCode(puzzle.variant, move);
      return attemptFailure(
        puzzle,
        code === 'wrong-move-shape' ? 'wrong-move-shape' : 'incorrect-move',
        playedMoves.length,
        state,
        move,
      );
    }
    const applied = applyPuzzleMove(puzzle.variant, state, move);
    if (!applied) {
      return attemptFailure(puzzle, 'illegal-move', playedMoves.length, state, move);
    }
    state = applied;
    lastMove = move;
    playedMoves.push(move);
    acceptedSolverMoves.push(move);
    solutionPly += 1;

    if (state.status.type !== 'playing' || solutionPly >= puzzle.solution.length) continue;
    const reply = puzzle.solution[solutionPly] as MiniXiangqiPuzzleMove | undefined;
    if (!reply) continue;
    const replied = applyPuzzleMove(puzzle.variant, state, reply);
    if (!replied) {
      return attemptFailure(puzzle, 'illegal-move', playedMoves.length, state, reply);
    }
    state = replied;
    lastMove = reply;
    playedMoves.push(reply);
    solutionPly += 1;
  }

  const ply = playedMoves.length;
  return {
    ok: true,
    puzzleId: puzzle.id,
    variant: puzzle.variant,
    playedMoves,
    solverMoves: acceptedSolverMoves,
    complete: solutionPly >= puzzle.solution.length && state.status.type === 'finished',
    ply,
    state,
    ...(lastMove ? { lastMove } : {}),
  };
}

function applyPuzzleMove(
  variant: MiniXiangqiPuzzleVariant,
  state: MiniXiangqiPuzzleState,
  move: MiniXiangqiPuzzleMove,
): MiniXiangqiPuzzleState | null {
  if (variant !== MINI_XIANGQI_SPEC_ID) return null;
  if (!isMiniXiangqiOpenLegalMove(state, move)) return null;
  return applyMiniXiangqiOpenMove(state, move);
}

function legalPuzzleMoves(
  variant: MiniXiangqiPuzzleVariant,
  state: MiniXiangqiPuzzleState,
): MiniXiangqiPuzzleMove[] {
  if (variant !== MINI_XIANGQI_SPEC_ID) return [];
  return getMiniXiangqiOpenLegalMoves(state);
}

function immediateGeneralCaptureMoves(state: MiniXiangqiPuzzleState): MiniXiangqiMove[] {
  if (state.status.type !== 'playing') return [];
  const defender = oppositeMiniXiangqiColor(state.status.turn);
  const defenderGeneral = findGeneralSquare(state.board, defender);
  if (!defenderGeneral) return [];
  return getMiniXiangqiLegalMoves({
    id: state.id,
    board: state.board,
    status: state.status,
    moveNumber: state.moveNumber,
    progressClock: state.progressClock,
    positionCounts: {},
  }).filter((move) => move.to === defenderGeneral);
}

function isDefenderAlreadyInCheck(
  variant: MiniXiangqiPuzzleVariant,
  state: MiniXiangqiPuzzleState,
  attacker: MiniXiangqiColor,
): boolean {
  const defender = attacker === 'red' ? 'black' : 'red';
  if (variant !== MINI_XIANGQI_SPEC_ID) return false;
  return isMiniXiangqiGeneralInCheckOnBoard(state.board, defender);
}

function findGeneralSquare(
  board: MiniXiangqiBoard,
  color: MiniXiangqiColor,
): MiniXiangqiSquare | null {
  for (const [square, piece] of Object.entries(board)) {
    if (piece?.color === color && piece.role === 'general') return square as MiniXiangqiSquare;
  }
  return null;
}

function moveShapeIssueCode(
  variant: MiniXiangqiPuzzleVariant,
  move: MiniXiangqiPuzzleMove,
): MiniXiangqiPuzzleValidationIssueCode {
  return variant === MINI_XIANGQI_SPEC_ID && 'drop' in move ? 'wrong-move-shape' : 'illegal-move';
}

function validationError(
  puzzle: MiniXiangqiPuzzle,
  code: MiniXiangqiPuzzleValidationIssueCode,
  ply: number,
  message: string,
  move?: MiniXiangqiPuzzleMove,
): MiniXiangqiPuzzleValidationResult {
  return {
    ok: false,
    puzzleId: puzzle.id,
    variant: puzzle.variant,
    issue: {
      code,
      message,
      ply,
      ...(move ? { move } : {}),
    },
  };
}

function attemptFailure(
  puzzle: MiniXiangqiPuzzle,
  code: MiniXiangqiPuzzleAttemptFailureCode,
  ply: number,
  state: MiniXiangqiPuzzleState,
  move: MiniXiangqiPuzzleMove,
): MiniXiangqiPuzzleAttemptResult {
  return {
    ok: false,
    puzzleId: puzzle.id,
    variant: puzzle.variant,
    code,
    ply,
    state,
    move,
  };
}

function miniPuzzleState(
  id: string,
  board: MiniXiangqiBoard,
  turn: MiniXiangqiColor,
): MiniXiangqiGameState {
  const state: MiniXiangqiGameState = {
    id,
    board,
    status: { type: 'playing', turn },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
  return {
    ...state,
    positionCounts: { [miniXiangqiPositionRepetitionKey(state)]: 1 },
  };
}
