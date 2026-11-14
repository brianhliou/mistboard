import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type BanqiSeat,
  FFQ_BANQI_SPEC_ID,
  getFFQBanqiPlayerView,
  oppositeBanqiSeat,
} from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import type { BanqiDecision } from '../banqi-analysis.js';
import { ffqBanqiAdmits, ffqBanqiCorrespondenceAdmits } from './../ffq-banqi-access.js';
import {
  FFQ_BANQI_ANALYSIS_TIER,
  type FFQBanqiAnalysisCache,
  type FFQBanqiGameAnalysis,
  resolveFFQBanqiAnalysis,
} from '../ffq-banqi-analysis.js';
import {
  type FFQBanqiDecisionsCache,
  type FFQPublicTrack,
  resolveFFQBanqiDecisions,
} from '../ffq-banqi-decisions.js';
import { ffqBanqiEngineAvailable } from '../ffq-banqi-engine.js';
import { ffqBanqiRooms } from '../ffq-banqi-registration.js';
import { ffqBanqiPostgameHistory } from '../ffq-banqi-replay.js';
import {
  type FFQBanqiEvent,
  type FFQBanqiRuntimeRoom,
  ffqBanqiTenant,
} from './../ffq-banqi-tenant.js';
import * as persistence from './../persistence.js';
import { isTenantEventLog, replayTenantEvents } from './../variant-tenant/runtime.js';
import { registerLiveWatchPayloadBuilder } from '../watch-live.js';
import { createGameAnalysisRoutes, type GameAnalysisRouteDeps } from './game-analysis-route.js';
import { type HttpApiContext, postgameGameSummary, requireMethod, writeJson } from './lib.js';

// Launch-gated finished replay. All snapshots are observer-masked, even after
// game end. The deal and the old flip variants' revealed track never leave here.

type FFQBanqiPostgameMove = {
  type: 'move-played';
  at: number;
  color: BanqiSeat;
  move: { from: number; to: number };
  ply: number;
};

type FFQBanqiPostgameTerminal =
  | { type: 'clock-expired'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'seat-resigned'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'seat-forfeited'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'game-aborted'; at: number; reason: string };

export type FFQBanqiPostgamePersistence = {
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  loadRoomEvents(roomId: string): Promise<FFQBanqiEvent[] | null>;
};

/** Everything the handler reads from outside, injectable for the route tests. */
export type FFQBanqiPostgameRouteDeps = FFQBanqiPostgamePersistence & {
  persistenceReady(): boolean;
  admits(request: IncomingMessage, roomId: string): Promise<boolean>;
};

const defaultDeps: FFQBanqiPostgameRouteDeps = {
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<FFQBanqiEvent>(roomId),
  persistenceReady: () => persistence.isInitialized(),
  admits: async (request, roomId) => {
    const account = await currentAccountUser(request);
    if (!ffqBanqiAdmits(account)) return false;
    if (ffqBanqiCorrespondenceAdmits(account)) return true;
    const game = persistence.isInitialized() ? await persistence.getGameSummary(roomId) : null;
    if (!game || game.variant !== FFQ_BANQI_SPEC_ID || game.visibility === 'private') return false;
    // Ordinary room summaries do not persist daysPerMove; the recorded opening
    // is authoritative even after the correspondence deadline row is removed.
    const events = await persistence.loadRoomEvents<FFQBanqiEvent>(roomId);
    const created = events?.[0];
    return created?.type === 'room-created' && created.timeControl?.daysPerMove === undefined;
  },
};

const POSTGAME_ROUTE = /^\/api\/ffq-banqi\/games\/([^/]+)$/;

const ANALYSIS_ROUTE =
  /^\/api\/ffq-banqi\/games\/([^/]+)\/(?:analysis|decisions)(?:\/jobs\/[^/]+)?$/;

export function createFFQBanqiAnalysisRoutes(
  deps: FFQBanqiPostgameRouteDeps = defaultDeps,
  options: {
    cache?: FFQBanqiAnalysisCache;
    decisionsCache?: FFQBanqiDecisionsCache;
    analyzeDecisions?: (track: FFQPublicTrack) => Promise<BanqiDecision[]>;
    analyze?: (events: readonly FFQBanqiEvent[]) => Promise<FFQBanqiGameAnalysis>;
    engineAvailable?: () => boolean;
    route?: GameAnalysisRouteDeps;
  } = {},
) {
  const handle = createGameAnalysisRoutes(
    {
      routeId: 'ffq-banqi',
      logPrefix: 'ffq_banqi',
      variantLabel: 'Fanfanqi',
      enabled: () => true,
      requiresPersistence: false,
      engineBinary: {
        available:
          options.engineAvailable ?? (() => ffqBanqiEngineAvailable(FFQ_BANQI_ANALYSIS_TIER)),
        label: 'Misty FFQ level 7 classical engine',
      },
      loadInputs: async (roomId) => (await loadFinishedGame(roomId, deps))?.events ?? null,
      countPlies: (events) => events.filter((event) => event.type === 'move-played').length,
      resolveAnalysis: (roomId, events, computeIfMissing) =>
        resolveFFQBanqiAnalysis(roomId, events, options.cache, options.analyze, computeIfMissing),
      resolveDecisions: (roomId, events, computeIfMissing) =>
        resolveFFQBanqiDecisions(
          roomId,
          events,
          options.decisionsCache,
          options.analyzeDecisions,
          computeIfMissing,
        ),
      // Flips AND captures of covered pieces resolve chance. Neither raw swing
      // should be graded as a player's mistake.
      analysisExtras: (events) => {
        const frames = ffqBanqiPostgameHistory(events).truth;
        return {
          chancePlies: events
            .filter((event) => event.type === 'move-played')
            .flatMap((event, index) =>
              frames[index]?.view.board[event.move.to]?.faceDown ? [index + 1] : [],
            ),
        };
      },
    },
    options.route,
  );
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<boolean> => {
    const match = pathname.match(ANALYSIS_ROUTE);
    if (!match) return false;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('x-robots-tag', 'noindex');
    if (!(await deps.admits(request, decodeURIComponent(match[1]!)))) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    if (!deps.persistenceReady()) {
      writeJson(response, 503, { error: 'persistence_disabled' });
      return true;
    }
    return handle(request, response, pathname);
  };
}

