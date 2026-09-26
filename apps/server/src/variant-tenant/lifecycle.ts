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
import {
  ABORT_WINDOW_MS,
  FORFEIT_WINDOW_MS,
  JOIN_WINDOW_MS,
  PVP_DISCONNECT_FORFEIT_ENABLED,
} from '../lifecycle-windows.js';
import { logger } from '../obs.js';
import { recordRoomLifecycleAuditSafe } from '../room-lifecycle-audit.js';
import { serverConfig } from '../server-config.js';
import {
  expireTenantClock,
  tenantClockRemainingMs,
  tenantPauseEventFor,
  tenantResumeEventFor,
} from './runtime.js';
import type {
  TenantAbortPhase,
  TenantGameStateLike,
  TenantPendingAction,
  TenantProjection,
  TenantResumeReason,
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
  // Set by the shutdown pause before it appends: a stopping room arms nothing,
  // or the pause's own append would re-run the timers and resume the clock of
  // players who are still connected for the last second of the process.
  stopping?: boolean;
};

// How long a paused game waits for its players after the server comes back
// before the clock runs anyway. The chess stack's setting, so both wait alike.
export const TENANT_PAUSE_GRACE_MS = serverConfig.pauseGraceMs;

export type TenantTimerKind = 'abort' | 'clock' | 'forfeit' | 'action' | 'pause' | 'resume';

export type TenantLifecycleContext<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
  Room extends TenantLifecycleRoom<C, M, State, Spec> = TenantLifecycleRoom<C, M, State, Spec>,
> = {
  appendEvent(room: Room, event: TenantRoomEvent<C, M, Spec>): Promise<number>;
  broadcastEventAppended(room: Room, event: TenantRoomEvent<C, M, Spec>, seq: number): void;
  logTimerFailure?(kind: TenantTimerKind, roomId: string, err: Error): void;
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
  actionTimer: ReturnType<typeof setTimeout> | null;
  engineTimer: ReturnType<typeof setTimeout> | null;
  resumeTimer?: ReturnType<typeof setTimeout> | null;
}): void {
  clearTenantAbortTimer(room);
  clearTenantClockTimer(room);
  clearTenantForfeitTimer(room);
  clearTenantActionTimer(room);
  clearTenantResumeTimer(room);
  if (room.engineTimer) clearTimeout(room.engineTimer);
  room.engineTimer = null;
}

export function clearTenantResumeTimer(room: {
  resumeTimer?: ReturnType<typeof setTimeout> | null;
}): void {
  if (room.resumeTimer) clearTimeout(room.resumeTimer);
  room.resumeTimer = null;
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

export function clearTenantActionTimer(room: {
  actionTimer: ReturnType<typeof setTimeout> | null;
}): void {
  if (room.actionTimer) clearTimeout(room.actionTimer);
  room.actionTimer = null;
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
  if (room.stopping) {
    clearTenantRuntimeTimers(room);
    return;
  }
  // A game paused by a server stop runs no game timer: its clock is frozen, it
  // takes no moves, and nothing may flag, abort or forfeit it. The only timer
  // is the one that ends the pause.
  if (room.projection.paused) {
    clearTenantAbortTimer(room);
    clearTenantClockTimer(room);
    clearTenantForfeitTimer(room);
    clearTenantActionTimer(room);
    scheduleTenantResume(tenant, room, ctx);
    return;
  }
  clearTenantResumeTimer(room);
  room.resumeDeadline = null;
  scheduleTenantAbortTimeout(tenant, room, ctx);
  scheduleTenantClockTimeout(tenant, room, ctx);
  scheduleTenantForfeitTimeout(tenant, room, ctx);
  scheduleTenantActionTimeout(tenant, room, ctx);
}

// Resume at once when every human seat is back (engine seats are always
// present while the server is up), otherwise when the grace window runs out.
// The window opens on the first schedule after the pause, which is the first
// seated connection to the rehydrated room; a spectator never opens it.
function scheduleTenantResume<
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
  clearTenantResumeTimer(room);
  const now = ctx.now?.() ?? Date.now();
  const connected = tenantConnectedSeats(tenant, room.clients);
  const everyoneBack = tenant.colors.every(
    (color) =>
      connected[color] || (tenant.engine?.isEngineClientId(room.projection.seats[color]) ?? false),
  );
  if (everyoneBack) {
    resumeTenantRoom(tenant, room, ctx, now, 'players-returned');
    return;
  }
  if (room.resumeDeadline === null || room.resumeDeadline === undefined) {
    room.resumeDeadline = now + TENANT_PAUSE_GRACE_MS;
  }
  room.resumeTimer = setTimeout(
    () => {
      room.resumeTimer = null;
      resumeTenantRoom(tenant, room, ctx, Date.now(), 'grace-elapsed');
    },
    Math.max(0, room.resumeDeadline - now),
  );
  room.resumeTimer.unref();
}

