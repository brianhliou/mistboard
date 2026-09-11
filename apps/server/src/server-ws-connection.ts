import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { VariantId } from '@mistboard/game';
import type { WebSocket } from 'ws';
import { currentAccountUser } from './account-session.js';
import { gateGameSpecRequest } from './game-spec-request-gate.js';
import { parseHiddenDraft960, parseVariantId } from './http-api.js';
import { logger, wsCounters } from './obs.js';
import { snapshotPayload } from './payloads.js';
import {
  cancelRematch,
  declineRematch,
  finalizeRematchIfReady,
  maybeReplayRematchRedirect,
  offerRematch,
  type RematchOrchestrator,
} from './rematch.js';
import {
  broadcastSnapshot,
  PersistenceFailure,
  playMove,
  type RoomManagerContext,
  resumeRoomIfReady,
  scheduleAbortTimeout,
  scheduleClockTimeout,
  scheduleForfeitTimeout,
  scheduleRandomEngineMove,
  seatDisplayNamesForRoom,
  seatProfilesForRoom,
} from './room-manager.js';
import {
  adminDebugTokenFromProtocolHeader,
  canObserveLiveRoom,
  isAdminDebugToken,
  isAllowedWebSocketOrigin,
  isProductionLikeRuntime,
  recordMessageTimestamp,
  seatTokenFromProtocolHeader,
} from './server-policy.js';
import { assignSeat, displaceOlderSeatClients } from './server-seat-session.js';
import type { Client, Room, SeatAssignment } from './server-types.js';
import { isKnownClientMessageType, parseClientMessage } from './server-ws-messages.js';
import { rememberExcludedDevice } from './stats-excluded-device.js';
import {
  registeredVariantTenants,
  type TenantManagedRoom,
  type VariantTenantRegistration,
} from './variant-tenant/registry.js';

export type WebSocketConnectionContext = {
  roomMgrCtx: RoomManagerContext;
  rematchOrch: RematchOrchestrator;
  defaultRoomRegion: string;
  wsMessageLimit: number;
  wsMessageWindowMs: number;
  clearPendingVacate: (room: Room, seat: Client['seat']) => void;
  enableRandomEngine: (room: Room) => Promise<void>;
  getOrCreateRoom: (roomId: string, variant: VariantId, hiddenDraft960?: boolean) => Promise<Room>;
  handleAbort: (room: Room, client: Client) => Promise<void>;
  handleResign: (room: Room, client: Client) => Promise<void>;
  isAbortedRoom: (roomId: string) => Promise<boolean>;
  resetRoom: (roomId: string, reason?: string) => void;
  scheduleSeatVacate: (room: Room, client: Client) => void;
  selectStart: (
    room: Room,
    client: Client,
    startId: number | undefined,
    color: string | undefined,
  ) => Promise<void>;
  send: (client: Client, payload: unknown) => void;
};

export type WebSocketLiveRuntime =
  | { kind: 'chess' }
  | { kind: 'variant-tenant'; registration: VariantTenantRegistration; room: TenantManagedRoom }
  | { kind: 'variant-tenant-unavailable'; reason: 'game spec disabled' | 'room unavailable' };

export function isAllowedWebSocketRequest(request: IncomingMessage): boolean {
  return isAllowedWebSocketOrigin(request.headers.origin, request.headers.host);
}

// Route a room id to its live runtime. Live rooms route before flag checks so
// an in-flight game keeps serving even if its tenant flag flips off; a
// registry miss is the chess fallback (chess is deliberately unregistered
// until its P2 migration).
export async function resolveWebSocketLiveRuntime(
  registrations: readonly VariantTenantRegistration[],
  roomId: string,
): Promise<WebSocketLiveRuntime> {
  for (const registration of registrations) {
    const live = registration.rooms.get(roomId);
    if (live) return { kind: 'variant-tenant', registration, room: live };
  }
  const registration = registrations.find((entry) => roomId.startsWith(entry.roomIdPrefix)) ?? null;
  if (!registration) return { kind: 'chess' };
  if (!registration.enabled()) {
    return { kind: 'variant-tenant-unavailable', reason: 'game spec disabled' };
  }
  const hydrated = await registration.getOrLoadRoom(roomId);
  if (hydrated) return { kind: 'variant-tenant', registration, room: hydrated };
  return { kind: 'variant-tenant-unavailable', reason: 'room unavailable' };
}

