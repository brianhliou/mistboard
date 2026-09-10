/**
 * Generic lifecycle timers for tenant rooms: the pregame abort window, the
 * active-clock expiry timer, and the disconnect-forfeit window. All timers are
 * speculative and .unref()'d (leaked-timer rule), re-derived from room state on
 * every schedule call, and append their terminal event through the tenant's
 * event writer so persistence/broadcast behave exactly like a player action.
 *
 * Clock policy (derived per room from the persisted time control, see
 * clockPolicyKindFor) governs which timers exist at all. Days-per-move
 * (correspondence) rooms arm NO in-memory timers: deadlines are days-scale and
 * enforced durably by the deadline sweeper, disconnect forfeit does not apply
 * (disconnecting is normal between correspondence moves), and the pregame
 * abort window is the per-move allowance anchored to the event log so a
 * restart never extends it. Deadline state (abortDeadline) is still computed
 * for the wire.
 */

import { clockPolicyKindFor, DAY_MS } from '@mistboard/game';
import { ABORT_WINDOW_MS, FORFEIT_WINDOW_MS, JOIN_WINDOW_MS } from '../lifecycle-windows.js';
import { logger } from '../obs.js';
import { expireTenantClock, tenantClockRemainingMs } from './runtime.js';
import type {
  TenantAbortPhase,
  TenantGameStateLike,
  TenantProjection,
  TenantRoomEvent,
  TenantRuntimeRoom,
  TenantSeat,
} from './tenant.js';
import { firstSeat, seatAfter } from './tenant.js';

// The projection+log slice the abort/deadline derivations read. Satisfied by
// both TenantRuntimeRoom (event-writer side) and TenantLifecycleRoom (timer
// side) — these functions never touch clients or timers.
export type TenantProjectedRoom<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
> = {
  id: string;
  events: readonly TenantRoomEvent<C, M, Spec>[];
  projection: TenantProjection<C, State, Spec>;
};

export type TenantLifecycleClient<C extends string> = {
  displaced: boolean;
  // May be 'spectator' (debug-authorized read-only viewer); spectators hold no
  // color seat, so seat-occupancy computations skip them.
  seat: TenantSeat<C>;
};

export type TenantLifecycleRoom<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
  Client extends TenantLifecycleClient<C> = TenantLifecycleClient<C>,
> = Omit<TenantRuntimeRoom<string, C, M, State, Spec>, 'clients' | 'kind'> & {
  kind: string;
  clients: Iterable<Client>;
};

export type TenantLifecycleContext<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
  Room extends TenantLifecycleRoom<C, M, State, Spec> = TenantLifecycleRoom<C, M, State, Spec>,
> = {
  appendEvent(room: Room, event: TenantRoomEvent<C, M, Spec>): Promise<number>;
  broadcastEventAppended(room: Room, event: TenantRoomEvent<C, M, Spec>, seq: number): void;
  logTimerFailure?(kind: 'abort' | 'clock' | 'forfeit', roomId: string, err: Error): void;
  now?(): number;
};

export type TenantLifecycleTenant<C extends string> = {
  colors: readonly C[];
  engine?: { isEngineClientId(clientId: string | undefined): boolean };
  persistence: { logKindPrefix: string; logLabel: string };
};

export function clearTenantRuntimeTimers(room: {
  abortTimer: ReturnType<typeof setTimeout> | null;
  clockTimer: ReturnType<typeof setTimeout> | null;
  forfeitTimer: ReturnType<typeof setTimeout> | null;
  engineTimer: ReturnType<typeof setTimeout> | null;
}): void {
  clearTenantAbortTimer(room);
  clearTenantClockTimer(room);
  clearTenantForfeitTimer(room);
  if (room.engineTimer) clearTimeout(room.engineTimer);
  room.engineTimer = null;
}

export function clearTenantAbortTimer(room: {
  abortTimer: ReturnType<typeof setTimeout> | null;
}): void {
  if (room.abortTimer) clearTimeout(room.abortTimer);
  room.abortTimer = null;
}

