/**
 * Atomic Xiangqi postgame route — `GET /api/atomic-xiangqi/games/:id`, plus
 * cached whole-game analysis under it (`…/analysis`). Native search is retired.
 *
 * Shape-for-shape the Duck Xiangqi route, including the live board builder
 * (`atomicXiangqiLiveWatchPayload`) that /games, Watch live and the
 * correspondence inbox draw an in-progress game from; the registration's
 * `watch:` block names its channel. Open information, so the payload carries one
 * view (`truth`) built from Red's perspective and both seats plus spectators
 * get it. The per-ply history is the server's own snapshots, each carrying the
 * aftermath of its move (`lastBlast`), so the watch board can draw what every
 * explosion took without re-deriving it.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ATOMIC_XIANGQI_SPEC_ID,
  type AtomicXiangqiColor,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  type AtomicXiangqiPlayerView,
  getAtomicXiangqiPlayerView,
  oppositeAtomicXiangqiColor,
} from '@mistboard/game';
import {
  ATOMIC_XIANGQI_ANALYSIS_DEPTH,
  ATOMIC_XIANGQI_ANALYSIS_ENGINE_ID,
} from './../atomic-xiangqi-engine-history.js';
import { atomicXiangqiRooms } from './../atomic-xiangqi-registration.js';
import { type AtomicXiangqiEvent, atomicXiangqiTenant } from './../atomic-xiangqi-tenant.js';
import { atomicXiangqiEnabled } from './../feature-flags.js';
import type { SweepPlyEval } from './../game-analysis-sweep.js';
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

type AtomicXiangqiPostgameSnapshot = {
  ply: number;
  view: AtomicXiangqiPlayerView;
};

type AtomicXiangqiPostgameMove = {
  type: 'move-played';
  at: number;
  color: AtomicXiangqiColor;
  move: AtomicXiangqiMove;
  ply: number;
};

type AtomicXiangqiPostgameTerminal =
  | { type: 'clock-expired'; at: number; color: AtomicXiangqiColor; winner: AtomicXiangqiColor }
  | { type: 'seat-resigned'; at: number; color: AtomicXiangqiColor; winner: AtomicXiangqiColor }
  | { type: 'seat-forfeited'; at: number; color: AtomicXiangqiColor; winner: AtomicXiangqiColor }
  | { type: 'game-aborted'; at: number; reason: string };

export type AtomicXiangqiPostgamePersistence = {
  getLiveRoom?(roomId: string): AtomicXiangqiRuntimeRoom | null;
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  isPersistenceEnabled?(): boolean;
  loadRoomEvents(roomId: string): Promise<AtomicXiangqiEvent[] | null>;
};

type AtomicXiangqiRuntimeRoom = TenantRuntimeRoom<
  'atomic-xiangqi',
  AtomicXiangqiColor,
  AtomicXiangqiMove,
  AtomicXiangqiGameState,
  typeof ATOMIC_XIANGQI_SPEC_ID
>;

const defaultPersistence: AtomicXiangqiPostgamePersistence = {
  getLiveRoom: (roomId) => atomicXiangqiRooms.get(roomId) ?? null,
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  isPersistenceEnabled: () => persistence.isInitialized(),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<AtomicXiangqiEvent>(roomId),
};

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  // Historical analysis is readable with the launch flag off. Never enqueue a
  // native sweep, including a POST from an older browser review client.
  const analysisMatch = pathname.match(/^\/api\/atomic-xiangqi\/games\/([^/]+)\/analysis$/);
  if (analysisMatch) {
    if (request.method === 'POST') {
      writeJson(response, 410, { error: 'retired_game_spec' });
      return true;
    }
    if (!requireMethod(request, response, 'GET')) return true;
    const roomId = decodeURIComponent(analysisMatch[1]!);
    const payload = await atomicXiangqiPostgameForApi(roomId);
    if (!payload) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    const cached = await resolveAtomicXiangqiAnalysis(roomId, payload);
    if (cached) writeJson(response, 200, cached);
    else response.writeHead(204).end();
    return true;
  }

  const postgameMatch = pathname.match(/^\/api\/atomic-xiangqi\/games\/([^/]+)$/);
  if (!postgameMatch) return false;

  if (!requireMethod(request, response, 'GET')) return true;

  const roomId = decodeURIComponent(postgameMatch[1]!);
  const payload = await atomicXiangqiPostgameForApi(roomId);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

export type AtomicXiangqiGameAnalysis = {
  engineId: string;
  depth: number;
  plies: SweepPlyEval[];
};

type AtomicXiangqiAnalysisPayload = {
  timeline: ReadonlyArray<{ type: string; move?: AtomicXiangqiMove }>;
};

/** Read the original analysis cache dimensions; retired games never compute. */
export type AtomicXiangqiAnalysisCache = {
  get(roomId: string, engineId: string, depth: number): Promise<SweepPlyEval[] | null>;
};