const handleAnalysis = createFFQBanqiAnalysisRoutes();

// Reuse the masked review projection for TV; no raw projection or setup is
// serialized. The launch switch and live-only check also protect direct calls.
export function ffqBanqiLiveWatchPayloadFor(
  roomId: string,
  room: Pick<FFQBanqiRuntimeRoom, 'id' | 'events' | 'projection'>,
): Record<string, unknown> | null {
  if (!ffqBanqiAdmits(null) || room.id !== roomId) return null;
  const projection = room.projection;
  if (
    projection.state.status.type !== 'playing' ||
    projection.timeControl?.daysPerMove !== undefined
  )
    return null;
  if (!isTenantEventLog(ffqBanqiTenant, room.events, roomId)) return null;
  const timeline = ffqBanqiPostgameTimeline(room.events);
  const isEngine = ffqBanqiTenant.engine!.isEngineClientId;
  return {
    game: {
      roomId,
      variant: FFQ_BANQI_SPEC_ID,
      mode: Object.values(projection.seats).some(isEngine) ? 'pve' : 'pvp',
      result: 'in-progress',
      termination: 'in-progress',
      plyCount: timeline.filter((entry) => entry.type === 'move-played').length,
      startedAt: new Date(room.events[0]!.at).toISOString(),
      endedAt: null,
      rated: false,
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
    view: getFFQBanqiPlayerView(projection.state, 'observer'),
    history: ffqBanqiPostgameHistory(room.events),
  };
}

registerLiveWatchPayloadBuilder(FFQ_BANQI_SPEC_ID, async (roomId) => {
  if (!ffqBanqiAdmits(null)) return null;
  const room = ffqBanqiRooms.get(roomId);
  if (!room) return null;
  await room.pendingWrites.catch(() => undefined);
  return ffqBanqiLiveWatchPayloadFor(roomId, room);
});

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  if (await handleAnalysis(request, response, pathname)) return true;
  return handleFFQBanqiPostgame(request, response, pathname);
}

export async function handleFFQBanqiPostgame(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  deps: FFQBanqiPostgameRouteDeps = defaultDeps,
): Promise<boolean> {
  const match = pathname.match(POSTGAME_ROUTE);
  if (!match) return false;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('x-robots-tag', 'noindex');
  if (!requireMethod(request, response, 'GET')) return true;
  // Reject unlaunched callers before persistence; launched viewers must also
  // pass the per-game correspondence and privacy checks.
  if (!(await deps.admits(request, decodeURIComponent(match[1]!)))) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  if (!deps.persistenceReady()) {
    writeJson(response, 503, { error: 'persistence_disabled' });
    return true;
  }
  const payload = await ffqBanqiPostgameForApi(decodeURIComponent(match[1]!), deps);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

export async function ffqBanqiPostgameForApi(
  roomId: string,
  deps: FFQBanqiPostgamePersistence = defaultDeps,
) {
  const loaded = await loadFinishedGame(roomId, deps);
  if (!loaded) return null;
  const { game, events, projection } = loaded;

  return {
    game: postgameGameSummary(game),
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.clock ? { clock: projection.clock } : {}),
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline: ffqBanqiPostgameTimeline(events),
    view: getFFQBanqiPlayerView(projection.state, 'observer'),
    history: ffqBanqiPostgameHistory(events),
  };
}

function ffqBanqiPostgameTimeline(
  events: readonly FFQBanqiEvent[],
): Array<FFQBanqiPostgameMove | FFQBanqiPostgameTerminal> {
  const timeline: Array<FFQBanqiPostgameMove | FFQBanqiPostgameTerminal> = [];
  let ply = 0;
  for (const event of events) {
    if (event.type === 'move-played') {
      ply += 1;
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        move: { from: event.move.from, to: event.move.to },
        ply,
      });
      continue;
    }
    if (
      event.type === 'clock-expired' ||
      event.type === 'seat-resigned' ||
      event.type === 'seat-forfeited'
    ) {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: oppositeBanqiSeat(event.color),
      });
      continue;
    }
    if (event.type === 'game-aborted') {
      timeline.push({ type: event.type, at: event.at, reason: event.reason });
    }
  }
  return timeline;
}

async function loadFinishedGame(roomId: string, deps: FFQBanqiPostgamePersistence) {
  const [game, events] = await Promise.all([
    deps.getGameSummary(roomId),
    deps.loadRoomEvents(roomId),
  ]);
  if (!game || game.variant !== FFQ_BANQI_SPEC_ID) return null;
  if (!events || !isTenantEventLog(ffqBanqiTenant, events, roomId)) return null;

  const projection = replayTenantEvents(ffqBanqiTenant, events);
  if (projection.state.status.type !== 'finished') return null;

  return { game, events, projection };
}