export function clearTenantClockTimer(room: {
  clockTimer: ReturnType<typeof setTimeout> | null;
}): void {
  if (room.clockTimer) clearTimeout(room.clockTimer);
  room.clockTimer = null;
}

export function clearTenantForfeitTimer(room: {
  forfeitTimer: ReturnType<typeof setTimeout> | null;
}): void {
  if (room.forfeitTimer) clearTimeout(room.forfeitTimer);
  room.forfeitTimer = null;
}

export function scheduleTenantLifecycleTimers<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Room extends TenantLifecycleRoom<C, M, State, Spec>,
>(
  tenant: TenantLifecycleTenant<C>,
  room: Room,
  ctx: TenantLifecycleContext<C, M, State, Spec, Room>,
): void {
  scheduleTenantAbortTimeout(tenant, room, ctx);
  scheduleTenantClockTimeout(tenant, room, ctx);
  scheduleTenantForfeitTimeout(tenant, room, ctx);
}

export function tenantAbortPhaseFor<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
>(
  tenant: TenantLifecycleTenant<C>,
  room: TenantProjectedRoom<C, M, State, Spec>,
): TenantAbortPhase<C> | null {
  const { status, moveNumber, lastMove } = room.projection.state;
  if (status.type !== 'playing' || moveNumber >= 2) return null;
  // An unfilled seat used to return null here, which left the room claimed by
  // NOTHING: the pregame window never opened (nobody owes a move), the forfeit
  // window needs moveNumber >= 2, and the durable guest-prestart sweep skips
  // any room carrying a `clock-started` event — which a timed tenant room emits
  // at CREATION (runtime.ts), unlike the legacy stack where it means "both
  // seats filled". So an abandoned invite link sat in `playing` forever. It now
  // gets its own, longer window; see reaper-coverage.test.ts.
  for (const color of tenant.colors) {
    if (!room.projection.seats[color]) return 'unjoined';
  }
  const first = firstSeat(tenant);
  return lastMove === undefined ? `${first}-1` : `${seatAfter(tenant, first)}-1`;
}

// The durable (sweeper-enforced) deadline of a days-per-move room: who must
// act and when they flag. Pregame phases use the event-log-anchored abort
// window; armed mid-game clocks use the persisted clock arithmetic. Null for
// live-policy rooms, terminal rooms, and rooms still waiting on a seat.
// Deterministic over the event log — the sweeper and the writer's
// room_deadlines row both derive from this single function.
export function tenantDurableDeadlineFor<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
>(
  tenant: TenantLifecycleTenant<C>,
  room: TenantProjectedRoom<C, M, State, Spec>,
): { seat: C; dueAt: number } | null {
  if (clockPolicyKindFor(room.projection.timeControl) !== 'days-per-move') return null;
  if (room.projection.state.status.type !== 'playing') return null;
  const allowanceMs = (room.projection.timeControl?.daysPerMove ?? 0) * DAY_MS;
  const phase = tenantAbortPhaseFor(tenant, room);
  // 'unjoined' carries no seat that owes a move, so there is no durable
  // deadline to enforce and nobody to award. Falling through would pick a seat
  // arbitrarily and anchor at 0, flagging an unfilled correspondence room
  // immediately for the wrong player.
  if (phase !== null && phase !== 'unjoined') {
    const first = firstSeat(tenant);
    const seat = phase === `${first}-1` ? first : seatAfter(tenant, first);
    return { seat, dueAt: tenantAbortAnchorAt(tenant, room, phase) + allowanceMs };
  }
  if (phase === 'unjoined') return null;
  const clock = room.projection.clock;
  if (!clock || clock.activeColor === null || clock.runningSince === null) return null;
  return {
    seat: clock.activeColor,
    dueAt: clock.runningSince + clock.remainingMs[clock.activeColor],
  };
}