export async function handleWebSocketConnection(
  ctx: WebSocketConnectionContext,
  socket: WebSocket,
  request: IncomingMessage,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const roomId = url.searchParams.get('room') ?? 'dev-room';
  const runtime = await resolveWebSocketLiveRuntime(registeredVariantTenants(), roomId);
  if (runtime.kind === 'variant-tenant') {
    await runtime.registration.attachWebSocket(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      runtime.room,
    );
    return;
  }
  if (runtime.kind === 'variant-tenant-unavailable') {
    socket.close(1008, runtime.reason);
    return;
  }
  const gameSpecGate = gateGameSpecRequest({
    gameSpecId: url.searchParams.get('gameSpecId'),
    variant: url.searchParams.get('variant'),
  });
  if (gameSpecGate.type === 'reject') {
    socket.close(1008, gameSpecGate.wsCloseReason);
    return;
  }
  const dev = devSwitches(url.searchParams, isDebugViewAuthorized(request));
  if (dev.reset) ctx.resetRoom(roomId, 'manual-reset');
  if (await ctx.isAbortedRoom(roomId)) {
    socket.close(1008, 'room aborted');
    return;
  }
  const { solo, randomEngine, debugRequested, devViews } = dev;
  const accountUser = await currentAccountUser(request);
  const room = await ctx.getOrCreateRoom(
    roomId,
    parseVariantId(url.searchParams.get('variant')),
    parseHiddenDraft960(url.searchParams.get('hiddenDraft960') ?? url.searchParams.get('draft960')),
  );
  if (randomEngine) await ctx.enableRandomEngine(room);
  const clientId = parseClientId(url.searchParams.get('client')) ?? randomUUID();
  // The browser's durable id (same alphabet as the per-room client id); a
  // guest seat is attributed to it at game end. Absent from old clients.
  const deviceId = parseClientId(url.searchParams.get('device'));
  rememberExcludedDevice(deviceId, accountUser);
  const seatToken = seatTokenFromProtocolHeader(request.headers['sec-websocket-protocol']);
  const assignment = solo
    ? ({ seat: 'spectator' } satisfies SeatAssignment)
    : await assignSeat(ctx.roomMgrCtx, room, clientId, seatToken, accountUser, deviceId);
  const seat = assignment.seat;
  if (assignment.deniedReason === 'rated-requires-account') {
    // Hard account-gate (assignSeat): a guest tried to take a seat in a rated
    // room. Close with a distinct reason so the client surfaces a sign-in
    // prompt rather than the generic 'private room' / spectator message.
    socket.close(1008, 'rated requires account');
    return;
  }
  if (assignment.deniedReason === 'play-disabled') {
    // The account is an identity, not a player (126). Distinct close reason so
    // the client explains the lock instead of showing the generic spectator or
    // private-room message, which would read as a bug.
    socket.close(1008, 'play disabled');
    return;
  }
  if (seat === 'spectator' && !solo && !canObserveLiveRoom(room.projection, room.gameSpecId)) {
    socket.close(1008, 'private room');
    return;
  }
  const client: Client = {
    debugRequested,
    devViews,
    id: clientId,
    messageTimestamps: [],
    socket,
    roomId,
    seat,
    seatTokenHash: assignment.seatTokenHash,
    userId: accountUser?.id ?? null,
    displaced: false,
    solo,
  };
  room.clients.add(client);
  if (!solo && seat !== 'spectator') {
    displaceOlderSeatClients(room, client);
    ctx.clearPendingVacate(room, seat);
    // A returning seat-holder re-derives the forfeit countdown: if this brings
    // both sides present, the leaver's forfeit is cancelled. Reached only for a
    // resolved color seat (seat !== 'spectator'). In a casual room that seat may
    // be an anonymous guest; in a rated room assignSeat's account-gate has
    // already refused guests, so a rated seat-holder is always a signed-in
    // account.
    scheduleForfeitTimeout(ctx.roomMgrCtx, room);
    // The pregame window depends on seat PRESENCE now (a room nobody is in and
    // nobody has joined is abandoned; one with its creator waiting is not), and
    // the seat-assigned event that re-runs the scheduler is appended before the
    // client lands in room.clients. Re-derive here, where presence is true.
    scheduleAbortTimeout(ctx.roomMgrCtx, room);
  }

  // If the room is paused (post-restart hydration), let resumeRoomIfReady
  // decide whether resume is appropriate. It knows the mode-specific rules
  // (PvP needs both humans, PvE needs the human, EvE auto-resumes on any
  // connection). Safe for spectators too; it short-circuits when seats aren't
  // satisfied.
  if (room.projection.paused && !solo) {
    try {
      const resumed = await resumeRoomIfReady(ctx.roomMgrCtx, room, Date.now());
      if (resumed) {
        scheduleClockTimeout(ctx.roomMgrCtx, room);
        scheduleAbortTimeout(ctx.roomMgrCtx, room);
        scheduleRandomEngineMove(ctx.roomMgrCtx, room);
      }
    } catch (err) {
      if (!(err instanceof PersistenceFailure)) {
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'resume_on_connect_failure',
            roomId: room.id,
            error: (err as Error).message,
            at: Date.now(),
          }),
        );
      }
    }
  }

  const snapshot = snapshotPayload(
    {
      ...room,
      seatDisplayNames: seatDisplayNamesForRoom(room, ctx.roomMgrCtx),
      seatProfiles: seatProfilesForRoom(room, ctx.roomMgrCtx),
    },
    client,
  );
  ctx.send(client, {
    ...snapshot,
    type: 'hello',
    clientId: client.id,
    offer: snapshot.offer,
    ...(assignment.seatToken ? { seatToken: assignment.seatToken } : {}),
  });
  broadcastSnapshot(ctx.roomMgrCtx, room);
  maybeReplayRematchRedirect(ctx.rematchOrch, room, client);

  socket.on('message', (raw) => {
    if (!recordClientMessage(ctx, client)) {
      socket.close(1008, 'rate limit');
      return;
    }
    void handleMessage(ctx, room, client, raw.toString());
  });

  socket.on('close', () => {
    void handleClose(ctx, room, client);
  });
}

