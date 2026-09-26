// Mounts one game as a compact, single-board, autoplaying showcase board that
// hands off via onGameEnd at the end. Split from ./showcase-dispatch.ts because
// this pulls in replay.js (chessground); keeping it separate lets /watch import
// the resolver without the chessground weight.

import type { GameEvent } from '@mistboard/game';
import { type GameMeta, mountReplay, type ReplayHandle } from './replay.js';
import { showcaseRendererKindForSpec } from './showcase-dispatch.js';
import { webVariantTenantForSpecId } from './variant-tenant/registry.js';

// Hold on the final frame (clocks flipped to 1/0/½ result marks) before the
// board hands off via onGameEnd. Matches the tenant frameworks'
// SHOWCASE_END_HOLD_MS so every variant ends on the same beat.
const SHOWCASE_CHESS_HOLD_MS = 4000;

export type ShowcaseBoardOptions = {
  metadataByRoomId: Record<string, GameMeta>;
  // Player names for the tenant compact seats (first = red, second = black),
  // keyed by room id; the chess path reads names from metadataByRoomId instead.
  namesByRoomId: Record<string, { first: string; second: string }>;
  // Fired once when the mounted game reaches its final ply; the cycler advances.
  // Omitted by static callers (e.g. the dev variant sheet) that don't cycle.
  onGameEnd?: () => void;
  // Autoplay through the game (default). false = mount paused at the start
  // position, used by the dev sheet to show each variant's opening.
  autoplay?: boolean;
  // Tenant path only: suppress the flanking reserve strips for drop/reserve
  // variants (fortress-xiangqi) so the compact board renders bare. Used by the
  // /watch queue thumbnails, where hands are unreadable at preview scale.
  hideReserve?: boolean;
  // POV for the chess (chessground) path; tenants pick their own showcase side.
  pov: 'white' | 'black';
  // Completed-game grids can reveal the final chess position. The homepage keeps
  // the fogged POV throughout by default so its showcase still demonstrates fog.
  revealOnFinish?: boolean;
  // Chess event loader (static bundled samples vs the games API). Tenants load
  // their own postgame payloads internally and ignore this.
  loaderForId: (roomId: string) => Promise<GameEvent[]>;
  // LIVE-follow mode for the tenant path (homepage TV): no end-of-game marks at
  // the final known ply, payload served by loadPostgameOverride (the
  // /api/watch/live payload) instead of the finished-game endpoint. The chess
  // path ignores both — no chess-stack spec is live-observable.
  live?: boolean;
  loadPostgameOverride?: (
    roomId: string,
  ) => Promise<{ ok: true; postgame: unknown } | { ok: false }>;
  // Tenant path only: return true from here to keep the current board when a
  // postgame load fails, instead of wiping it to the "could not be loaded"
  // notice. The homepage TV uses it so a followed live game that goes idle (or
  // whose finished record has not persisted yet) keeps its last frame on the
  // live→frozen handoff (see landing-tv.ts). The chess path ignores it.
  onLoadError?: () => boolean;
  // Delayed air (homepage TV channel): the wall-clock ms at which the game's start
  // went on air. Autoplay joins the broadcast at the ply it is on now and plays on
  // at the recorded timing. Both renderer paths honor it.
  airStartMs?: number;
};

export async function mountShowcaseBoard(
  root: HTMLElement,
  specId: string,
  roomId: string,
  options: ShowcaseBoardOptions,
): Promise<ReplayHandle> {
  const tenant =
    showcaseRendererKindForSpec(specId) === 'chess' ? null : webVariantTenantForSpecId(specId);
  if (tenant?.watch) {
    return tenant.watch.mountReplay(root, roomId, {
      autoplay: options.autoplay ?? true,
      metadataByRoomId: options.metadataByRoomId,
      compact: true,
      onGameEnd: options.onGameEnd,
      namesByRoomId: options.namesByRoomId,
      ...(options.hideReserve ? { hideReserve: true } : {}),
      ...(options.live ? { live: true } : {}),
      ...(options.loadPostgameOverride
        ? { loadPostgameOverride: options.loadPostgameOverride }
        : {}),
      ...(options.onLoadError ? { onLoadError: options.onLoadError } : {}),
      ...(options.airStartMs !== undefined ? { airStartMs: options.airStartMs } : {}),
    });
  }

  // Chess (chessground): a single fogged POV board, no controls, playing at the
  // game's recorded timing. To match the tenant showcase boards, it drops captured-piece rows
  // and puts the player name + clock in rows above/below the board (board-edges),
  // which CSS then styles into the shared `.showcase-seat` look.
  return mountReplay(root, roomId, {
    autoplay: options.autoplay ?? true,
    showControls: false,
    keyboardNav: false,
    revealOnFinish: options.revealOnFinish ?? false,
    ...(options.airStartMs !== undefined ? { airStartMs: options.airStartMs } : {}),
    metadataMode: 'compact',
    metadataByRoomId: options.metadataByRoomId,
    hideGameIdPill: true,
    showCaptures: false,
    compactClockLayout: 'board-edges',
    endStatusMode: 'clock',
    betweenGameDelayMs: SHOWCASE_CHESS_HOLD_MS,
    onGameEnd: options.onGameEnd,
    orientation: options.pov,
    orientationForId: () => options.pov,
    panes: { resolver: () => options.pov },
    loaderForId: options.loaderForId,
  });
}