// Sweeper enforcement for a hydrated days-per-move room: re-derive the
// deadline from the room itself (never trust the row), and when actually due
// append the same terminal event the in-memory timers would have — pregame
// phases abort, armed clocks expire — through the tenant's writer so
// persistence/broadcast behave exactly like a live flag.
export async function sweepTenantRoomDeadline<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Room extends TenantProjectedRoom<C, M, State, Spec>,
>(
  tenant: TenantLifecycleTenant<C>,
  room: Room,
  ctx: {
    appendEvent(room: Room, event: TenantRoomEvent<C, M, Spec>): Promise<number>;
    broadcastEventAppended(room: Room, event: TenantRoomEvent<C, M, Spec>, seq: number): void;
    now?(): number;
  },
): Promise<'aborted' | 'expired' | 'not-due' | 'no-deadline'> {
  const deadline = tenantDurableDeadlineFor(tenant, room);
  if (!deadline) return 'no-deadline';
  const now = ctx.now?.() ?? Date.now();
  if (deadline.dueAt > now) return 'not-due';
  if (tenantAbortPhaseFor(tenant, room) !== null) {
    const seq = await ctx.appendEvent(room, {
      type: 'game-aborted',
      at: now,
      roomId: room.id,
      reason: 'pregame-timeout',
    });
    const event = room.events[seq];
    if (event) ctx.broadcastEventAppended(room, event, seq);
    return 'aborted';
  }
  const clock = room.projection.clock;
  const activeColor = clock?.activeColor ?? null;
  if (!clock || activeColor === null) return 'no-deadline';
  const expiredClock = expireTenantClock(clock, now, activeColor);
  if (!expiredClock) return 'no-deadline';
  const seq = await ctx.appendEvent(room, {
    type: 'clock-expired',
    at: now,
    roomId: room.id,
    color: activeColor,
    clock: expiredClock,
  });
  const event = room.events[seq];
  if (event) ctx.broadcastEventAppended(room, event, seq);
  return 'expired';
}

// Event-log anchor for a correspondence pregame abort window. The first
// mover's window starts when the room became fully seated (the latest
// seat-assigned, falling back to room-created); the second mover's window
// starts at the first move. Deterministic over the event log, so hydration
// recomputes the same deadline a restart interrupted.
export function tenantAbortAnchorAt<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
>(
  tenant: TenantLifecycleTenant<C>,
  room: TenantProjectedRoom<C, M, State, Spec>,
  phase: TenantAbortPhase<C>,
): number {
  const firstMoverPhase = phase === `${firstSeat(tenant)}-1`;
  let anchor = 0;
  for (const event of room.events) {
    if (event.type === 'room-created') anchor = Math.max(anchor, event.at);
    if (firstMoverPhase && event.type === 'seat-assigned') anchor = Math.max(anchor, event.at);
    if (!firstMoverPhase && event.type === 'move-played') anchor = Math.max(anchor, event.at);
  }
  return anchor;
}

export function tenantForfeitingSeat<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
>(tenant: TenantLifecycleTenant<C>, room: TenantLifecycleRoom<C, M, State, Spec>): C | null {
  const { status, moveNumber } = room.projection.state;
  if (status.type !== 'playing' || moveNumber < 2) return null;
  const connected = tenantConnectedSeats(tenant, room.clients);
  // PvE: the engine seat has no WS client but is always "present" — never forfeit
  // it for "disconnection" (else a PvE game self-forfeits to the human the moment
  // play starts). A human who actually leaves still forfeits their own seat.
  if (tenant.engine) {
    for (const seat of tenant.colors) {
      if (tenant.engine.isEngineClientId(room.projection.seats[seat])) connected[seat] = true;
    }
  }
  const [first, second] = tenant.colors;
  if (connected[first] && !connected[second]) return second;
  if (!connected[first] && connected[second]) return first;
  return null;
}

// Is anyone actually sitting in this room right now (spectators and displaced
// sockets excluded)? Used to tell "waiting for an opponent" apart from
// "abandoned", which look identical in the projection alone.
function someSeatConnected<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
>(tenant: TenantLifecycleTenant<C>, room: TenantLifecycleRoom<C, M, State, Spec>): boolean {
  const connected = tenantConnectedSeats(tenant, room.clients);
  return tenant.colors.some((color) => connected[color]);
}

