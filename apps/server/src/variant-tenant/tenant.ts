/**
 * VariantTenant — the Layer-3 live-room tenant contract.
 *
 * Extracted 2026-06-11 from the four sibling live stacks (dark chess, Dark
 * Mini Xiangqi, Dark Xiangqi), whose runtime/events/
 * lifecycle/seat-session/ws files are 70-90% identical. The generic modules in
 * this directory hold that shared plumbing once, parameterized by a tenant:
 *
 *   - the rules module is the type boundary: the runtime only calls the
 *     opaque callbacks under `rules` and `visibility`, and only reads the
 *     structural slice of game state declared by TenantGameStateLike
 *     (status / moveNumber / lastMove). It never constructs variant state
 *     directly — terminal states go through rules.finish / rules.abort.
 *   - per-seat redaction is tenant policy: visibility.clientEventFor decides
 *     which wire events a seat may see (fog tenants hide opponent moves;
 *     perfect-info tenants pass them through) and visibility.viewForClient
 *     builds the seat's PlayerView, including the spectator policy.
 *   - everything color-shaped is keyed by the tenant's `colors` tuple in move
 *     order; the clock arms after the second mover's first move.
 *
 * Reference implementations: dark-xiangqi-tenant.ts (fog) and jieqi-tenant.ts
 * (hidden identity). Migration order and gates:
 * docs-private/variant-generalization-track.md.
 */

import type { AbortReason, RoomTimeControl } from '@mistboard/game';
import type * as persistence from '../persistence.js';

export type TenantSeat<C extends string> = C | 'spectator';

// The structural slice of variant game status the generic runtime reads.
// Every sibling stack's status union already has this exact shape.
export type TenantGameStatus<C extends string> =
  | { type: 'playing'; turn: C }
  | { type: 'finished'; winner: C | null; reason: string }
  | { type: 'aborted'; reason: AbortReason };

export type TenantGameStateLike<C extends string> = {
  status: TenantGameStatus<C>;
  moveNumber: number;
  lastMove?: unknown;
};

// Terminal reasons the GENERIC runtime itself can produce (clock expiry,
// resign, abandonment). Rules-produced endings (checkmate, king-captured,
// race, ...) never pass through here — they come out of rules.applyMove.
export type TenantEndReason = 'timeout' | 'resignation' | 'abandonment';

/**
 * A move the game will make FOR a seat when a wait runs out, and the absolute
 * time that happens.
 *
 * A mahjong claim window is the case this exists for: after a discard, up to
 * three seats may claim the tile, and the hand cannot continue until each has
 * answered. One player closing their laptop must not hang the table, so silence
 * has to become an answer on a deadline.
 *
 * It is a real move by a real seat, appended as an ordinary move-played event,
 * so a replayed game takes the same path as the live one and a spectator sees
 * why the turn moved.
 */
export type TenantPendingAction<C extends string, M> = { at: number; color: C; move: M };

export type TenantEngineTerminalContext =
  | 'full-history'
  | 'repetition-window'
  | 'repetition-seed'
  | 'fog-observation';

export type TenantClockState<C extends string> = {
  activeColor: C | null;
  incrementMs: number;
  initialMs: number;
  remainingMs: Record<C, number>;
  runningSince: number | null;
};

export type TenantRoomEvent<C extends string, M, Spec extends string = string> =
  | {
      type: 'room-created';
      at: number;
      roomId: string;
      gameSpecId: Spec;
      creatorPreference?: C | 'random';
      rated?: boolean;
      pveBotId?: string;
      timeControl?: RoomTimeControl;
      // Server-secret per-game setup (e.g. a jieqi deal). Produced by
      // rules.createSetup at room creation, persisted here as the replay source
      // of truth, and consumed by rules.createInitialState. Tenants with hidden
      // setup MUST strip this in visibility.clientEventFor — it is never sent to
      // a client. Tenants without createSetup never set it.
      setup?: unknown;
    }
  | { type: 'seat-assigned'; at: number; roomId: string; clientId: string; seat: C }
  // Accepted in event logs only for tenants with wire.acceptsSeatVacated
  // (Dark Xiangqi); clears the seat when the vacating clientId still holds it.
  | { type: 'seat-vacated'; at: number; roomId: string; clientId: string; seat: C }
  | { type: 'clock-started'; at: number; roomId: string; clock: TenantClockState<C> }
  | { type: 'clock-expired'; at: number; roomId: string; color: C; clock: TenantClockState<C> }
  | {
      type: 'move-played';
      at: number;
      roomId: string;
      color: C;
      move: M;
      clock?: TenantClockState<C>;
    }
  | { type: 'seat-resigned'; at: number; roomId: string; color: C; clock?: TenantClockState<C> }
  | {
      type: 'game-aborted';
      at: number;
      roomId: string;
      reason: AbortReason;
      clock?: TenantClockState<C>;
    }
  | { type: 'seat-forfeited'; at: number; roomId: string; color: C; clock?: TenantClockState<C> };