function resumeTenantRoom<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Room extends TenantLifecycleRoom<C, M, State, Spec>,
>(
  tenant: TenantLifecycleTenant<C>,
  room: Room,
  ctx: TenantLifecycleContext<C, M, State, Spec, Room>,
  at: number,
  reason: TenantResumeReason,
): void {
  const paused = room.projection.paused;
  const event = tenantResumeEventFor<C, M, Spec>(room.projection, at, reason);
  if (!paused || !event) return;
  room.resumeDeadline = null;
  void ctx
    .appendEvent(room, event)
    .then(async (seq) => {
      if (seq < 0) return; // a concurrent resume landed first
      const appended = room.events[seq];
      if (appended) ctx.broadcastEventAppended(room, appended, seq);
      await recordRoomLifecycleAuditSafe({
        roomId: room.id,
        kind: 'resume',
        atMs: at,
        eventSeq: seq,
        payload: {
          mode: 'tenant',
          gameSpecId: room.gameSpecId,
          // Same vocabulary as the chess stack's resume rows, so the deploy
          // history counts both the same way.
          reason: reason === 'players-returned' ? 'both-present' : 'grace-elapsed',
          pauseReason: pausedReasonOf(room.events),
          pausedAtMs: paused.at,
          pausedDurationMs: at - paused.at,
        },
      });
    })
    .catch((err) => {
      (ctx.logTimerFailure ?? tenantTimerFailureLogger(tenant))('resume', room.id, err as Error);
    });
}

function pausedReasonOf(events: readonly { type: string; reason?: unknown }[]): unknown {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === 'clock-paused') return event.reason === 'orphaned' ? 'orphaned' : 'shutdown';
  }
  return null;
}

/**
 * Pause every live game in a tenant's room map as the server stops, so the
 * outage is not charged to whoever was on move. Appends through the tenant's
 * writer (persisted before the process exits: shutdown awaits room writes).
 * Returns how many rooms it paused.
 */
export async function pauseTenantRoomsOnShutdown<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Room extends TenantLifecycleRoom<C, M, State, Spec>,
>(
  tenant: TenantLifecycleTenant<C>,
  rooms: Iterable<Room>,
  ctx: TenantLifecycleContext<C, M, State, Spec, Room>,
  at: number,
): Promise<number> {
  let paused = 0;
  for (const room of rooms) {
    const event = tenantPauseEventFor<C, M, Spec>(room.projection, at, 'shutdown');
    room.stopping = true;
    clearTenantRuntimeTimers(room);
    if (!event) continue;
    try {
      const seq = await ctx.appendEvent(room, event);
      if (seq < 0) continue;
      paused += 1;
      await recordRoomLifecycleAuditSafe({
        roomId: room.id,
        kind: 'pause_on_shutdown',
        atMs: at,
        eventSeq: seq,
        payload: { mode: 'tenant', gameSpecId: room.gameSpecId, turn: event.activeColor },
      });
    } catch (err) {
      (ctx.logTimerFailure ?? tenantTimerFailureLogger(tenant))('pause', room.id, err as Error);
    }
  }
  return paused;
}