export function tenantConnectedSeats<C extends string>(
  tenant: { colors: readonly C[] },
  clients: Iterable<TenantLifecycleClient<C>>,
): Record<C, boolean> {
  const connected = {} as Record<C, boolean>;
  for (const color of tenant.colors) connected[color] = false;
  for (const client of clients) {
    if (client.displaced) continue;
    if (client.seat === 'spectator') continue;
    connected[client.seat] = true;
  }
  return connected;
}

function scheduleTenantAbortTimeout<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Room extends TenantLifecycleRoom<C, M, State, Spec>,
>(
  tenant: TenantLifecycleTenant<C>,
  room: Room,
  ctx: TenantLifecycleContext<C, M, State, Spec, Room>,
): void {
  clearTenantAbortTimer(room);
  const phase = tenantAbortPhaseFor(tenant, room);
  if (phase === null) {
    room.abortDeadline = null;
    room.abortPhase = null;
    return;
  }
  if (phase === 'unjoined' && someSeatConnected(tenant, room)) {
    // Somebody is sitting in this room with the page open, waiting for an
    // opponent. That is not an abandoned room and must never be aborted under
    // them, however long they wait — the bug being fixed is the room nobody is
    // in. This is re-derived on every connect, disconnect, and event, so the
    // window arms the moment the last person actually leaves.
    room.abortDeadline = null;
    room.abortPhase = null;
    return;
  }
  if (clockPolicyKindFor(room.projection.timeControl) === 'days-per-move') {
    if (phase === 'unjoined') {
      // Correspondence rooms waiting for an opponent are left alone: an open
      // correspondence challenge legitimately sits unfilled for days, and it is
      // already reclaimed on its own TTL by deleteExpiredCorrespondenceSeeks.
      room.abortDeadline = null;
      room.abortPhase = null;
      return;
    }
    // Correspondence: the first-move window is the per-move allowance,
    // anchored to the event log (not "now") so hydration after a restart
    // never extends it. No in-memory timer — the deadline sweeper enforces.
    room.abortPhase = phase;
    room.abortDeadline =
      tenantAbortAnchorAt(tenant, room, phase) +
      (room.projection.timeControl?.daysPerMove ?? 0) * DAY_MS;
    return;
  }
  const now = ctx.now?.() ?? Date.now();
  if (room.abortPhase !== phase || room.abortDeadline === null) {
    room.abortPhase = phase;
    // The phase is part of the guard above, so a seat filling flips
    // 'unjoined' -> '<first>-1' and recomputes the deadline down to the short
    // pregame window instead of leaving the long join window running.
    room.abortDeadline = now + (phase === 'unjoined' ? JOIN_WINDOW_MS : ABORT_WINDOW_MS);
  }
  const delay = Math.max(0, room.abortDeadline - now);
  room.abortTimer = setTimeout(() => {
    if (tenantAbortPhaseFor(tenant, room) === null) return;
    void ctx
      .appendEvent(room, {
        type: 'game-aborted',
        at: Date.now(),
        roomId: room.id,
        reason: 'pregame-timeout',
      })
      .then((seq) => {
        const event = room.events[seq];
        if (event) ctx.broadcastEventAppended(room, event, seq);
      })
      .catch((err) => {
        (ctx.logTimerFailure ?? tenantTimerFailureLogger(tenant))('abort', room.id, err as Error);
      });
  }, delay + 25);
  room.abortTimer.unref();
}

