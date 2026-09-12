/**
 * Chess liveState shell socket — since the P2 web convergence, a thin
 * frame-application adapter over the generic tenant socket client
 * (variant-tenant/socket-client.ts), which owns the connection state machine,
 * reconnect backoff + notice tiers, seq-gap resync, latency sampling, and the
 * server-restart banner messages. This module keeps only what is shell-shaped:
 * projecting state frames into the shared mutable liveState, the rematch
 * declined-vs-cancelled cue, and the per-variant sound dispatch.
 */

import type { Color, GameEvent, GameSpecId, PlayerView } from '@mistboard/game';
import type {
  ConnectedSeats,
  DevViews,
  PauseReason,
  RoomMode,
  Seat,
  XiangqiFamilyClock,
} from './live-state.js';
import { isPlayableSeat, liveState, takeRematchCancel } from './live-state.js';
import type { ProfileIdentity } from './profile-link.js';
import {
  createTenantSocketClient,
  type TenantSocketClient,
  type TenantSocketFrame,
} from './variant-tenant/socket-client.js';

// ── Wire types ────────────────────────────────────────────────────────────────

// Fields shared by every state-bearing frame. hello/snapshot carry the full
// `events` array; event-appended carries seq + the single appended `event`
// instead. The connection
// machinery (pong, rematch:redirect, restart messages) never reaches this
// module — the generic client consumes those frames itself.
type StateFrame = {
  type: 'hello' | 'snapshot' | 'event-appended';
  clients: number;
  gameSpecId?: GameSpecId;
  region?: string;
  mode?: RoomMode;
  pveEngineId?: string | null;
  pveEngineName?: string | null;
  serverAt?: number;
  seat: Seat;
  solo: boolean;
  devViews?: DevViews | null;
  events?: GameEvent[];
  event?: GameEvent;
  state: PlayerView;
  rated?: boolean;
  paused?: boolean;
  pauseReason?: PauseReason | null;
  abortDeadline?: number | null;
  forfeitDeadline?: number | null;
  connectedSeats?: ConnectedSeats;
  clock?: XiangqiFamilyClock | null;
  timeControl?: { initialMs: number; incrementMs: number; daysPerMove?: number } | null;
  rematch?: {
    offers: { white?: boolean; black?: boolean; red?: boolean };
    finalizedRoomId: string | null;
  };
  seatDisplayNames?: Partial<Record<Color, string>>;
  seatProfiles?: Partial<Record<Color, ProfileIdentity>>;
};

type RematchStateMessage = {
  type: 'rematch:state';
  offers: { white?: boolean; black?: boolean; red?: boolean };
  finalizedRoomId: string | null;
};

// ── Module-scope socket state ─────────────────────────────────────────────────

let client: TenantSocketClient | null = null;

// ── Injected callbacks (set by initSocket) ────────────────────────────────────

let _render: () => void = () => {};
let _reconcileInteractionState: () => void = () => {};
let _maybePlaySnapshotSound: (events: GameEvent[], state: PlayerView | null) => void = () => {};

// ── Init ──────────────────────────────────────────────────────────────────────

export function initSocket(callbacks: {
  render: () => void;
  reconcileInteractionState: () => void;
  maybePlaySnapshotSound: (events: GameEvent[], state: PlayerView | null) => void;
}): void {
  _render = callbacks.render;
  _reconcileInteractionState = callbacks.reconcileInteractionState;
  _maybePlaySnapshotSound = callbacks.maybePlaySnapshotSound;
}

// ── Socket management ─────────────────────────────────────────────────────────

export function connectSocket(): void {
  // A re-bootstrap (SPA landing -> room transition) gets a fresh client; the
  // old one's timers and listeners are torn down so they can't zombie-render.
  client?.close();
  client = createTenantSocketClient({
    room: liveState.room,
    socketUrl: liveState.socketUrl,
    applyHello: applyStateFrame,
    applySnapshot: applyStateFrame,
    applyEvent: applyStateFrame,
    onRematchState: (message) => applyRematchState(message as unknown as RematchStateMessage),
    render: renderFromSocket,
  });
  client.connect();
}

export function reconnectNow(): void {
  client?.reconnectNow();
}

export function sendSocket(payload: unknown): boolean {
  return client?.send(payload) ?? false;
}

