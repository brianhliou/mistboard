// A mahjong ply is an action, not a board move. Keep the canonical action so
// replay can recover every automatic draw from the ordered walls, including
// claim passes, ready declarations and the deadlines between hands.
import { isXmjRoomSetup, XMJ_GLYPHS, type XmjMove } from '@mistboard/game';
import type { VariantTenantExport } from './variant-tenant/registry.js';
import { isTenantEventLog, replayTenantEvents } from './variant-tenant/runtime.js';
import { xiangqiMahjongTenant } from './xiangqi-mahjong-tenant.js';

function notation(move: XmjMove): string {
  switch (move.action) {
    case 'discard':
    case 'declare-ready':
      return `${move.action} ${XMJ_GLYPHS[move.tile]}`;
    case 'claim':
      return `claim ${move.kind} ${move.fromHand.map((tile) => XMJ_GLYPHS[tile]).join(' ')}`;
    case 'pass':
    case 'self-draw':
    case 'next-hand':
    case 'timeout':
      return move.action;
  }
}

export const xiangqiMahjongExport: VariantTenantExport = {
  gameRouteBase: '/xiangqi-mahjong/game',
  finishedGame(events, roomId) {
    if (!isTenantEventLog(xiangqiMahjongTenant, events, roomId)) return null;
    const created = events[0];
    if (created?.type !== 'room-created' || !isXmjRoomSetup(created.setup)) return null;
    const { state } = replayTenantEvents(xiangqiMahjongTenant, events);
    // Check the replay, never the database summary: neither a live nor an
    // aborted match may release even one wall tile, hand or action.
    if (state.status.type !== 'finished') return null;
    const setup = created.setup;
    return {
      colors: xiangqiMahjongTenant.colors,
      plies: events
        .filter((event) => event.type === 'move-played')
        .map((event, index) => ({
          ply: index + 1,
          mover: event.color,
          move: event.move,
          notation: notation(event.move),
          clockMsAfter: event.clock ? { ...event.clock.remainingMs } : null,
        })),
      match: {
        setup: {
          walls: setup.walls,
          firstDealer: setup.firstDealer,
          taiTable: setup.taiTable ?? 1,
          correspondence: setup.correspondence ?? false,
        },
        hands: state.match.results,
        final_score: { east: state.match.scores[0], west: state.match.scores[1] },
      },
    };
  },
};
