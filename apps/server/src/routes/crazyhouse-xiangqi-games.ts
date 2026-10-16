/**
 * Crazyhouse Xiangqi postgame route: `GET /api/crazyhouse-xiangqi/games/:id`,
 * plus the whole-game analysis routes under it (`…/analysis`, the shared
 * factory).
 *
 * Shape-for-shape the Atomic Xiangqi route. Open information, so the payload
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
  crazyhouseXiangqiMoveToUci,
  getCrazyhouseXiangqiPlayerView,
  oppositeCrazyhouseXiangqiColor,
} from '@mistboard/game';
import {
  CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH,
  CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID,
  withCrazyhouseXiangqiAnalysisSession,
} from './../crazyhouse-xiangqi-fsf-engine.js';
import { crazyhouseXiangqiRooms } from './../crazyhouse-xiangqi-registration.js';
import {
  type CrazyhouseXiangqiEvent,
  crazyhouseXiangqiTenant,
} from './../crazyhouse-xiangqi-tenant.js';
import { crazyhouseXiangqiEnabled } from './../feature-flags.js';
import {
  type AnalysisProgressStore,
  liveAnalysisProgressStore,
  resolveCachedComputation,
} from './../game-analysis-kernel.js';
import {
  isVacuousAnalysis,
  type SweepPlyEval,
  sweepPlyEvals,
  VacuousAnalysisError,
} from './../game-analysis-sweep.js';
import * as persistence from './../persistence.js';
import { buildTenantGameSummary } from './../variant-tenant/events.js';
import { UnreplayableTenantGameError } from './../variant-tenant/replay-guard.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
  tenantPveEngineId,
} from './../variant-tenant/runtime.js';
import type { TenantRuntimeRoom } from './../variant-tenant/tenant.js';
import { registerLiveWatchPayloadBuilder } from './../watch-live.js';
import { createGameAnalysisRoutes, type GameAnalysisRouteDeps } from './game-analysis-route.js';
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

// Computer analysis: full-strength fixed-depth eval of every ply on the stock
// Fairy-Stockfish (the ladder's binary and .ini), cached and coalesced. Mirrors
// the atomic analysis route; the engine's `best` is already the kernel's UCI
// spelling (drops `N@e5`), so there is no rewrite step. Gates/envelopes: the
// shared factory. No engineBinary gate: binary resolution happens lazily inside
// the eval, and a sweep that produced no score is a 503.
export function createCrazyhouseXiangqiAnalysisRoutes(
  deps: {
    persistence?: CrazyhouseXiangqiPostgamePersistence;
    cache?: CrazyhouseXiangqiAnalysisCache;
    analyze?: (movesUci: string[]) => Promise<SweepPlyEval[]>;
    route?: GameAnalysisRouteDeps;
  } = {},
) {
  return createGameAnalysisRoutes(
    {
      routeId: 'crazyhouse-xiangqi',
      logPrefix: 'crazyhouse_xiangqi',
      variantLabel: 'Crazyhouse Xiangqi',
      enabled: crazyhouseXiangqiEnabled,
      requiresPersistence: false,
      loadInputs: (roomId) => crazyhouseXiangqiAnalysisInputs(roomId, deps.persistence),
      countPlies: (payload) =>
        payload.timeline.filter((entry) => entry.type === 'move-played').length,
      resolveAnalysis: (roomId, payload, computeIfMissing) =>
        resolveCrazyhouseXiangqiAnalysis(
          roomId,
          payload,
          deps.cache ?? liveAnalysisCache,
          deps.analyze,
          computeIfMissing,
        ),
    },
    deps.route,
  );
}

const handleAnalysisRoutes = createCrazyhouseXiangqiAnalysisRoutes();

/**
 * The analysis inputs for a finished game, or null (404). A game stored under
 * retired rules no longer replays (variant-tenant/replay-guard.ts); it has no
 * moves to analyse, so it is a missing game here too, never a 500.
 */
export async function crazyhouseXiangqiAnalysisInputs(
  roomId: string,
  deps: CrazyhouseXiangqiPostgamePersistence = defaultPersistence,
) {
  try {
    return await crazyhouseXiangqiPostgameForApi(roomId, deps);
  } catch (err) {
    if (err instanceof UnreplayableTenantGameError) return null;
    throw err;
  }
}

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  if (await handleAnalysisRoutes(request, response, pathname)) return true;

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

export type CrazyhouseXiangqiGameAnalysis = {
  engineId: string;
  depth: number;
  plies: SweepPlyEval[];
};

type CrazyhouseXiangqiAnalysisPayload = {
  timeline: ReadonlyArray<{ type: string; move?: CrazyhouseXiangqiMove }>;
};

// The whole-game sweep: the shared prefix walker bound to ONE persistent FSF
// session (spawn + variant setup once, then incremental position/go per ply).
// With a `progress` store the sweep checkpoints after every evaluated ply and
// resumes from the last checkpoint.
function crazyhouseXiangqiAnalysisSweep(
  movesUci: string[],
  progress?: AnalysisProgressStore<SweepPlyEval>,
): Promise<SweepPlyEval[]> {
  return withCrazyhouseXiangqiAnalysisSession((evaluate) =>
    // The session evaluator carries the fixed analysis depth internally; the
    // sweep's depth argument is the nominal cache dimension, not a search limit.
    sweepPlyEvals(
      movesUci,
      (moves) => evaluate(moves),
      CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH,
      progress,
    ),
  );
}

