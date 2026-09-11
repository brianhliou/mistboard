import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { Color, GameEvent } from '@mistboard/game';
import pg from 'pg';
import { WebSocketServer } from 'ws';
// Populates the VariantTenant registry (one registration module per variant).
import './variant-tenant/register-tenants.js';
import { darkXiangqiRooms } from './dark-xiangqi-registration.js';
import { MISTY_DARK_CHESS_ACTIVE_ENGINE_ID } from './first-party-bots.js';
import { prewarmJieqiEngine } from './jieqi-engine.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { runMigrations } from './migrate.js';
import * as persistence from './persistence.js';
import type { RematchOrchestrator } from './rematch.js';
import { recordRoomLifecycleAuditSafe } from './room-lifecycle-audit.js';
import {
  appendEvent,
  broadcastEventAppended,
  buildGameSummary,
  canClientAct,
  offerForColor,
  persistSeatToken,
  type RoomManagerContext,
  resolveStartIfReady,
  selectEngineDraftStart,
} from './room-manager.js';
import { loadServerRuntimeConfig, serverConfig } from './server-config.js';
import { createDrainController } from './server-drain.js';
import { createHttpRequestHandler } from './server-http.js';
import {
  clearRoomRuntimeTimers,
  closeHttpServer,
  closeRoomClients,
  closeWebSocketServer,
  pauseActiveRoomsOnShutdown,
  waitForRoomWrites,
} from './server-lifecycle.js';
import {
  releaseLiveEngineReservation,
  reserveHydratedLiveEngineSeat,
  reserveLiveEngineSeat,
} from './server-live-engine-reservations.js';
import { createRoomLifecycle } from './server-room-lifecycle.js';
import { hashSeatToken } from './server-seat-session.js';
import type { Client, LobbyTicket, Room, SeatTokenState } from './server-types.js';
import {
  handleWebSocketConnection,
  isAllowedWebSocketRequest,
  type WebSocketConnectionContext,
} from './server-ws-connection.js';
import type { DarkXiangqiLiveRoom } from './server-ws-dark-xiangqi.js';
import {
  startTenantDeadlineSweeper,
  type TenantDeadlineSweeper,
} from './variant-tenant/deadline-sweeper.js';
import {
  registeredVariantTenants,
  setVariantTenantFallbackRoomLookup,
} from './variant-tenant/registry.js';
import { type BotVsBotScheduler, startBotVsBotScheduler } from './xiangqi-bot-vs-bot-scheduler.js';
import {
  startXiangqiBroadcastScheduler,
  type XiangqiBroadcastScheduler,
} from './xiangqi-broadcast-scheduler.js';

// Navigation index — grep for section name to jump to the right block
// Account/auth           → ./account-session.ts  (currentAccountUser, hashSecret, session cookies)
// HTTP API handlers      → ./http-api.ts          (handleApiRequest, lobby, game data, auth endpoints)
// Room game flow         → ./room-manager.ts       (playMove, appendEvent, broadcastSnapshot, scheduleClockTimeout, etc.)
// Static page helpers    → ./server-static-pages.ts (page meta, article shells, sitemap)
// Drain/admin HTTP       → ./server-drain.ts       (drain state, deadline, broadcast)
// WS connection handling → ./server-ws-connection.ts (handshake, dispatch, close handling)
// WS message parsing     → ./server-ws-messages.ts (client message parser and allowlist)
// Seat/session handling  → ./server-seat-session.ts (seat assignment, tokens, displacement)
// Server lifecycle       → ./server-lifecycle.ts   (shutdown pause, timer/socket/server cleanup)
// Engine reservations    → ./server-live-engine-reservations.ts (live engine seat holds)
// SECTION: Types and constants          (~line 90)    module-scope maps and config constants
// SECTION: Server init and HTTP entry   (~line 130)   initPersistence, handleHttpRequest, static file serving
// SECTION: Room lifecycle              (~line 230)   room lifecycle factory and timer grace config
// SECTION: Game flow                    (~line 700)   enableRandomEngine, selectStart
// SECTION: Room event infrastructure    (~line 760)   inMemoryGameSummary, recordPersistenceError
// SECTION: Helpers and shutdown         (~line 810)   send, isColor, shutdown

// ── SECTION: Types and constants ───────────────────────────────────────────
// Core server types live in ./server-types.ts — Client, Room, SeatTokenState, SeatAssignment, LobbyTicket

