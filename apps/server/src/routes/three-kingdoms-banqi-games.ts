import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type BanqiSeat,
  getThreeKingdomsBanqiPlayerView,
  oppositeBanqiSeat,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  type ThreeKingdomsBanqiPlayerView,
} from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import { threeKingdomsBanqiEnabled } from '../feature-flags.js';
import * as persistence from './../persistence.js';
import { threeKingdomsBanqiAdmits } from './../three-kingdoms-banqi-access.js';
import {
  resolveThreeKingdomsBanqiAnalysis,
  THREE_KINGDOMS_BANQI_ANALYSIS_TIER,
  type ThreeKingdomsBanqiAnalysisCache,
  type ThreeKingdomsBanqiGameAnalysis,
} from './../three-kingdoms-banqi-analysis.js';
import {
  resolveThreeKingdomsBanqiDecisions,
  type ThreeKingdomsBanqiDecision,
  type ThreeKingdomsBanqiDecisionsCache,
} from './../three-kingdoms-banqi-decisions.js';
import { threeKingdomsBanqiEngineAvailable } from './../three-kingdoms-banqi-engine.js';
import { threeKingdomsBanqiRooms } from '../three-kingdoms-banqi-registration.js';
import {
  getThreeKingdomsBanqiTruthView,
  type ThreeKingdomsBanqiEvent,
  threeKingdomsBanqiTenant,
} from './../three-kingdoms-banqi-tenant.js';
import {
  getThreeKingdomsBanqiClientView,
  type ThreeKingdomsBanqiRuntimeRoom,
} from '../three-kingdoms-banqi-tenant.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
} from './../variant-tenant/runtime.js';
import { registerLiveWatchPayloadBuilder } from '../watch-live.js';
import { createGameAnalysisRoutes, type GameAnalysisRouteDeps } from './game-analysis-route.js';
import { type HttpApiContext, postgameGameSummary, requireMethod, writeJson } from './lib.js';

// Three Kingdoms banqi (#628) postgame review: GET /api/three-kingdoms-banqi/games/:roomId.
//
// ADMIN PLAYTEST (#684). The route opens to exactly who may open a TK room
// (three-kingdoms-banqi-access.ts: an admin account, or anyone under the local
// flag). Everyone else gets the same 404 as a game that does not exist, so the
// route cannot confirm that an admin's game is there.
//
// HIDDEN INFORMATION, banqi's finished-game policy exactly (routes/banqi-games.ts).
// TK is symmetric hidden identity: a face-down tile is hidden from both seats
// and every capture is of a face-up piece, so the deal is the one secret. The
// route answers ONLY for a log that replays to 'finished' (a finished room
// reveals everything); a live or aborted game gets the 404. The deal itself
// (room-created setup) never goes out as such: the payload is the truth view of
// the final position, the as-played masked board at every ply (`history.truth`,
// the red seat's view, identical for both seats), and the revealed board at every
// ply (`history.revealed`). Regression: routes/three-kingdoms-banqi-games.test.ts.
//
// Whole-game analysis uses the live engine's public information state at L8.

type ThreeKingdomsBanqiPostgameSnapshot = { ply: number; view: ThreeKingdomsBanqiPlayerView };

type ThreeKingdomsBanqiPostgameMove = {
  type: 'move-played';
  at: number;
  color: BanqiSeat;
  move: { from: string; to: string };
  ply: number;
};

type ThreeKingdomsBanqiPostgameTerminal =
  | { type: 'clock-expired'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'seat-resigned'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'seat-forfeited'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'game-aborted'; at: number; reason: string };

export type ThreeKingdomsBanqiPostgamePersistence = {
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  loadRoomEvents(roomId: string): Promise<ThreeKingdomsBanqiEvent[] | null>;
};

/** Everything the handler reads from outside, injectable for the route tests. */
export type ThreeKingdomsBanqiPostgameRouteDeps = ThreeKingdomsBanqiPostgamePersistence & {
  persistenceReady(): boolean;
  admits(request: IncomingMessage): Promise<boolean>;
};

const defaultDeps: ThreeKingdomsBanqiPostgameRouteDeps = {
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<ThreeKingdomsBanqiEvent>(roomId),
  persistenceReady: () => persistence.isInitialized(),
  admits: async (request) => threeKingdomsBanqiAdmits(await currentAccountUser(request)),
};

const POSTGAME_ROUTE = /^\/api\/three-kingdoms-banqi\/games\/([^/]+)$/;
const ANALYSIS_ROUTE =
  /^\/api\/three-kingdoms-banqi\/games\/[^/]+\/(analysis|decisions)(?:\/jobs\/[^/]+)?$/;

