/**
 * Generic event-sourced live-room runtime over a VariantTenant.
 *
 * One implementation of the room event model, projection replay, clock
 * arithmetic, event-log validation, and the per-seat snapshot payload. The
 * tenant supplies rules, redaction policy, and color/spec identity; this
 * module never inspects variant state beyond the TenantGameStateLike slice
 * and never builds variant status objects (rules.finish / rules.abort do).
 *
 * Wire-parity contract: for a migrated tenant the snapshot payload and
 * per-seat client events must be deep-equal to its pre-migration stack —
 * pinned by that tenant's golden wire fixture (e.g.
 * dark-mini-xiangqi-golden-wire.parkedtest.ts).
 */

import type { ClockPolicyKind, RoomTimeControl } from '@mistboard/game';
import { clockPolicyKindFor, isAbortReason, maybeGameSpecForId } from '@mistboard/game';
import { countDeployGatingRooms } from '../deploy-gate.js';
import {
  firstPartyBotForEngine,
  firstPartyBotForId,
  type LiveSeatProfile,
} from '../first-party-bots.js';
import { roomViewPolicy } from '../server-policy.js';
import type {
  TenantClientEvent,
  TenantClockState,
  TenantEndReason,
  TenantGameStateLike,
  TenantGameStatus,
  TenantProjection,
  TenantRoomEvent,
  TenantRuntimeRoom,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './tenant.js';
import { assertForfeitPolicy, forfeitWinnerOf, lastSeat, tenantSeatMayAct } from './tenant.js';

export type TenantRoomCreation<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
> =
  | { ok: true; room: TenantRuntimeRoom<Kind, C, M, State, Spec> }
  | { ok: false; error: 'disabled' };

export type TenantRoomHydration<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
> =
  | { ok: true; room: TenantRuntimeRoom<Kind, C, M, State, Spec> }
  | { ok: false; error: 'empty_event_log' | 'invalid_event_log' };

export function isTenantRoomId(tenant: { roomIdPrefix: string }, roomId: string): boolean {
  return roomId.startsWith(tenant.roomIdPrefix);
}

export function createTenantClock<C extends string>(
  tenant: { colors: readonly C[] },
  initialMs: number,
  incrementMs: number,
): TenantClockState<C> {
  const remainingMs = {} as Record<C, number>;
  for (const color of [...tenant.colors].sort()) remainingMs[color] = initialMs;
  return {
    activeColor: null,
    incrementMs,
    initialMs,
    remainingMs,
    runningSince: null,
  };
}

export function nextTenantClockForMove<C extends string>(
  tenant: { colors: readonly C[]; armsClockOnFirstMove?: boolean },
  clock: TenantClockState<C> | undefined,
  at: number,
  movedColor: C,
  prevMoveNumber: number,
  nextStatus: TenantGameStatus<C>,
  policy: ClockPolicyKind = 'live',
): TenantClockState<C> | undefined {
  if (!clock) return clock;
  if (clock.activeColor === null && clock.runningSince === null) {
    const remainingMs = {
      ...clock.remainingMs,
      [movedColor]: clock.remainingMs[movedColor] + clock.incrementMs,
    };
    // Arms once the LAST seat has completed the first go-around. For two seats
    // that is the second mover.
    //
    // `prevMoveNumber === 1` is a two-seat proxy for "everyone has had a go",
    // and it is not one anywhere else. Mahjong counts a move per ACTION rather
    // than per turn (draw, discard, claim, pass), so no move-number threshold
    // marks the first go-around at all: the condition was never true and the
    // clock never started. A tenant whose clock should run from the opening
    // move says so instead.
    const armsNow = tenant.armsClockOnFirstMove
      ? prevMoveNumber === 0
      : movedColor === lastSeat(tenant) && prevMoveNumber === 1;
    if (armsNow && nextStatus.type === 'playing') {
      return { ...clock, activeColor: nextStatus.turn, remainingMs, runningSince: at };
    }
    return { ...clock, remainingMs };
  }
  if (clock.activeColor !== movedColor || clock.runningSince === null) return clock;
  const remaining = Math.max(0, tenantClockRemainingMs(clock, movedColor, at));
  const nextActiveColor = nextStatus.type === 'playing' ? nextStatus.turn : null;
  // A game-ending move keeps the spent value under both policies; the
  // days-per-move reset only matters when the mover will move again.
  const moverNextMs =
    nextStatus.type !== 'playing'
      ? remaining
      : policy === 'days-per-move'
        ? clock.initialMs
        : remaining + clock.incrementMs;
  return {
    ...clock,
    activeColor: nextActiveColor,
    remainingMs: {
      ...clock.remainingMs,
      [movedColor]: moverNextMs,
    },
    runningSince: nextActiveColor ? at : null,
  };
}

export function expireTenantClock<C extends string>(
  clock: TenantClockState<C> | undefined,
  at: number,
  color: C,
): TenantClockState<C> | undefined {
  if (!clock) return clock;
  return {
    ...clock,
    activeColor: null,
    remainingMs: {
      ...clock.remainingMs,
      [color]: Math.max(0, tenantClockRemainingMs(clock, color, at)),
    },
    runningSince: null,
  };
}

export function freezeTenantClock<C extends string>(
  clock: TenantClockState<C> | undefined,
  at: number,
): TenantClockState<C> | undefined {
  if (!clock) return clock;
  if (clock.activeColor === null && clock.runningSince === null) return clock;
  const active = clock.activeColor;
  const remainingMs = { ...clock.remainingMs };
  if (active) remainingMs[active] = Math.max(0, tenantClockRemainingMs(clock, active, at));
  return {
    ...clock,
    activeColor: null,
    remainingMs,
    runningSince: null,
  };
}

export function tenantClockRemainingMs<C extends string>(
  clock: TenantClockState<C>,
  color: C,
  at: number,
): number {
  const remaining = clock.remainingMs[color];
  if (clock.activeColor !== color || clock.runningSince === null) return remaining;
  return Math.max(0, remaining - Math.max(0, at - clock.runningSince));
}

export function createTenantRuntimeRoom<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  roomId: string,
  options: {
    creatorPreference?: C | 'random';
    now?: number;
    pveBotId?: string;
    rated?: boolean;
    timeControl?: RoomTimeControl;
  } = {},
): TenantRoomCreation<Kind, C, M, State, Spec> {
  // A tenant with more than two seats that has not said what a forfeit does
  // would hang the first room where a connection dropped. Fail on the first
  // room rather than discovering it mid-game.
  assertForfeitPolicy(tenant);
  if (!tenant.enabled()) return { ok: false, error: 'disabled' };

  const now = options.now ?? Date.now();
  const setup = tenant.rules.createSetup?.();
  const events: TenantRoomEvent<C, M, Spec>[] = [
    {
      type: 'room-created',
      at: now,
      roomId,
      gameSpecId: tenant.gameSpecId,
      ...(options.creatorPreference ? { creatorPreference: options.creatorPreference } : {}),
      ...(options.pveBotId ? { pveBotId: options.pveBotId } : {}),
      ...(options.rated ? { rated: true } : {}),
      ...(options.timeControl ? { timeControl: options.timeControl } : {}),
      ...(setup !== undefined ? { setup } : {}),
    },
  ];
  if (options.timeControl) {
    events.push({
      type: 'clock-started',
      at: now,
      roomId,
      clock: createTenantClock(
        tenant,
        options.timeControl.initialMs,
        options.timeControl.incrementMs,
      ),
    });
  }
  const hydrated = createTenantRuntimeRoomFromEvents(tenant, events);
  if (!hydrated.ok) throw new Error(`failed to create ${tenant.kind} room: ${hydrated.error}`);
  return { ok: true, room: hydrated.room };
}