async function handleMessage(
  ctx: WebSocketConnectionContext,
  room: Room,
  client: Client,
  raw: string,
): Promise<void> {
  const message = parseClientMessage(raw);
  if (!message) {
    wsCounters.recordParseFailure();
    return;
  }
  if (!isKnownClientMessageType(message.type)) {
    wsCounters.recordUnknownMessage();
    logger.warn(
      {
        kind: 'ws_unknown_message',
        room_id: room.id,
        client_id: client.id,
        message_type: message.type,
      },
      'ws unknown message',
    );
    return;
  }
  try {
    if (message.type === 'ping') {
      ctx.send(client, {
        type: 'pong',
        at: typeof message.at === 'number' ? message.at : Date.now(),
        serverAt: Date.now(),
      });
      return;
    }
    if (message.type === 'latency-sample') {
      if (typeof message.rttMs === 'number' && Number.isFinite(message.rttMs)) {
        const rttMs = Math.max(0, Math.min(60_000, Math.round(message.rttMs)));
        wsCounters.recordLatencySample(room.region ?? ctx.defaultRoomRegion, rttMs);
      }
      return;
    }
    if (message.type === 'admin-debug-auth') {
      handleAdminDebugAuth(
        ctx,
        room,
        client,
        typeof message.token === 'string' ? message.token : undefined,
      );
      return;
    }
    if (message.type === 'snapshot:request') {
      // Delta-mode recovery channel. The client is already authenticated to
      // this room via the WS connect handshake (canObserveLiveRoom + seat
      // token); we inherit that auth here rather than re-deriving it.
      wsCounters.recordSnapshotRequest();
      ctx.send(
        client,
        snapshotPayload(
          {
            ...room,
            seatDisplayNames: seatDisplayNamesForRoom(room, ctx.roomMgrCtx),
            seatProfiles: seatProfilesForRoom(room, ctx.roomMgrCtx),
          },
          client,
        ),
      );
      return;
    }
    if (message.type === 'select-start') {
      await ctx.selectStart(room, client, message.startId, message.color);
    }
    if (
      message.type === 'move' &&
      typeof message.from === 'string' &&
      typeof message.to === 'string'
    ) {
      await playMove(ctx.roomMgrCtx, room, client, {
        type: 'move',
        from: message.from,
        to: message.to,
        promotion: message.promotion,
      });
    }
    if (message.type === 'resign') {
      await ctx.handleResign(room, client);
    }
    if (message.type === 'abort') {
      await ctx.handleAbort(room, client);
    }
    if (message.type === 'rematch:offer') {
      offerRematch(ctx.rematchOrch, room, client);
      await finalizeRematchIfReady(ctx.rematchOrch, room);
    }
    if (message.type === 'rematch:cancel') {
      cancelRematch(ctx.rematchOrch, room, client);
    }
    if (message.type === 'rematch:decline') {
      declineRematch(ctx.rematchOrch, room, client);
    }
  } catch (err) {
    if (err instanceof PersistenceFailure) {
      ctx.send(client, { type: 'error', reason: 'persistence_failure' });
      return;
    }
    throw err;
  }
}

