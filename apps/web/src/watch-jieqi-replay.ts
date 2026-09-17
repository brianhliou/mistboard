// Mistboard TV renderer for Jieqi — a thin adapter over the shared tenant watch
// renderer (watch-tenant-replay.ts). TV shows one finished-game board with no
// captures or player-knowledge POVs. The dedicated /watch payload therefore avoids
// the richer review endpoint's Red + Black histories and historical legal-move
// generation.
//
// That board is the AS-PLAYED one ('masked'): a piece nobody ever moved is still
// face-down, which is how the game actually looked and how the review page has
// always rendered it. The Reveal control (and `h`) swaps in the 'truth' track —
// the same shape watch-jungle-flip-replay uses, with jieqi's key names, since
// jieqi's 'truth' has to keep meaning fully-revealed for the review's deal
// recovery.
import type { JieqiPlayerView } from '@mistboard/game';
import {
  type JieqiPostgameResponse,
  type JieqiPostgameViewKey,
  postgameReplayMaxPly,
  postgameViewAtPly,
} from './live-jieqi-postgame.js';
import {
  animateJieqiBoardMove,
  installJieqiBoardStyles,
  renderJieqiBoardSvg,
} from './live-jieqi-render.js';
import type { ReplayHandle } from './replay.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';

export type JieqiWatchReplayOptions = TenantWatchReplayOptions;

type JieqiWatchLoadResult =
  | { ok: true; postgame: JieqiPostgameResponse }
  | { ok: false; status: number };

// 'masked' and 'truth' are both single, side-agnostic boards, so they share the
// neutral pane; only the review payload's per-color keys pick a side.
function paneKind(key: JieqiPostgameViewKey): 'white' | 'truth' | 'black' {
  if (key === 'red') return 'white';
  if (key === 'black') return 'black';
  return 'truth';
}

export function jieqiWatchPostgameApiUrl(roomId: string): string {
  return `/api/jieqi/games/${encodeURIComponent(roomId)}/watch`;
}

export async function loadJieqiWatchPostgame(roomId: string): Promise<JieqiWatchLoadResult> {
  const response = await fetch(jieqiWatchPostgameApiUrl(roomId));
  if (!response.ok) return { ok: false, status: response.status };
  return {
    ok: true,
    postgame: (await response.json()) as JieqiPostgameResponse,
  };
}

export function mountJieqiWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: JieqiWatchReplayOptions,
): Promise<ReplayHandle> {
  return mountTenantWatchReplay<JieqiPostgameResponse, JieqiPlayerView, JieqiPostgameViewKey>(
    root,
    roomId,
    options,
    {
      installStyles: installJieqiBoardStyles,
      // Piece-set / board-theme changes repaint the board in place (the homepage
      // TV sits frozen on one ply, so nothing else would re-render it).
      appearanceEvent: xiangqiAppearanceChangedEvent,
      loadPostgame: loadJieqiWatchPostgame,
      maxPly: postgameReplayMaxPly,
      // One pane; the reveal toggle below chooses which track fills it.
      viewEntries: () => [{ key: 'masked', label: 'Board' }],
      // A payload built before the masked track existed (an unrefreshed cache, a
      // client ahead of the server) still replays — revealed, as it did before —
      // instead of rendering a blank board when the key is missing.
      viewAtPly: (postgame, key, ply) =>
        postgameViewAtPly(postgame, key, ply) ??
        (key === 'masked' ? postgameViewAtPly(postgame, 'truth', ply) : null),
      reveal: { hiddenKey: 'masked', truthKey: 'truth' },
      paneKind,
      renderBoard: (view, orientation) => renderJieqiBoardSvg(view, orientation, {}),
      // One-ply steps glide (pieceAnimation pref): forward animates the newly
      // rendered view's lastMove; a back step reverse-animates the move the
      // previous ply carried. Moves come from the watch payload's views only.
      animateMove: (boardEl, view, prevView, direction, orientation) => {
        const move = direction === 'forward' ? view.lastMove : prevView?.lastMove;
        if (!move) return;
        animateJieqiBoardMove(boardEl, move, orientation, { reverse: direction === 'back' });
      },
      // Captures are intentionally absent from the compact TV product.
      fillCaptures: () => {},
    },
  );
}