export function createThreeKingdomsBanqiAnalysisRoutes(
  deps: ThreeKingdomsBanqiPostgameRouteDeps = defaultDeps,
  options: {
    cache?: ThreeKingdomsBanqiAnalysisCache;
    analyze?: (
      events: readonly ThreeKingdomsBanqiEvent[],
    ) => Promise<ThreeKingdomsBanqiGameAnalysis>;
    engineAvailable?: () => boolean;
    decisionsCache?: ThreeKingdomsBanqiDecisionsCache;
    analyzeDecisions?: (
      events: readonly ThreeKingdomsBanqiEvent[],
    ) => Promise<ThreeKingdomsBanqiDecision[]>;
    route?: GameAnalysisRouteDeps;
  } = {},
) {
  const handle = createGameAnalysisRoutes(
    {
      routeId: 'three-kingdoms-banqi',
      logPrefix: 'three_kingdoms_banqi',
      variantLabel: 'Three Kingdoms banqi',
      // The wrapper applies playtest admission to every path.
      enabled: () => true,
      requiresPersistence: false,
      engineBinary: {
        available:
          options.engineAvailable ??
          (() => threeKingdomsBanqiEngineAvailable(THREE_KINGDOMS_BANQI_ANALYSIS_TIER)),
        label: 'Three Kingdoms L8 engine and NNUE net',
      },
      loadInputs: async (roomId) => (await loadFinishedGame(roomId, deps))?.events ?? null,
      countPlies: (events) => events.filter((event) => event.type === 'move-played').length,
      resolveAnalysis: (roomId, events, computeIfMissing) =>
        resolveThreeKingdomsBanqiAnalysis(
          roomId,
          events,
          options.cache,
          options.analyze,
          computeIfMissing,
        ),
      resolveDecisions: (roomId, events, computeIfMissing) =>
        resolveThreeKingdomsBanqiDecisions(
          roomId,
          events,
          options.decisionsCache,
          options.analyzeDecisions,
          computeIfMissing,
        ),
      // Base scores include reveal luck. The follow-on decisions overlay
      // supplies luck-free judgments; never grade the raw flip swing.
      analysisExtras: (events) => ({
        chancePlies: events
          .filter((event) => event.type === 'move-played')
          .flatMap((event, index) => (event.move.from === event.move.to ? [index + 1] : [])),
      }),
    },
    options.route,
  );
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<boolean> => {
    if (!ANALYSIS_ROUTE.test(pathname)) return false;
    // Every TK path, decisions reads included, answers only to the playtest
    // admission while TK is unlaunched: anyone else gets the unknown-game 404,
    // so no route confirms that an admin's game exists. Decisions hold
    // public-information values only; open the GET like banqi's at launch.
    if (!(await deps.admits(request))) {
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

const handleAnalysis = createThreeKingdomsBanqiAnalysisRoutes();

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  if (await handleAnalysis(request, response, pathname)) return true;
  return handleThreeKingdomsBanqiPostgame(request, response, pathname);
}

export async function handleThreeKingdomsBanqiPostgame(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  deps: ThreeKingdomsBanqiPostgameRouteDeps = defaultDeps,
): Promise<boolean> {
  const match = pathname.match(POSTGAME_ROUTE);
  if (!match) return false;
  if (!requireMethod(request, response, 'GET')) return true;
  // The gate comes before persistence and the lookup: a refused caller learns
  // nothing, not even whether the database is up.
  if (!(await deps.admits(request))) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  if (!deps.persistenceReady()) {
    writeJson(response, 503, { error: 'persistence_disabled' });
    return true;
  }
  const payload = await threeKingdomsBanqiPostgameForApi(decodeURIComponent(match[1]!), deps);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

export async function threeKingdomsBanqiPostgameForApi(
  roomId: string,
  deps: ThreeKingdomsBanqiPostgamePersistence = defaultDeps,
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
    timeline: threeKingdomsBanqiPostgameTimeline(events),
    // Every identity revealed: postgame only, never on a live wire.
    view: getThreeKingdomsBanqiTruthView(projection.state),
    history: threeKingdomsBanqiPostgameHistory(events),
  };
}

async function loadFinishedGame(roomId: string, deps: ThreeKingdomsBanqiPostgamePersistence) {
  const [game, events] = await Promise.all([
    deps.getGameSummary(roomId),
    deps.loadRoomEvents(roomId),
  ]);
  if (!game || game.variant !== THREE_KINGDOMS_BANQI_SPEC_ID) return null;
  if (!events || !isTenantEventLog(threeKingdomsBanqiTenant, events, roomId)) return null;

  const projection = replayTenantEvents(threeKingdomsBanqiTenant, events);
  if (projection.state.status.type !== 'finished') return null;

  return { game, events, projection };
}

// Per-ply snapshots in banqi's two tracks: 'truth' is the as-played masked board
// (a tile not yet flipped is face down), 'revealed' shows every identity at every
// ply. The masked view is the same for both seats, so 'red' is arbitrary.
function threeKingdomsBanqiPostgameHistory(events: readonly ThreeKingdomsBanqiEvent[]): {
  truth: ThreeKingdomsBanqiPostgameSnapshot[];
  revealed: ThreeKingdomsBanqiPostgameSnapshot[];
} {
  const created = events[0];
  if (created?.type !== 'room-created') return { truth: [], revealed: [] };
  let projection = replayTenantEvents(threeKingdomsBanqiTenant, [created]);
  let ply = 0;
  const truth = [{ ply, view: getThreeKingdomsBanqiPlayerView(projection.state, 'red') }];
  const revealed = [{ ply, view: getThreeKingdomsBanqiTruthView(projection.state) }];
  for (const event of events.slice(1)) {
    projection = applyTenantEvent(threeKingdomsBanqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    truth.push({ ply, view: getThreeKingdomsBanqiPlayerView(projection.state, 'red') });
    revealed.push({ ply, view: getThreeKingdomsBanqiTruthView(projection.state) });
  }
  return { truth, revealed };
}

function threeKingdomsBanqiPostgameTimeline(
  events: readonly ThreeKingdomsBanqiEvent[],
): Array<ThreeKingdomsBanqiPostgameMove | ThreeKingdomsBanqiPostgameTerminal> {
  const timeline: Array<ThreeKingdomsBanqiPostgameMove | ThreeKingdomsBanqiPostgameTerminal> = [];
  let ply = 0;
  for (const event of events) {
    if (event.type === 'move-played') {
      ply += 1;
      timeline.push({ type: event.type, at: event.at, color: event.color, move: event.move, ply });
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

export function threeKingdomsBanqiLiveWatchPayloadFor(
  roomId: string,
  room: Pick<ThreeKingdomsBanqiRuntimeRoom, 'id' | 'events' | 'projection'>,
): Record<string, unknown> | null {
  if (room.id !== roomId) return null;
  const projection = room.projection;
  if (projection.state.status.type !== 'playing') return null;
  if (!isTenantEventLog(threeKingdomsBanqiTenant, room.events, roomId)) return null;
  const timeline = threeKingdomsBanqiPostgameTimeline(room.events);
  const isEngine = threeKingdomsBanqiTenant.engine?.isEngineClientId ?? (() => false);
  const hasEngineSeat = Object.values(projection.seats).some((clientId) => isEngine(clientId));
  return {
    game: {
      roomId,
      variant: THREE_KINGDOMS_BANQI_SPEC_ID,
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
    // Masked view (either seat's — they are identical), NOT banqiTruthView.
    view: getThreeKingdomsBanqiClientView(projection.state, {
      id: 'tv',
      solo: false,
      seat: 'spectator',
    }),
    // Masked track only; no `revealed` overlay exists for a live game.
    history: { truth: threeKingdomsBanqiLiveHistory(room.events) },
  };
}

async function threeKingdomsBanqiLiveWatchPayload(
  roomId: string,
): Promise<Record<string, unknown> | null> {
  if (!threeKingdomsBanqiEnabled()) return null;
  const room = threeKingdomsBanqiRooms.get(roomId) ?? null;
  if (!room) return null;
  await room.pendingWrites.catch(() => undefined);
  return threeKingdomsBanqiLiveWatchPayloadFor(roomId, room);
}

registerLiveWatchPayloadBuilder('three-kingdoms-banqi', threeKingdomsBanqiLiveWatchPayload);

function threeKingdomsBanqiLiveHistory(events: readonly ThreeKingdomsBanqiEvent[]) {
  let projection = replayTenantEvents(threeKingdomsBanqiTenant, events.slice(0, 1));
  const spectator = { id: 'tv', solo: false, seat: 'spectator' } as const;
  const history = [{ ply: 0, view: getThreeKingdomsBanqiClientView(projection.state, spectator) }];
  for (const event of events.slice(1)) {
    projection = applyTenantEvent(threeKingdomsBanqiTenant, projection, event);
    if (event.type === 'move-played')
      history.push({
        ply: projection.state.ply,
        view: getThreeKingdomsBanqiClientView(projection.state, spectator),
      });
  }
  return history;
}