const liveAnalysisCache: AtomicXiangqiAnalysisCache = {
  get: (roomId, engineId, depth) => persistence.getGameAnalysis(roomId, engineId, depth),
};

export async function resolveAtomicXiangqiAnalysis(
  roomId: string,
  _payload: AtomicXiangqiAnalysisPayload,
  cache: AtomicXiangqiAnalysisCache = liveAnalysisCache,
): Promise<AtomicXiangqiGameAnalysis | null> {
  const engineId = ATOMIC_XIANGQI_ANALYSIS_ENGINE_ID;
  const depth = ATOMIC_XIANGQI_ANALYSIS_DEPTH;
  const plies = await cache.get(roomId, engineId, depth);
  return plies ? { engineId, depth, plies } : null;
}

export async function atomicXiangqiPostgameForApi(
  roomId: string,
  deps: AtomicXiangqiPostgamePersistence = defaultPersistence,
) {
  const persistenceEnabled = deps.isPersistenceEnabled?.() ?? true;
  const [game, events] = await Promise.all([
    persistenceEnabled ? deps.getGameSummary(roomId) : null,
    persistenceEnabled ? deps.loadRoomEvents(roomId) : null,
  ]);
  if (game && game.variant !== ATOMIC_XIANGQI_SPEC_ID) return null;
  if (events && !isTenantEventLog(atomicXiangqiTenant, events, roomId)) return null;

  let source: {
    game: persistence.RecentEveGameRecord;
    events: readonly AtomicXiangqiEvent[];
  } | null = game && events ? { game, events } : null;
  if (!source) {
    const room = deps.getLiveRoom?.(roomId) ?? null;
    await room?.pendingWrites.catch(() => undefined);
    source = atomicXiangqiPostgameFromLiveRoom(roomId, room);
  }
  if (!source) return null;

  const projection = replayTenantEvents(atomicXiangqiTenant, source.events);
  if (projection.state.status.type !== 'finished') return null;
  const pveEngineId = tenantPveEngineId(atomicXiangqiTenant, { projection } as never);

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
    timeline: atomicXiangqiPostgameTimeline(source.events),
    view: getAtomicXiangqiPlayerView(projection.state, 'red'),
    views: {
      truth: getAtomicXiangqiPlayerView(projection.state, 'red'),
    },
    history: atomicXiangqiPostgameHistory(source.events),
  };
}

