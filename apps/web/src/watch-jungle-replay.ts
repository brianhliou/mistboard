// Mistboard TV renderer for Jungle — a thin adapter over the shared tenant watch
// renderer (watch-tenant-replay.ts). Jungle is PERFECT-INFORMATION: the board was
// always fully visible, so there is one truth surface (no per-color triptych), no
// reveal toggle, and no captured-pool fill (the board itself carries the material).
import { t } from './i18n/catalog.js';
import { reviewResultLabel } from './review/game-review-meta.js';
import './live-xiangqi.css';
import type { JungleBoard, JunglePlayerView } from '@mistboard/game';
import { animateJungleBoardMove, renderJungleBoardSvg } from './jungle-render.js';
import {
  type JunglePostgameResponse,
  junglePostgameMaxPly,
  junglePostgameViewAtPly,
  loadJunglePostgame,
} from './live-jungle-postgame.js';
import type { ReplayHandle } from './replay.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';

export type JungleWatchReplayOptions = TenantWatchReplayOptions;

type JungleWatchViewKey = 'truth';

export function mountJungleWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: JungleWatchReplayOptions,
): Promise<ReplayHandle> {
  return mountTenantWatchReplay<JunglePostgameResponse, JunglePlayerView, JungleWatchViewKey>(
    root,
    roomId,
    options,
    {
      installStyles: () => {},
      loadPostgame: loadJunglePostgame,
      maxPly: junglePostgameMaxPly,
      viewEntries: () => [{ key: 'truth', label: t('watch.truth') }],
      viewAtPly: (postgame, _key, ply) => junglePostgameViewAtPly(postgame, ply),
      paneKind: () => 'truth',
      // Open Jungle is seat == ink, so the winning-side word comes straight from
      // the result — branded "Blue" for the dark side (see variant-seat-label.ts)
      // so the TV result line matches the postgame + rail.
      resultLabel: (result) => reviewResultLabel(result, 'jungle'),
      renderBoard: (view, orientation) =>
        renderJungleBoardSvg(view.board as JungleBoard, {
          perspective: orientation,
          lastMove: view.lastMove ?? null,
        }),
      // One-ply steps glide: forward animates the newly rendered view's lastMove,
      // a back step reverse-animates the move the previous ply carried.
      animateMove: (boardEl, view, prevView, direction, orientation) => {
        const move = direction === 'forward' ? view.lastMove : prevView?.lastMove;
        if (!move) return;
        animateJungleBoardMove(boardEl, move, orientation, { reverse: direction === 'back' });
      },
      // Perfect-info board carries its own material; no captured-pool strips.
      fillCaptures: () => {},
    },
  );
}
