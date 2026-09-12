import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getStandardXiangqiPlayerView,
  pikafishUciToXiangqiSquares,
  type StandardXiangqiPlayerView,
  XIANGQI_SPEC_ID,
  type XiangqiColor,
  type XiangqiMove,
  xiangqiMoveToPikafishUci,
} from '@mistboard/game';
import { xiangqiEnabled } from './../feature-flags.js';
import { liveAnalysisProgressStore, resolveCachedComputation } from './../game-analysis-kernel.js';
import { isVacuousAnalysis, VacuousAnalysisError } from './../game-analysis-sweep.js';
import * as persistence from './../persistence.js';
import { LIVE_ENGINE_DECISION_ARTIFACT_TYPE } from './../persistence-game-lifecycle.js';
import { buildTenantGameSummary } from './../variant-tenant/events.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
} from './../variant-tenant/runtime.js';
import { registerLiveWatchPayloadBuilder } from './../watch-live.js';
import {
  analyzeXiangqiGame,
  type PlyEval,
  XIANGQI_ANALYSIS_ENGINE_ID,
  XIANGQI_ANALYSIS_REQUEST_DEPTH,
} from './../xiangqi-analysis.js';
import { xiangqiRooms } from './../xiangqi-registration.js';
import type { XiangqiEvent, XiangqiRuntimeRoom } from './../xiangqi-runtime.js';
import { xiangqiTenant } from './../xiangqi-tenant.js';
import { createGameAnalysisRoutes } from './game-analysis-route.js';
import {
  type HttpApiContext,
  isHttpAdminSession,
  postgameGameSummary,
  requireMethod,
  writeJson,
} from './lib.js';

type XiangqiPostgameSnapshot = {
  ply: number;
  view: StandardXiangqiPlayerView;
};

type XiangqiPostgameMove = {
  type: 'move-played';
  at: number;
  color: XiangqiColor;
  move: XiangqiMove;
  ply: number;
};

type XiangqiPostgameTerminal =
  | { type: 'clock-expired'; at: number; color: XiangqiColor; winner: XiangqiColor }
  | { type: 'seat-resigned'; at: number; color: XiangqiColor; winner: XiangqiColor }
  | { type: 'seat-forfeited'; at: number; color: XiangqiColor; winner: XiangqiColor }
  | { type: 'game-aborted'; at: number; reason: string };

export type XiangqiPostgamePersistence = {
  getLiveRoom?(roomId: string): XiangqiRuntimeRoom | null;
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  isPersistenceEnabled?(): boolean;
  loadRoomEvents(roomId: string): Promise<XiangqiEvent[] | null>;
};

const livePersistence: XiangqiPostgamePersistence = {
  getLiveRoom: (roomId) => xiangqiRooms.get(roomId) ?? null,
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  isPersistenceEnabled: () => persistence.isInitialized(),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<XiangqiEvent>(roomId),
};