// Mistboard TV live payload: the postgame shape built from an IN-PROGRESS room's
// events so far, so the watch renderer can draw and follow the live board.
// Atomic Xiangqi is OPEN INFORMATION, so every field here is already public to
// both players. The board is the kernel's own post-explosion state (the room's
// projection, and per ply the replayed snapshots, each carrying `lastBlast`);
// nothing here re-derives an explosion. Mirrors duckXiangqiLiveWatchPayload.
export function atomicXiangqiLiveWatchPayloadFor(
  roomId: string,
  room: Pick<AtomicXiangqiRuntimeRoom, 'id' | 'events' | 'projection'>,
): Record<string, unknown> | null {
  if (room.id !== roomId) return null;
  const projection = room.projection;
  if (projection.state.status.type !== 'playing') return null;
  if (!isTenantEventLog(atomicXiangqiTenant, room.events, roomId)) return null;
  const timeline = atomicXiangqiPostgameTimeline(room.events);
  const isEngine = atomicXiangqiTenant.engine?.isEngineClientId ?? (() => false);
  const hasEngineSeat = Object.values(projection.seats).some((clientId) => isEngine(clientId));
  const view = getAtomicXiangqiPlayerView(projection.state, 'red');
  return {
    game: {
      roomId,
      variant: ATOMIC_XIANGQI_SPEC_ID,
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
    history: atomicXiangqiPostgameHistory(room.events),
  };
}

async function atomicXiangqiLiveWatchPayload(
  roomId: string,
): Promise<Record<string, unknown> | null> {
  if (!atomicXiangqiEnabled()) return null;
  const room = atomicXiangqiRooms.get(roomId) ?? null;
  if (!room) return null;
  await room.pendingWrites.catch(() => undefined);
  return atomicXiangqiLiveWatchPayloadFor(roomId, room);
}

// Module scope on purpose (duck and fortress do the same): importing the route
// module is what registers the TV builder, and http-api.ts's dispatch array is
// the only import site. Channel id 'atomic-xiangqi' must match the
// `watch.channelId` the tenant registration declares, or the builder is never
// reached (games-route-registration.test.ts checks every open channel has one).
registerLiveWatchPayloadBuilder('atomic-xiangqi', atomicXiangqiLiveWatchPayload);

function atomicXiangqiPostgameFromLiveRoom(
  roomId: string,
  room: AtomicXiangqiRuntimeRoom | null,
): { game: persistence.RecentEveGameRecord; events: readonly AtomicXiangqiEvent[] } | null {
  if (!room || room.id !== roomId) return null;
  if (room.projection.state.status.type !== 'finished') return null;
  if (!isTenantEventLog(atomicXiangqiTenant, room.events, roomId)) return null;
  const summary = buildTenantGameSummary(atomicXiangqiTenant, room);
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
  game: Awaited<ReturnType<AtomicXiangqiPostgamePersistence['getGameSummary']>>,
  color: AtomicXiangqiColor,
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
function atomicXiangqiPostgameHistory(events: readonly AtomicXiangqiEvent[]): {
  truth: AtomicXiangqiPostgameSnapshot[];
} {
  const created = events[0];
  if (created?.type !== 'room-created') return { truth: [] };
  let projection = replayTenantEvents(atomicXiangqiTenant, [created]);
  let ply = 0;
  const truth: AtomicXiangqiPostgameSnapshot[] = [
    { ply, view: getAtomicXiangqiPlayerView(projection.state, 'red') },
  ];

  for (const event of events.slice(1)) {
    projection = applyTenantEvent(atomicXiangqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    truth.push({ ply, view: getAtomicXiangqiPlayerView(projection.state, 'red') });
  }
  return { truth };
}

function atomicXiangqiPostgameTimeline(
  events: readonly AtomicXiangqiEvent[],
): Array<AtomicXiangqiPostgameMove | AtomicXiangqiPostgameTerminal> {
  const timeline: Array<AtomicXiangqiPostgameMove | AtomicXiangqiPostgameTerminal> = [];
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
        winner: oppositeAtomicXiangqiColor(event.color),
      });
      continue;
    }
    if (event.type === 'seat-resigned' || event.type === 'seat-forfeited') {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: oppositeAtomicXiangqiColor(event.color),
      });
      continue;
    }
    if (event.type === 'game-aborted') {
      timeline.push({ type: event.type, at: event.at, reason: event.reason });
    }
  }
  return timeline;
}
