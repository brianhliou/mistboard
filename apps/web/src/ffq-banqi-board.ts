// Rotate FFQ's x + 4*y indices onto banqi's existing horizontal 8 by 4 board:
// FFQ x becomes rank-1, y becomes file. Adjacency and cannon rays are preserved.
// Only a masked PlayerView enters this adapter, including after game end.
import type { BanqiPlayerView, BanqiSquare, FFQBanqiPlayerView } from '@mistboard/game';
import { type BanqiClickResult, banqiClickResult } from './live-banqi-interaction.js';

export function ffqBanqiSquare(index: number): BanqiSquare {
  if (!Number.isInteger(index) || index < 0 || index >= 32) throw new Error('Invalid FFQ square');
  return `${'abcdefgh'[Math.floor(index / 4)]}${(index % 4) + 1}` as BanqiSquare;
}

export function ffqBanqiIndex(square: string): number {
  if (!/^[a-h][1-4]$/.test(square)) throw new Error('Invalid banqi square');
  return 'abcdefgh'.indexOf(square[0]!) * 4 + Number(square[1]) - 1;
}

export function ffqBanqiBoardView(view: FFQBanqiPlayerView): BanqiPlayerView {
  const board: BanqiPlayerView['board'] = {};
  view.board.forEach((entry, index) => {
    if (entry)
      board[ffqBanqiSquare(index)] = entry.faceDown
        ? { faceDown: true }
        : { faceDown: false, color: entry.color, role: entry.role };
  });
  const move = (m: { from: number; to: number }) => ({
    from: ffqBanqiSquare(m.from),
    to: ffqBanqiSquare(m.to),
  });
  return {
    id: view.id,
    perspective: view.perspective === 'black' ? 'black' : 'red',
    board,
    legalMoves: view.legalMoves.map(move),
    captured: view.captured,
    // This projection is used only by banqi's renderer and click helper. The
    // room keeps FFQ's original status/reason for its result panel.
    status:
      view.status.type === 'finished'
        ? {
            ...view.status,
            reason: view.status.reason === 'no-progress' ? 'no-progress' : 'stalemate',
          }
        : view.status,
    ply: view.ply,
    moveNumber: view.moveNumber,
    firstColor: 'red',
    ...(view.lastMove ? { lastMove: move(view.lastMove) } : {}),
  };
}

export function ffqBanqiClickResult(
  view: FFQBanqiPlayerView,
  seat: unknown,
  selected: BanqiSquare | null,
  square: BanqiSquare,
): BanqiClickResult {
  const projected = ffqBanqiBoardView(view);
  // FFQ cannons can take covered pieces. A selected legal capture must win
  // over the one-click flip that ordinary banqi's helper prioritizes.
  if (view.status.type === 'playing' && view.status.turn === seat && selected) {
    const capture = projected.legalMoves.find(
      (m) => m.from === selected && m.to === square && m.from !== m.to,
    );
    if (capture) return { kind: 'move', move: capture };
  }
  return banqiClickResult(projected, seat, selected, square);
}