const rooms = new Map<string, Room>();
// Variant-tenant live maps are owned by their *-registration.ts modules; the
// registry's cross-variant room-id collision check needs visibility into the
// chess map, which still lives here.
setVariantTenantFallbackRoomLookup((roomId) => rooms.has(roomId));
const lobbyTickets = new Map<string, LobbyTicket>();
const lobbyQueue: LobbyTicket[] = [];
const databaseRequired = serverConfig.databaseRequired;
const wsMaxPayloadBytes = serverConfig.wsMaxPayloadBytes;
const wsMessageLimit = serverConfig.wsMessageLimit;
const wsMessageWindowMs = serverConfig.wsMessageWindowMs;
const shutdownGraceMs = serverConfig.shutdownGraceMs;
const pauseGraceMs = serverConfig.pauseGraceMs;
const orphanThresholdMs = serverConfig.orphanThresholdMs;
const liveClockInitialMs = 180_000;
const liveClockIncrementMs = 2_000;
const pveEngineMoveDelayMs = serverConfig.pveEngineMoveDelayMs;
const liveEngineTimeoutMs = serverConfig.liveEngineTimeoutMs;
const defaultRoomRegion = serverConfig.defaultRoomRegion;
const guestPrestartAbortMs = serverConfig.guestPrestartAbortMs;
const abortPolicySweepMs = serverConfig.abortPolicySweepMs;
const stalePauseMs = serverConfig.stalePauseMs;
const stalePausedSweepMs = serverConfig.stalePausedSweepMs;
// Default PvE engine. Streamlined to Misty (the only player-facing engine) —
// no random fallback. Name kept for compat; it is no longer a builtin. If Misty
// can't serve, room creation / reservation fails loudly (503) rather than
// silently substituting random.
const pveBuiltinEngineClientId = MISTY_DARK_CHESS_ACTIVE_ENGINE_ID;
const persistenceErrors: Array<{ at: number; roomId: string; eventType: string }> = [];
const PERSISTENCE_ERROR_RETENTION_MS = 3_600_000;

const staticDir = serverConfig.staticDir;
// Local-only research/debug annotations. Keep this independent from the private
// engine repo so web boots cleanly without an engine checkout.
const annotationsFile = serverConfig.annotationsFile;
const drainController = createDrainController({
  drainWindowDefaultMs: serverConfig.drainWindowDefaultMs,
  drainWindowMaxMs: serverConfig.drainWindowMaxMs,
  rooms,
});

const roomMgrCtx: RoomManagerContext = {
  send,
  recordPersistenceError,
  pveBuiltinEngineClientId,
  pveEngineMoveDelayMs,
  liveEngineTimeoutMs,
  liveClockInitialMs,
  liveClockIncrementMs,
  releaseLiveEngineReservation,
};

const roomLifecycle = createRoomLifecycle({
  rooms,
  roomMgrCtx,
  defaultRoomRegion,
  orphanThresholdMs,
  guestPrestartAbortMs,
  abortPolicySweepMs,
  stalePauseMs,
  stalePausedSweepMs,
  pauseGraceMs,
  recordPersistenceError,
  releaseLiveEngineReservation,
  reserveHydratedLiveEngineSeat,
  seatVacateGraceMs,
});

const rematchOrch: RematchOrchestrator = {
  ctx: roomMgrCtx,
  send,
  buildRoomUrl: (roomId) => `/?room=${encodeURIComponent(roomId)}`,
  createRoom: (spec) =>
    roomLifecycle.createRoom(
      spec.mode,
      spec.variant,
      spec.pveEngineId ?? pveBuiltinEngineClientId,
      spec.hiddenDraft960,
      spec.timeControl,
      spec.rated,
      { region: spec.region },
    ),
  issueSeatToken: async (room, seat, identity) => {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = hashSeatToken(rawToken);
    const now = new Date();
    const state: SeatTokenState = {
      clientId: randomUUID(),
      // Rematch pre-issue: the holder's device is learned on reconnect.
      deviceId: null,
      seat,
      tokenHash,
      userId: identity.userId,
      userHandle: identity.userHandle,
      userDisplayName: identity.userDisplayName,
      issuedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    };
    await persistSeatToken(roomMgrCtx, room, state);
    room.seatTokens[seat] = state;
    return { rawToken, state };
  },
};