function scheduleTenantClockTimeout<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Room extends TenantLifecycleRoom<C, M, State, Spec>,
>(
  tenant: TenantLifecycleTenant<C>,
  room: Room,
  ctx: TenantLifecycleContext<C, M, State, Spec, Room>,
): void {
  clearTenantClockTimer(room);
  // Correspondence deadlines are days-scale and enforced by the durable
  // deadline sweeper; an in-memory timer would not survive a restart anyway.
  if (clockPolicyKindFor(room.projection.timeControl) === 'days-per-move') return;
  const clock = room.projection.clock;
  const activeColor = clock?.activeColor ?? null;
  if (room.projection.state.status.type !== 'playing' || !clock || activeColor === null) return;
  const now = ctx.now?.() ?? Date.now();
  const delay = Math.max(0, tenantClockRemainingMs(clock, activeColor, now));
  room.clockTimer = setTimeout(() => {
    const currentClock = room.projection.clock;
    const currentActive = currentClock?.activeColor ?? null;
    if (room.projection.state.status.type !== 'playing' || !currentClock || currentActive === null)
      return;
    const firedAt = Date.now();
    if (tenantClockRemainingMs(currentClock, currentActive, firedAt) > 0) return;
    const expiredClock = expireTenantClock(currentClock, firedAt, currentActive);
    if (!expiredClock) return;
    void ctx
      .appendEvent(room, {
        type: 'clock-expired',
        at: firedAt,
        roomId: room.id,
        color: currentActive,
        clock: expiredClock,
      })
      .then((seq) => {
        const event = room.events[seq];
        if (event) ctx.broadcastEventAppended(room, event, seq);
      })
      .catch((err) => {
        (ctx.logTimerFailure ?? tenantTimerFailureLogger(tenant))('clock', room.id, err as Error);
      });
  }, delay + 25);
  room.clockTimer.unref();
}

function scheduleTenantForfeitTimeout<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Room extends TenantLifecycleRoom<C, M, State, Spec>,
>(
  tenant: TenantLifecycleTenant<C>,
  room: Room,
  ctx: TenantLifecycleContext<C, M, State, Spec, Room>,
): void {
  clearTenantForfeitTimer(room);
  // Disconnect forfeit does not apply to correspondence rooms: disconnecting
  // between moves is the normal way to play days-per-move.
  if (clockPolicyKindFor(room.projection.timeControl) === 'days-per-move') {
    room.forfeitSeat = null;
    room.forfeitDeadline = null;
    return;
  }
  const seat = tenantForfeitingSeat(tenant, room);
  if (seat === null) {
    room.forfeitSeat = null;
    room.forfeitDeadline = null;
    return;
  }
  const now = ctx.now?.() ?? Date.now();
  if (room.forfeitSeat !== seat || room.forfeitDeadline === null) {
    room.forfeitSeat = seat;
    room.forfeitDeadline = now + FORFEIT_WINDOW_MS;
  }
  const delay = Math.max(0, room.forfeitDeadline - now);
  room.forfeitTimer = setTimeout(() => {
    if (tenantForfeitingSeat(tenant, room) !== seat) return;
    void ctx
      .appendEvent(room, {
        type: 'seat-forfeited',
        at: Date.now(),
        roomId: room.id,
        color: seat,
      })
      .then((seq) => {
        const event = room.events[seq];
        if (event) ctx.broadcastEventAppended(room, event, seq);
      })
      .catch((err) => {
        (ctx.logTimerFailure ?? tenantTimerFailureLogger(tenant))('forfeit', room.id, err as Error);
      });
  }, delay + 25);
  room.forfeitTimer.unref();
}

function tenantTimerFailureLogger(tenant: {
  persistence: { logKindPrefix: string; logLabel: string };
}): (kind: 'abort' | 'clock' | 'forfeit', roomId: string, err: Error) => void {
  return (kind, roomId, err) => logTenantTimerFailure(tenant.persistence, kind, roomId, err);
}

function logTenantTimerFailure(
  identity: { logKindPrefix: string; logLabel: string },
  kind: 'abort' | 'clock' | 'forfeit',
  roomId: string,
  err: Error,
): void {
  logger.error(
    {
      kind:
        kind === 'abort'
          ? `${identity.logKindPrefix}_abort_window_failure`
          : kind === 'clock'
            ? `${identity.logKindPrefix}_clock_failure`
            : `${identity.logKindPrefix}_forfeit_window_failure`,
      room_id: roomId,
      error: err.message,
      at: Date.now(),
    },
    kind === 'abort'
      ? `${identity.logLabel} abort window failure`
      : kind === 'clock'
        ? `${identity.logLabel} clock failure`
        : `${identity.logLabel} forfeit window failure`,
  );
}