// ── Frame application ─────────────────────────────────────────────────────────

function applyStateFrame(generic: TenantSocketFrame): void {
  const frame = generic as unknown as StateFrame;
  // Sync before reconcile, not just at render: reconcileInteractionState gates
  // board interaction on liveState.connectionState, and the client flipped to
  // 'connected' for this frame before invoking the hook.
  syncConnectionMirror();
  liveState.lastSnapshotAt = Date.now();
  applyFullFrame(frame);
  if (frame.type === 'event-appended') {
    if (frame.event) liveState.events = [...liveState.events, frame.event];
  } else {
    // Snapshot/hello replace the event log wholesale; the array was already
    // filtered server-side for this seat.
    liveState.events = frame.events ?? [];
  }
  if (liveState.gameSpecId !== 'dark-xiangqi') {
    _maybePlaySnapshotSound(liveState.events, liveState.state);
  }
  _reconcileInteractionState();
}

// Fields shared by every state-bearing frame (hello, snapshot, event-
// appended). Keeping this in one helper prevents the handlers from
// drifting — same code wrote the snapshot for years, now event-appended
// uses the same projection.
function applyFullFrame(message: StateFrame): void {
  liveState.clientCount = message.clients;
  liveState.gameSpecId = message.gameSpecId ?? liveState.gameSpecId;
  liveState.roomRegion = message.region ?? liveState.roomRegion;
  liveState.roomMode = message.mode ?? liveState.roomMode;
  liveState.pveEngineId = message.pveEngineId ?? null;
  liveState.pveEngineName = message.pveEngineName ?? null;
  liveState.lastServerAt = message.serverAt ?? null;
  liveState.seat = message.seat;
  liveState.solo = message.solo;
  liveState.devViews = message.devViews ?? null;
  liveState.rated = message.rated ?? true;
  liveState.paused = message.paused ?? false;
  liveState.pauseReason = message.pauseReason ?? null;
  liveState.abortDeadline = message.abortDeadline ?? null;
  liveState.forfeitDeadline = message.forfeitDeadline ?? null;
  liveState.state = message.state;
  liveState.clock = message.clock ?? null;
  liveState.timeControl = message.timeControl ?? null;
  if (message.connectedSeats) liveState.connectedSeats = message.connectedSeats;
  if (message.rematch) liveState.rematch = message.rematch;
  if (message.seatDisplayNames) liveState.seatDisplayNames = message.seatDisplayNames;
  if (message.seatProfiles) liveState.seatProfiles = message.seatProfiles;
}

function applyRematchState(message: RematchStateMessage): void {
  const mySeat = liveState.seat;
  const hadMyOffer = isPlayableSeat(mySeat) && Boolean(liveState.rematch.offers[mySeat]);
  const stillMyOffer = isPlayableSeat(mySeat) && Boolean(message.offers[mySeat]);
  const anyOffer = Boolean(message.offers.white || message.offers.black || message.offers.red);
  // Decline and self-cancel both clear my offer on the wire, so they're only
  // distinguishable by intent: if my pending offer vanished without a redirect
  // and I didn't click Cancel, the opponent declined. Keep the cue until either
  // side has an active offer again.
  const iCancelled = takeRematchCancel();
  const declined =
    hadMyOffer && !stillMyOffer && !message.finalizedRoomId && !iCancelled
      ? true
      : anyOffer
        ? false
        : liveState.rematch.declined;
  liveState.rematch = {
    offers: message.offers,
    finalizedRoomId: message.finalizedRoomId,
    declined,
  };
}

// ── Connection-state mirror ───────────────────────────────────────────────────

// The generic client owns connection truth; the shell's render path reads it
// off liveState (live-render/live-status predate the extraction), so every
// socket-driven render syncs the mirror first. Between socket renders the
// client's state can't change, so non-socket renders never see stale values.
function syncConnectionMirror(): void {
  if (!client) return;
  liveState.connectionState = client.connection();
  liveState.connectionNoticeTier = client.noticeTier();
  liveState.closeReason = client.closeReason();
  liveState.clientId = client.clientId() || liveState.clientId;
  liveState.reconnectAttempt = client.reconnectAttempt();
  liveState.latencyMs = client.latencyMs();
}

function renderFromSocket(): void {
  syncConnectionMirror();
  _render();
}