export function createTenantRuntimeRoomFromEvents<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  events: readonly TenantRoomEvent<C, M, Spec>[],
  projection = replayTenantEvents(tenant, events),
): TenantRoomHydration<Kind, C, M, State, Spec> {
  if (events.length === 0) return { ok: false, error: 'empty_event_log' };
  if (!isTenantEventLog(tenant, events)) return { ok: false, error: 'invalid_event_log' };
  const first = events[0]!;
  const pveBotId = first.type === 'room-created' ? (first.pveBotId ?? null) : null;
  return {
    ok: true,
    room: {
      kind: tenant.kind,
      id: first.roomId,
      clients: new Set(),
      events: [...events],
      projection,
      gameSpecId: tenant.gameSpecId,
      rated: projection.rated,
      abortTimer: null,
      abortDeadline: null,
      abortPhase: null,
      clockTimer: null,
      forfeitTimer: null,
      actionTimer: null,
      forfeitDeadline: null,
      forfeitSeat: null,
      gameEndRecorded:
        projection.state.status.type === 'finished' || projection.state.status.type === 'aborted',
      pendingWrites: Promise.resolve(),
      seatTokens: {},
      rematch: { offers: {} },
      engineTimer: null,
      engineReservationId: null,
      pveBotId,
    },
  };
}