/**
 * Build the Red-POV eval series for a finished game from its postgame payload.
 * Board moves become `<from><to>` and drops `<L>@<to>`, the kernel's own UCI,
 * which is also the engine's; the hands follow from the move list (see
 * crazyhouseXiangqiAnalysisPositionCommand). `analyze` is injectable for tests.
 */
export async function analyzeCrazyhouseXiangqiPostgame(
  payload: CrazyhouseXiangqiAnalysisPayload,
  analyze: (movesUci: string[]) => Promise<SweepPlyEval[]> = (movesUci) =>
    crazyhouseXiangqiAnalysisSweep(movesUci),
): Promise<CrazyhouseXiangqiGameAnalysis> {
  const movesUci = payload.timeline
    .filter((entry): entry is { type: 'move-played'; move: CrazyhouseXiangqiMove } =>
      Boolean(entry.type === 'move-played' && entry.move),
    )
    .map((entry) => crazyhouseXiangqiMoveToUci(entry.move));
  const plies = await analyze(movesUci);
  return {
    engineId: CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID,
    depth: CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH,
    plies,
  };
}

// Cache read/write, injectable for tests. Live impl reads/writes the
// variant-agnostic game_analysis table (no-ops when persistence is disabled).
export type CrazyhouseXiangqiAnalysisCache = {
  get(roomId: string, engineId: string, depth: number): Promise<SweepPlyEval[] | null>;
  save(roomId: string, engineId: string, depth: number, plies: SweepPlyEval[]): Promise<void>;
};

const liveAnalysisCache: CrazyhouseXiangqiAnalysisCache = {
  get: (roomId, engineId, depth) => persistence.getGameAnalysis(roomId, engineId, depth),
  save: (roomId, engineId, depth, plies) =>
    persistence.saveGameAnalysis(roomId, engineId, depth, plies),
};

/**
 * Cache-first, coalesced whole-game analysis (shared skeleton:
 * game-analysis-kernel). Serve a stored result immediately, else compute once
 * (sharing one in-flight promise), persist it, and return. A scoreless sweep
 * throws VacuousAnalysisError and is never cached; the route maps it to 503.
 */
export async function resolveCrazyhouseXiangqiAnalysis(
  roomId: string,
  payload: CrazyhouseXiangqiAnalysisPayload,
  cache: CrazyhouseXiangqiAnalysisCache = liveAnalysisCache,
  analyze?: (movesUci: string[]) => Promise<SweepPlyEval[]>,
  computeIfMissing = true,
): Promise<CrazyhouseXiangqiGameAnalysis | null> {
  const engineId = CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID;
  const depth = CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH;
  // Incremental checkpoints only on the real (default-analyzer) path; injected
  // analyzers (tests) keep the plain contract.
  const progress = analyze
    ? null
    : liveAnalysisProgressStore<SweepPlyEval>(roomId, engineId, depth);
  const plies = await resolveCachedComputation<SweepPlyEval[]>({
    roomId,
    engineId,
    depth,
    cache,
    computeIfMissing,
    compute: async () =>
      (
        await analyzeCrazyhouseXiangqiPostgame(
          payload,
          analyze ??
            ((movesUci) => crazyhouseXiangqiAnalysisSweep(movesUci, progress ?? undefined)),
        )
      ).plies,
    validate: (series) => {
      if (isVacuousAnalysis(series)) throw new VacuousAnalysisError('crazyhouse-xiangqi');
    },
    afterSave: progress ? () => progress.clear() : undefined,
  });
  return plies ? { engineId, depth, plies } : null;
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

// Mistboard TV live payload, which /games and the correspondence inbox also
// draw: the postgame shape built from an IN-PROGRESS room's events so far, so
// the watch renderer can draw and follow the live board. Crazyhouse Xiangqi is
// OPEN INFORMATION: every field here, both hands included, is already public to
// both players, so seats and spectators get the same one view. Mirrors
// fortressXiangqiLiveWatchPayload; split like jungleFlipLiveWatchPayloadFor so
// the shape is testable without the live room map.
export function crazyhouseXiangqiLiveWatchPayloadFor(
  roomId: string,
  room: Pick<CrazyhouseXiangqiRuntimeRoom, 'id' | 'events' | 'projection'>,
): Record<string, unknown> | null {
  if (room.id !== roomId) return null;
  const projection = room.projection;
  if (projection.state.status.type !== 'playing') return null;
  if (!isTenantEventLog(crazyhouseXiangqiTenant, room.events, roomId)) return null;
  const timeline = crazyhouseXiangqiPostgameTimeline(room.events);
  const isEngine = crazyhouseXiangqiTenant.engine?.isEngineClientId ?? (() => false);
  const hasEngineSeat = Object.values(projection.seats).some((clientId) => isEngine(clientId));
  const view = getCrazyhouseXiangqiPlayerView(projection.state, 'red');
  return {
    game: {
      roomId,
      variant: CRAZYHOUSE_XIANGQI_SPEC_ID,
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
    history: crazyhouseXiangqiPostgameHistory(room.events),
  };
}

async function crazyhouseXiangqiLiveWatchPayload(
  roomId: string,
): Promise<Record<string, unknown> | null> {
  if (!crazyhouseXiangqiTenant.enabled()) return null;
  const room = crazyhouseXiangqiRooms.get(roomId) ?? null;
  if (!room) return null;
  await room.pendingWrites.catch(() => undefined);
  return crazyhouseXiangqiLiveWatchPayloadFor(roomId, room);
}

// The channel id is crazyhouse-xiangqi-registration.ts's watch.channelId.
registerLiveWatchPayloadBuilder('crazyhouse-xiangqi', crazyhouseXiangqiLiveWatchPayload);

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
