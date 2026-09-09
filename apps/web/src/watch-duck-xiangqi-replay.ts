// Mistboard TV renderer for Duck Xiangqi — a thin adapter over the shared tenant
// watch renderer (watch-tenant-replay.ts). Duck Xiangqi is OPEN INFORMATION, so
// there is a single truth board: no fog triptych, no mask.
//
// BOTH stylesheets, in this order. `live-xiangqi.css` carries the board ground,
// the grid, the palace diagonals and the river; `duck-xiangqi.css` carries only
// the duck and the two-phase marks. A watch chunk extracted from the live shell
// has to import them itself, and a chunk that imports only the second one draws
// a complete board that is entirely invisible.
import './live-xiangqi.css';
import './duck-xiangqi.css';
import type { DuckXiangqiPlayerView } from '@mistboard/game';
import { duckXiangqiBoardSvg } from './duck-xiangqi-board.js';
import {
  type DuckXiangqiPostgameResponse,
  loadDuckXiangqiPostgame,
  postgameReplayMaxPly,
  postgameViewAtPly,
} from './duck-xiangqi-postgame.js';
import type { ReplayHandle } from './replay.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';

export type DuckXiangqiWatchReplayOptions = TenantWatchReplayOptions;

export function mountDuckXiangqiWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: DuckXiangqiWatchReplayOptions,
): Promise<ReplayHandle> {
  return mountTenantWatchReplay<DuckXiangqiPostgameResponse, DuckXiangqiPlayerView, 'truth'>(
    root,
    roomId,
    options,
    {
      installStyles: () => {},
      appearanceEvent: xiangqiAppearanceChangedEvent,
      loadPostgame: loadDuckXiangqiPostgame,
      maxPly: postgameReplayMaxPly,
      viewEntries: () => [{ key: 'truth', label: 'Server truth' }],
      viewAtPly: postgameViewAtPly,
      paneKind: () => 'truth',
      // Non-interactive: the showcase board collects no clicks, so it draws no
      // targets and sits in phase one forever. The duck itself rides the view.
      renderBoard: (view, orientation) =>
        duckXiangqiBoardSvg(view, orientation, {
          interactive: false,
          phase: { kind: 'piece', selected: null },
          targets: [],
        }),
      // The wire view carries no captured pool, so the per-pane capture strips
      // have nothing to draw.
      fillCaptures: () => {},
      // Deliberately no animateMove. A ply here moves TWO things, the piece and
      // the duck, and the shared helper animates one move. Gliding the piece
      // while the duck teleports reads as a rendering fault rather than as a
      // turn; a clean cut to the next position is honest about what happened.
    },
  );
}