// Event types whose apply step has a REJECTION semantic: each guards on status
// or turn and returns the projection unchanged when it refuses. For these, an
// unchanged projection means "not part of the game" and the event must not be
// recorded. Everything else (and any type added later that this list does not
// know about) is appended unconditionally, so a new informational event cannot
// be silently dropped by an identity check it was never designed for.
const REJECTABLE_EVENT_TYPES = new Set([
  'move-played',
  'setup-submitted',
  'clock-started',
  'clock-expired',
  'seat-resigned',
  'game-aborted',
  'seat-forfeited',
]);

/**
 * Did the projection accept this event? Only meaningful for the types above.
 *
 * This exists because room.events and room.projection could disagree. The
 * projection drops an out-of-turn move; the event array kept it anyway, and the
 * event array is what the engine adapter replays into Fairy-Stockfish. On
 * 2026-09-03 a double-submitted move in a Fortress room made those two differ by
 * three plies, FSF searched a stale position, proposed a move illegal in the real
 * one, and the guard resigned the bot's seat.
 */
export function tenantEventWasAccepted<C extends string, M, Spec extends string>(
  before: unknown,
  after: unknown,
  event: TenantRoomEvent<C, M, Spec>,
): boolean {
  if (!REJECTABLE_EVENT_TYPES.has(event.type)) return true;
  return after !== before;
}

export function appendTenantRuntimeEvent<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  event: TenantRoomEvent<C, M, Spec>,
): number {
  // Apply BEFORE pushing: a rejected event is not part of the game and must not
  // enter room.events, which is the history the engine adapter replays.
  const next = applyTenantEvent(tenant, room.projection, event);
  if (!tenantEventWasAccepted(room.projection, next, event)) return -1;
  room.events.push(event);
  room.projection = next;
  return room.events.length - 1;
}

export function replayTenantEvents<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  events: readonly TenantRoomEvent<C, M, Spec>[],
): TenantProjection<C, State, Spec> {
  const first = events[0];
  const firstRoomId = first?.roomId ?? 'unknown-room';
  // Seed from the room-created event rather than from nothing.
  //
  // The seed used to be built with no arguments past the room id, which called
  // createInitialState with `setup` undefined on every replay, for every
  // tenant. Tenants whose setup is server-secret (a jieqi deal, a mahjong wall)
  // therefore dealt a whole throwaway game before the event carrying the real
  // one was applied a line later. Harmless where a tenant tolerates a missing
  // setup, fatal where it refuses one, and wasted work in both cases.
  const seed =
    first?.type === 'room-created'
      ? initialTenantProjection(
          tenant,
          first.roomId,
          first.timeControl,
          first.creatorPreference,
          first.rated === true,
          first.setup,
        )
      : initialTenantProjection(tenant, firstRoomId);
  return events.reduce((projection, event) => applyTenantEvent(tenant, projection, event), seed);
}

/**
 * Finish a game whose loser is known. Throws when the tenant has no answer,
 * which assertForfeitPolicy makes unreachable by refusing to register such a
 * tenant at all. Belt and braces: the alternative is a silently hung room.
 */