const wsConnectionCtx: WebSocketConnectionContext = {
  roomMgrCtx,
  rematchOrch,
  defaultRoomRegion,
  wsMessageLimit,
  wsMessageWindowMs,
  clearPendingVacate: roomLifecycle.clearPendingVacate,
  enableRandomEngine,
  getOrCreateRoom: roomLifecycle.getOrCreateRoom,
  handleAbort,
  handleResign,
  isAbortedRoom: roomLifecycle.isAbortedRoom,
  resetRoom: roomLifecycle.resetRoom,
  scheduleSeatVacate: roomLifecycle.scheduleSeatVacate,
  selectStart,
  send,
};

// ── SECTION: startServer (module side-effect-free until called) ────────────
//
// All side effects (DB init, listener, intervals, signal handlers) live inside
// startServer() so that `apps/server/integration/harness.ts` can import this
// module without booting a real server, then call startServer({port:0}) to spin
// up a controlled instance per test process.
let server: ReturnType<typeof createServer> | null = null;
let wss: WebSocketServer | null = null;
let deadlineSweeper: TenantDeadlineSweeper | null = null;
let broadcastScheduler: XiangqiBroadcastScheduler | null = null;
let botVsBotScheduler: BotVsBotScheduler | null = null;
let shuttingDown = false;
let seatVacateGraceMsOverride: number | null = null;

export type StartServerOptions = {
  port?: number;
  seatVacateGraceMs?: number;
};

export type StartedServer = {
  port: number;
  rooms: Map<string, Room>;
  darkXiangqiRooms: Map<string, DarkXiangqiLiveRoom>;
  wsClientCount: () => number;
  close: () => Promise<void>;
};

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  if (server) throw new Error('startServer: already running');
  shuttingDown = false;
  if (typeof options.seatVacateGraceMs === 'number') {
    seatVacateGraceMsOverride = options.seatVacateGraceMs;
  } else {
    seatVacateGraceMsOverride = null;
  }
  await initPersistence();
  roomLifecycle.startAbortPolicySweep();
  roomLifecycle.startStalePausedSweep();
  deadlineSweeper = startTenantDeadlineSweeper();
  if (persistence.isInitialized()) {
    broadcastScheduler = startXiangqiBroadcastScheduler();
    // Always started; the tick no-ops unless MISTBOARD_BOT_VS_BOT_ENABLED=true,
    // so ops can flip generation on/off without a restart.
    botVsBotScheduler = startBotVsBotScheduler();
  }

  const httpServer = createServer(
    createHttpRequestHandler({
      rooms,
      lobbyTickets,
      lobbyQueue,
      databaseRequired,
      persistenceErrors,
      pveBuiltinEngineClientId,
      annotationsFile,
      liveClockInitialMs,
      liveClockIncrementMs,
      staticDir,
      publicHost: serverConfig.publicHost,
      drainController,
      createRoom: roomLifecycle.createRoom,
      reserveLiveEngineSeat,
      releaseLiveEngineReservation,
      abandonRoom: roomLifecycle.abandonRoom,
      inMemoryGameSummary,
    }),
  );
  const wsServer = new WebSocketServer({ server: httpServer, maxPayload: wsMaxPayloadBytes });
  server = httpServer;
  wss = wsServer;

  wsServer.on('connection', (socket, request) => {
    if (!isAllowedWebSocketRequest(request)) {
      socket.close(1008, 'origin not allowed');
      return;
    }
    void handleWebSocketConnection(wsConnectionCtx, socket, request).catch((err) => {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'connection_handler_failure',
          error: (err as Error).message,
          at: Date.now(),
        }),
      );
      try {
        socket.close(1011, 'internal error');
      } catch {
        /* socket already closed */
      }
    });
  });

  const port = options.port ?? serverConfig.port;
  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });
  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  if (!options.port && port !== 0) {
    console.log(`mistboard server listening on http://localhost:${boundPort}`);
    // Park a jieqi engine process now, so the first PvE move after a deploy does
    // not pay the spawn and hash allocation on a player's clock (#335). Real boots
    // only: the test harness passes an explicit port and must not spawn engines.
    if (jieqiTenant.enabled()) void prewarmJieqiEngine();
  }

  return {
    port: boundPort,
    rooms,
    darkXiangqiRooms,
    wsClientCount: () => wsServer.clients.size,
    close: async () => {
      await stopServer();
    },
  };
}