// Wire-side event: move-played gains its 1-based ply so clients can sequence.
export type TenantClientEvent<C extends string, M, Spec extends string = string> =
  | Exclude<TenantRoomEvent<C, M, Spec>, { type: 'move-played' }>
  | (Extract<TenantRoomEvent<C, M, Spec>, { type: 'move-played' }> & { ply: number });

export type TenantProjection<
  C extends string,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
> = {
  roomId: string;
  creatorPreference?: C | 'random';
  gameSpecId: Spec;
  rated: boolean;
  state: State;
  seats: Partial<Record<C, string>>;
  clock?: TenantClockState<C>;
  timeControl?: RoomTimeControl;
};

export type TenantClientRef<C extends string> = {
  id?: string;
  seat: TenantSeat<C>;
  displaced: boolean;
};

export type TenantSeatTokenState<C extends string> = {
  clientId: string;
  // See SeatTokenState.deviceId.
  deviceId?: string | null;
  seat: C;
  tokenHash: string;
  userId: string | null;
  userHandle: string | null;
  userDisplayName: string | null;
  issuedAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

export type TenantRematchOffer = {
  tokenHash: string;
  userId: string | null;
  at: number;
};

export type TenantRematchPendingRedirect<C extends string> = {
  roomId: string;
  seat: C;
  rawToken: string;
  url: string;
};

export type TenantRematchState<C extends string> = {
  offers: Partial<Record<C, TenantRematchOffer>>;
  finalizedRoomId?: string;
  pendingRedirects?: Partial<Record<C, TenantRematchPendingRedirect<C>>>;
};

// Pregame abort phases: waiting on the first mover's move, then the second's.
// `${C}-1` = the named seat owes their first move. 'unjoined' = the room is
// still missing a seat-holder, so nobody owes a move yet and the pregame
// window has not started; it carries its own, longer deadline.
export type TenantAbortPhase<C extends string> = `${C}-1` | 'unjoined';

export type TenantRuntimeRoom<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
> = {
  kind: Kind;
  id: string;
  clients: Set<TenantClientRef<C>>;
  events: TenantRoomEvent<C, M, Spec>[];
  projection: TenantProjection<C, State, Spec>;
  gameSpecId: Spec;
  rated: boolean;
  abortTimer: ReturnType<typeof setTimeout> | null;
  abortDeadline: number | null;
  abortPhase: TenantAbortPhase<C> | null;
  clockTimer: ReturnType<typeof setTimeout> | null;
  forfeitTimer: ReturnType<typeof setTimeout> | null;
  forfeitDeadline: number | null;
  // Fires the tenant's pendingAction. Distinct from the forfeit timer: that one
  // ends the game, this one continues it.
  actionTimer: ReturnType<typeof setTimeout> | null;
  forfeitSeat: C | null;
  gameEndRecorded: boolean;
  /**
   * Debug artifacts (per-move engine decisions) an engine loop produced before
   * the games row exists. Tenants that omit recordGameStart (xiangqi, dark
   * xiangqi) insert their games row only at game end, and
   * game_debug_artifacts.game_id is a foreign key onto it, so a mid-game write
   * violates the FK (prod, 2026-09-02, every xiangqi PvE ply). The loop queues
   * here and appendTenantEvent flushes right after recordGameEnd succeeds; an
   * aborted room drops the queue, since there is no game to attach it to.
   * Memory-only: a restart mid-game loses the queue, never the game.
   */
  pendingDebugArtifacts?: persistence.GameDebugArtifactInput[];
  pendingWrites: Promise<void>;
  seatTokens: Partial<Record<C, TenantSeatTokenState<C>>>;
  rematch: TenantRematchState<C>;
  // PvE: setTimeout handle for the pending engine move (debounces the scheduler
  // so an engine seat schedules at most one move at a time). The engine SEAT
  // itself is derived from projection.seats (its slot holds an engine clientId),
  // so it survives hydration without a dedicated field.
  engineTimer: ReturnType<typeof setTimeout> | null;
  // PvE: the engine HTTP service's seat reservation for this game. Reserved at
  // creation, sent on every engine turn (the service 409s without it), released
  // on game end. Null for PvP and until reserved.
  engineReservationId: string | null;
  // PvE: bot profile that requested the engine seat. Hydrated from the initial
  // room-created event; the engine seat itself remains the executable engine id.
  pveBotId: string | null;
};

export type TenantSnapshotClient<C extends string> = {
  id: string;
  seat: TenantSeat<C>;
  solo: boolean;
};

export type VariantTenant<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string = string,
> = {
  kind: Kind;
  gameSpecId: Spec;
  roomIdPrefix: string;
  // Move order, in turn sequence starting from the first mover. Drives seat
  // iteration, summary participant order, rematch color swap, and clock arming
  // (the clock arms once the LAST seat completes the first go-around).
  //
  // Widened from a fixed pair 2026-09-10. Every existing tenant passes two and
  // behaves exactly as before; the array is what lets a four-seat game exist at
  // all. Read positions through firstSeat/lastSeat/seatAfter rather than by
  // index, so a tenant with more than two seats cannot be silently mis-read.
  colors: readonly C[];
  /**
   * Start the clock on the very first move rather than after the first
   * go-around.
   *
   * The default waits for every seat to have moved once, which chess wants so a
   * player who has only just opened the tab is not already losing time. It is
   * expressed as a move-number threshold, and that only means "everyone has had
   * a go" where one move is one turn. Set this where it is not.
   */
  armsClockOnFirstMove?: boolean;
  enabled(): boolean;
  // Only meaningful where there are exactly two seats: it answers "who wins if
  // this seat forfeits". A four-seat tenant has no such answer and must supply
  // forfeitWinner instead.
  oppositeColor(color: C): C;
  // Who is awarded the game when `color` times out or abandons. Defaults to
  // oppositeColor, which is right for two seats and undefined for more.
  forfeitWinner?(color: C): C | null;
  rules: {
    // `setup` is the server-secret per-game setup persisted in the room-created
    // event (see TenantRoomEvent.setup). Tenants without hidden setup ignore it.
    createInitialState(roomId: string, setup?: unknown): State;
    // Optional: produce the per-game server-secret setup at room creation. The
    // runtime persists the return value in the room-created event and feeds it
    // back to createInitialState (including on replay).
    createSetup?(): unknown;
    // Deliberately two parameters. Several tenants pass their kernel's own
    // applyMove straight through, and those already take a third options
    // argument, so a positional `at` here would land in that slot. A tenant
    // that needs the wall-clock (a mahjong claim window deadline) stamps it
    // onto the move in canonicalMove, which runs once on the live path and
    // persists into the event log, so replay reads the same value back.
    applyMove(state: State, move: M): State;
    isLegalMove(state: State, move: M): boolean;
    // Terminal-state constructors: the generic runtime never builds variant
    // status objects itself, so variant status unions stay variant-owned.
    finish(state: State, winner: C, reason: TenantEndReason): State;
    // How the game ends when a seat forfeits and NOBODY is awarded the win.
    // Only reachable for tenants whose forfeitWinner returns null, which means
    // tables of more than two: there is no "the other player" to hand it to.
    // Omitting it on such a tenant makes the forfeit throw rather than guess.
    finishNoWinner?(state: State, reason: TenantEndReason): State;
    abort(state: State, reason: AbortReason): State;
    isColor(value: unknown): value is C;
    isMove(value: unknown): value is M;
    // Parse + validate a move out of a raw client `move` message; null rejects.
    // STATE-FREE canonicalization (e.g. coordinate parsing) belongs here.
    // Parse a wire move, or return null. This is the validation boundary: the
    // message arrived as untyped JSON and was cast, not checked.
    moveFromMessage(message: {
      drop?: string;
      from?: string;
      to?: string;
      promotion?: string;
      // Tile games: no squares. See ClientMessage in server-ws-messages.ts.
      action?: string;
      tiles?: string[];
      /** Duck Xiangqi: a turn is a piece move AND a duck placement, sent as one
       *  message so a client that disconnects mid-placement sends nothing. */
      duckTo?: string;
    }): M | null;
    // STATE-DEPENDENT canonicalization: resolve the parsed move to the exact
    // legal-move object to append (e.g. a chess-family tenant re-attaches promotion from
    // the legal-move list). Null rejects. When omitted, the ws move path
    // appends the parsed move after an isLegalMove check instead.
    // `seat` is the mover. Every existing tenant ignores it, because in a
    // strictly alternating game the mover is state.status.turn and the move
    // carries no identity. Mahjong is the exception: a claim arrives from a
    // seat whose turn it is NOT, and applyMove receives only the state and the
    // move, so the seat has to be stamped onto the move here to survive into
    // the event log and back out on replay.
    canonicalMove?(state: State, move: M, seat: C): M | null;
    // May this seat act right now? Defaults to "it is this seat's turn".
    //
    // Mahjong is why this exists. Every other tenant is strictly alternating:
    // the seat to move moves, and anything from anyone else is dropped. A
    // mahjong discard opens a window in which up to three other seats may
    // respond, and whoever wins the window takes the turn out of order.
    //
    // Read through tenantSeatMayAct, never called directly, because BOTH the
    // live move path and the replay projection gate on it. A tenant that
    // widens one and not the other gets a room that plays one game live and a
    // different one on reconnect, which the event log will not reveal because
    // every event in it is individually valid.
    seatMayAct?(state: State, seat: C): boolean;
    // The move to make on this state's behalf if nobody acts, and when.
    // Null when the state is not waiting on anything, which is every state of
    // every strictly alternating tenant, so all of them omit this.
    //
    // Return ONE action that settles the whole wait, not one per silent seat:
    // the runtime applies a single action per firing and then re-arms from the
    // new state, so a hook that settles a four-seat window one seat at a time
    // costs four round trips through the event writer.
    pendingAction?(state: State): TenantPendingAction<C, M> | null;
  };
  visibility: {
    // Per-seat wire-event redaction. Fog tenants hide opponent moves and
    // foreign seat assignments; perfect-info tenants pass events through.
    // Returning null drops the event for that seat entirely.
    clientEventFor(
      event: TenantRoomEvent<C, M, Spec>,
      seat: TenantSeat<C>,
      ply: number,
    ): TenantClientEvent<C, M, Spec> | null;
    // The seat's redacted view, including the spectator policy. Receives the
    // event log so fog tenants can derive context (e.g. whether the viewer
    // made the latest move) without the runtime inspecting view shape.
    viewForClient(
      state: State,
      client: TenantSnapshotClient<C>,
      events: readonly TenantRoomEvent<C, M, Spec>[],
    ): View;
    // The unredacted board, served to every client once the game is FINISHED
    // (docs-private/spectator-visibility-matrix.md). The runtime decides when,
    // via roomViewPolicy; the tenant only says what truth looks like on the
    // wire, because that shape is variant-specific.
    //
    // Optional, and its absence is fail-closed: a tenant that does not
    // implement it keeps serving viewForClient forever, which is today's
    // no-reveal behaviour. Adding a tenant can therefore fail to open a board,
    // never accidentally open one.
    //
    // Perfect-information tenants do not need it. viewForClient already returns
    // everything for them, and roomViewPolicy('open', …) is 'truth' at every
    // status regardless.
    truthView?(state: State, events: readonly TenantRoomEvent<C, M, Spec>[]): View;
  };
  engine?: {
    // Required declaration of how the live engine preserves history-dependent terminal
    // semantics. Adding an engine tenant without choosing one fails typecheck. Fog engines
    // deliberately receive only their redacted observation stream, never canonical truth.
    terminalContext: TenantEngineTerminalContext;
    isEngineClientId(clientId: string | undefined): boolean;
    displayName(engineId: string): string;
    // External engine-service tenants must reacquire their per-game compute
    // reservation after process hydration. Omit for in-process engines. The
    // engine protocol names the first-mover slot `white`, even for red/black
    // variants, so the tenant owns that mapping explicitly.
    reservationColor?(color: C): 'white' | 'black';
    // Engine BUILD version for this engine id (e.g. '0.2.0'), recorded per game so PvE games
    // are queryable by build. Optional: only the variant-tenant UCI engines whose subject_id
    // is version-less (jieqi/banqi) implement it; returns null for unknown ids.
    engineVersion?(clientId: string | undefined): string | null;
    // Observability tag on engine-seat reservation releases (`<tag>-finished`).
    reservationReleaseTag: string;
  };
  // Wire-format variation points. Each tenant's full snapshot shape (core +
  // extras) is pinned by its golden wire fixture.
  wire?: {
    // Variant-specific snapshot fields spread over the core payload (e.g.
    // DMX adds mode/pveEngineId/rated/forfeitDeadline/rematch; Dark Xiangqi
    // adds nothing).
    snapshotExtras?(
      room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
      client: TenantSnapshotClient<C>,
    ): Record<string, unknown>;
    // Accept seat-vacated events when validating event logs. Off by default
    // so tenants that never emit them keep rejecting them.
    acceptsSeatVacated?: boolean;
    // Additional gameSpecId values accepted in PERSISTED room-created events
    // (pre-rename aliases). Validation-only:
    // new rooms and projections always carry the canonical tenant.gameSpecId.
    legacyGameSpecIds?: readonly string[];
    // When a client move is rejected (failed the legality / canonicalization
    // check), produce a payload to send ONLY back to the mover, or null to stay
    // silent (the default for every existing tenant). Dark Crazyhouse used it
    // for the parachute drop BOUNCE: a drop onto a square that is occupied in
    // truth is rejected, and the mover is told the square is occupied (a probe).
    rejectionFor?(state: State, move: M, seat: TenantSeat<C>): Record<string, unknown> | null;
  };
  persistence: {
    resultForWinner(winner: C | null): persistence.GameResult;
    termination(reason: string): persistence.GameTermination;
    // Full GameSummary override for tenants whose persisted record predates
    // (or deliberately diverges from) the default builder in
    // variant-tenant/events.ts. Omit to use the default.
    buildGameSummary?(room: TenantRuntimeRoom<Kind, C, M, State, Spec>): persistence.GameSummary;
    // Structured-log identity: `<logKindPrefix>_persistence_failure` etc.
    logKindPrefix: string;
    logLabel: string;
  };
};

/**
 * Whether `seat` may act on this state: the one question the live move path and
 * the replay projection must always answer identically.
 *
 * The default is strict alternation, which is what every tenant but mahjong
 * wants. Note it is false for any non-playing status, so callers do not need
 * their own status check to stay safe.
 */
export function tenantSeatMayAct<C extends string, State extends TenantGameStateLike<C>>(
  tenant: { rules: { seatMayAct?(state: State, seat: C): boolean } },
  state: State,
  seat: C,
): boolean {
  if (state.status.type !== 'playing') return false;
  if (tenant.rules.seatMayAct) return tenant.rules.seatMayAct(state, seat);
  return state.status.turn === seat;
}

/** The seat that moves first. Throws rather than returning undefined: a tenant
 *  with no seats is a programming error, not a runtime condition. */
export function firstSeat<C extends string>(tenant: { colors: readonly C[] }): C {
  const seat = tenant.colors[0];
  if (seat === undefined) throw new Error('tenant declares no seats');
  return seat;
}

/** The seat that moves last in a go-around. For two seats this is the second
 *  mover, which is what clock arming has always keyed on. */
export function lastSeat<C extends string>(tenant: { colors: readonly C[] }): C {
  const seat = tenant.colors[tenant.colors.length - 1];
  if (seat === undefined) throw new Error('tenant declares no seats');
  return seat;
}

/** The next seat in turn order, wrapping. For two seats this is the opposite. */
export function seatAfter<C extends string>(tenant: { colors: readonly C[] }, seat: C): C {
  const at = tenant.colors.indexOf(seat);
  if (at < 0) throw new Error(`seat ${seat} is not one of this tenant's seats`);
  return tenant.colors[(at + 1) % tenant.colors.length] as C;
}

/**
 * Who is awarded the game when `seat` times out, resigns or abandons.
 *
 * At two seats this is the opposite seat and always has an answer. At more it
 * may not: three players do not collectively "win" because a fourth walked
 * away, and AbortReason is a CHECK-constrained union with no value that fits a
 * mid-game forfeit, so the runtime cannot invent one either. A tenant with more
 * than two seats must therefore answer this itself.
 *
 * Null is a real answer meaning "no winner", and callers must handle it. It is
 * unreachable for every tenant that ships today.
 */
export function forfeitWinnerOf<C extends string>(
  tenant: { colors: readonly C[]; oppositeColor(color: C): C; forfeitWinner?(color: C): C | null },
  seat: C,
): C | null {
  if (tenant.forfeitWinner) return tenant.forfeitWinner(seat);
  if (tenant.colors.length === 2) return tenant.oppositeColor(seat);
  return null;
}

/**
 * Registration-time guard. A tenant with more than two seats that has not said
 * what a forfeit does is a bug that would otherwise surface as a hung game the
 * first time someone's connection dropped - fail at boot instead.
 */
export function assertForfeitPolicy<C extends string>(tenant: {
  kind: string;
  colors: readonly C[];
  forfeitWinner?(color: C): C | null;
}): void {
  if (tenant.colors.length > 2 && !tenant.forfeitWinner) {
    throw new Error(
      `tenant ${tenant.kind} has ${tenant.colors.length} seats and must implement ` +
        'forfeitWinner: oppositeColor has no meaning beyond two seats',
    );
  }
}