// Computer analysis: eval every ply with Pikafish (P3). Reuses the postgame loader
// (finished-games-only) to get the moves, then runs the whole-game job. The account
// gate on POST is the expensive-path gate (a whole-game Pikafish sweep); GET stays
// open so the cached result auto-loads for anyone opening the page. Gates/envelopes:
// the shared factory. No engineBinary gate — Pikafish resolution happens lazily
// inside the eval itself (pikafishXiangqiPath throws into the request).
const handleAnalysisRoutes = createGameAnalysisRoutes({
  routeId: 'xiangqi',
  logPrefix: 'xiangqi',
  variantLabel: 'Xiangqi',
  enabled: xiangqiEnabled,
  requiresPersistence: false,
  loadInputs: (roomId) => xiangqiPostgameForApi(roomId, livePersistence),
  countPlies: (payload) => payload.timeline.filter((entry) => entry.type === 'move-played').length,
  resolveAnalysis: (roomId, payload, computeIfMissing) =>
    resolveXiangqiAnalysis(roomId, payload, liveAnalysisCache, undefined, computeIfMissing),
});

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  if (await handleAnalysisRoutes(request, response, pathname)) return true;

  // Per-move engine telemetry written by server-xiangqi-engine.ts. Admin-only,
  // like the chess-side /api/games/:id/artifacts; that route cannot serve xiangqi
  // games because its seat filter is chess-coloured, so the tenant has its own.
  const artifactsMatch = pathname.match(/^\/api\/xiangqi\/games\/([^/]+)\/artifacts$/);
  if (artifactsMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!xiangqiEnabled()) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    const artifactType = parsedUrl.searchParams.get('type');
    if (artifactType !== LIVE_ENGINE_DECISION_ARTIFACT_TYPE) {
      writeJson(response, 400, { error: 'invalid_artifact_type' });
      return true;
    }
    if (!(await isHttpAdminSession(request))) {
      writeJson(response, 403, { error: 'forbidden' });
      return true;
    }
    if (!persistence.isInitialized()) {
      writeJson(response, 200, { artifacts: [] });
      return true;
    }
    const roomId = decodeURIComponent(artifactsMatch[1]!);
    const artifacts = await persistence.listGameDebugArtifactPayloads(roomId, { artifactType });
    writeJson(response, 200, {
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        gameId: artifact.gameId,
        ply: artifact.ply,
        artifactType: artifact.artifactType,
        payload: artifact.payload,
        createdAt: artifact.createdAt.toISOString(),
      })),
    });
    return true;
  }

  const postgameMatch = pathname.match(/^\/api\/xiangqi\/games\/([^/]+)$/);
  if (!postgameMatch) return false;

  if (!requireMethod(request, response, 'GET')) return true;
  if (!xiangqiEnabled()) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }

  const roomId = decodeURIComponent(postgameMatch[1]!);
  const payload = await xiangqiPostgameForApi(roomId, livePersistence);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

export type XiangqiGameAnalysis = {
  engineId: string;
  depth: number;
  plies: PlyEval[];
};

/**
 * Build the eval series for a finished game from its postgame payload. `analyze`
 * is injectable for tests; it defaults to the real Pikafish whole-game job (one
 * persistent engine process per sweep at the analysis node budget, #168).
 */
export async function analyzeXiangqiPostgame(
  payload: { timeline: ReadonlyArray<{ type: string; move?: XiangqiMove }> },
  // `moves` is the same game in native notation, handed alongside the UCI prefix
  // list because the offered-piece pass needs a board (#315). Injected test
  // analyzers may ignore it.
  analyze: (movesUci: string[], moves: readonly XiangqiMove[]) => Promise<PlyEval[]> = (
    movesUci,
    moves,
  ) => analyzeXiangqiGame(movesUci, { moves }),
): Promise<XiangqiGameAnalysis> {
  const moves = payload.timeline
    .filter((entry): entry is { type: 'move-played'; move: XiangqiMove } =>
      Boolean(entry.type === 'move-played' && entry.move),
    )
    .map((entry) => entry.move);
  const movesUci = moves.map((move) => xiangqiMoveToPikafishUci(move));
  const plies = await analyze(movesUci, moves);
  return {
    engineId: XIANGQI_ANALYSIS_ENGINE_ID,
    depth: XIANGQI_ANALYSIS_REQUEST_DEPTH,
    // `best`/`pv` come back as Pikafish UCI (0-indexed); hand the client our own
    // square notation so it never has to know the engine's rank convention. An
    // unconvertible pv token TRUNCATES the line there (never splice around it —
    // the moves after it would land on the wrong position).
    plies: plies.map((p) => {
      const pv = pikafishLineToOurUci(p.pv);
      // The runner-up move and the accepted-offer line travel the same way as
      // `best`/`pv`: converted here, never served in the engine's dialect. An
      // unconvertible root move drops the whole field rather than serving half.
      const secondMove = pikafishBestToOurUci(p.second?.move ?? null);
      const second = p.second && secondMove ? { ...p.second, move: secondMove } : undefined;
      const capture = pikafishBestToOurUci(p.offerLine?.capture ?? null);
      const offerLine =
        p.offerLine && capture
          ? { capture, pv: pikafishLineToOurUci(p.offerLine.pv) ?? [] }
          : undefined;
      return { ...p, best: pikafishBestToOurUci(p.best), pv, second, offerLine };
    }),
  };
}

