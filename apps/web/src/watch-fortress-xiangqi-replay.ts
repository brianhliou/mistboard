import type { FortressXiangqiPlayerView } from '@mistboard/game';
import './drop-reserve.css';
import {
  type FortressXiangqiPostgameResponse,
  loadFortressXiangqiPostgame,
  postgameReplayMaxPly,
  postgameViewAtPly,
} from './fortress-xiangqi-postgame.js';
import {
  installFortressXiangqiBoardStyles,
  renderFortressXiangqiBoardSvg,
} from './fortress-xiangqi-render.js';
import { fillFortressXiangqiReserve } from './fortress-xiangqi-view.js';
import type { ReplayHandle } from './replay.js';
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
    loadPostgame: loadFortressXiangqiPostgame,
    maxPly: postgameReplayMaxPly,
    viewEntries: () => [{ key: 'truth', label: 'Server truth' }],
    viewAtPly: postgameViewAtPly,
    paneKind: () => 'truth',
    renderBoard: (view, orientation) => renderFortressXiangqiBoardSvg(view, orientation),
    // allRoles: the showcase draws every droppable role and ghosts the ones
    // held none of, the way lichess draws a crazyhouse pocket. Held-only rows
    // render the common empty pocket as a blank band, and shift the pieces
    // already in hand every time a new one arrives.
    fillCaptures: (host, view, owner) =>
      fillFortressXiangqiReserve(host, view, owner, { allRoles: true }),
    sidedCaptures: true,
  });
}
