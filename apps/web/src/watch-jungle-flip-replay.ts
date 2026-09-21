// Mistboard TV renderer for Flip Jungle — a thin adapter over the shared tenant
// watch renderer (watch-tenant-replay.ts). Flip Jungle is SYMMETRIC hidden-identity
// (the banqi pattern): one board, defaulting to the as-played masked replay with a
// Reveal/Hide control (and the `h` key) that swaps in the full-reveal overlay. The
// deal has no sides, so orientation is ignored. The compact TV product draws no
// captures; the live room does (live-jungle-flip.ts renderJungleFlipMaterial).
import { t } from './i18n/catalog.js';
import './live-xiangqi.css';
import { type JungleFlipPlayerView, jungleFlipLastMoverInk } from '@mistboard/game';
import {
  animateJungleFlipBoardMove,
  type JungleFlipRenderBoard,
  renderJungleFlipBoardSvg,
} from './jungle-flip-render.js';
import { jungleFlipResultLabel, jungleFlipSeatInkLabel } from './jungle-flip-result-label.js';
import {
  type JungleFlipPostgameResponse,
  loadJungleFlipPostgame,
  replayMaxPly,
  viewAtPly,
} from './live-jungle-flip-postgame.js';
import type { ReplayHandle } from './replay.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';

export type JungleFlipWatchReplayOptions = TenantWatchReplayOptions;

// 'truth' is the as-played mask (unflipped tiles face-down); 'revealed' is the
// spoiler overlay. The shared chrome defaults to the hidden key and the Reveal
// control swaps to the truth (revealed) key.
type JungleFlipWatchViewKey = 'truth' | 'revealed';

export function mountJungleFlipWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: JungleFlipWatchReplayOptions,
): Promise<ReplayHandle> {
  return mountTenantWatchReplay<
    JungleFlipPostgameResponse,
    JungleFlipPlayerView,
    JungleFlipWatchViewKey
  >(root, roomId, options, {
    installStyles: () => {},
    loadPostgame: loadJungleFlipPostgame,
    maxPly: replayMaxPly,
    viewEntries: () => [{ key: 'truth', label: t('watch.truth') }],
    viewAtPly,
    paneKind: () => 'truth',
    renderBoard: (view) =>
      renderJungleFlipBoardSvg(view.board as JungleFlipRenderBoard, {
        lastMove: view.lastMove ?? null,
        lastMoveInk: jungleFlipLastMoverInk(view),
      }),
    // One-ply steps glide: forward animates the newly rendered view's lastMove,
    // a back step reverse-animates the move the previous ply carried. A flip is a
    // self-move and animateJungleFlipBoardMove no-ops on it.
    animateMove: (boardEl, view, prevView, direction, orientation) => {
      const move = direction === 'forward' ? view.lastMove : prevView?.lastMove;
      if (!move) return;
      animateJungleFlipBoardMove(boardEl, move, orientation, { reverse: direction === 'back' });
    },
    fillCaptures: () => {},
    reveal: { hiddenKey: 'truth', truthKey: 'revealed' },
    resultLabel: (result, postgame) => jungleFlipResultLabel(result, postgame.view.firstColor),
    seatLabel: (seat, postgame) => jungleFlipSeatInkLabel(seat, postgame.view.firstColor),
  });
}
