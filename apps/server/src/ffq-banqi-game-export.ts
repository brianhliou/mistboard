// Export only identities in masked spectator history. Covered victims are
// public in FFQ; identities still underneath on-board backs never leave it.
import {
  FFQ_BANQI_DAMAGE,
  FFQ_BANQI_FACE_UP_SQUARES,
  hiddenPieceStartFen,
  writeHiddenPiecePgn,
} from '@mistboard/game';
import { ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { isInternalEngineTestLog } from './internal-engine-test.js';
import type { TenantExportPly, VariantTenantExport } from './variant-tenant/registry.js';
import {
  isTenantEventLog,
  replayTenantEvents,
  tenantPerPlyViews,
} from './variant-tenant/runtime.js';

const square = (index: number) =>
  `${String.fromCharCode(97 + (index % 4))}${Math.floor(index / 4)}`;

export const ffqBanqiExport: VariantTenantExport = {
  gameRouteBase: '/ffq-banqi/game',
  finishedGame(events, roomId) {
    if (isInternalEngineTestLog(events) || !isTenantEventLog(ffqBanqiTenant, events, roomId))
      return null;
    const created = events[0];
    if (created?.type !== 'room-created') return null;
    if (replayTenantEvents(ffqBanqiTenant, events).state.status.type !== 'finished') return null;
    const views = tenantPerPlyViews(ffqBanqiTenant, events, 'spectator');
    const initialRevealed = FFQ_BANQI_FACE_UP_SQUARES.map((i) => {
      const piece = views[0]!.view.board[i];
      if (!piece || piece.faceDown) throw new Error('Missing public Fanfanqi opening piece');
      return { color: piece.color, role: piece.role };
    });
    const moves = events.filter((event) => event.type === 'move-played');
    if (views.length !== moves.length + 1) return null;
    const plies: TenantExportPly[] = [];
    for (const [i, event] of moves.entries()) {
      const before = views[i]!.view;
      const after = views[i + 1]!.view;
      if (before.ply !== i || after.ply !== i + 1) return null;
      const { from, to } = event.move;
      const flip = from === to;
      const shown = flip ? after.board[to] : null;
      if (flip && (!shown || shown.faceDown)) return null;
      const capture = after.captured[before.captured.length];
      const covered = !flip && before.board[to]?.faceDown;
      if (covered && !capture) return null;
      const damage = { red: 0, black: 0 };
      if (capture) damage[capture.owner] = FFQ_BANQI_DAMAGE[capture.role];
      plies.push({
        ply: i + 1,
        mover: event.color,
        uci: flip ? `@${square(from)}` : `${square(from)}${square(to)}`,
        san: null,
        clockMsAfter: event.clock
          ? {
              red: event.clock.remainingMs.red,
              black: event.clock.remainingMs.black,
            }
          : null,
        ...(shown && !shown.faceDown ? { revealed: { color: shown.color, role: shown.role } } : {}),
        ...(covered && capture
          ? { capturedHidden: { color: capture.owner, role: capture.role } }
          : {}),
        hpAfter: { ...after.hp },
        damage,
      });
    }
    return {
      colors: ffqBanqiTenant.colors,
      initialFen: hiddenPieceStartFen('ffq-banqi', initialRevealed),
      initialRevealed,
      plies,
      writePgn: (tags, result) =>
        writeHiddenPiecePgn({
          variant: 'ffq-banqi',
          tags,
          result,
          dealFen: null,
          initialRevealed,
          plies: plies.map((ply) => ({
            uci: ply.uci!,
            revealed: ply.revealed ?? null,
            captured_hidden: ply.capturedHidden ?? null,
          })),
        }),
    };
  },
};