function finishByForfeit<C extends string, State>(
  tenant: {
    kind: string;
    colors: readonly C[];
    oppositeColor(color: C): C;
    forfeitWinner?(color: C): C | null;
    rules: {
      finish(state: State, winner: C, reason: TenantEndReason): State;
      finishNoWinner?(state: State, reason: TenantEndReason): State;
    };
  },
  state: State,
  forfeiting: C,
  reason: TenantEndReason,
): State {
  const winner = forfeitWinnerOf(tenant, forfeiting);
  if (winner === null && tenant.rules.finishNoWinner) {
    // A table of four has no "other player" to hand the game to. The hand ends
    // with nobody winning, which is a real outcome here rather than an error.
    return tenant.rules.finishNoWinner(state, reason);
  }
  if (winner === null) {
    throw new Error(
      `tenant ${tenant.kind}: ${reason} by ${forfeiting} has no winner and no abort path`,
    );
  }
  return tenant.rules.finish(state, winner, reason);
}

export function applyTenantEvent<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  projection: TenantProjection<C, State, Spec>,
  event: TenantRoomEvent<C, M, Spec>,
): TenantProjection<C, State, Spec> {
  if (event.roomId !== projection.roomId) return projection;
  const status: TenantGameStatus<C> = projection.state.status;
  if (event.type === 'room-created') {
    return initialTenantProjection(
      tenant,
      event.roomId,
      event.timeControl,
      event.creatorPreference,
      event.rated === true,
      event.setup,
    );
  }
  if (event.type === 'seat-assigned') {
    return {
      ...projection,
      seats: {
        ...projection.seats,
        [event.seat]: event.clientId,
      },
    };
  }
  if (event.type === 'seat-vacated') {
    if (projection.seats[event.seat] !== event.clientId) return projection;
    const seats = { ...projection.seats };
    delete seats[event.seat];
    return { ...projection, seats };
  }
  if (event.type === 'setup-submitted') {
    if (status.type !== 'setup' || !tenant.setupSubmission) return projection;
    if (!tenant.setupSubmission.isSetup(event.setup)) return projection;
    return {
      ...projection,
      state: tenant.setupSubmission.applySetup(projection.state, event.color, event.setup),
    };
  }
  if (event.type === 'clock-started') {
    if (status.type === 'finished' || status.type === 'aborted' || projection.clock)
      return projection;
    return { ...projection, clock: event.clock };
  }
  if (event.type === 'move-played') {
    if (status.type !== 'playing') return projection;
    // Same predicate the live path uses, so a replayed claim is accepted by
    // exactly the states that accepted it live.
    if (!tenantSeatMayAct(tenant, projection.state, event.color)) return projection;
    const prevMoveNumber = projection.state.moveNumber;
    const nextState = tenant.rules.applyMove(projection.state, event.move);
    return {
      ...projection,
      clock:
        event.clock ??
        nextTenantClockForMove(
          tenant,
          projection.clock,
          event.at,
          event.color,
          prevMoveNumber,
          nextState.status,
          clockPolicyKindFor(projection.timeControl),
        ),
      state: nextState,
    };
  }
  if (event.type === 'clock-expired') {
    if (status.type !== 'playing') return projection;
    return {
      ...projection,
      clock: event.clock,
      state: finishByForfeit(tenant, projection.state, event.color, 'timeout'),
    };
  }
  if (event.type === 'seat-resigned') {
    if (status.type !== 'playing') return projection;
    return {
      ...projection,
      clock: event.clock ?? freezeTenantClock(projection.clock, event.at),
      state: finishByForfeit(tenant, projection.state, event.color, 'resignation'),
    };
  }
  if (event.type === 'game-aborted') {
    if (status.type !== 'playing') return projection;
    if (projection.state.moveNumber !== 1) return projection;
    return {
      ...projection,
      clock: event.clock ?? freezeTenantClock(projection.clock, event.at),
      state: tenant.rules.abort(projection.state, event.reason),
    };
  }
  if (event.type === 'seat-forfeited') {
    if (status.type !== 'playing') return projection;
    return {
      ...projection,
      clock: event.clock ?? freezeTenantClock(projection.clock, event.at),
      state: finishByForfeit(tenant, projection.state, event.color, 'abandonment'),
    };
  }
  return projection;
}

