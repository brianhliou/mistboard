/**
 * Generic live-room WebSocket client — the single connection state machine for
 * every live surface: the self-contained tenant clients (Dark Xiangqi,
 * jieqi, banqi) and, since the P2 web convergence, the chess/DMX liveState shell
 * (live-socket.ts is now a thin frame-application adapter over this client).
 *
 * Owns everything connection-shaped and tenant-agnostic: the connection state
 * machine (connecting/connected/disconnected/reconnecting/displaced/rejected
 * with the server's close-code semantics), exponential-backoff reconnects with
 * send-triggered recovery, the staged reconnect-notice tiers, the seat-token
 * subprotocol attach + persistence on hello, rematch:redirect token hand-off +
 * navigation, event-appended sequence-gap detection with snapshot:request
 * resync, pong latency tracking with throttled latency-sample reporting, the
 * server-restart drain banner messages, and the ping loop. Frame APPLICATION
 * stays tenant-owned through the apply* hooks; `render` is invoked after every
 * state change exactly where the pre-extraction clients re-rendered.
 */

import {
  clientIdForRoom,
  deviceIdForBrowser,
  isPlayableSeat,
  resolveWebSocketBaseUrl,
  seatTokenForRoom,
  writeSeatTokenForRoom,
} from '../live-state.js';
import { setRestartBanner } from '../restart-banner.js';

export type TenantConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'displaced'
  | 'rejected';

// How prominently a mid-game reconnect is surfaced. A dropped socket reconnects
// on its own in well under a second most of the time, so the UI is staged
// rather than flashing a full notice on every blip: 'none' = stay silent during
// the grace window, 'dot' = a subtle own-presence cue, 'banner' = the full
// notice once retries have genuinely been failing. The two timers are anchored
// to the *first* drop of an outage (startNoticeTiers is a no-op while a window
// is already open), so reconnect churn doesn't keep resetting the clock.
export type TenantNoticeTier = 'none' | 'dot' | 'banner';

// The generic slice of a hello/snapshot/event-appended frame the client reads;
// tenants cast to their full frame type inside the apply hooks.
export type TenantSocketFrame = {
  type: 'hello' | 'snapshot' | 'event-appended';
  clientId?: string;
  seatToken?: string;
  seat?: unknown;
  seq?: number;
};

type TenantServerMessage =
  | TenantSocketFrame
  | { type: 'pong'; at: number; serverAt?: number }
  | { type: 'rematch:state' }
  | { type: 'rematch:redirect'; url: string; roomId: string; seat: unknown; seatToken: string }
  | {
      type: 'server_restart_scheduled';
      phase?: 'pending' | 'restarting';
      restartAt?: number;
    }
  | { type: 'server_restart_cancelled' };

export type TenantSocketClientOptions = {
  room: string;
  // Full socket URL override for shells that carry extra query params (dev
  // flags, variant, gameSpecId). Default: base URL + room + stored client id.
  socketUrl?: string;
  // Tenant frame application. The client has already handled clientId capture,
  // seat-token persistence, sequence bookkeeping, and the connected flip.
  applyHello(frame: TenantSocketFrame): void;
  applySnapshot(frame: TenantSocketFrame): void;
  applyEvent(frame: TenantSocketFrame): void;
  onRematchState?(message: Record<string, unknown>): void;
  // Tenant-specific server messages the core does not recognize (hello / snapshot
  // / event-appended / pong / rematch / restart), e.g. a drop-rejected bounce.
  // Called before the trailing re-render.
  onServerMessage?(message: { type: string; [key: string]: unknown }): void;
  // Full re-render, called after every connection/frame state change.
  render(): void;
};

