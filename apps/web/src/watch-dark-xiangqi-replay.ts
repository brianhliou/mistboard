// Mistboard TV renderer for full Dark Xiangqi (9x10) — a thin adapter over the
// shared tenant watch renderer (watch-tenant-replay.ts). Dark Xiangqi is a FOG
// variant: the postgame ships a red/truth/black triptych, and the adapter passes
// showFog for the per-color panes while the center truth pane stays unfogged.
// The board styles ride the same live-xiangqi.css the live room uses; a watch
// chunk extracted from the live shell must import them itself or the SVG renders
// black-on-black.
import './live-xiangqi.css';
import {
  type DarkXiangqiPostgameResponse,
  type DarkXiangqiPostgameViewKey,
  loadDarkXiangqiPostgame,
  postgameReplayMaxPly,
  postgameViewAtPly,
  postgameViewEntries,
} from './dark-xiangqi-postgame.js';
import { type DarkXiangqiWireView, renderDarkXiangqiBoardSvg } from './live-dark-xiangqi.js';
import type { ReplayHandle } from './replay.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { mountTenantWatchReplay, type TenantWatchReplayOptions } from './watch-tenant-replay.js';

export type DarkXiangqiWatchReplayOptions = TenantWatchReplayOptions;

function paneKind(key: DarkXiangqiPostgameViewKey): 'white' | 'truth' | 'black' {
  if (key === 'red') return 'white';
  if (key === 'black') return 'black';
  return 'truth';
}

export function mountDarkXiangqiWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: DarkXiangqiWatchReplayOptions,
): Promise<ReplayHandle> {
  return mountTenantWatchReplay<
    DarkXiangqiPostgameResponse,
    DarkXiangqiWireView,
    DarkXiangqiPostgameViewKey
  >(root, roomId, options, {
    installStyles: () => {},
    // Piece-set / board-theme changes repaint the board in place (the homepage
    // TV sits frozen on one ply, so nothing else would re-render it).
    appearanceEvent: xiangqiAppearanceChangedEvent,
    loadPostgame: loadDarkXiangqiPostgame,
    maxPly: postgameReplayMaxPly,
    viewEntries: (postgame) =>
      postgameViewEntries(postgame).map((entry) => ({ key: entry.key, label: entry.label })),
    viewAtPly: postgameViewAtPly,
    paneKind,
    // Fog variant: the per-color panes are fogged from that seat's view; the
    // center truth pane is not. The fog mask is keyed by the view's perspective,
    // so the three panes never collide on a shared mask id.
    renderBoard: (view, orientation, key) =>
      renderDarkXiangqiBoardSvg(view, orientation, { showFog: key !== 'truth' }),
    // Dark Xiangqi's wire view carries no captured-pool, so there is nothing to
    // render in the per-pane capture strips.
    fillCaptures: () => {},
  });
}