// The full per-seat snapshot wire shape. Pinned per tenant by its golden wire
// fixture; key-set changes here are protocol changes for every tenant.
// The CORE per-seat snapshot shape every tenant shares. Variant-specific
// fields (DMX: mode/pveEngineId/rated/forfeitDeadline/rematch; Dark Xiangqi:
// none) come from tenant.wire.snapshotExtras and are spread on top — each
// tenant's full shape is pinned by its golden wire fixture.
export type TenantSnapshotPayload<C extends string, M, View, Spec extends string = string> = {
  type: 'snapshot';
  roomId: string;
  gameSpecId: Spec;
  serverAt: number;
  clients: number;
  seat: TenantSeat<C>;
  solo: boolean;
  abortDeadline: number | null;
  clock: TenantClockState<C> | undefined;
  connectedSeats: Record<C, boolean>;
  events: TenantClientEvent<C, M, Spec>[];
  seats: Partial<Record<C, string>>;
  // Public per-seat player names for room chrome: bot/engine display name for
  // engine seats, account displayName/handle for signed-in humans. Guests are
  // OMITTED (clients fall back to the seat label), never a placeholder.
  seatDisplayNames: Partial<Record<C, string>>;
  // Where each of those names links (see tenantSeatProfiles). Same omission
  // rule: a seat with no public page is absent, not null.
  seatProfiles: Partial<Record<C, LiveSeatProfile>>;
  state: View;
  timeControl: RoomTimeControl | undefined;
};

// Resolves the same names tenantParticipant persists, but for the LIVE wire
// (from the in-memory room, before any game record exists). Names are public
// info: every client, spectators included, receives the same map.
export function tenantSeatDisplayNames<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
): Partial<Record<C, string>> {
  const names: Partial<Record<C, string>> = {};
  for (const color of tenant.colors) {
    const clientId = room.projection.seats[color];
    if (clientId && tenant.engine?.isEngineClientId(clientId)) {
      const bot = room.pveBotId
        ? firstPartyBotForId(room.pveBotId)
        : firstPartyBotForEngine(clientId);
      names[color] = bot?.displayName ?? tenant.engine.displayName(clientId);
      continue;
    }
    const token = room.seatTokens[color];
    const name = token?.userDisplayName ?? token?.userHandle;
    if (name) names[color] = name;
  }
  return names;
}

// The linkable profile behind each seat, the companion to tenantSeatDisplayNames.
// It repeats that function's resolution order EXACTLY -- pveBotId first, then the
// engine's bot, then the seat token -- so the name a client renders and the page
// it links to can never come from different sources. A seat with no public page
// (a guest, or an engine with no first-party bot fronting it) is omitted.
export function tenantSeatProfiles<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
): Partial<Record<C, LiveSeatProfile>> {
  const profiles: Partial<Record<C, LiveSeatProfile>> = {};
  for (const color of tenant.colors) {
    const clientId = room.projection.seats[color];
    if (clientId && tenant.engine?.isEngineClientId(clientId)) {
      const bot = room.pveBotId
        ? firstPartyBotForId(room.pveBotId)
        : firstPartyBotForEngine(clientId);
      if (bot) profiles[color] = { botId: bot.id };
      continue;
    }
    const handle = room.seatTokens[color]?.userHandle;
    if (handle) profiles[color] = { handle };
  }
  return profiles;
}

export function tenantSnapshotPayload<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  client: TenantSnapshotClient<C>,
): TenantSnapshotPayload<C, M, View, Spec> & Record<string, unknown> {
  // Board half of the finished-game reveal, paired with the event half in
  // tenantClientEvents. Both consult the same roomViewPolicy so a finished room
  // can never hand out a full move list beside an empty board, which is what a
  // one-sided change produces.
  const reveal = tenantRoomRevealsTruth(tenant, room, client);
  const state =
    reveal && tenant.visibility.truthView
      ? tenant.visibility.truthView(room.projection.state, room.events)
      : tenant.visibility.viewForClient(room.projection.state, client, room.events);
  return {
    type: 'snapshot' as const,
    roomId: room.id,
    gameSpecId: room.gameSpecId,
    serverAt: Date.now(),
    clients: room.clients.size,
    seat: client.seat,
    solo: client.solo,
    abortDeadline: room.abortDeadline,
    clock: room.projection.clock,
    connectedSeats: computeTenantConnectedSeats(tenant, room.clients, room.projection.seats),
    events: tenantEventsForClient(tenant, room, client),
    seats: room.projection.seats,
    seatDisplayNames: tenantSeatDisplayNames(tenant, room),
    seatProfiles: tenantSeatProfiles(tenant, room),
    state,
    timeControl: room.projection.timeControl,
    ...(tenant.wire?.snapshotExtras?.(room, client) ?? {}),
  };
}