export type TenantSocketClient = {
  connect(): void;
  // Tear down timers, listeners, and the socket; used when a shell re-boots
  // into a fresh client. Terminal — create a new client to reconnect.
  close(): void;
  // User-initiated retry: resets the backoff and reconnects immediately.
  // No-op in the terminal displaced/rejected states.
  reconnectNow(): void;
  send(payload: unknown): boolean;
  startPing(intervalMs?: number): void;
  connection(): TenantConnectionState;
  noticeTier(): TenantNoticeTier;
  closeReason(): string;
  clientId(): string;
  latencyMs(): number | null;
  reconnectAttempt(): number;
};

const RECONNECT_NOTICE_GRACE_MS = 1_500;
const RECONNECT_NOTICE_ESCALATE_MS = 5_000;
const LATENCY_SAMPLE_INTERVAL_MS = 60_000;

export function createTenantSocketClient(options: TenantSocketClientOptions): TenantSocketClient {
  let socketUrl = options.socketUrl ?? '';
  if (!socketUrl) {
    const socketParams = new URLSearchParams({ room: options.room });
    socketParams.set('client', clientIdForRoom(options.room));
    const deviceId = deviceIdForBrowser();
    if (deviceId) socketParams.set('device', deviceId);
    socketUrl = `${resolveWebSocketBaseUrl()}?${socketParams}`;
  }

  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  let lastSeq: number | null = null;
  let clientId = '';
  let connectionState: TenantConnectionState = 'connecting';
  let closeReason = '';
  let noticeTier: TenantNoticeTier = 'none';
  let noticeTierTimers: number[] = [];
  let latencyMs: number | null = null;
  let lastLatencySampleSentAt = 0;
  let pingTimer: number | null = null;

  function connect(): void {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      socket.removeEventListener('message', onMessage);
      socket.close();
      socket = null;
    }
    connectionState = clientId ? 'reconnecting' : 'connecting';
    options.render();

    const token = seatTokenForRoom(options.room);
    const next = token
      ? new WebSocket(socketUrl, [`mistboard-seat.${token}`])
      : new WebSocket(socketUrl);
    socket = next;
    next.addEventListener('message', onMessage);
    next.addEventListener('open', () => {
      if (socket !== next) return;
      // A send during CONNECTING may have armed a reconnect; an open socket
      // needs no pending teardown.
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      reconnectAttempt = 0;
      connectionState = 'connected';
      clearNoticeTiers();
      options.render();
    });
    next.addEventListener('close', (event) => {
      if (socket !== next) return;
      closeReason = event.reason;
      if (event.code === 4000 && event.reason === 'duplicate session') {
        connectionState = 'displaced';
        socket = null;
        clearNoticeTiers();
        options.render();
        return;
      }
      if (event.code === 1008) {
        connectionState = 'rejected';
        socket = null;
        clearNoticeTiers();
        options.render();
        return;
      }
      connectionState = 'disconnected';
      startNoticeTiers();
      options.render();
      scheduleReconnect();
    });
    next.addEventListener('error', () => {
      if (socket !== next) return;
      connectionState = 'disconnected';
      startNoticeTiers();
      options.render();
    });
  }

  function close(): void {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer !== null) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
    clearNoticeTiers();
    if (socket) {
      socket.removeEventListener('message', onMessage);
      socket.close();
      socket = null;
    }
  }

  function startNoticeTiers(): void {
    if (noticeTierTimers.length > 0) return;
    noticeTier = 'none';
    noticeTierTimers.push(
      window.setTimeout(() => {
        if (connectionState === 'connected') return;
        noticeTier = 'dot';
        options.render();
      }, RECONNECT_NOTICE_GRACE_MS),
      window.setTimeout(() => {
        if (connectionState === 'connected') return;
        noticeTier = 'banner';
        options.render();
      }, RECONNECT_NOTICE_ESCALATE_MS),
    );
  }

  function clearNoticeTiers(): void {
    for (const timer of noticeTierTimers) window.clearTimeout(timer);
    noticeTierTimers = [];
    noticeTier = 'none';
  }

  function scheduleReconnect(): void {
    if (connectionState === 'displaced' || connectionState === 'rejected') return;
    if (reconnectTimer) return;
    reconnectAttempt += 1;
    connectionState = 'reconnecting';
    options.render();
    const delay = tenantReconnectDelayMs(reconnectAttempt);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function reconnectNow(): void {
    if (connectionState === 'displaced' || connectionState === 'rejected') return;
    reconnectAttempt = 0;
    connect();
  }

  function send(payload: unknown): boolean {
    if (connectionState === 'displaced' || connectionState === 'rejected') return false;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // A send against a closed socket is the cheapest disconnect detector we
      // have (e.g. the ping loop, or a move clicked after a silent drop), so
      // it kicks off recovery rather than failing inert.
      scheduleReconnect();
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }

  function onMessage(event: MessageEvent<string>): void {
    const message = JSON.parse(event.data) as TenantServerMessage;
    if (message.type === 'pong') {
      latencyMs = Math.max(0, Date.now() - message.at);
      maybeSendLatencySample(latencyMs);
      // No re-render: latency is only surfaced in degraded-connection labels,
      // and a pong only arrives while connected, so the value is never on
      // screen here. Rendering on every 5s ping is pure churn.
      return;
    }
    if (message.type === 'server_restart_scheduled') {
      setRestartBanner(message.phase ?? 'pending');
      return;
    }
    if (message.type === 'server_restart_cancelled') {
      setRestartBanner(null);
      return;
    }
    if (message.type === 'rematch:state') {
      options.onRematchState?.(message as unknown as Record<string, unknown>);
      options.render();
      return;
    }
    if (message.type === 'rematch:redirect') {
      if (isPlayableSeat(message.seat)) {
        writeSeatTokenForRoom(message.roomId, { seat: message.seat, token: message.seatToken });
      }
      window.location.assign(message.url);
      return;
    }

    if (message.type === 'hello') {
      connectionState = 'connected';
      clientId = message.clientId ?? clientId;
      if (message.seatToken && isPlayableSeat(message.seat)) {
        writeSeatTokenForRoom(options.room, { seat: message.seat, token: message.seatToken });
      }
      options.applyHello(message);
      lastSeq = null;
    } else if (message.type === 'snapshot') {
      connectionState = 'connected';
      options.applySnapshot(message);
      lastSeq = null;
    } else if (message.type === 'event-appended') {
      // Gap detection: a missed delta means resync from a fresh snapshot.
      if (lastSeq !== null && message.seq !== undefined && message.seq !== lastSeq + 1) {
        send({ type: 'snapshot:request' });
        return;
      }
      connectionState = 'connected';
      options.applyEvent(message);
      if (message.seq !== undefined) lastSeq = message.seq;
    } else {
      options.onServerMessage?.(message as unknown as { type: string; [key: string]: unknown });
    }
    options.render();
  }

  function maybeSendLatencySample(rttMs: number): void {
    const now = Date.now();
    if (lastLatencySampleSentAt !== 0 && now - lastLatencySampleSentAt < LATENCY_SAMPLE_INTERVAL_MS)
      return;
    lastLatencySampleSentAt = now;
    send({ type: 'latency-sample', rttMs });
  }

  function startPing(intervalMs = 5_000): void {
    if (pingTimer !== null) return;
    pingTimer = window.setInterval(() => send({ type: 'ping', at: Date.now() }), intervalMs);
  }

  return {
    connect,
    close,
    reconnectNow,
    send,
    startPing,
    connection: () => connectionState,
    noticeTier: () => noticeTier,
    closeReason: () => closeReason,
    clientId: () => clientId,
    latencyMs: () => latencyMs,
    reconnectAttempt: () => reconnectAttempt,
  };
}

// Exponential backoff capped at 10s: 750ms, 1.5s, 3s, 6s, 10s, 10s, ...
export function tenantReconnectDelayMs(attempt: number): number {
  return Math.min(10_000, 750 * 2 ** Math.min(attempt - 1, 4));
}
