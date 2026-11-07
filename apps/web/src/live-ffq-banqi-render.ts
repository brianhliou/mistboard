// Shared by the room and rules figures. Only a masked player view enters here.
import type { FFQBanqiPlayerView } from '@mistboard/game';
import { ffqBanqiBoardView } from './ffq-banqi-board.js';
import { type BanqiBoardRenderOptions, renderBanqiBoardSvg } from './live-banqi-render.js';

export type FFQBanqiBoardRenderOptions = Pick<
  BanqiBoardRenderOptions,
  'interactive' | 'selectedSquare' | 'draggingFrom' | 'coordinates' | 'pieceSet'
>;

export function renderFFQBanqiBoardSvg(
  view: FFQBanqiPlayerView,
  options: FFQBanqiBoardRenderOptions = {},
): string {
  const projected = ffqBanqiBoardView(view);
  return renderBanqiBoardSvg(projected, projected.perspective, {
    ...options,
    legalMoves: options.selectedSquare
      ? projected.legalMoves.filter((m) => m.from === options.selectedSquare && m.from !== m.to)
      : [],
  });
}