export function tenantRematchOfferFlags<C extends string>(
  tenant: { colors: readonly C[] },
  room: { rematch: { offers: Partial<Record<C, unknown>> } },
): Record<C, boolean> {
  const flags = {} as Record<C, boolean>;
  for (const color of tenant.colors) flags[color] = room.rematch.offers[color] !== undefined;
  return flags;
}

// Every seat but the leaver learns the forfeit deadline, so the "you win in Ns"
// banner never leaks to the leaver itself.
//
// This asked oppositeColor for "the winner" until 2026-09-11, which is a
// question with no answer at a table of four, and mahjong's oppositeColor
// throws rather than inventing one. Asking instead who is NOT leaving gives the
// same answer for two seats and a correct one for four.
export function tenantForfeitDeadlineForClient<C extends string>(
  _tenant: unknown,
  room: { forfeitSeat: C | null; forfeitDeadline: number | null },
  client: { seat: TenantSeat<C> },
): number | null {
  if (room.forfeitSeat === null) return null;
  if (client.seat === 'spectator' || client.seat === room.forfeitSeat) return null;
  return room.forfeitDeadline;
}

export function tenantPveEngineId<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
): string | null {
  if (!tenant.engine) return null;
  for (const seat of tenant.colors) {
    const clientId = room.projection.seats[seat];
    if (tenant.engine.isEngineClientId(clientId)) return clientId ?? null;
  }
  return null;
}

export function tenantEventsForClient<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  client: TenantSnapshotClient<C>,
): TenantClientEvent<C, M, Spec>[] {
  const out: TenantClientEvent<C, M, Spec>[] = [];
  // A finished game hands every client the whole log, unredacted. This is the
  // event half of the same matrix row that opens the board (see
  // docs-private/spectator-visibility-matrix.md); without it a spectator on a
  // finished fog room gets the truth board and an EMPTY move list, because
  // clientEventFor strips every move-played event the viewer did not own.
  //
  // Gated here rather than inside each tenant's clientEventFor because this is
  // the replay path: the whole log is rebuilt for a client on join and on
  // reconnect, so a rule applied only to the live broadcast would be silently
  // wrong exactly here. The runtime is also the layer holding canonical status,
  // which is what the decision has to read.
  const reveal = tenantRoomRevealsTruth(tenant, room, client);
  let ply = 0;
  for (const event of room.events) {
    if (event.type === 'move-played') ply += 1;
    const visible = reveal
      ? ((event.type === 'move-played'
          ? { ...event, ply }
          : revealedNonMoveEvent(event)) as TenantClientEvent<C, M, Spec>)
      : tenant.visibility.clientEventFor(event, client.seat, ply);
    if (visible) out.push(visible);
  }
  return out;
}

// Revealing a finished game opens the MOVE LOG, not the server's bookkeeping.
// `room-created.setup` is the per-game deal: a crypto secret the tenants strip
// from every client event, and the one field a naive "send the raw log" reveal
// would leak by accident. It stays stripped, because the truth board already
// carries the identities it would have told you. Same information to a reader,
// one less internal field on the wire.
function revealedNonMoveEvent<C extends string, M, Spec extends string>(
  event: TenantRoomEvent<C, M, Spec>,
): TenantRoomEvent<C, M, Spec> {
  if (event.type !== 'room-created' || event.setup === undefined) return event;
  const redacted = { ...event };
  delete redacted.setup;
  return redacted;
}