function pikafishBestToOurUci(best: string | null): string | null {
  if (!best) return null;
  const squares = pikafishUciToXiangqiSquares(best);
  return squares ? `${squares.from}${squares.to}` : null;
}

/** Convert a whole line, TRUNCATING at the first unconvertible token (never splice
 *  around it — every move after would land on the wrong position). */
function pikafishLineToOurUci(line: readonly string[] | undefined): string[] | undefined {
  const out: string[] = [];
  for (const move of line ?? []) {
    const converted = pikafishBestToOurUci(move);
    if (!converted) break;
    out.push(converted);
  }
  return out.length ? out : undefined;
}

type XiangqiAnalysisPayload = { timeline: ReadonlyArray<{ type: string; move?: XiangqiMove }> };

// Cache read/write, injectable for tests. Live impl reads/writes the
// game_analysis table (no-ops when persistence is disabled).
export type XiangqiAnalysisCache = {
  get(roomId: string, engineId: string, depth: number): Promise<PlyEval[] | null>;
  save(roomId: string, engineId: string, depth: number, plies: PlyEval[]): Promise<void>;
};

const liveAnalysisCache: XiangqiAnalysisCache = {
  get: (roomId, engineId, depth) => persistence.getGameAnalysis(roomId, engineId, depth),
  save: (roomId, engineId, depth, plies) =>
    persistence.saveGameAnalysis(roomId, engineId, depth, plies),
};

/**
 * Cache-first, coalesced whole-game analysis (shared skeleton: game-analysis-kernel).
 * A finished game's eval series is immutable given (room, engine, depth): serve a
 * stored result immediately, else compute once (sharing one in-flight promise across
 * concurrent callers), persist it, and return. This keeps the engine pass off the hot
 * path for every request after the first and prevents duplicate passes. A scoreless
 * (all-null) sweep throws VacuousAnalysisError and is never cached; the route maps it
 * to 503 analysis_engine_unavailable. `cache`/`analyze` are injectable for tests.
 */
export async function resolveXiangqiAnalysis(
  roomId: string,
  payload: XiangqiAnalysisPayload,
  cache: XiangqiAnalysisCache = liveAnalysisCache,
  analyze?: (movesUci: string[]) => Promise<PlyEval[]>,
  computeIfMissing = true,
): Promise<XiangqiGameAnalysis | null> {
  const engineId = XIANGQI_ANALYSIS_ENGINE_ID;
  const depth = XIANGQI_ANALYSIS_REQUEST_DEPTH;
  // Incremental checkpoints only on the real (default-analyzer) path; injected
  // analyzers (tests) keep the plain contract.
  const progress = analyze ? null : liveAnalysisProgressStore<PlyEval>(roomId, engineId, depth);
  const plies = await resolveCachedComputation<PlyEval[]>({
    roomId,
    engineId,
    depth,
    cache,
    computeIfMissing,
    compute: async () =>
      (
        await analyzeXiangqiPostgame(
          payload,
          analyze ??
            ((movesUci, moves) =>
              analyzeXiangqiGame(movesUci, { moves, progress: progress ?? undefined })),
        )
      ).plies,
    validate: (series) => {
      if (isVacuousAnalysis(series)) throw new VacuousAnalysisError('xiangqi');
    },
    afterSave: progress ? () => progress.clear() : undefined,
  });
  return plies ? { engineId, depth, plies } : null;
}

export async function xiangqiPostgameForApi(
  roomId: string,
  deps: XiangqiPostgamePersistence = livePersistence,
) {
  const persistenceEnabled = deps.isPersistenceEnabled?.() ?? true;
  const [game, events] = await Promise.all([
    persistenceEnabled ? deps.getGameSummary(roomId) : null,
    persistenceEnabled ? deps.loadRoomEvents(roomId) : null,
  ]);
  if (game && game.variant !== XIANGQI_SPEC_ID) return null;
  if (events && !isTenantEventLog(xiangqiTenant, events, roomId)) return null;

  let source: {
    game: persistence.RecentEveGameRecord;
    events: readonly XiangqiEvent[];
  } | null = game && events ? { game, events } : null;
  if (!source) {
    const room = deps.getLiveRoom?.(roomId) ?? null;
    await room?.pendingWrites.catch(() => undefined);
    source = xiangqiPostgameFromLiveRoom(roomId, room);
  }
  if (!source) return null;

  const projection = replayTenantEvents(xiangqiTenant, source.events);
  if (projection.state.status.type !== 'finished') return null;

  return {
    game: postgameGameSummary(source.game),
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.clock ? { clock: projection.clock } : {}),
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline: xiangqiPostgameTimeline(source.events),
    // Open information: every viewer sees the same truth board.
    view: getStandardXiangqiPlayerView(projection.state, 'red'),
    views: {
      truth: getStandardXiangqiPlayerView(projection.state, 'red'),
    },
    history: xiangqiPostgameHistory(source.events),
  };
}

