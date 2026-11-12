// Three Kingdoms Banqi export (#628): the finished game as the public saw it.
//
// Covered identities stay masked after the game (#1002), so this record is
// built from the same per-ply spectator views the review page replays
// (tenantPerPlyViews over the kernel's masked view), never from the stored
// state. A flip names the piece the view shows on that square right after it
// was turned over; a piece never turned over appears nowhere, and the file has
// no deal_fen. A covered capture cannot happen in this variant (a face-down
// tile is never a legal target), so no ply carries `captured_hidden`.
//
// The record still replays on its own: legality reads only face-up pieces and
// empty squares, and replayHiddenPieceRecord starts TK from the standard
// face-down layout and settles each reveal as it is named.
import { writeHiddenPiecePgn } from '@mistboard/game';
import { flipOrBoardMoveUci } from './game-export-tenant.js';
import { isInternalEngineTestLog } from './internal-engine-test.js';
import { threeKingdomsBanqiTenant } from './three-kingdoms-banqi-tenant.js';
import type {
  TenantExportGame,
  TenantExportPly,
  VariantTenantExport,
} from './variant-tenant/registry.js';
import {
  isTenantEventLog,
  replayTenantEvents,
  tenantPerPlyViews,
} from './variant-tenant/runtime.js';

export const THREE_KINGDOMS_BANQI_GAME_ROUTE_BASE = '/three-kingdoms-banqi/game';

export const threeKingdomsBanqiExport: VariantTenantExport = {
  gameRouteBase: THREE_KINGDOMS_BANQI_GAME_ROUTE_BASE,
  finishedGame(events, roomId) {
    if (isInternalEngineTestLog(events)) return null;
    if (!isTenantEventLog(threeKingdomsBanqiTenant, events, roomId)) return null;
    // Entry 0 is the start; entry k is what a spectator saw after move k.
    const views = tenantPerPlyViews(threeKingdomsBanqiTenant, events, 'spectator');
    // The end of the log (a resignation, a flag, an agreed draw) is not a move,
    // so the finish is read from the spectator view of the whole log. Only a
    // game the public view shows as finished exports.
    const final = threeKingdomsBanqiTenant.visibility.viewForClient(
      replayTenantEvents(threeKingdomsBanqiTenant, events).state,
      { id: 'export-spectator', seat: 'spectator', solo: false },
      events,
    );
    if (final.status.type !== 'finished') return null;
    const moveEvents = events.filter((event) => event.type === 'move-played');
    if (views.length !== moveEvents.length + 1) return null;
    const plies: TenantExportPly[] = [];
    for (const [index, event] of moveEvents.entries()) {
      const { from, to } = event.move;
      let revealed: TenantExportPly['revealed'];
      if (from === to) {
        const shown = views[index + 1]!.view.board[from];
        // A flip the view does not show face up would be a record nobody can
        // replay; refuse the export rather than guess an identity.
        if (!shown || shown.faceDown) return null;
        revealed = { color: shown.color, role: shown.role };
      }
      plies.push({
        ply: index + 1,
        mover: event.color,
        uci: flipOrBoardMoveUci(event.move),
        san: null,
        clockMsAfter: event.clock ? { ...event.clock.remainingMs } : null,
        ...(revealed ? { revealed } : {}),
      });
    }
    const writePgn: TenantExportGame['writePgn'] = (tags, result) =>
      writeHiddenPiecePgn({
        variant: 'three-kingdoms-banqi',
        tags,
        result,
        dealFen: null,
        plies: plies.map((ply) => ({
          uci: ply.uci!,
          revealed: ply.revealed ?? null,
          captured_hidden: null,
        })),
      });
    return {
      colors: threeKingdomsBanqiTenant.colors,
      plies,
      firstMoverInk: final.firstColor,
      writePgn,
    };
  },
};
