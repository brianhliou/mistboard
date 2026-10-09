// A seated player's view of a fog variant's starting position, built from the
// rules kernel: what you would see the moment you sit down, before either side
// has moved. Your own Fog seek card (/correspondence "Waiting for an opponent")
// draws it, so the card shows your side of the board instead of a plain tile.
//
// Only the seat's own view ever leaves this module: Fog Xiangqi's shrouded
// entries are re-encoded to colour only, exactly as the server's
// redactShroudedXiangqiView does for the wire, so the renderer never holds a
// piece identity the seat could not see. A non-participant gets no view at all;
// callers draw a plain tile for someone else's fog seek.

import {
  type Color,
  createInitialXiangqiState,
  darkChessVariant,
  getPlayerView as getFogXiangqiPlayerView,
  type PlayerView,
  type XiangqiColor,
  type XiangqiPiece,
  type XiangqiPlayerView,
  type XiangqiSquare,
} from '@mistboard/game';

export type SeatSide = 'first' | 'second';

export type FogXiangqiSeatStartView = {
  id: string;
  perspective: XiangqiColor;
  board: Partial<
    Record<
      XiangqiSquare,
      { piece: XiangqiPiece; shrouded: false } | { color: XiangqiColor; shrouded: true }
    >
  >;
  visibleSquares: XiangqiSquare[];
  legalMoves: [];
  status: XiangqiPlayerView['status'];
  moveNumber: number;
  captures: { red: []; black: [] };
};

export function fogXiangqiSeatStartView(
  side: SeatSide,
  id = 'seat-start',
): FogXiangqiSeatStartView {
  const color: XiangqiColor = side === 'second' ? 'black' : 'red';
  const state = createInitialXiangqiState(id);
  const view = getFogXiangqiPlayerView(state, color);
  const board: FogXiangqiSeatStartView['board'] = {};
  for (const [square, entry] of Object.entries(view.board)) {
    if (!entry) continue;
    board[square as XiangqiSquare] = entry.shrouded
      ? { color: entry.piece.color, shrouded: true }
      : { piece: entry.piece, shrouded: false };
  }
  return {
    id: view.id,
    perspective: color,
    board,
    visibleSquares: [...view.visibleSquares],
    legalMoves: [],
    status: view.status,
    moveNumber: view.moveNumber,
    captures: { red: [], black: [] },
  };
}

export function fogChessSeatStartView(side: SeatSide, id = 'seat-start'): PlayerView {
  const color: Color = side === 'second' ? 'black' : 'white';
  const view = darkChessVariant.getPlayerView(darkChessVariant.createInitialState(id), color);
  return { ...view, legalMoves: [] };
}