/**
 * Arm the tenant's own deadline, if its current state has one.
 *
 * Unlike the abort, clock and forfeit timers, this one does not end a game. It
 * makes a move the game was waiting on and lets play continue, which is what a
 * mahjong claim window needs when a seat goes quiet.
 *
 * One action per firing. The re-arm happens on the way back through
 * scheduleTenantLifecycleTimers after the event lands, so a tenant that returns
 * a fresh action every time cannot spin inside a single callback.
 */
export function scheduleTenantActionTimeout<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Room extends TenantLifecycleRoom<C, M, State, Spec>,
>(
  tenant: TenantLifecycleTenant<C> & {
    rules?: { pendingAction?(state: State): TenantPendingAction<C, M> | null };
  },
  room: Room,
  ctx: TenantLifecycleContext<C, M, State, Spec, Room>,
): void {
  clearTenantActionTimer(room);
  const pending = tenant.rules?.pendingAction?.(room.projection.state);
  if (!pending) return;
  const now = ctx.now?.() ?? Date.now();
  const delay = Math.max(0, pending.at - now);
  room.actionTimer = setTimeout(() => {
    // The window may have settled on its own while the timer was pending: every
    // seat answered, or a claim resolved the discard. Re-read rather than
    // trusting the action captured at arming time, or a seat that answered at
    // the last moment gets overruled by its own timeout.
    const stillPending = tenant.rules?.pendingAction?.(room.projection.state);
    if (!stillPending) return;
    void ctx
      .appendEvent(room, {
        type: 'move-played',
        at: Date.now(),
        roomId: room.id,
        color: stillPending.color,
        move: stillPending.move,
      })
      .then((seq) => {
        const event = room.events[seq];
        if (event) ctx.broadcastEventAppended(room, event, seq);
      })
      .catch((err) => {
        (ctx.logTimerFailure ?? tenantTimerFailureLogger(tenant))('action', room.id, err as Error);
      });
  }, delay + 25);
  room.actionTimer.unref();
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
  // PvE: no disconnect forfeit at all, in either direction.
  //
  // A disconnect forfeit answers "your opponent is waiting and you left". Against
  // an engine nobody is waiting, so it only takes games away: measured on prod
  // (#436), 13 xiangqi PvE games ended this way 33-73 s after the human's last
  // move, and at the final position 5 were level and 4 ahead, one with a forced
  // mate. A phone locking closes the socket at once, and the client only retries
  // on throttled background timers, so 30 s is reachable by putting the phone
  // down. A human who never returns still loses: their clock runs through the
  // disconnect and flags (a tenant room always has one, rooms-route.ts defaults
  // it), which is what sitting at a board does too.
  if (tenant.engine) {
    for (const seat of tenant.colors) {
      if (tenant.engine.isEngineClientId(room.projection.seats[seat])) return null;
    }
  }
  // PvP: off by policy while the flag is false (lifecycle-windows.ts, #436).
  // Deliberately below the PvE check so the two reasons stay separable: PvE is
  // settled, this one is waiting on measurement.
  if (!PVP_DISCONNECT_FORFEIT_ENABLED) return null;
  const connected = tenantConnectedSeats(tenant, room.clients);
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
}): (kind: TenantTimerKind, roomId: string, err: Error) => void {
  return (kind, roomId, err) => logTenantTimerFailure(tenant.persistence, kind, roomId, err);
}

function logTenantTimerFailure(
  identity: { logKindPrefix: string; logLabel: string },
  kind: TenantTimerKind,
  roomId: string,
  err: Error,
): void {
  const kinds: Record<typeof kind, string> = {
    abort: `${identity.logKindPrefix}_abort_window_failure`,
    clock: `${identity.logKindPrefix}_clock_failure`,
    forfeit: `${identity.logKindPrefix}_forfeit_window_failure`,
    action: `${identity.logKindPrefix}_pending_action_failure`,
    pause: `${identity.logKindPrefix}_shutdown_pause_failure`,
    resume: `${identity.logKindPrefix}_pause_resume_failure`,
  };
  logger.error(
    {
      kind: kinds[kind],
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
