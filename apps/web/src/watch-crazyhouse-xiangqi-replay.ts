// Mistboard TV renderer for Crazyhouse Xiangqi: a thin adapter over the shared
// tenant watch renderer (watch-tenant-replay.ts). Open information, so one
// truth board, drawn by the standard xiangqi board (crazyhouse-xiangqi-view.ts
// narrows the view to it), with both hands flanking it as the live room's
// pockets do.
//
// BOTH stylesheets: `live-xiangqi.css` carries the board, `drop-reserve.css`
// the pockets. A watch chunk extracted from the live shell has to import them
// itself.
import './live-xiangqi.css';
import './drop-reserve.css';
import {
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
  isCrazyhouseXiangqiDropMove,
} from '@mistboard/game';
import {
  type CrazyhouseXiangqiPostgameResponse,
  loadCrazyhouseXiangqiPostgame,
  postgameViewAtPly,
} from './crazyhouse-xiangqi-postgame.js';
import {
  crazyhouseXiangqiBoardView,
  crazyhouseXiangqiLastDrop,
  crazyhouseXiangqiMoveLabel,
  fillCrazyhouseXiangqiReserve,
} from './crazyhouse-xiangqi-view.js';
import type { ReplayHandle } from './replay.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';
import { animateXiangqiBoardMove, xiangqiBoardSvg } from './xiangqi-board.js';

export type CrazyhouseXiangqiWatchReplayOptions = TenantWatchReplayOptions;

function postgameReplayMaxPly(postgame: CrazyhouseXiangqiPostgameResponse): number {
  const history = Object.values(postgame.history ?? {}).flat();
  return Math.max(postgame.game.plyCount, ...history.map((snapshot) => snapshot.ply), 0);
}

export function mountCrazyhouseXiangqiWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: CrazyhouseXiangqiWatchReplayOptions,
): Promise<ReplayHandle> {
  return mountTenantWatchReplay<
    CrazyhouseXiangqiPostgameResponse,
    CrazyhouseXiangqiPlayerView,
    'truth'
  >(root, roomId, options, {
    installStyles: () => {},
    // Piece-set / board-theme changes repaint the board in place (the homepage
    // TV sits frozen on one ply, so nothing else would re-render it).
    appearanceEvent: xiangqiAppearanceChangedEvent,
    loadPostgame: loadCrazyhouseXiangqiPostgame,
    maxPly: postgameReplayMaxPly,
    viewEntries: () => [{ key: 'truth', label: 'Server truth' }],
    viewAtPly: (postgame, _key, ply) => postgameViewAtPly(postgame, ply),
    paneKind: () => 'truth',
    renderBoard: (view, orientation) =>
      xiangqiBoardSvg(crazyhouseXiangqiBoardView(view), orientation, {
        interactive: false,
        selectedSquare: null,
        draggingFrom: null,
        coordinates: false,
        lastDropSquare: crazyhouseXiangqiLastDrop(view),
      }),
    // The hand IS the position: every droppable role in a fixed slot, ghosted
    // when held none of. allRoles, not the live room's pocket bar: the showcase
    // strips are styled for it (landing.css), and /watch hides them, which the
    // pocket bar's own display rule would override.
    fillCaptures: (host, view, owner) =>
      fillCrazyhouseXiangqiReserve(host, view, owner, { allRoles: true }),
    sidedCaptures: true,
    // Drops have no `from`, so the default from-to label would print
    // "undefined-e5"; the room's own notation spells them `N@e5`.
    moveLabel: (move) => crazyhouseXiangqiMoveLabel(move as unknown as CrazyhouseXiangqiMove),
    // One-ply steps glide, as on the xiangqi showcase. A drop has no origin
    // square, so it just appears.
    animateMove: (boardEl, view, prevView, direction, orientation) => {
      const move = direction === 'forward' ? view.lastMove : prevView?.lastMove;
      if (!move || isCrazyhouseXiangqiDropMove(move)) return;
      animateXiangqiBoardMove(boardEl, move, orientation, { reverse: direction === 'back' });
    },
  });
}