export function installShutdownHandlers(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

// Tear down for tests / hot restart. Mirrors shutdown() but does NOT call
// process.exit, so the runner stays alive across tests.
export async function stopServer(): Promise<void> {
  if (!server || !wss) return;
  await pauseActiveRoomsOnShutdown(rooms.values(), roomMgrCtx);
  for (const room of rooms.values()) {
    clearRoomRuntimeTimers(room, { clearPendingVacates: true });
  }
  for (const registration of registeredVariantTenants()) {
    for (const room of registration.rooms.values()) {
      registration.clearRuntimeTimers(room);
    }
  }
  roomLifecycle.stopSweeps();
  deadlineSweeper?.stop();
  deadlineSweeper = null;
  broadcastScheduler?.stop();
  broadcastScheduler = null;
  botVsBotScheduler?.stop();
  botVsBotScheduler = null;
  closeRoomClients(rooms.values());
  for (const registration of registeredVariantTenants()) {
    closeRoomClients(registration.rooms.values());
  }
  await waitForRoomWrites(rooms.values());
  for (const registration of registeredVariantTenants()) {
    await waitForRoomWrites(registration.rooms.values());
  }
  await closeWebSocketServer(wss);
  await closeHttpServer(server);
  await persistence.close();
  rooms.clear();
  for (const registration of registeredVariantTenants()) {
    registration.clearRooms();
  }
  lobbyTickets.clear();
  lobbyQueue.length = 0;
  persistenceErrors.length = 0;
  server = null;
  wss = null;
  seatVacateGraceMsOverride = null;
}

// ── SECTION: Server init and HTTP entry ────────────────────────────────────
async function initPersistence(): Promise<void> {
  const persistenceConfig = loadServerRuntimeConfig();
  const databaseUrl = persistenceConfig.databaseUrl;
  if (!databaseUrl) {
    if (persistenceConfig.databaseRequired) {
      throw new Error(
        'DATABASE_URL is required in this runtime; set MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE=true only for intentional ephemeral environments',
      );
    }
    console.log('persistence: disabled (set DATABASE_URL to enable)');
    return;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const applied = await runMigrations(client);
    if (applied.length > 0) console.log(`migrations applied: ${applied.join(', ')}`);
  } finally {
    await client.end();
  }
  persistence.init(databaseUrl);
  console.log('persistence: enabled');
}

// ── SECTION: Room lifecycle ────────────────────────────────────────────────
const SEAT_VACATE_GRACE_MS_DEFAULT = serverConfig.seatVacateGraceMs;

function seatVacateGraceMs(): number {
  return seatVacateGraceMsOverride ?? SEAT_VACATE_GRACE_MS_DEFAULT;
}

// ── SECTION: Game flow ─────────────────────────────────────────────────────
async function enableRandomEngine(room: Room): Promise<void> {
  room.randomEngine = true;
  room.pveEngineId = pveBuiltinEngineClientId;
  if (room.projection.variant !== 'dark-chess') return;
  if (!room.projection.seats.black) {
    await appendEvent(roomMgrCtx, room, {
      type: 'seat-assigned',
      at: Date.now(),
      roomId: room.id,
      clientId: pveBuiltinEngineClientId,
      seat: 'black',
    });
  }
  await selectEngineDraftStart(roomMgrCtx, room);
}

async function selectStart(
  room: Room,
  client: Client,
  startId: number | undefined,
  color: string | undefined,
): Promise<void> {
  if (!canClientAct(room, client)) return;
  const selectionColor = client.solo && isColor(color) ? color : client.seat;
  if (selectionColor === 'spectator') return;
  if (room.projection.state.status.type !== 'pregame') return;
  if (!offerForColor(room.projection, selectionColor).some((start) => start.id === startId)) return;
  if (startId === undefined) return;

  const fromSeq = room.events.length;
  await appendEvent(roomMgrCtx, room, {
    type: 'draft-start-selected',
    at: Date.now(),
    roomId: room.id,
    color: selectionColor,
    startId,
  });
  await resolveStartIfReady(roomMgrCtx, room);
  broadcastEventAppended(roomMgrCtx, room, fromSeq);
}

async function handleResign(room: Room, client: Client): Promise<void> {
  if (!canClientAct(room, client)) return;
  if (client.seat !== 'white' && client.seat !== 'black') return;
  if (room.projection.state.status.type !== 'playing') return;
  // Before both players have completed their first move the game isn't a real
  // contest yet — bailing is an abort (no result), not a resignation (which
  // would wrongly award the opponent a win). Resign is only valid from move 2.
  if (room.projection.state.moveNumber < 2) return;
  const fromSeq = room.events.length;
  await appendEvent(roomMgrCtx, room, {
    type: 'seat-resigned',
    at: Date.now(),
    roomId: room.id,
    color: client.seat,
  });
  broadcastEventAppended(roomMgrCtx, room, fromSeq);
}

async function handleAbort(room: Room, client: Client): Promise<void> {
  if (!canClientAct(room, client)) return;
  if (client.seat !== 'white' && client.seat !== 'black') return;
  if (room.projection.state.status.type !== 'playing') return;
  // Abort is available only before both players have completed their first move,
  // and only to the side whose move is pending (the same side that sees the
  // Abort button in place of Resign). The reducer enforces the moveNumber guard
  // too; this is the server-authority check on the inbound message.
  if (room.projection.state.moveNumber >= 2) return;
  if (room.projection.state.status.turn !== client.seat) return;
  const fromSeq = room.events.length;
  await appendEvent(roomMgrCtx, room, {
    type: 'game-aborted',
    at: Date.now(),
    roomId: room.id,
    reason: 'user-abort',
  });
  broadcastEventAppended(roomMgrCtx, room, fromSeq);
}

// ── SECTION: Room event infrastructure ─────────────────────────────────────
function inMemoryGameSummary(roomId: string): persistence.RecentEveGameRecord | null {
  const room = rooms.get(roomId);
  if (room?.projection.state.status.type !== 'finished') return null;

  const summary = buildGameSummary(roomMgrCtx, room);
  return {
    roomId: room.id,
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

function recordPersistenceError(roomId: string, seq: number, event: GameEvent, err: Error): void {
  const entry = { at: Date.now(), roomId, eventType: event.type };
  persistenceErrors.push(entry);
  const cutoff = Date.now() - PERSISTENCE_ERROR_RETENTION_MS;
  while (persistenceErrors.length > 0 && persistenceErrors[0]!.at < cutoff) {
    persistenceErrors.shift();
  }
  console.error(
    JSON.stringify({
      level: 'error',
      kind: 'persistence_failure',
      roomId,
      seq,
      eventType: event.type,
      error: err.message,
      at: entry.at,
    }),
  );
}

// ── SECTION: Helpers and shutdown ──────────────────────────────────────────
function send(client: Client, payload: unknown): void {
  client.socket.send(JSON.stringify(payload));
}

function isColor(value: string | undefined): value is Color {
  return value === 'white' || value === 'black';
}

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const shutdownAt = Date.now();
  console.log(
    JSON.stringify({ level: 'info', kind: 'server_shutdown_requested', signal, at: shutdownAt }),
  );
  const forceExit = setTimeout(() => {
    console.error(
      JSON.stringify({ level: 'error', kind: 'server_shutdown_timeout', signal, at: Date.now() }),
    );
    process.exit(1);
  }, shutdownGraceMs);
  forceExit.unref();

  await recordRoomLifecycleAuditSafe({
    kind: 'server_shutdown_requested',
    atMs: shutdownAt,
    payload: {
      signal,
      activeGames: drainController.activeGameCount(),
      rooms: rooms.size,
    },
  });

  await pauseActiveRoomsOnShutdown(rooms.values(), roomMgrCtx);

  for (const room of rooms.values()) {
    clearRoomRuntimeTimers(room);
  }
  for (const registration of registeredVariantTenants()) {
    for (const room of registration.rooms.values()) {
      registration.clearRuntimeTimers(room);
    }
  }
  roomLifecycle.stopSweeps();
  deadlineSweeper?.stop();
  deadlineSweeper = null;
  broadcastScheduler?.stop();
  broadcastScheduler = null;
  botVsBotScheduler?.stop();
  botVsBotScheduler = null;
  closeRoomClients(rooms.values());
  for (const registration of registeredVariantTenants()) {
    closeRoomClients(registration.rooms.values());
  }

  let exitCode = 0;
  try {
    await waitForRoomWrites(rooms.values());
    for (const registration of registeredVariantTenants()) {
      await waitForRoomWrites(registration.rooms.values());
    }
    await closeWebSocketServer(wss);
    await closeHttpServer(server);
    await persistence.close();
  } catch (err) {
    exitCode = 1;
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'server_shutdown_failure',
        error: (err as Error).message,
        at: Date.now(),
      }),
    );
  } finally {
    clearTimeout(forceExit);
  }
  process.exit(exitCode);
}
