export type Color = 'white' | 'black';

export type VariantId = 'dark-chess' | 'chess';

export type Square =
  | 'a1'
  | 'b1'
  | 'c1'
  | 'd1'
  | 'e1'
  | 'f1'
  | 'g1'
  | 'h1'
  | 'a2'
  | 'b2'
  | 'c2'
  | 'd2'
  | 'e2'
  | 'f2'
  | 'g2'
  | 'h2'
  | 'a3'
  | 'b3'
  | 'c3'
  | 'd3'
  | 'e3'
  | 'f3'
  | 'g3'
  | 'h3'
  | 'a4'
  | 'b4'
  | 'c4'
  | 'd4'
  | 'e4'
  | 'f4'
  | 'g4'
  | 'h4'
  | 'a5'
  | 'b5'
  | 'c5'
  | 'd5'
  | 'e5'
  | 'f5'
  | 'g5'
  | 'h5'
  | 'a6'
  | 'b6'
  | 'c6'
  | 'd6'
  | 'e6'
  | 'f6'
  | 'g6'
  | 'h6'
  | 'a7'
  | 'b7'
  | 'c7'
  | 'd7'
  | 'e7'
  | 'f7'
  | 'g7'
  | 'h7'
  | 'a8'
  | 'b8'
  | 'c8'
  | 'd8'
  | 'e8'
  | 'f8'
  | 'g8'
  | 'h8';

export type PieceRole = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

export type Piece = {
  color: Color;
  role: PieceRole;
};

export type Board = Partial<Record<Square, Piece>>;

export type Move = {
  from: Square;
  to: Square;
  promotion?: Exclude<PieceRole, 'king' | 'pawn'>;
};

export type ClockState = {
  activeColor: Color | null;
  incrementMs: number;
  initialMs: number;
  remainingMs: Record<Color, number>;
  runningSince: number | null;
};

export type GameEndReason =
  | 'checkmate'
  | 'draw'
  | 'king-captured'
  | 'timeout'
  | 'resignation'
  | 'abandonment';

export const gameEndReasons: readonly GameEndReason[] = [
  'checkmate',
  'draw',
  'king-captured',
  'timeout',
  'resignation',
  'abandonment',
] as const;

export function isGameEndReason(value: unknown): value is GameEndReason {
  return typeof value === 'string' && (gameEndReasons as readonly string[]).includes(value);
}

// 'engine-unavailable': a PvE bot could not be reached for its opening move, so the
// game is voided (no result) instead of scored as a resignation the human never earned.
export type AbortReason = 'pregame-timeout' | 'user-abort' | 'engine-unavailable';

export const abortReasons: readonly AbortReason[] = [
  'pregame-timeout',
  'user-abort',
  'engine-unavailable',
] as const;

export function isAbortReason(value: unknown): value is AbortReason {
  return typeof value === 'string' && (abortReasons as readonly string[]).includes(value);
}

export type GameStatus =
  | { type: 'playing'; turn: Color }
  | { type: 'finished'; winner: Color | null; reason: GameEndReason }
  | { type: 'aborted'; reason: AbortReason };

export type GameState = {
  id: string;
  variant: VariantId;
  board: Board;
  status: GameStatus;
  moveNumber: number;
  castlingRights: Square[];
  enPassantSquare?: Square;
  halfmoveClock: number;
  lastMove?: Move;
  clock?: ClockState;
  positionCounts?: Record<string, number>;
};

export type PlayerView = {
  id: string;
  variant: VariantId;
  board: Board;
  visibleSquares: Square[];
  legalMoves: Move[];
  status: GameStatus;
  perspective: Color;
  moveNumber: number;
  lastMove?: Move;
  clock?: ClockState;
};

export type Variant = {
  id: VariantId;
  createInitialState(gameId: string): GameState;
  getLegalMoves(state: GameState, player: Color): Move[];
  applyMove(state: GameState, move: Move): GameState;
  getPlayerView(state: GameState, player: Color): PlayerView;
  isGameOver(state: GameState): GameStatus | null;
};
