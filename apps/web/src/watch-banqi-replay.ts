// Mistboard TV renderer for Banqi — a thin adapter over the shared tenant watch
// renderer (watch-tenant-replay.ts). Banqi is symmetric-information: the board is
// public and only the deal is hidden, so the postgame ships a SINGLE truth
// surface (no per-color triptych) and there is no fog to pass to the renderer.
import type { BanqiPlayerView } from '@mistboard/game';
import { banqiResultLabel, seatInkLabel } from './banqi-result-label.js';
import { flipSeatInk } from './flip-seat-ink.js';
import {
  type BanqiPostgameResponse,
  type BanqiPostgameViewKey,
  loadBanqiPostgame,
  postgameReplayMaxPly,
  postgameViewAtPly,
  postgameViewEntries,
} from './live-banqi-postgame.js';
import {
  animateBanqiBoardMove,
  type BanqiBoardArrow,
  type BanqiBoardMarker,
  installBanqiBoardStyles,
  renderBanqiBoardSvg,
} from './live-banqi-render.js';
import type { ReplayHandle } from './replay.js';
import { fillCapturedPoolWith } from './review/captured-pool.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { watchBanqiMoveSound } from './watch-move-sound.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import { renderXiangqiPieceGlyphed } from './xiangqi-piece-sets.js';

export type BanqiWatchReplayOptions = TenantWatchReplayOptions;

function paneKind(key: BanqiPostgameViewKey): 'white' | 'truth' | 'black' {
  if (key === 'red') return 'white';
  if (key === 'black') return 'black';
  return 'truth';
}

export function mountBanqiWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: BanqiWatchReplayOptions,
): Promise<ReplayHandle> {
  return mountTenantWatchReplay<BanqiPostgameResponse, BanqiPlayerView, BanqiPostgameViewKey>(
    root,
    roomId,
    options,
    {
      installStyles: installBanqiBoardStyles,
      // Piece-set / board-theme changes repaint the board in place (the homepage
      // TV sits frozen on one ply, so nothing else would re-render it).
      appearanceEvent: xiangqiAppearanceChangedEvent,
      loadPostgame: loadBanqiPostgame,
      maxPly: postgameReplayMaxPly,
      viewEntries: (postgame) =>
        postgameViewEntries(postgame).map((entry) => ({ key: entry.key, label: entry.label })),
      viewAtPly: postgameViewAtPly,
      paneKind,
      // Symmetric board: no fog/perspective to apply.
      renderBoard: (view, orientation, _key, overlay) =>
        renderBanqiBoardSvg(view, orientation, {
          arrows: overlay.arrows as readonly BanqiBoardArrow[],
          markers: overlay.glyphs as readonly BanqiBoardMarker[],
        }),
      // One-ply steps glide: forward animates the newly rendered view's lastMove,
      // a back step reverse-animates the move the previous ply carried.
      animateMove: (boardEl, view, prevView, direction) => {
        const move = direction === 'forward' ? view.lastMove : prevView?.lastMove;
        if (!move) return;
        animateBanqiBoardMove(boardEl, move, { reverse: direction === 'back' });
      },
      // The same grouped pool the live room draws (review/captured-pool.ts); every
      // banqi capture has a known identity, so no hidden renderer is needed.
      // Spectator cue: the mover's own-move sound (watch-move-sound.ts).
      moveSound: watchBanqiMoveSound,
      fillCaptures: (host, view, owner) => {
        const pieceSet = readStoredXiangqiPieceSet();
        fillCapturedPoolWith(host, view.captured, owner, (entry) =>
          renderXiangqiPieceGlyphed(entry, pieceSet, { ariaLabel: ` ` }),
        );
      },
      // Banqi seats (first/second mover) are decoupled from ink; the recorded
      // result is seat-keyed, so translate it to the bound ink for display.
      resultLabel: (result, postgame) => banqiResultLabel(result, postgame.view.firstColor),
      seatLabel: (seat, postgame) => seatInkLabel(seat, postgame.view.firstColor),
      seatInk: (seat, postgame) => flipSeatInk(seat, postgame.view.firstColor ?? null),
    },
  );
}
