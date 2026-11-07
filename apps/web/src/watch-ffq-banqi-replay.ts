// A private direct replay, never a TV channel or a discovery candidate.
import type { BanqiMove, FFQBanqiPlayerView } from '@mistboard/game';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { ffqBanqiBoardView, ffqBanqiSquare } from './ffq-banqi-board.js';
import { installBanqiBoardStyles, renderBanqiBoardSvg } from './live-banqi-render.js';
import { type FFQBanqiPostgameResponse, loadFFQBanqiPostgame } from './live-ffq-banqi-postgame.js';
import { ffqBanqiReviewMoveLabel } from './review/ffq-banqi-tree-adapter.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';

type WatchRecord = Omit<FFQBanqiPostgameResponse, 'timeline'> & {
  timeline: Array<{ at: number; color?: string; ply?: number; move?: BanqiMove }>;
};

export function ffqBanqiWatchRecord(postgame: FFQBanqiPostgameResponse): WatchRecord {
  return {
    ...postgame,
    timeline: postgame.timeline.map(({ at, color, ply, move }) => ({
      at,
      color,
      ply,
      ...(move ? { move: { from: ffqBanqiSquare(move.from), to: ffqBanqiSquare(move.to) } } : {}),
    })),
  };
}

export function mountFFQBanqiWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: TenantWatchReplayOptions = {},
) {
  return mountTenantWatchReplay<WatchRecord, FFQBanqiPlayerView, 'truth'>(root, roomId, options, {
    installStyles: installBanqiBoardStyles,
    appearanceEvent: xiangqiAppearanceChangedEvent,
    loadPostgame: async (id) => {
      const result = await loadFFQBanqiPostgame(id);
      return result.ok
        ? { ok: true, postgame: ffqBanqiWatchRecord(result.postgame) }
        : { ok: false };
    },
    maxPly: (record) => record.history.truth.length - 1,
    viewEntries: () => [{ key: 'truth', label: 'Board' }],
    viewAtPly: (record, _key, ply) => record.history.truth[ply]?.view ?? null,
    paneKind: () => 'truth',
    renderBoard: (view, orientation) =>
      renderBanqiBoardSvg(ffqBanqiBoardView(view), orientation, {
        coordinates: boardCoordinatesEnabled(),
      }),
    fillCaptures: (host, view, owner) => {
      const seat = owner === 'red' ? 'black' : 'red';
      host.textContent = `${view.hp[seat]} HP`;
    },
    moveLabels: (record) =>
      record.timeline.flatMap((entry) => {
        const frame = entry.ply === undefined ? undefined : record.history.truth[entry.ply];
        return entry.move && frame ? [ffqBanqiReviewMoveLabel(entry.move, frame)] : [];
      }),
    seatInk: (seat) => (seat === 'black' ? 'black' : 'red'),
  });
}
