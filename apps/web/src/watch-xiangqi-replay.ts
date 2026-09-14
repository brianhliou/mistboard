// Mistboard TV renderer for standard Xiangqi (9x10) — a thin adapter over the
// shared tenant watch renderer (watch-tenant-replay.ts). Standard Xiangqi is
// OPEN INFORMATION: there is a single truth board (no red/truth/black fog
// triptych and no fog mask). The board styles ride the same live-xiangqi.css the
// live room uses; a watch chunk extracted from the live shell must import them
// itself or the SVG renders black-on-black.
import './live-xiangqi.css';
import {
  formatXiangqiMoves,
  type StandardXiangqiPlayerView,
  type XiangqiMove,
} from '@mistboard/game';
import { renderXiangqiBoardSvg } from './live-xiangqi.js';
import type { ReplayHandle } from './replay.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';
import { animateXiangqiBoardMove } from './xiangqi-board.js';
import { currentXiangqiNotationStyle } from './xiangqi-notation.js';
import {
  loadXiangqiPostgame,
  postgameReplayMaxPly,
  postgameViewAtPly,
  postgameViewEntries,
  type XiangqiPostgameResponse,
  type XiangqiPostgameViewKey,
} from './xiangqi-postgame.js';

export type XiangqiWatchReplayOptions = TenantWatchReplayOptions;

function paneKind(_key: XiangqiPostgameViewKey): 'white' | 'truth' | 'black' {
  return 'truth';
}

export function mountXiangqiWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: XiangqiWatchReplayOptions,
): Promise<ReplayHandle> {
  return mountTenantWatchReplay<
    XiangqiPostgameResponse,
    StandardXiangqiPlayerView,
    XiangqiPostgameViewKey
  >(root, roomId, options, {
    installStyles: () => {},
    appearanceEvent: xiangqiAppearanceChangedEvent,
    loadPostgame: loadXiangqiPostgame,
    maxPly: postgameReplayMaxPly,
    viewEntries: (postgame) =>
      postgameViewEntries(postgame).map((entry) => ({ key: entry.key, label: entry.label })),
    viewAtPly: postgameViewAtPly,
    paneKind,
    // Open information: one truth board, no fog mask.
    renderBoard: (view, orientation) => renderXiangqiBoardSvg(view, orientation),
    // Standard Xiangqi's wire view carries no captured-pool, so there is nothing
    // to render in the per-pane capture strips.
    fillCaptures: () => {},
    // The reader's notation, replayed from the opening (a live game always
    // starts there); an unreplayable line degrades to coordinates inside.
    moveLabels: (postgame) =>
      formatXiangqiMoves(
        postgame.timeline.flatMap((event) =>
          event.type === 'move-played' && event.move ? [event.move as XiangqiMove] : [],
        ),
        currentXiangqiNotationStyle(),
      ),
    // One-ply steps glide (pieceAnimation pref): forward animates the newly
    // rendered view's lastMove; a back step reverse-animates the move the
    // previous ply carried. Moves come from the postgame payload's views only.
    animateMove: (boardEl, view, prevView, direction, orientation) => {
      const move = direction === 'forward' ? view.lastMove : prevView?.lastMove;
      if (!move) return;
      animateXiangqiBoardMove(boardEl, move, orientation, { reverse: direction === 'back' });
    },
  });
}
