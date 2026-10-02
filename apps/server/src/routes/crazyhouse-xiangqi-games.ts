/**
 * Crazyhouse Xiangqi postgame route: `GET /api/crazyhouse-xiangqi/games/:id`.
 *
 * Shape-for-shape the Atomic Xiangqi route minus the whole-game analysis (an
 * admin playtest has no review engine yet). Open information, so the payload
 * carries one view (`truth`) built from Red's perspective, both hands
 * included, and both seats plus spectators get it. The per-ply history is the
 * server's own snapshots, so the replay board reads each ply's hands without
 * re-deriving them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
  getCrazyhouseXiangqiPlayerView,
  oppositeCrazyhouseXiangqiColor,
} from '@mistboard/game';
import { crazyhouseXiangqiRooms } from './../crazyhouse-xiangqi-registration.js';
import {
  type CrazyhouseXiangqiEvent,
  crazyhouseXiangqiTenant,
} from './../crazyhouse-xiangqi-tenant.js';
import { crazyhouseXiangqiEnabled } from './../feature-flags.js';
import * as persistence from './../persistence.js';
import { buildTenantGameSummary } from './../variant-tenant/events.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
  tenantPveEngineId,
} from './../variant-tenant/runtime.js';
import type { TenantRuntimeRoom } from './../variant-tenant/tenant.js';
import { type HttpApiContext, postgamePlayers, requireMethod, writeJson } from './lib.js';

type CrazyhouseXiangqiPostgameSnapshot = {
  ply: number;
  view: CrazyhouseXiangqiPlayerView;
};

type CrazyhouseXiangqiPostgameMove = {
  type: 'move-played';
  at: number;
  color: CrazyhouseXiangqiColor;
  move: CrazyhouseXiangqiMove;
  ply: number;
};

type CrazyhouseXiangqiPostgameTerminal =
  | {
      type: 'clock-expired';
      at: number;
      color: CrazyhouseXiangqiColor;
      winner: CrazyhouseXiangqiColor;
    }
  | {
      type: 'seat-resigned';
      at: number;
      color: CrazyhouseXiangqiColor;
      winner: CrazyhouseXiangqiColor;
    }
  | {
      type: 'seat-forfeited';
      at: number;
      color: CrazyhouseXiangqiColor;
      winner: CrazyhouseXiangqiColor;
    }
  | { type: 'game-aborted'; at: number; reason: string };

export type CrazyhouseXiangqiPostgamePersistence = {
  getLiveRoom?(roomId: string): CrazyhouseXiangqiRuntimeRoom | null;
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  isPersistenceEnabled?(): boolean;
  loadRoomEvents(roomId: string): Promise<CrazyhouseXiangqiEvent[] | null>;
};

type CrazyhouseXiangqiRuntimeRoom = TenantRuntimeRoom<
  'crazyhouse-xiangqi',
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState,
  typeof CRAZYHOUSE_XIANGQI_SPEC_ID
>;

const defaultPersistence: CrazyhouseXiangqiPostgamePersistence = {
  getLiveRoom: (roomId) => crazyhouseXiangqiRooms.get(roomId) ?? null,
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  isPersistenceEnabled: () => persistence.isInitialized(),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<CrazyhouseXiangqiEvent>(roomId),
};

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  const postgameMatch = pathname.match(/^\/api\/crazyhouse-xiangqi\/games\/([^/]+)$/);
  if (!postgameMatch) return false;

  if (!requireMethod(request, response, 'GET')) return true;
  if (!crazyhouseXiangqiEnabled()) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }

  const roomId = decodeURIComponent(postgameMatch[1]!);
  const payload = await crazyhouseXiangqiPostgameForApi(roomId);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

export async function crazyhouseXiangqiPostgameForApi(
  roomId: string,
  deps: CrazyhouseXiangqiPostgamePersistence = defaultPersistence,
) {
  const persistenceEnabled = deps.isPersistenceEnabled?.() ?? true;
  const [game, events] = await Promise.all([
    persistenceEnabled ? deps.getGameSummary(roomId) : null,
    persistenceEnabled ? deps.loadRoomEvents(roomId) : null,
  ]);
  if (game && game.variant !== CRAZYHOUSE_XIANGQI_SPEC_ID) return null;
  if (events && !isTenantEventLog(crazyhouseXiangqiTenant, events, roomId)) return null;

  let source: {
    game: persistence.RecentEveGameRecord;
    events: readonly CrazyhouseXiangqiEvent[];
  } | null = game && events ? { game, events } : null;
  if (!source) {
    const room = deps.getLiveRoom?.(roomId) ?? null;
    await room?.pendingWrites.catch(() => undefined);
    source = crazyhouseXiangqiPostgameFromLiveRoom(roomId, room);
  }
  if (!source) return null;

  const projection = replayTenantEvents(crazyhouseXiangqiTenant, source.events);
  if (projection.state.status.type !== 'finished') return null;
  const pveEngineId = tenantPveEngineId(crazyhouseXiangqiTenant, { projection } as never);

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
    timeline: crazyhouseXiangqiPostgameTimeline(source.events),
    view: getCrazyhouseXiangqiPlayerView(projection.state, 'red'),
    views: {
      truth: getCrazyhouseXiangqiPlayerView(projection.state, 'red'),
    },
    history: crazyhouseXiangqiPostgameHistory(source.events),
  };
}

function crazyhouseXiangqiPostgameFromLiveRoom(
  roomId: string,
  room: CrazyhouseXiangqiRuntimeRoom | null,
): { game: persistence.RecentEveGameRecord; events: readonly CrazyhouseXiangqiEvent[] } | null {
  if (!room || room.id !== roomId) return null;
  if (room.projection.state.status.type !== 'finished') return null;
  if (!isTenantEventLog(crazyhouseXiangqiTenant, room.events, roomId)) return null;
  const summary = buildTenantGameSummary(crazyhouseXiangqiTenant, room);
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
  game: Awaited<ReturnType<CrazyhouseXiangqiPostgamePersistence['getGameSummary']>>,
  color: CrazyhouseXiangqiColor,
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

/** Per-ply truth snapshots, ply 0 first, each with its move's aftermath. */
function crazyhouseXiangqiPostgameHistory(events: readonly CrazyhouseXiangqiEvent[]): {
  truth: CrazyhouseXiangqiPostgameSnapshot[];
} {
  const created = events[0];
  if (created?.type !== 'room-created') return { truth: [] };
  let projection = replayTenantEvents(crazyhouseXiangqiTenant, [created]);
  let ply = 0;
  const truth: CrazyhouseXiangqiPostgameSnapshot[] = [
    { ply, view: getCrazyhouseXiangqiPlayerView(projection.state, 'red') },
  ];

  for (const event of events.slice(1)) {
    projection = applyTenantEvent(crazyhouseXiangqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    truth.push({ ply, view: getCrazyhouseXiangqiPlayerView(projection.state, 'red') });
  }
  return { truth };
}

function crazyhouseXiangqiPostgameTimeline(
  events: readonly CrazyhouseXiangqiEvent[],
): Array<CrazyhouseXiangqiPostgameMove | CrazyhouseXiangqiPostgameTerminal> {
  const timeline: Array<CrazyhouseXiangqiPostgameMove | CrazyhouseXiangqiPostgameTerminal> = [];
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
        winner: oppositeCrazyhouseXiangqiColor(event.color),
      });
      continue;
    }
    if (event.type === 'seat-resigned' || event.type === 'seat-forfeited') {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: oppositeCrazyhouseXiangqiColor(event.color),
      });
      continue;
    }
    if (event.type === 'game-aborted') {
      timeline.push({ type: event.type, at: event.at, reason: event.reason });
    }
  }
  return timeline;
}