function tenantRoomRevealsTruth<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  client: TenantSnapshotClient<C>,
): boolean {
  const spec = maybeGameSpecForId(tenant.gameSpecId);
  if (!spec) return false;
  // A tenant reveals as a unit or not at all. Requiring truthView here is what
  // keeps the board and the event log in step: without it, a tenant that has
  // not implemented truthView would still get its events unredacted by the
  // policy above and serve a full move list beside a blank board.
  //
  // Perfect-information tenants are unaffected. They implement no truthView and
  // do not need one: viewForClient already returns everything and their
  // clientEventFor passes every event through, so the un-revealed path is
  // already full disclosure for them.
  if (!tenant.visibility.truthView) return false;
  return (
    roomViewPolicy(
      spec.visibility,
      room.projection.state.status.type === 'finished',
      client.seat === 'spectator' ? 'spectator' : 'player',
    ) === 'truth'
  );
}

export function tenantPlyAtEventIndex(
  events: readonly { type: string }[],
  eventIndex: number,
): number {
  let ply = 0;
  for (let index = 0; index <= eventIndex && index < events.length; index += 1) {
    if (events[index]?.type === 'move-played') ply += 1;
  }
  return ply;
}

export function isTenantEventLog<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  events: readonly unknown[],
  roomId?: string,
): events is readonly TenantRoomEvent<C, M, Spec>[] {
  const firstRoomId = roomId ?? roomIdFromUnknownEvent(events[0]);
  if (!firstRoomId) return false;
  const [created, ...rest] = events;
  if (
    !isTenantEvent(tenant, created, firstRoomId) ||
    created.type !== 'room-created' ||
    !isAcceptedGameSpecId(tenant, created.gameSpecId) ||
    !isFiniteTimestamp(created.at)
  ) {
    return false;
  }
  return rest.every((event) => isTenantEvent(tenant, event, firstRoomId));
}

export function isTenantEvent<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  value: unknown,
  roomId?: string,
): value is TenantRoomEvent<C, M, Spec> {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  if (typeof event.roomId !== 'string') return false;
  if (roomId !== undefined && event.roomId !== roomId) return false;
  if (!isFiniteTimestamp(event.at)) return false;
  if (event.type === 'room-created') {
    return (
      isAcceptedGameSpecId(tenant, event.gameSpecId) &&
      (event.creatorPreference === undefined ||
        event.creatorPreference === 'random' ||
        tenant.rules.isColor(event.creatorPreference)) &&
      (event.pveBotId === undefined || typeof event.pveBotId === 'string') &&
      (event.rated === undefined || typeof event.rated === 'boolean') &&
      (event.timeControl === undefined || isRoomTimeControl(event.timeControl))
    );
  }
  if (event.type === 'seat-assigned') {
    return typeof event.clientId === 'string' && tenant.rules.isColor(event.seat);
  }
  if (event.type === 'seat-vacated') {
    return (
      tenant.wire?.acceptsSeatVacated === true &&
      typeof event.clientId === 'string' &&
      tenant.rules.isColor(event.seat)
    );
  }
  if (event.type === 'setup-submitted') {
    return (
      tenant.setupSubmission !== undefined &&
      tenant.rules.isColor(event.color) &&
      tenant.setupSubmission.isSetup(event.setup)
    );
  }
  if (event.type === 'clock-started') {
    return isTenantClockState(tenant, event.clock);
  }
  if (event.type === 'clock-expired') {
    return tenant.rules.isColor(event.color) && isTenantClockState(tenant, event.clock);
  }
  if (event.type === 'move-played') {
    return (
      tenant.rules.isColor(event.color) &&
      tenant.rules.isMove(event.move) &&
      (event.clock === undefined || isTenantClockState(tenant, event.clock))
    );
  }
  if (event.type === 'seat-resigned') {
    return (
      tenant.rules.isColor(event.color) &&
      (event.clock === undefined || isTenantClockState(tenant, event.clock))
    );
  }
  if (event.type === 'game-aborted') {
    return (
      isAbortReason(event.reason) &&
      (event.clock === undefined || isTenantClockState(tenant, event.clock))
    );
  }
  if (event.type === 'seat-forfeited') {
    return (
      tenant.rules.isColor(event.color) &&
      (event.clock === undefined || isTenantClockState(tenant, event.clock))
    );
  }
  return false;
}

