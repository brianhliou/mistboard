/**
 * Duck Xiangqi postgame route — `GET /api/duck-xiangqi/games/:id`.
 *
 * Shape-for-shape the Fortress Xiangqi route minus the engine: Duck Xiangqi has
 * no analysis engine yet, so there is no `createGameAnalysisRoutes` mount and no
 * cached whole-game sweep. Everything else (the finished-game gate, the live-room
 * fallback, the per-ply truth history, the TV live-watch payload) is the same
 * because the postgame client expects the same envelope.
 *
 * Duck Xiangqi is OPEN INFORMATION: there is nothing to redact per seat, so the
 * payload carries one view (`truth`) built from Red's perspective and both seats
 * plus spectators get it. That is NOT a looser rule than the perfect-information
 * reference — fortress does exactly this — and it is deliberately not a fog
 * route: no per-seat `views.red` / `views.black` split exists to get wrong.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DUCK_XIANGQI_SPEC_ID,
  type DuckXiangqiColor,
  type DuckXiangqiGameState,
  type DuckXiangqiPlayerView,
  type DuckXiangqiTurn,
  getDuckXiangqiPlayerView,
  oppositeDuckXiangqiColor,
} from '@mistboard/game';
import { duckXiangqiRooms } from './../duck-xiangqi-registration.js';
import { type DuckXiangqiEvent, duckXiangqiTenant } from './../duck-xiangqi-tenant.js';
import { duckXiangqiEnabled } from './../feature-flags.js';
import * as persistence from './../persistence.js';
import { buildTenantGameSummary } from './../variant-tenant/events.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
  tenantPveEngineId,
} from './../variant-tenant/runtime.js';
import type { TenantRuntimeRoom } from './../variant-tenant/tenant.js';
import { registerLiveWatchPayloadBuilder } from './../watch-live.js';
import { type HttpApiContext, postgamePlayers, requireMethod, writeJson } from './lib.js';

type DuckXiangqiPostgameSnapshot = {
  ply: number;
  view: DuckXiangqiPlayerView;
};

type DuckXiangqiPostgameMove = {
  type: 'move-played';
  at: number;
  color: DuckXiangqiColor;
  move: DuckXiangqiTurn;
  ply: number;
};

type DuckXiangqiPostgameTerminal =
  | { type: 'clock-expired'; at: number; color: DuckXiangqiColor; winner: DuckXiangqiColor }
  | { type: 'seat-resigned'; at: number; color: DuckXiangqiColor; winner: DuckXiangqiColor }
  | { type: 'seat-forfeited'; at: number; color: DuckXiangqiColor; winner: DuckXiangqiColor }
  | { type: 'game-aborted'; at: number; reason: string };

export type DuckXiangqiPostgamePersistence = {
  getLiveRoom?(roomId: string): DuckXiangqiRuntimeRoom | null;
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  isPersistenceEnabled?(): boolean;
  loadRoomEvents(roomId: string): Promise<DuckXiangqiEvent[] | null>;
};

type DuckXiangqiRuntimeRoom = TenantRuntimeRoom<
  'duck-xiangqi',
  DuckXiangqiColor,
  DuckXiangqiTurn,
  DuckXiangqiGameState,
  typeof DUCK_XIANGQI_SPEC_ID
>;

const defaultPersistence: DuckXiangqiPostgamePersistence = {
  getLiveRoom: (roomId) => duckXiangqiRooms.get(roomId) ?? null,
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  isPersistenceEnabled: () => persistence.isInitialized(),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<DuckXiangqiEvent>(roomId),
};

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  const postgameMatch = pathname.match(/^\/api\/duck-xiangqi\/games\/([^/]+)$/);
  if (!postgameMatch) return false;

  if (!requireMethod(request, response, 'GET')) return true;
  if (!duckXiangqiEnabled()) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }

  const roomId = decodeURIComponent(postgameMatch[1]!);
  const payload = await duckXiangqiPostgameForApi(roomId);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

export async function duckXiangqiPostgameForApi(
  roomId: string,
  deps: DuckXiangqiPostgamePersistence = defaultPersistence,
) {
  const persistenceEnabled = deps.isPersistenceEnabled?.() ?? true;
  const [game, events] = await Promise.all([
    persistenceEnabled ? deps.getGameSummary(roomId) : null,
    persistenceEnabled ? deps.loadRoomEvents(roomId) : null,
  ]);
  if (game && game.variant !== DUCK_XIANGQI_SPEC_ID) return null;
  if (events && !isTenantEventLog(duckXiangqiTenant, events, roomId)) return null;

  let source: {
    game: persistence.RecentEveGameRecord;
    events: readonly DuckXiangqiEvent[];
  } | null = game && events ? { game, events } : null;
  if (!source) {
    const room = deps.getLiveRoom?.(roomId) ?? null;
    await room?.pendingWrites.catch(() => undefined);
    source = duckXiangqiPostgameFromLiveRoom(roomId, room);
  }
  if (!source) return null;

  const projection = replayTenantEvents(duckXiangqiTenant, source.events);
  if (projection.state.status.type !== 'finished') return null;
  const pveEngineId = tenantPveEngineId(duckXiangqiTenant, { projection } as never);

  return {
    game: {
      roomId: source.game.roomId,
      variant: source.game.variant,
      mode: source.game.mode,
      redName: postgameSeatDisplayName(source.game, 'red'),
      blackName: postgameSeatDisplayName(source.game, 'black'),
      result: source.game.result,
      termination: source.game.termination,
      plyCount: source.game.plyCount,
      startedAt: source.game.startedAt.toISOString(),
      endedAt: source.game.endedAt.toISOString(),
      rated: source.game.rated,
      visibility: source.game.visibility,
      initialMs: source.game.initialMs,
      incrementMs: source.game.incrementMs,
      ...(pveEngineId === null ? {} : { pveEngineId }),
      players: postgamePlayers(source.game.participants ?? []),
    },
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.clock ? { clock: projection.clock } : {}),
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline: duckXiangqiPostgameTimeline(source.events),
    view: getDuckXiangqiPlayerView(projection.state, 'red'),
    views: {
      truth: getDuckXiangqiPlayerView(projection.state, 'red'),
    },
    history: duckXiangqiPostgameHistory(source.events),
  };
}

// Mistboard TV live payload: the postgame shape built from an IN-PROGRESS room's
// events so far, so the watch renderer can draw and follow the live board. Duck
// Xiangqi is OPEN INFORMATION - every field here is already public to both
// players. Mirrors fortressXiangqiLiveWatchPayload.
async function duckXiangqiLiveWatchPayload(
  roomId: string,
): Promise<Record<string, unknown> | null> {
  if (!duckXiangqiTenant.enabled()) return null;
  const room = duckXiangqiRooms.get(roomId) ?? null;
  if (!room || room.id !== roomId) return null;
  await room.pendingWrites.catch(() => undefined);
  const projection = room.projection;
  if (projection.state.status.type !== 'playing') return null;
  if (!isTenantEventLog(duckXiangqiTenant, room.events, roomId)) return null;
  const timeline = duckXiangqiPostgameTimeline(room.events);
  const isEngine = duckXiangqiTenant.engine?.isEngineClientId ?? (() => false);
  const hasEngineSeat = Object.values(projection.seats).some((clientId) => isEngine(clientId));
  const view = getDuckXiangqiPlayerView(projection.state, 'red');
  return {
    game: {
      roomId,
      variant: DUCK_XIANGQI_SPEC_ID,
      mode: hasEngineSeat ? 'pve' : 'pvp',
      result: 'in-progress',
      termination: 'in-progress',
      plyCount: timeline.filter((entry) => entry.type === 'move-played').length,
      startedAt: new Date(room.events[0]?.at ?? Date.now()).toISOString(),
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
    view,
    views: { truth: view },
    history: duckXiangqiPostgameHistory(room.events),
  };
}

// Module scope on purpose (fortress does the same): importing the route module
// is what registers the TV builder, and http-api.ts's dispatch array is the only
// import site. Channel id 'duck-xiangqi' must match the `watch.channelId` the
// tenant registration declares, or the builder is never reached.
registerLiveWatchPayloadBuilder('duck-xiangqi', duckXiangqiLiveWatchPayload);

function duckXiangqiPostgameFromLiveRoom(
  roomId: string,
  room: DuckXiangqiRuntimeRoom | null,
): { game: persistence.RecentEveGameRecord; events: readonly DuckXiangqiEvent[] } | null {
  if (!room || room.id !== roomId) return null;
  if (room.projection.state.status.type !== 'finished') return null;
  if (!isTenantEventLog(duckXiangqiTenant, room.events, roomId)) return null;
  const summary = buildTenantGameSummary(duckXiangqiTenant, room);
  return {
    game: recentGameRecordFromSummary(room.id, summary),
    events: room.events,
  };
}

function recentGameRecordFromSummary(
  roomId: string,
  summary: persistence.GameSummary,
): persistence.RecentEveGameRecord {
  return {
    roomId,
    variant: summary.variant,
    mode: summary.mode ?? (summary.corpusId ? 'imported' : 'pvp'),
    result: summary.result,
    termination: summary.termination,
    plyCount: summary.plyCount,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    whiteName: summary.whiteName,
    blackName: summary.blackName,
    corpusId: summary.corpusId,
    rated: summary.rated ?? false,
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: summary.initialMs ?? null,
    incrementMs: summary.incrementMs ?? null,
    visibility: summary.visibility ?? 'public',
    participants: summary.participants ?? [],
  };
}

function postgameSeatDisplayName(
  game: Awaited<ReturnType<DuckXiangqiPostgamePersistence['getGameSummary']>>,
  color: DuckXiangqiColor,
): string {
  const legacyColor = color === 'red' ? 'white' : 'black';
  const persistedName =
    game?.participants?.find((participant) => participant.color === color)?.displayName ??
    game?.participants?.find((participant) => participant.color === legacyColor)?.displayName ??
    (color === 'red' ? game?.whiteName : game?.blackName);
  if (!persistedName) return 'Guest';
  if (persistedName === (color === 'red' ? 'Red' : 'Black')) return 'Guest';
  return persistedName;
}

/**
 * Per-ply truth snapshots, ply 0 first.
 *
 * Ply 0 is the start position, where the duck is NOT yet on the board:
 * `getDuckXiangqiPlayerView` leaves `duck` undefined there, and every later
 * snapshot carries the duck square as it stood after that turn. The replay
 * client reads the duck off these snapshots rather than recomputing it, which is
 * what makes the duck correct on every ply including the first.
 */
