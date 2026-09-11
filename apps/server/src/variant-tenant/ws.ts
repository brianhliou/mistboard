/**
 * Generic WebSocket live-room runtime over a VariantTenant.
 *
 * createTenantWsRuntime(tenant) binds the event writer, lifecycle timers,
 * broadcast fan-out, and connection/message handling into one per-tenant
 * bundle (the callback-injection init pattern: the writer re-arms lifecycle
 * timers after every append, and the timers append through the writer).
 * Adapters instantiate the bundle once at module scope and re-export the
 * bound functions under their existing per-variant names.
 *
 * Per-seat redaction on the wire happens in exactly two places, both tenant
 * hooks: visibility.clientEventFor for event-appended deltas and
 * visibility.viewForClient inside the snapshot payload. Terminal positions
 * fall back to full snapshots so endgame reveals stay tenant policy.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { currentAccountUser } from '../account-session.js';
import { logger, wsCounters } from '../obs.js';
import { mayPlayVariant } from '../persistence.js';
import {
  adminDebugTokenFromProtocolHeader,
  canObserveRoom,
  isAdminDebugToken,
  isProductionLikeRuntime,
  recordMessageTimestamp,
  seatTokenFromProtocolHeader,
} from '../server-policy.js';
import { isKnownClientMessageType, parseClientMessage } from '../server-ws-messages.js';
import { rememberExcludedDevice } from '../stats-excluded-device.js';
import {
  appendTenantEvent,
  appendTenantSeatAssigned,
  recordTenantPersistenceError,
  type TenantEventWriterContext,
} from './events.js';
import {
  clearTenantRuntimeTimers,
  scheduleTenantLifecycleTimers,
  type TenantLifecycleContext,
} from './lifecycle.js';
import {
  cancelTenantRematch,
  declineTenantRematch,
  finalizeTenantRematchIfReady,
  maybeReplayTenantRematchRedirect,
  offerTenantRematch,
  type TenantRematchContext,
} from './rematch.js';
import {
  expireTenantClock,
  type TenantSnapshotPayload,
  tenantClockRemainingMs,
  tenantPlyAtEventIndex,
  tenantSnapshotPayload,
} from './runtime.js';
import {
  assignTenantSeat,
  displaceOlderTenantSeatClients,
  rollbackTenantSeatAssignment,
} from './seat-session.js';
import type {
  TenantGameStateLike,
  TenantRoomEvent,
  TenantRuntimeRoom,
  TenantSeat,
  VariantTenant,
} from './tenant.js';
import { tenantSeatMayAct } from './tenant.js';

export type TenantLiveClient<C extends string> = {
  debugRequested: false;
  displaced: boolean;
  id: string;
  messageTimestamps: number[];
  roomId: string;
  // A debug-authorized spectator (dev / admin token) joins full rooms with seat
  // 'spectator'; handleMessage keeps them read-only. Normal players hold a color.
  seat: TenantSeat<C>;
  seatTokenHash?: string;
  socket: WebSocket;
  solo: false;
  userId?: string | null;
};

export type TenantLiveRoom<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
> = Omit<TenantRuntimeRoom<Kind, C, M, State, Spec>, 'clients'> & {
  clients: Set<TenantLiveClient<C>>;
};

export type TenantWebSocketContext<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
> = {
  wsMessageLimit: number;
  wsMessageWindowMs: number;
  // Latency-sample observability region tag; 'global' when omitted.
  defaultRoomRegion?: string;
  // Rematch is a capability: tenants without a rematch flow (Dark Xiangqi)
  // omit it and rematch:* messages are ignored.
  rematch?: TenantRematchContext<Kind, C, M, State, Spec, TenantLiveClient<C>>;
};

export type TenantWsRuntime<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string = string,
> = {
  handleConnection(
    ctx: TenantWebSocketContext<Kind, C, M, State, Spec>,
    socket: WebSocket,
    request: IncomingMessage,
    room: TenantLiveRoom<Kind, C, M, State, Spec>,
  ): Promise<void>;
  broadcastEventAppended(
    room: TenantLiveRoom<Kind, C, M, State, Spec>,
    event: TenantRoomEvent<C, M, Spec>,
    seq: number,
  ): void;
  broadcastSnapshot(room: TenantLiveRoom<Kind, C, M, State, Spec>): void;
  sendPayload(client: Pick<TenantLiveClient<C>, 'displaced' | 'socket'>, payload: unknown): void;
  scheduleLifecycleTimers(room: TenantLiveRoom<Kind, C, M, State, Spec>): void;
  transportSnapshotPayload(
    room: TenantLiveRoom<Kind, C, M, State, Spec>,
    client: TenantLiveClient<C>,
  ): TenantSnapshotPayload<C, M, View, Spec>;
  lifecycleCtx: TenantLifecycleContext<C, M, State, Spec, TenantLiveRoom<Kind, C, M, State, Spec>>;
};

export function createTenantWsRuntime<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  options: {
    // PvE: invoked after connection joins and after every human move, with the
    // bundle's lifecycle ctx, so the engine's move flows through the same
    // append+broadcast path as a human move. No-op when omitted.
    scheduleEngineMove?: (
      ctx: TenantLifecycleContext<C, M, State, Spec, TenantLiveRoom<Kind, C, M, State, Spec>>,
      room: TenantLiveRoom<Kind, C, M, State, Spec>,
    ) => void;
  } = {},
): TenantWsRuntime<Kind, C, M, State, View, Spec> {
  type LiveRoom = TenantLiveRoom<Kind, C, M, State, Spec>;
  type LiveClient = TenantLiveClient<C>;

  const eventWriterCtx: TenantEventWriterContext<Kind, C, M, State, Spec> = {
    scheduleLifecycleTimers: (room) => scheduleLifecycleTimers(room as LiveRoom),
    scheduleEngineMove: (room) => scheduleEngineMove(room as LiveRoom),
  };

  const lifecycleCtx: TenantLifecycleContext<C, M, State, Spec, LiveRoom> = {
    appendEvent: (room, event) => appendTenantEvent(tenant, room, event, eventWriterCtx),
    broadcastEventAppended,
  };

  function scheduleLifecycleTimers(room: LiveRoom): void {
    scheduleTenantLifecycleTimers(tenant, room, lifecycleCtx);
  }

  function scheduleEngineMove(room: LiveRoom): void {
    options.scheduleEngineMove?.(lifecycleCtx, room);
  }

  async function handleConnection(
    ctx: TenantWebSocketContext<Kind, C, M, State, Spec>,
    socket: WebSocket,
    request: IncomingMessage,
    room: LiveRoom,
  ): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const clientId = parseClientId(url.searchParams.get('client')) ?? randomUUID();
    // The browser's durable id; a guest seat is attributed to it at game end.
    const deviceId = parseClientId(url.searchParams.get('device'));
    const accountUser = await currentAccountUser(request);
    rememberExcludedDevice(deviceId, accountUser);
    const seatToken = seatTokenFromProtocolHeader(request.headers['sec-websocket-protocol']);
    // Allowlist-gated variants (139) ask the grant table before handing out a
    // seat. Non-gated specs short-circuit to true without a query.
    const variantAccessGranted = await mayPlayVariant(accountUser?.id ?? null, tenant.gameSpecId);
    const assignment = assignTenantSeat(
      tenant,
      room,
      clientId,
      seatToken,
      accountUser,
      deviceId,
      variantAccessGranted,
    );
    if (!assignment.ok) {
      // Spectator admission on a full room, via two independent routes:
      //  - canObserveRoom: the spec hides nothing while live, or the game has
      //    finished, so anyone may watch. This is the same predicate Mistboard TV
      //    consults before broadcasting a live board, so the room URL and TV now
      //    agree instead of the room being blanket-closed. Fog and hidden-identity
      //    are refused here while live and open at completion.
      //  - isDebugViewAuthorized: dev runtime or an admin token, which also reaches
      //    rooms the policy refuses (dev /game-sheet spectates seeded corpus rooms).
      // Every other rejection reason (rated/correspondence account gates) still
      // closes fail-closed.
      const observable =
        canObserveRoom(room.projection.state.status.type === 'finished', tenant.gameSpecId) ||
        isDebugViewAuthorized(request);
      if (assignment.reason === 'private room' && observable) {
        joinAsSpectator(ctx, socket, room, clientId, accountUser?.id ?? null);
        return;
      }
      socket.close(1008, assignment.reason);
      return;
    }

    try {
      await appendTenantSeatAssigned(
        tenant,
        room,
        {
          event: {
            type: 'seat-assigned',
            at: Date.now(),
            roomId: room.id,
            clientId,
            seat: assignment.seat,
          },
          tokenState: assignment.tokenState,
        },
        eventWriterCtx,
      );
    } catch (err) {
      rollbackTenantSeatAssignment(room, assignment);
      recordTenantPersistenceError(
        tenant,
        room.id,
        room.events.length,
        'seat-assigned',
        err as Error,
      );
      socket.close(1011, 'persistence failure');
      return;
    }

    const client: LiveClient = {
      debugRequested: false,
      displaced: false,
      id: clientId,
      messageTimestamps: [],
      roomId: room.id,
      seat: assignment.seat,
      seatTokenHash: assignment.seatTokenHash,
      socket,
      solo: false,
      userId: accountUser?.id ?? null,
    };
    room.clients.add(client);
    displaceOlderTenantSeatClients(room, client);
    scheduleLifecycleTimers(room);

    sendPayload(client, {
      ...transportSnapshotPayload(room, client),
      type: 'hello',
      clientId: client.id,
      ...(assignment.seatToken ? { seatToken: assignment.seatToken } : {}),
    });
    broadcastSnapshot(room);
    // PvE: once the human takes the empty seat, the engine (if it holds the
    // first-mover seat / the side to move) plays its move. No-op for PvP or
    // when it's the human's turn.
    scheduleEngineMove(room);
    // A player reconnecting after a rematch was finalized (while they were
    // offline) still gets routed to the new swapped-color room.
    if (ctx.rematch) maybeReplayTenantRematchRedirect(ctx.rematch, room, client);

    socket.on('message', (raw) => {
      if (
        !recordMessageTimestamp(
          client.messageTimestamps,
          Date.now(),
          ctx.wsMessageLimit,
          ctx.wsMessageWindowMs,
        )
      ) {
        socket.close(1008, 'rate limit');
        return;
      }
      void handleMessage(ctx, room, client, raw.toString());
    });

    socket.on('close', () => {
      room.clients.delete(client);
      if (!client.displaced) {
        scheduleLifecycleTimers(room);
        broadcastSnapshot(room);
      }
    });
  }

  // Read-only spectator admission for a debug-authorized viewer on a full room.
  // Deliberately skips everything a seated join does that mutates room state or
  // asserts a seat identity: no seat-assigned event (no token persisted), no
  // displacement (spectators don't own a seat, so they never displace each
  // other or a player), no engine scheduling, no rematch redirect replay. The
  // hello carries no seatToken. handleMessage enforces the read-only contract.
  function joinAsSpectator(
    ctx: TenantWebSocketContext<Kind, C, M, State, Spec>,
    socket: WebSocket,
    room: LiveRoom,
    clientId: string,
    userId: string | null,
  ): void {
    const client: LiveClient = {
      debugRequested: false,
      displaced: false,
      id: clientId,
      messageTimestamps: [],
      roomId: room.id,
      seat: 'spectator',
      socket,
      solo: false,
      userId,
    };
    room.clients.add(client);

    sendPayload(client, {
      ...transportSnapshotPayload(room, client),
      type: 'hello',
      clientId: client.id,
    });
    // A spectator arriving doesn't change canonical state, but the connected-
    // client count did; keep observers' snapshots consistent.
    broadcastSnapshot(room);

    socket.on('message', (raw) => {
      if (
        !recordMessageTimestamp(
          client.messageTimestamps,
          Date.now(),
          ctx.wsMessageLimit,
          ctx.wsMessageWindowMs,
        )
      ) {
        socket.close(1008, 'rate limit');
        return;
      }
      void handleMessage(ctx, room, client, raw.toString());
    });

    socket.on('close', () => {
      room.clients.delete(client);
      broadcastSnapshot(room);
    });
  }

  async function handleMessage(
    ctx: TenantWebSocketContext<Kind, C, M, State, Spec>,
    room: LiveRoom,
    client: LiveClient,
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
    if (message.type === 'ping') {
      sendPayload(client, {
        type: 'pong',
        at: typeof message.at === 'number' ? message.at : Date.now(),
        serverAt: Date.now(),
      });
      return;
    }
    if (message.type === 'latency-sample') {
      if (typeof message.rttMs === 'number' && Number.isFinite(message.rttMs)) {
        const rttMs = Math.max(0, Math.min(60_000, Math.round(message.rttMs)));
        wsCounters.recordLatencySample(ctx.defaultRoomRegion ?? 'global', rttMs);
      }
      return;
    }
    if (message.type === 'snapshot:request') {
      wsCounters.recordSnapshotRequest();
      sendPayload(client, transportSnapshotPayload(room, client));
      return;
    }
    // Read-only guard for debug spectators. Everything above (ping /
    // latency-sample / snapshot:request) is read-only; everything below appends
    // events or asserts a seat identity, so a spectator (no seat) stops here.
    // This is a correctness invariant, not polish: handleResign / handleSetupSubmit
    // stamp `color: seat` with no seat validation, so a spectator resign would
    // otherwise append `color:'spectator'` and corrupt the event log. After this
    // guard client.seat narrows to a real color; `seat` threads it downstream.
    if (client.seat === 'spectator') return;
    const seat: C = client.seat;
    if (message.type === 'resign') {
      await handleResign(room, client, seat);
      return;
    }
    if (message.type === 'abort') {
      await handleAbort(room, client, seat);
      return;
    }
    if (message.type === 'rematch:offer') {
      if (!ctx.rematch) return;
      offerTenantRematch(tenant, ctx.rematch, room, client);
      await finalizeTenantRematchIfReady(tenant, ctx.rematch, room);
      return;
    }
    if (message.type === 'rematch:cancel') {
      if (ctx.rematch) cancelTenantRematch(tenant, ctx.rematch, room, client);
      return;
    }
    if (message.type === 'rematch:decline') {
      if (ctx.rematch) declineTenantRematch(tenant, ctx.rematch, room, client);
      return;
    }
    if (message.type === 'setup:submit') {
      await handleSetupSubmit(room, client, seat, message);
      return;
    }
    if (message.type !== 'move') return;
    const move = tenant.rules.moveFromMessage(message);
    if (move === null) return;
    const status = room.projection.state.status;
    if (status.type !== 'playing') return;
    // No moves until both seats are filled (a fresh room starts in `playing`, so
    // a seated player could otherwise move before the opponent/engine joined).
    for (const color of tenant.colors) {
      if (!room.projection.seats[color]) return;
    }
    if (!tenantSeatMayAct(tenant, room.projection.state, seat)) return;
    // A move that arrives after the mover's flag fell but before the clock
    // timer fired ends the game by expiry instead of landing the move (the
    // chess-stack rule; closes the timer race for every tenant). The guard is
    // synchronous so the un-expired common path keeps its microtask timing.
    const activeClock = room.projection.clock;
    const activeColor = activeClock?.activeColor ?? null;
    if (
      activeClock &&
      activeColor !== null &&
      tenantClockRemainingMs(activeClock, activeColor, Date.now()) <= 0
    ) {
      await expireActiveClock(room, client, activeClock, activeColor);
      return;
    }
    // State-dependent canonicalization (when the tenant defines it) resolves
    // the parsed move to the exact legal-move object to append — e.g.
    // Crossroads re-attaches `promotion` from the legal-move list. It doubles
    // as the legality check: null rejects.
    const canonical = tenant.rules.canonicalMove
      ? tenant.rules.canonicalMove(room.projection.state, move, seat)
      : tenant.rules.isLegalMove(room.projection.state, move)
        ? move
        : null;
    if (canonical === null) {
      // A tenant may turn a rejection into a per-mover signal (the Crazyhouse
      // parachute bounce). Sent only to this client, so it never leaks to others.
      const rejection = tenant.wire?.rejectionFor?.(room.projection.state, move, seat);
      if (rejection) sendPayload(client, rejection);
      return;
    }
    const event: TenantRoomEvent<C, M, Spec> = {
      type: 'move-played',
      at: Date.now(),
      roomId: room.id,
      color: seat,
      move: canonical,
    };
    let seq: number;
    try {
      seq = await appendTenantEvent(tenant, room, event, eventWriterCtx);
    } catch (err) {
      recordTenantPersistenceError(tenant, room.id, room.events.length, event.type, err as Error);
      client.socket.close(1011, 'persistence failure');
      return;
    }
    broadcastEventAppended(room, event, seq);
    // PvE: it may now be the engine's turn (no-op for PvP / engine not to move).
    scheduleEngineMove(room);
  }

  // `seat` is the caller's read-only-guarded color (never 'spectator'); see the
  // spectator guard in handleMessage before the resign/setup/move dispatch.
  async function handleSetupSubmit(
    room: LiveRoom,
    client: LiveClient,
    seat: C,
    message: { setup?: unknown },
  ): Promise<void> {
    if (!tenant.setupSubmission) return;
    if (room.projection.state.status.type !== 'setup') return;
    const setup = tenant.setupSubmission.setupFromMessage(message);
    if (setup === null) return;
    const event: TenantRoomEvent<C, M, Spec> = {
      type: 'setup-submitted',
      at: Date.now(),
      roomId: room.id,
      color: seat,
      setup,
    };
    let seq: number;
    try {
      seq = await appendTenantEvent(tenant, room, event, eventWriterCtx);
    } catch (err) {
      recordTenantPersistenceError(tenant, room.id, room.events.length, event.type, err as Error);
      client.socket.close(1011, 'persistence failure');
      return;
    }
    broadcastEventAppended(room, event, seq);
    scheduleEngineMove(room);
  }

  async function expireActiveClock(
    room: LiveRoom,
    client: LiveClient,
    clock: NonNullable<LiveRoom['projection']['clock']>,
    activeColor: C,
  ): Promise<void> {
    const now = Date.now();
    const expiredClock = expireTenantClock(clock, now, activeColor);
    if (!expiredClock) return;
    const event: TenantRoomEvent<C, M, Spec> = {
      type: 'clock-expired',
      at: now,
      roomId: room.id,
      color: activeColor,
      clock: expiredClock,
    };
    let seq: number;
    try {
      seq = await appendTenantEvent(tenant, room, event, eventWriterCtx);
    } catch (err) {
      recordTenantPersistenceError(tenant, room.id, room.events.length, event.type, err as Error);
      client.socket.close(1011, 'persistence failure');
      return;
    }
    broadcastEventAppended(room, event, seq);
  }

  // `seat` is the caller's read-only-guarded color (never 'spectator').
  async function handleResign(room: LiveRoom, client: LiveClient, seat: C): Promise<void> {
    if (room.projection.state.status.type !== 'playing') return;
    if (room.projection.state.moveNumber < 2) return;
    const event: TenantRoomEvent<C, M, Spec> = {
      type: 'seat-resigned',
      at: Date.now(),
      roomId: room.id,
      color: seat,
    };
    let seq: number;
    try {
      seq = await appendTenantEvent(tenant, room, event, eventWriterCtx);
    } catch (err) {
      recordTenantPersistenceError(tenant, room.id, room.events.length, event.type, err as Error);
      client.socket.close(1011, 'persistence failure');
      return;
    }
    broadcastEventAppended(room, event, seq);
  }

  // `seat` is the caller's read-only-guarded color (never 'spectator').
  async function handleAbort(room: LiveRoom, client: LiveClient, seat: C): Promise<void> {
    const status = room.projection.state.status;
    if (status.type !== 'playing') return;
    if (room.projection.state.moveNumber >= 2) return;
    if (status.turn !== seat) return;
    const event: TenantRoomEvent<C, M, Spec> = {
      type: 'game-aborted',
      at: Date.now(),
      roomId: room.id,
      reason: 'user-abort',
    };
    let seq: number;
    try {
      seq = await appendTenantEvent(tenant, room, event, eventWriterCtx);
    } catch (err) {
      recordTenantPersistenceError(tenant, room.id, room.events.length, event.type, err as Error);
      client.socket.close(1011, 'persistence failure');
      return;
    }
    broadcastEventAppended(room, event, seq);
  }

  function broadcastEventAppended(
    room: LiveRoom,
    event: TenantRoomEvent<C, M, Spec>,
    seq: number,
  ): void {
    for (const client of room.clients) {
      if (client.displaced) continue;
      if (room.projection.state.status.type !== 'playing') {
        sendPayload(client, transportSnapshotPayload(room, client));
        continue;
      }
      const snapshot = transportSnapshotPayload(room, client);
      const { events: _events, ...base } = snapshot;
      const clientEvent = tenant.visibility.clientEventFor(
        event,
        client.seat,
        tenantPlyAtEventIndex(room.events, seq),
      );
      sendPayload(client, {
        ...base,
        type: 'event-appended',
        seq,
        ...(clientEvent ? { event: clientEvent } : {}),
      });
    }
  }

  function sendPayload(client: Pick<LiveClient, 'displaced' | 'socket'>, payload: unknown): void {
    if (client.displaced) return;
    try {
      client.socket.send(JSON.stringify(payload));
    } catch {
      /* socket closed */
    }
  }

  function broadcastSnapshot(room: LiveRoom): void {
    for (const client of room.clients) {
      if (client.displaced) continue;
      sendPayload(client, transportSnapshotPayload(room, client));
    }
  }

  function transportSnapshotPayload(room: LiveRoom, client: LiveClient) {
    return tenantSnapshotPayload(tenant, room, {
      id: client.id,
      seat: client.seat,
      solo: false,
    });
  }

  return {
    handleConnection,
    broadcastEventAppended,
    broadcastSnapshot,
    sendPayload,
    scheduleLifecycleTimers,
    transportSnapshotPayload,
    lifecycleCtx,
  };
}

export { clearTenantRuntimeTimers };

// The chess-stack client-id rule (shared with the dark-xiangqi handler it
// replaced): bounded length, URL/log-safe charset. Anything else falls back to
// a server-minted UUID exactly like a missing param.
function parseClientId(value: string | null): string | null {
  if (!value) return null;
  return /^[a-zA-Z0-9:_-]{8,80}$/.test(value) ? value : null;
}

// Mirrors isDebugViewAuthorized in server-ws-connection.ts: non-production
// runtimes always allow (dev /game-sheet spectates seeded corpus rooms);
// production requires a valid admin debug token in the WS subprotocol header.
// Gates the spectator fallback so production stays fail-closed for real users.
function isDebugViewAuthorized(request: IncomingMessage): boolean {
  if (!isProductionLikeRuntime()) return true;
  return isAdminDebugToken(
    adminDebugTokenFromProtocolHeader(request.headers['sec-websocket-protocol']),
  );
}