// Mistboard TV live payload: the postgame shape (timeline / truth views /
// per-ply history) built from an IN-PROGRESS room's events so far, so the watch
// renderer can draw and follow the live board. Standard Xiangqi is OPEN
// INFORMATION — every field here is public to both players already. `game`
// carries an 'in-progress' result/termination the compact showcase never reads
// before the game ends (the live flag suppresses end-of-game marks).
async function xiangqiLiveWatchPayload(roomId: string): Promise<Record<string, unknown> | null> {
  if (!xiangqiTenant.enabled()) return null;
  const room = xiangqiRooms.get(roomId) ?? null;
  if (!room || room.id !== roomId) return null;
  await room.pendingWrites.catch(() => undefined);
  const projection = room.projection;
  if (projection.state.status.type !== 'playing') return null;
  if (!isTenantEventLog(xiangqiTenant, room.events, roomId)) return null;
  const timeline = xiangqiPostgameTimeline(room.events);
  const isEngine = xiangqiTenant.engine?.isEngineClientId ?? (() => false);
  const hasEngineSeat = Object.values(projection.seats).some((clientId) => isEngine(clientId));
  const view = getStandardXiangqiPlayerView(projection.state, 'red');
  return {
    game: {
      roomId,
      variant: XIANGQI_SPEC_ID,
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
    history: xiangqiPostgameHistory(room.events),
  };
}

registerLiveWatchPayloadBuilder('xiangqi', xiangqiLiveWatchPayload);

function xiangqiPostgameFromLiveRoom(
  roomId: string,
  room: XiangqiRuntimeRoom | null,
): { game: persistence.RecentEveGameRecord; events: readonly XiangqiEvent[] } | null {
  if (!room || room.id !== roomId) return null;
  if (room.projection.state.status.type !== 'finished') return null;
  if (!isTenantEventLog(xiangqiTenant, room.events, roomId)) return null;
  const summary = buildTenantGameSummary(xiangqiTenant, room);
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

function xiangqiPostgameHistory(events: readonly XiangqiEvent[]): {
  truth: XiangqiPostgameSnapshot[];
} {
  const created = events[0];
  if (created?.type !== 'room-created') return { truth: [] };
  let projection = replayTenantEvents(xiangqiTenant, [created]);
  let ply = 0;
  const truth: XiangqiPostgameSnapshot[] = [
    { ply, view: getStandardXiangqiPlayerView(projection.state, 'red') },
  ];

  for (const event of events.slice(1)) {
    projection = applyTenantEvent(xiangqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    truth.push({ ply, view: getStandardXiangqiPlayerView(projection.state, 'red') });
  }
  return { truth };
}

function xiangqiPostgameTimeline(
  events: readonly XiangqiEvent[],
): Array<XiangqiPostgameMove | XiangqiPostgameTerminal> {
  const timeline: Array<XiangqiPostgameMove | XiangqiPostgameTerminal> = [];
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
        winner: oppositeXiangqiColor(event.color),
      });
      continue;
    }
    if (event.type === 'seat-resigned' || event.type === 'seat-forfeited') {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: oppositeXiangqiColor(event.color),
      });
      continue;
    }
    if (event.type === 'game-aborted') {
      timeline.push({ type: event.type, at: event.at, reason: event.reason });
    }
  }
  return timeline;
}

function oppositeXiangqiColor(color: XiangqiColor): XiangqiColor {
  return color === 'red' ? 'black' : 'red';
}