function duckXiangqiPostgameHistory(events: readonly DuckXiangqiEvent[]): {
  truth: DuckXiangqiPostgameSnapshot[];
} {
  const created = events[0];
  if (created?.type !== 'room-created') return { truth: [] };
  let projection = replayTenantEvents(duckXiangqiTenant, [created]);
  let ply = 0;
  const truth: DuckXiangqiPostgameSnapshot[] = [
    { ply, view: getDuckXiangqiPlayerView(projection.state, 'red') },
  ];

  for (const event of events.slice(1)) {
    projection = applyTenantEvent(duckXiangqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    truth.push({ ply, view: getDuckXiangqiPlayerView(projection.state, 'red') });
  }
  return { truth };
}

function duckXiangqiPostgameTimeline(
  events: readonly DuckXiangqiEvent[],
): Array<DuckXiangqiPostgameMove | DuckXiangqiPostgameTerminal> {
  const timeline: Array<DuckXiangqiPostgameMove | DuckXiangqiPostgameTerminal> = [];
  let ply = 0;
  for (const event of events) {
    if (event.type === 'move-played') {
      ply += 1;
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        move: event.move,
        ply,
      });
      continue;
    }
    if (event.type === 'clock-expired') {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: oppositeDuckXiangqiColor(event.color),
      });
      continue;
    }
    if (event.type === 'seat-resigned' || event.type === 'seat-forfeited') {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: oppositeDuckXiangqiColor(event.color),
      });
      continue;
    }
    if (event.type === 'game-aborted') {
      timeline.push({ type: event.type, at: event.at, reason: event.reason });
    }
  }
  return timeline;
}
