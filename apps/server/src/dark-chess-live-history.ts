// A live Fog Chess seat's own per-ply history, for the HELLO frame of a seated
// connection on the legacy chess stack (server-ws-connection.ts). The client's
// event log is fog-filtered (no opponent moves), so after a reload it cannot
// rebuild the plies it saw; it held only the live view and every earlier move
// in the list was a dead click. This sends what the room served this seat at
// each ply instead.
//
// HIDDEN-INFO: every view comes from getClientView, the same per-client
// builder that served the seat live, on the projection cut at that ply. The
// gates mirror the tenant runtime's (tenantLiveHistoryExtras): a COLOR seat
// only (live fog spectators are refused at the connection layer anyway, and
// the view builder blanks them), a PLAYING room only (a finished room reveals
// truth through the snapshot), never a solo sandbox client (it sees both
// sides' legal moves, nothing a reload loses). Never the other seat's view,
// never truth.
//
// eventsLen is how many of this client's (fog-filtered) events had arrived by
// that ply, the key live-replay.ts uses to map a move-list click to a ply.

import {
  applyGameEvent,
  type GameEvent,
  type GameProjection,
  initialGameProjection,
  type PlayerView,
} from '@mistboard/game';
import {
  filterEventForClient,
  getClientView,
  type SnapshotClient,
  type SnapshotRoom,
} from './payloads.js';

export type DarkChessLiveHistoryEntry = { ply: number; view: PlayerView; eventsLen: number };

export function darkChessLiveHistoryExtras(
  room: SnapshotRoom,
  client: SnapshotClient,
): { liveHistory?: DarkChessLiveHistoryEntry[] } {
  if (room.projection.variant !== 'dark-chess') return {};
  if (room.projection.state.status.type !== 'playing') return {};
  if (client.solo) return {};
  if (client.seat !== 'white' && client.seat !== 'black') return {};
  const history = darkChessSeatHistory(room, client);
  return history.length > 0 ? { liveHistory: history } : {};
}

export function darkChessSeatHistory(
  room: SnapshotRoom,
  client: SnapshotClient,
): DarkChessLiveHistoryEntry[] {
  const created = room.events[0];
  if (created?.type !== 'room-created') return [];
  let projection: GameProjection = initialGameProjection(created.roomId, room.projection.variant);
  const history: DarkChessLiveHistoryEntry[] = [];
  let visible = 0;
  const viewAt = (events: GameEvent[]): PlayerView => ({
    ...getClientView({ ...room, events, projection }, client),
    legalMoves: [],
  });
  for (const [index, event] of room.events.entries()) {
    if (event.type === 'move-played' && history.length === 0) {
      // Ply 0: the position before the first move, keyed to the events that
      // had arrived by then.
      history.push({ ply: 0, view: viewAt(room.events.slice(0, index)), eventsLen: visible });
    }
    projection = applyGameEvent(projection, event);
    const sliced = { ...room, events: room.events.slice(0, index + 1), projection };
    if (filterEventForClient(sliced, client, event)) visible += 1;
    if (event.type !== 'move-played') continue;
    history.push({
      ply: history.length,
      view: viewAt(room.events.slice(0, index + 1)),
      eventsLen: visible,
    });
  }
  return history;
}