function initialTenantProjection<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  roomId: string,
  timeControl?: RoomTimeControl,
  creatorPreference?: C | 'random',
  rated = false,
  setup?: unknown,
): TenantProjection<C, State, Spec> {
  return {
    roomId,
    ...(creatorPreference ? { creatorPreference } : {}),
    gameSpecId: tenant.gameSpecId,
    rated,
    state: tenant.rules.createInitialState(roomId, setup),
    seats: {},
    ...(timeControl ? { timeControl } : {}),
  };
}

// Persisted room-created events may carry a pre-rename spec alias
// (wire.legacyGameSpecIds); everything the runtime writes is canonical.
function isAcceptedGameSpecId(
  tenant: { gameSpecId: string; wire?: { legacyGameSpecIds?: readonly string[] } },
  value: unknown,
): boolean {
  if (value === tenant.gameSpecId) return true;
  return typeof value === 'string' && (tenant.wire?.legacyGameSpecIds?.includes(value) ?? false);
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRoomTimeControl(value: unknown): value is RoomTimeControl {
  if (typeof value !== 'object' || value === null) return false;
  const timeControl = value as Partial<Record<keyof RoomTimeControl, unknown>>;
  return (
    typeof timeControl.initialMs === 'number' &&
    Number.isInteger(timeControl.initialMs) &&
    typeof timeControl.incrementMs === 'number' &&
    Number.isInteger(timeControl.incrementMs)
  );
}

export function isTenantClockState<C extends string>(
  tenant: { colors: readonly C[]; rules: { isColor(value: unknown): value is C } },
  value: unknown,
): value is TenantClockState<C> {
  if (typeof value !== 'object' || value === null) return false;
  const clock = value as Partial<TenantClockState<C>>;
  if (!(clock.activeColor === null || tenant.rules.isColor(clock.activeColor))) return false;
  if (typeof clock.initialMs !== 'number' || !Number.isFinite(clock.initialMs)) return false;
  if (typeof clock.incrementMs !== 'number' || !Number.isFinite(clock.incrementMs)) return false;
  if (!(typeof clock.runningSince === 'number' || clock.runningSince === null)) return false;
  if (typeof clock.remainingMs !== 'object' || clock.remainingMs === null) return false;
  const remaining = clock.remainingMs as Partial<Record<C, unknown>>;
  for (const color of tenant.colors) {
    const ms = remaining[color];
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return false;
  }
  return true;
}

// Live in-progress games in a tenant's room map, for the registration's
// activeGameCount binding. Correspondence (days-per-move) rooms are excluded on
// purpose: this count is the deploy drain gate, and a multi-week correspondence
// game must never pin it above zero (its deadline is durable via the sweeper,
// and a mid-deploy reconnect is invisible at days-per-move cadence).
//
// The predicate itself lives in deploy-gate.ts so this half of the gate and the
// chess map agree on what "live" means. They used to disagree: this side
// dropped correspondence and the chess side didn't, so a single chess
// correspondence room could block every deploy forever.
export function countActiveTenantGames(
  rooms: Iterable<{
    events?: readonly { at?: number }[];
    projection: { state: { status: { type: string } }; timeControl?: RoomTimeControl };
  }>,
): number {
  return countDeployGatingRooms(rooms);
}

export function computeTenantConnectedSeats<C extends string>(
  tenant: {
    colors: readonly C[];
    engine?: { isEngineClientId(clientId: string | undefined): boolean };
  },
  clients: Iterable<{ seat: TenantSeat<C>; displaced: boolean }>,
  seats: Partial<Record<C, string>> = {},
): Record<C, boolean> {
  const connected = {} as Record<C, boolean>;
  for (const color of tenant.colors) connected[color] = false;
  for (const client of clients) {
    if (client.displaced) continue;
    if (client.seat !== 'spectator') connected[client.seat as C] = true;
  }
  // PvE: the engine seat holds no WS client but is always present — show it as
  // connected so the human doesn't see the engine as "offline".
  if (tenant.engine) {
    for (const seat of tenant.colors) {
      if (tenant.engine.isEngineClientId(seats[seat])) connected[seat] = true;
    }
  }
  return connected;
}

function roomIdFromUnknownEvent(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const roomId = (value as Record<string, unknown>).roomId;
  return typeof roomId === 'string' ? roomId : undefined;
}
