// Mistboard TV renderer for Atomic Xiangqi: a thin adapter over the shared
// tenant watch renderer (watch-tenant-replay.ts). Open information, so one
// truth board, drawn by the xiangqi board with the aftermath discs, and on a
// forward step the detonation the live room plays (atomic-xiangqi-board.ts).
//
// BOTH stylesheets, in this order: `live-xiangqi.css` carries the board,
// `atomic-xiangqi.css` only the discs, the shockwave and the ghosts. A watch
// chunk extracted from the live shell has to import them itself.
import './live-xiangqi.css';
import './atomic-xiangqi.css';
import type { AtomicXiangqiPlayerView } from '@mistboard/game';
import {
  animateAtomicXiangqiCapture,
  atomicXiangqiBlastMarkers,
  atomicXiangqiCaptureAnimates,
  markAtomicXiangqiBlastHost,
} from './atomic-xiangqi-board.js';
import {
  type AtomicXiangqiPostgameResponse,
  loadAtomicXiangqiPostgame,
  postgameReplayMaxPly,
  postgameViewAtPly,
} from './atomic-xiangqi-postgame.js';
import { replayAtomicXiangqiNotation } from './atomic-xiangqi-replay.js';
import type { ReplayHandle } from './replay.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';
import { xiangqiBoardSvg } from './xiangqi-board.js';

export type AtomicXiangqiWatchReplayOptions = TenantWatchReplayOptions;

function boardSvg(view: AtomicXiangqiPlayerView, orientation: 'red' | 'black', fresh: boolean) {
  return xiangqiBoardSvg(view, orientation, {
    interactive: false,
    selectedSquare: null,
    draggingFrom: null,
    coordinates: false,
    markers: atomicXiangqiBlastMarkers(view, { fresh }),
  });
}

export function mountAtomicXiangqiWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: AtomicXiangqiWatchReplayOptions,
): Promise<ReplayHandle> {
  let cancelCapture: (() => void) | null = null;
  return mountTenantWatchReplay<AtomicXiangqiPostgameResponse, AtomicXiangqiPlayerView, 'truth'>(
    root,
    roomId,
    options,
    {
      installStyles: () => {},
      appearanceEvent: xiangqiAppearanceChangedEvent,
      loadPostgame: loadAtomicXiangqiPostgame,
      maxPly: postgameReplayMaxPly,
      viewEntries: () => [{ key: 'truth', label: 'Server truth' }],
      viewAtPly: postgameViewAtPly,
      paneKind: () => 'truth',
      // A repaint that is not a one-ply step (a jump, a resize, an appearance
      // change) shows the discs without the burst, as the live room does.
      renderBoard: (view, orientation) => boardSvg(view, orientation, false),
      fillCaptures: () => {},
      // Algebraic labels from the atomic kernel: the standard formatter would
      // read the wrong board after the first explosion. A record the kernel
      // rejects (it cannot happen for a game the server refereed, but the
      // label pass must not take the page down) falls back to from-to.
      moveLabels: (postgame) => {
        const tokens = postgame.timeline.flatMap((event) =>
          event.type === 'move-played' && event.move ? [`${event.move.from}${event.move.to}`] : [],
        );
        try {
          return replayAtomicXiangqiNotation(tokens.join(' ')).labels;
        } catch {
          return tokens.map((token) => `${token.slice(0, -2)}-${token.slice(-2)}`);
        }
      },
      // A forward step onto a capture repaints with the fresh aftermath and
      // plays the detonation; a back step, or a quiet move, keeps the plain
      // repaint the generic already did.
      animateMove: (boardEl, view, _prevView, direction, orientation) => {
        cancelCapture?.();
        cancelCapture = null;
        markAtomicXiangqiBlastHost(boardEl, view);
        if (direction !== 'forward' || !atomicXiangqiCaptureAnimates(view)) return;
        boardEl.innerHTML = boardSvg(view, orientation, true);
        cancelCapture = animateAtomicXiangqiCapture(boardEl, view, orientation);
      },
    },
  );
}