async function handleClose(
  ctx: WebSocketConnectionContext,
  room: Room,
  client: Client,
): Promise<void> {
  room.clients.delete(client);
  if (client.displaced) {
    broadcastSnapshot(ctx.roomMgrCtx, room);
    return;
  }
  const beforeFirstMove =
    room.projection.state.moveNumber === 1 && room.projection.state.lastMove === undefined;
  const clockStarted = room.projection.state.clock !== undefined;
  if (
    (room.projection.state.status.type === 'pregame' || beforeFirstMove) &&
    !clockStarted &&
    client.seat !== 'spectator' &&
    room.projection.seats[client.seat] === client.id
  ) {
    ctx.scheduleSeatVacate(room, client);
  }
  // Post-move-1, a seated player leaving starts (or, if the opponent also just
  // left, clears) the forfeit countdown. Re-derived from current presence —
  // the disconnecting client was already removed from room.clients above. The
  // displaced early-out higher up means a same-account device switch never
  // reaches here, so it can't trigger a phantom forfeit.
  scheduleForfeitTimeout(ctx.roomMgrCtx, room);
  // Same reason as the connect path: pre-move-1, the departure of the last
  // person in an unjoined room is what starts its join window running.
  scheduleAbortTimeout(ctx.roomMgrCtx, room);
  broadcastSnapshot(ctx.roomMgrCtx, room);
}

function parseClientId(value: string | null): string | null {
  if (!value) return null;
  return /^[a-zA-Z0-9:_-]{8,80}$/.test(value) ? value : null;
}

function handleAdminDebugAuth(
  ctx: WebSocketConnectionContext,
  room: Room,
  client: Client,
  token: string | undefined,
): void {
  if (!client.debugRequested) {
    ctx.send(client, { type: 'error', reason: 'debug_not_requested' });
    return;
  }
  if (!isAdminDebugToken(token)) {
    ctx.send(client, { type: 'error', reason: 'debug_unauthorized' });
    return;
  }
  client.devViews = true;
  ctx.send(client, snapshotPayload(room, client));
}

function isDebugViewAuthorized(request: IncomingMessage): boolean {
  if (!isProductionLikeRuntime()) return true;
  return isAdminDebugToken(
    adminDebugTokenFromProtocolHeader(request.headers['sec-websocket-protocol']),
  );
}

export type DevSwitches = {
  /** One client drives both seats and skips the private-room check. */
  solo: boolean;
  /** Evict the room before joining it. */
  reset: boolean;
  /** Attach the random engine to the room. */
  randomEngine: boolean;
  /** Any debug view was asked for (`views=all` or the random engine). */
  debugRequested: boolean;
  /** Debug views were asked for AND the caller is authorized to see them. */
  devViews: boolean;
};

/**
 * The dev switches a WebSocket URL may carry, honoured only for an authorized
 * caller: outside a production-like runtime everyone is, inside one only the
 * admin debug token is. That is the rule `views=all` always had. `dev=solo`,
 * `dev=engine` and `reset=1` were not behind it, so in production anyone
 * holding a live fog room's id could open it as a solo client, read a
 * dark-draft960 game's picks, move for either side, or evict the room
 * (found 2026-09-11). An unauthorized switch is dropped, not refused: the
 * connection proceeds as an ordinary join, which the seat and private-room
 * checks then judge on their own.
 */
export function devSwitches(params: URLSearchParams, authorized: boolean): DevSwitches {
  const devMode = params.get('dev');
  const randomEngine = devMode === 'engine' || params.get('engine') === 'random';
  const debugRequested = randomEngine || params.get('views') === 'all';
  if (!authorized) {
    return { solo: false, reset: false, randomEngine: false, debugRequested, devViews: false };
  }
  return {
    solo: devMode === 'solo',
    reset: params.get('reset') === '1',
    randomEngine,
    debugRequested,
    devViews: debugRequested,
  };
}

function recordClientMessage(ctx: WebSocketConnectionContext, client: Client): boolean {
  return recordMessageTimestamp(
    client.messageTimestamps,
    Date.now(),
    ctx.wsMessageLimit,
    ctx.wsMessageWindowMs,
  );
}
