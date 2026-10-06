import { type FortressXiangqiPlayerView, isFortressXiangqiDropMove } from '@mistboard/game';
import './drop-reserve.css';
import {
  type FortressXiangqiPostgameResponse,
  loadFortressXiangqiPostgame,
  postgameReplayMaxPly,
  postgameViewAtPly,
} from './fortress-xiangqi-postgame.js';
import {
  animateFortressXiangqiBoardMove,
  type FortressXiangqiBoardArrow,
  type FortressXiangqiBoardMarker,
  installFortressXiangqiBoardStyles,
  renderFortressXiangqiBoardSvg,
} from './fortress-xiangqi-render.js';
import { fillFortressXiangqiReserve } from './fortress-xiangqi-view.js';
import type { ReplayHandle } from './replay.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { watchFortressXiangqiMoveSound } from './watch-move-sound.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';

export type FortressXiangqiWatchReplayOptions = TenantWatchReplayOptions;

// Fortress Xiangqi is open information, so the showcase renders a single 'truth'
// pane straight from the player view. Reserves are part of the position, so the
// captured pieces flank the board as vertical strips (sidedCaptures).
export function mountFortressXiangqiWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: FortressXiangqiWatchReplayOptions,
): Promise<ReplayHandle> {
  return mountTenantWatchReplay<
    FortressXiangqiPostgameResponse,
    FortressXiangqiPlayerView,
    'truth'
  >(root, roomId, options, {
    installStyles: installFortressXiangqiBoardStyles,
    // Piece-set / board-theme changes repaint the board in place (the homepage
    // TV sits frozen on one ply, so nothing else would re-render it).
    appearanceEvent: xiangqiAppearanceChangedEvent,
    loadPostgame: loadFortressXiangqiPostgame,
    maxPly: postgameReplayMaxPly,
    viewEntries: () => [{ key: 'truth', label: 'Server truth' }],
    viewAtPly: postgameViewAtPly,
    paneKind: () => 'truth',
    renderBoard: (view, orientation, _key, overlay) =>
      renderFortressXiangqiBoardSvg(view, orientation, {
        arrows: overlay.arrows as readonly FortressXiangqiBoardArrow[],
        markers: overlay.glyphs as readonly FortressXiangqiBoardMarker[],
      }),
    // allRoles: the showcase draws every droppable role and ghosts the ones
    // held none of, the way lichess draws a crazyhouse pocket. Held-only rows
    // render the common empty pocket as a blank band, and shift the pieces
    // already in hand every time a new one arrives.
    // Spectator cue: the mover's own-move sound (watch-move-sound.ts).
    moveSound: watchFortressXiangqiMoveSound,
    fillCaptures: (host, view, owner) =>
      fillFortressXiangqiReserve(host, view, owner, { allRoles: true }),
    sidedCaptures: true,
    // One-ply steps glide, as on the xiangqi showcase: forward animates the new
    // view's lastMove, a back step reverse-animates the move the previous ply
    // carried. A drop has no origin square, so it just appears.
    animateMove: (boardEl, view, prevView, direction, orientation) => {
      const move = direction === 'forward' ? view.lastMove : prevView?.lastMove;
      if (!move || isFortressXiangqiDropMove(move)) return;
      animateFortressXiangqiBoardMove(boardEl, move, orientation, {
        reverse: direction === 'back',
      });
    },
  });
}
