import { XIANGQI_MAHJONG_SPEC_ID, type XmjPlayerView, type XmjSeat } from '@mistboard/game';
import {
  isTenantEventLog,
  tenantPerPlyViews,
  tenantSeatDisplayNames,
} from './variant-tenant/runtime.js';
import type { XmjRuntimeRoom } from './xiangqi-mahjong-registration.js';
import {
  type XmjEvent,
  xiangqiMahjongTenant,
  xmjClientEventFor,
} from './xiangqi-mahjong-tenant.js';

// Mistboard TV live payload for an IN-PROGRESS Xiangqi Mahjong match.
//
// HIDDEN INFORMATION. The hands are concealed, so TV serves exactly what a
// spectator in the room sees (xmjViewFor(state, 'spectator')): melds, discards,
// the hand and wall COUNTS, whose turn it is and the points table, with both
// hands shown only once a hand is over. Never the walls (room-created setup),
// never a just-drawn tile, never a concealed tile. The timeline goes through the
// same xmjClientEventFor every room recipient's events go through, and then
// keeps only the public fields of each move: `handCopy` (whether a discard was
// the drawn tile's twin) is dropped here, so TV never repeats it even while the
// shared serializer still passes it. Regression: xiangqi-mahjong-spectate.test.ts.

export type XmjWatchMove = {
  type: 'move-played';
  at: number;
  color: XmjSeat;
  ply: number;
  move: {
    action: string;
    by: XmjSeat;
    at: number;
    tile?: string;
    kind?: string;
    fromHand?: readonly string[];
  };
};

/** The public part of every move, ply-numbered, through the room serializer. */
export function xmjWatchTimeline(events: readonly XmjEvent[]): XmjWatchMove[] {
  const timeline: XmjWatchMove[] = [];
  let ply = 0;
  for (const event of events) {
    if (event.type !== 'move-played') continue;
    ply += 1;
    const shaped = xmjClientEventFor(event, 'spectator', ply);
    if (shaped?.type !== 'move-played') continue;
    const move = shaped.move;
    timeline.push({
      type: 'move-played',
      at: shaped.at,
      color: move.by,
      ply,
      move: {
        action: move.action,
        by: move.by,
        at: move.at,
        ...('tile' in move ? { tile: move.tile } : {}),
        ...('kind' in move ? { kind: move.kind } : {}),
        ...('fromHand' in move ? { fromHand: [...move.fromHand] } : {}),
      },
    });
  }
  return timeline;
}

export function xmjLiveWatchPayloadFor(
  roomId: string,
  room: XmjRuntimeRoom,
): Record<string, unknown> | null {
  if (room.id !== roomId) return null;
  const projection = room.projection;
  if (projection.state.status.type !== 'playing') return null;
  if (!isTenantEventLog(xiangqiMahjongTenant, room.events, roomId)) return null;
  const events = room.events;
  const timeline = xmjWatchTimeline(events);
  const isEngine = xiangqiMahjongTenant.engine?.isEngineClientId ?? (() => false);
  const hasEngineSeat = Object.values(projection.seats).some(
    (clientId) => typeof clientId === 'string' && isEngine(clientId),
  );
  // The spectator's own view at every ply: the same view the room sends a
  // spectator, legal moves cleared.
  const spectator: Array<{ ply: number; view: XmjPlayerView }> = tenantPerPlyViews(
    xiangqiMahjongTenant,
    events,
    'spectator',
  );
  const last = spectator.at(-1)?.view;
  if (!last) return null;
  return {
    game: {
      roomId,
      variant: XIANGQI_MAHJONG_SPEC_ID,
      mode: hasEngineSeat ? 'pve' : 'pvp',
      result: 'in-progress',
      termination: 'in-progress',
      plyCount: timeline.length,
      startedAt: new Date(events[0]?.at ?? Date.now()).toISOString(),
      endedAt: null,
      rated: projection.rated,
      visibility: 'public',
      initialMs: projection.timeControl?.initialMs ?? null,
      incrementMs: projection.timeControl?.incrementMs ?? null,
    },
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.clock ? { clock: projection.clock } : {}),
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline,
    // The names the room shows its spectators, by seat (east and west are not
    // first and second mover, so the TV cannot pair names by order).
    seatDisplayNames: tenantSeatDisplayNames(xiangqiMahjongTenant, room),
    view: last,
    // The spectator track only; no seat's view and no review (all face up)
    // track exists for a live match.
    history: { spectator },
  };
}
