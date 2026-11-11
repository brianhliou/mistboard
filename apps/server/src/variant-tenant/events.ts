import { INTERNAL_BANQI_CORPUS_ID, internalEngineTestFor } from '../internal-engine-test.js';
/**
 * Generic event writer for tenant rooms: persistence-first append serialized
 * through room.pendingWrites, lifecycle re-arming, engine-reservation release
 * on game end, and the terminal GameSummary build. Persistence kinds/labels
 * come from the tenant so structured logs keep their per-variant identity.
 */

import { clockPolicyKindFor } from '@mistboard/game';
import { engineFailureAbort } from '../engine-failure-abort.js';
import {
  firstPartyBotForEngine,
  firstPartyBotForId,
  liveSeatEngineName,
} from '../first-party-bots.js';
import { logger } from '../obs.js';
import * as persistence from '../persistence.js';
import { releaseLiveEngineReservation } from '../server-live-engine-reservations.js';
import { tenantDurableDeadlineFor } from './lifecycle.js';
import {
  appendTenantRuntimeEvent,
  applyTenantEvent,
  createTenantRuntimeRoomFromEvents,
  isTenantEventLog,
  tenantClockExpiryEventFor,
  tenantEventWasAccepted,
  tenantPauseEventFor,
} from './runtime.js';
import { tenantSeatTokenStatesFromPersistence } from './seat-session.js';
import type {
  TenantGameStateLike,
  TenantRoomEvent,
  TenantRuntimeRoom,
  TenantSeatTokenState,
  VariantTenant,
} from './tenant.js';

export type TenantEventWriterPersistence<C extends string, M, Spec extends string = string> = {
  abortRunningGame(
    roomId: string,
    options: { abortedReason: string; endedAt?: Date; termination: 'abandoned' },
  ): Promise<boolean>;
  appendRoomEvent(roomId: string, seq: number, event: TenantRoomEvent<C, M, Spec>): Promise<void>;
  deleteRoomDeadline(roomId: string): Promise<void>;
  isInitialized(): boolean;
  /**
   * The store's event log and seat tokens, read back when appendRoomEvent finds
   * its seq already taken: another server process (a deploy overlap, two dev
   * servers on one database) wrote to this room, so the in-memory copy is stale
   * and is rebuilt from these. A writer without them rethrows the conflict.
   */
  loadRoomEvents?(roomId: string): Promise<persistence.PersistedRoomEvent[] | null>;
  loadRoomSeatTokens?(
    roomId: string,
  ): Promise<
    Partial<
      Record<
        C & persistence.RoomSeatTokenSeat,
        persistence.RoomSeatTokenRecord<C & persistence.RoomSeatTokenSeat>
      >
    >
  >;
  /** Flush target for room.pendingDebugArtifacts once the games row exists. */
  recordGameDebugArtifact?(artifact: persistence.GameDebugArtifactInput): Promise<void>;
  recordGameEnd(roomId: string, summary: persistence.GameSummary): Promise<void>;
  upsertRoomDeadline(record: {
    roomId: string;
    gameSpecId: string;
    seat: string;
    seatUserId: string | null;
    dueAt: Date;
  }): Promise<void>;
  upsertRoomSeatToken(
    roomId: string,
    token: persistence.RoomSeatTokenRecord<C & persistence.RoomSeatTokenSeat>,
  ): Promise<void>;
};

export type TenantEventWriterContext<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string = string,
> = {
  logDeadlineRowFailure?(roomId: string, err: Error): void;
  logGameAbortRecordFailure?(roomId: string, err: Error): void;
  logGameEndRecordFailure?(roomId: string, err: Error): void;
  persistence?: TenantEventWriterPersistence<C, M, Spec>;
  /**
   * The room was rebuilt from the store after another process appended to it
   * (see resyncTenantRoomFromStore). The ws runtime sends every connected seat
   * the fresh snapshot here, which is how a player whose room was swept to an
   * end elsewhere learns the result.
   */
  onRoomResynced?(room: TenantRuntimeRoom<Kind, C, M, State, Spec>): void;
  scheduleLifecycleTimers?(room: TenantRuntimeRoom<Kind, C, M, State, Spec>): void;
  /**
   * Give a PvE scheduler a chance to move, after EVERY appended event.
   *
   * It used to be called only after a client's move, which is enough when a PvE
   * game alternates human, engine, human: the human's move is always the thing
   * that wakes the engine. Mahjong breaks that. Three of the four seats are
   * bots, so bot follows bot, and a hand stopped dead the moment the human's
   * turn ended. A claim window that settled on its own timer had the same
   * problem: the event that resumed play came from a timer, not a socket.
   *
   * Safe to call this often, and that safety is an invariant every scheduler
   * owes rather than something this module can enforce. Each one must bail on
   * an already-armed timer AND re-derive whose move it is, so an extra call
   * where nothing is owed does nothing. Verified 2026-09-11 for all five:
   * duck-xiangqi, jungle, banqi and jieqi all open with `if (room.engineTimer)
   * return` followed by a `playing && turn === seat && bothSeatsFilled` check;
   * mahjong clears and re-arms instead, because there a bot follows a bot and
   * bailing on an armed timer would stop the hand.
   *
   * A new scheduler that fires unconditionally will now be called after every
   * event rather than only after a human move, so it will move on the human's
   * turn.
   */
  scheduleEngineMove?(room: TenantRuntimeRoom<Kind, C, M, State, Spec>): void;
};

export async function appendTenantEvent<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  requestedEvent: TenantRoomEvent<C, M, Spec>,
  ctx: TenantEventWriterContext<Kind, C, M, State, Spec> = {},
): Promise<number> {
  const writer = contextWithDefaults(tenant, ctx);
  const expectedClock = room.projection.clock;
  const write = room.pendingWrites.then(async () => {
    // A move or pause queued ahead of this timer owns the new clock. Never let
    // the old request act on it, even if the same seat is still on move.
    if (requestedEvent.type === 'clock-expired' && room.projection.clock !== expectedClock)
      return -1;
    // Shutdown may be requested while an earlier move is awaiting its INSERT.
    // Freeze the committed projection here, preserving that move's increment
    // and the new clock owner. Never persist the caller's earlier snapshot.
    const event =
      requestedEvent.type === 'clock-paused' && requestedEvent.reason === 'shutdown'
        ? tenantPauseEventFor<C, M, Spec>(room.projection, requestedEvent.at, 'shutdown')
        : requestedEvent.type === 'clock-expired'
          ? tenantClockExpiryEventFor(tenant, room.projection, requestedEvent)
          : requestedEvent;
    if (!event) return -1;
    // Decide acceptance INSIDE the serialized write, before anything is durable.
    // The WebSocket turn guard reads the projection synchronously and then
    // awaits this write, so a double-submit or resend inside that window passes
    // the guard; re-checking here against the up-to-date projection is what
    // closes it. Persisting first meant a rejected move got a row and a seq of
    // its own — (room, seq) is the primary key, so nothing downstream could
    // reject it — and room.events outran the real game (2026-09-03: a Fortress
    // bot resigned because Fairy-Stockfish replayed three phantom plies).
    const projected = applyTenantEvent(tenant, room.projection, event);
    if (!tenantEventWasAccepted(room.projection, projected, event)) return -1;
    const seq = room.events.length;
    if (writer.persistence.isInitialized()) {
      // A taken seq means the room moved on elsewhere. The event was judged
      // against the stale copy, so it is refused, never re-numbered and retried.
      const appended = await appendRoomEventOrResync(tenant, room, writer, seq, event);
      if (!appended) return -1;
    }
    // Commit the projection computed above rather than re-deriving it. Applying
    // twice from the same projection gives the same answer while applyMove stays
    // pure, so this is thrift, not a fix — but it removes a second apply whose
    // correctness quietly depends on that purity.
    room.events.push(event);
    room.projection = projected;
    const appendedSeq = room.events.length - 1;
    writer.scheduleLifecycleTimers(room);
    writer.scheduleEngineMove(room);
    // PvE: free the engine seat reservation the moment the game ends, so a
    // finished/aborted game doesn't tie up a global engine seat until its TTL.
    // Idempotent via the null guard; harmless for PvP (no reservation).
    const endStatus = room.projection.state.status.type;
    if ((endStatus === 'finished' || endStatus === 'aborted') && room.engineReservationId) {
      releaseLiveEngineReservation(
        room.engineReservationId,
        `${tenant.engine?.reservationReleaseTag ?? tenant.kind}-${endStatus}`,
      );
      room.engineReservationId = null;
    }
    if (
      writer.persistence.isInitialized() &&
      room.projection.state.status.type === 'finished' &&
      !room.gameEndRecorded
    ) {
      // Claim the record up front so a concurrent event can't double-write, but
      // RETRY the write itself: the games row is the only record of a finished
      // game's result, so a single transient DB hiccup must not silently drop it
      // forever (a finished game emits no further events to trigger a re-attempt).
      room.gameEndRecorded = true;
      const summary =
        tenant.persistence.buildGameSummary?.(room) ?? buildTenantGameSummary(tenant, room);
      let gameEndRecorded = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await writer.persistence.recordGameEnd(room.id, summary);
          gameEndRecorded = true;
          break;
        } catch (err) {
          if (attempt === 2) {
            writer.logGameEndRecordFailure(room.id, err as Error);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
          }
        }
      }
      // The games row now exists, so the engine loop's queued per-move artifacts
      // can satisfy their foreign key. Best-effort, one row at a time: a failed
      // artifact must never fail the game-end path that just succeeded.
      if (gameEndRecorded) await flushPendingDebugArtifacts(tenant, room, writer.persistence);
      room.pendingDebugArtifacts = undefined;
    }
    if (room.projection.state.status.type === 'aborted' && !room.gameEndRecorded) {
      room.gameEndRecorded = true;
      // No game, no artifacts: an aborted room never gets a games row to hang
      // them on (and a pregame abort cascades away any row that did exist).
      room.pendingDebugArtifacts = undefined;
      // Aborts flip the running games row (status='aborted', no result)
      // instead of recordGameEnd — mirrors the chess stack. No-op for rooms
      // that never recorded a game start.
      if (writer.persistence.isInitialized()) {
        try {
          await writer.persistence.abortRunningGame(room.id, {
            abortedReason: room.projection.state.status.reason,
            termination: 'abandoned',
          });
        } catch (err) {
          writer.logGameAbortRecordFailure(room.id, err as Error);
        }
      }
    }
    await maintainTenantDeadlineRow(tenant, room, writer);
    return appendedSeq;
  });
  room.pendingWrites = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

export async function appendTenantSeatAssigned<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  args: {
    event: Extract<TenantRoomEvent<C, M, Spec>, { type: 'seat-assigned' }>;
    tokenState: TenantSeatTokenState<C>;
  },
  ctx: TenantEventWriterContext<Kind, C, M, State, Spec> = {},
): Promise<number> {
  const writer = contextWithDefaults(tenant, ctx);
  const write = room.pendingWrites.then(async () => {
    const seq = room.events.length;
    if (writer.persistence.isInitialized()) {
      if (!(await appendRoomEventOrResync(tenant, room, writer, seq, args.event))) {
        // The seat was chosen from the stale copy; the caller re-assigns it
        // against the room as the store has it.
        throw new TenantRoomResyncedError(room.id);
      }
      await writer.persistence.upsertRoomSeatToken(
        room.id,
        persistenceRecordForTenantSeatToken(args.tokenState),
      );
    }
    const appendedSeq = appendTenantRuntimeEvent(tenant, room, args.event);
    room.seatTokens[args.event.seat] = args.tokenState;
    writer.scheduleLifecycleTimers(room);
    // A seat fill can open the first-move window (the room becomes fully
    // seated), so the durable deadline row is maintained here too.
    await maintainTenantDeadlineRow(tenant, room, writer);
    return appendedSeq;
  });
  room.pendingWrites = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

/**
 * A write found the room's next seq already in the store and rebuilt the room
 * from it instead (resyncTenantRoomFromStore). Thrown by the seat-assigned
 * writer so the connection handler re-runs seat assignment once against the
 * fresh room rather than closing the socket.
 */
export class TenantRoomResyncedError extends Error {
  constructor(roomId: string) {
    super(`room ${roomId} was rebuilt from the store after a seq conflict`);
    this.name = 'TenantRoomResyncedError';
  }
}

function isEventSeqConflict(err: unknown): boolean {
  const pgError = err as { code?: unknown; constraint?: unknown } | null;
  return pgError?.code === '23505' && pgError.constraint === 'events_pkey';
}

// Append at seq, or, when another process already wrote that seq, rebuild the
// room from the store and report false. Runs inside the room's serialized write
// chain, so nothing else in this process touches the room meanwhile. Anything
// other than a seq conflict, or a conflict the store cannot explain, rethrows.
async function appendRoomEventOrResync<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  writer: Required<TenantEventWriterContext<Kind, C, M, State, Spec>>,
  seq: number,
  event: TenantRoomEvent<C, M, Spec>,
): Promise<boolean> {
  try {
    await writer.persistence.appendRoomEvent(room.id, seq, event);
    return true;
  } catch (err) {
    if (!isEventSeqConflict(err)) throw err;
    if (!(await resyncTenantRoomFromStore(tenant, room, writer))) throw err;
    return false;
  }
}

/**
 * Rebuild a stale in-memory room from the store, in place. Every web process
 * runs the correspondence deadline sweeper, so while two share the database (a
 * deploy overlap, two dev servers) one can hydrate a room another holds and end
 * it there. The holder never hears of it, and before this its next write reused
 * the swept seq and failed on events_pkey forever (#1056). The object keeps its
 * identity (connected clients, timers), and only what the log decides is
 * replaced. A terminal result found here was recorded by the process that wrote
 * it, so this one marks the end recorded and writes no games row of its own.
 */
async function resyncTenantRoomFromStore<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  writer: Required<TenantEventWriterContext<Kind, C, M, State, Spec>>,
): Promise<boolean> {
  const { loadRoomEvents, loadRoomSeatTokens } = writer.persistence;
  if (!loadRoomEvents || !loadRoomSeatTokens) return false;
  const events = await loadRoomEvents(room.id);
  // Only a longer log explains the conflict; anything else is not ours to fix.
  if (!events || events.length <= room.events.length) return false;
  if (!isTenantEventLog(tenant, events, room.id)) return false;
  const rebuilt = createTenantRuntimeRoomFromEvents(tenant, events);
  if (!rebuilt.ok) return false;
  const tokens = await loadRoomSeatTokens(room.id);
  room.events.splice(0, room.events.length, ...rebuilt.room.events);
  room.projection = rebuilt.room.projection;
  room.rated = rebuilt.room.rated;
  room.seatTokens = tenantSeatTokenStatesFromPersistence(
    tokens as Partial<
      Record<
        C & persistence.RoomSeatTokenSeat,
        persistence.RoomSeatTokenRecord<C & persistence.RoomSeatTokenSeat>
      >
    >,
  ) as TenantRuntimeRoom<Kind, C, M, State, Spec>['seatTokens'];
  const status = room.projection.state.status.type;
  if (status === 'finished' || status === 'aborted') {
    room.gameEndRecorded = true;
    room.pendingDebugArtifacts = undefined;
    if (room.engineReservationId) {
      releaseLiveEngineReservation(
        room.engineReservationId,
        `${tenant.engine?.reservationReleaseTag ?? tenant.kind}-${status}`,
      );
      room.engineReservationId = null;
    }
  }
  logger.warn(
    {
      kind: `${tenant.persistence.logKindPrefix}_room_resynced`,
      room_id: room.id,
      event_count: events.length,
      status,
    },
    `${tenant.persistence.logLabel} room rebuilt from the store after a seq conflict`,
  );
  writer.scheduleLifecycleTimers(room);
  writer.onRoomResynced(room);
  return true;
}

export function buildTenantGameSummary<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
): persistence.GameSummary {
  const status = room.projection.state.status;
  if (status.type !== 'finished') {
    throw new Error(`buildTenantGameSummary called on non-terminal ${tenant.kind} state`);
  }
  const moveEvents = room.events.filter((event) => event.type === 'move-played');
  const firstAt = room.events[0]?.at ?? Date.now();
  const lastAt = room.events[room.events.length - 1]?.at ?? Date.now();
  const engineSeat = tenantEngineSeat(tenant, room);
  const mode = engineSeat ? 'pve' : 'pvp';
  // Finished games are public (lichess model): human-vs-human games are no
  // longer kept private. Fog variants stay hidden WHILE LIVE via the separate
  // spectate gate; this only affects the concluded row's browsability. Guest
  // seats still render as "Guest" and non-account handles are never invented.
  const internal = internalEngineTestFor(room.events);
  const visibility: persistence.GameVisibility = internal ? 'private' : 'public';
  const participants = tenant.colors.map((color) =>
    tenantParticipant(tenant, color, room, visibility),
  );
  const rated =
    room.rated &&
    !engineSeat &&
    participants.every((participant) => participant.subjectType === 'user');
  return {
    variant: tenant.gameSpecId,
    mode,
    result: tenant.persistence.resultForWinner(status.winner),
    termination: tenant.persistence.termination(status.reason),
    plyCount: moveEvents.length,
    startedAt: new Date(firstAt),
    endedAt: new Date(lastAt),
    whiteClient: null,
    blackClient: null,
    whiteName: null,
    blackName: null,
    corpusId: internal ? INTERNAL_BANQI_CORPUS_ID : null,
    initialMs: room.projection.timeControl?.initialMs ?? null,
    incrementMs: room.projection.timeControl?.incrementMs ?? null,
    rated,
    visibility,
    participants,
    // An engine cannot abandon: record the failure, not a win for the human.
    abortedAs: engineFailureAbort({
      engineSeat,
      winner: status.winner,
      reason: status.reason,
    }),
  };
}

export function recordTenantPersistenceError(
  tenant: { persistence: { logKindPrefix: string; logLabel: string } },
  roomId: string,
  seq: number,
  eventType: string,
  err: Error,
): void {
  logger.error(
    {
      kind: `${tenant.persistence.logKindPrefix}_persistence_failure`,
      room_id: roomId,
      seq,
      event_type: eventType,
      error: err.message,
    },
    `${tenant.persistence.logLabel} persistence failure`,
  );
}

async function flushPendingDebugArtifacts<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
>(
  tenant: { persistence: { logKindPrefix: string; logLabel: string } },
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  writer: TenantEventWriterPersistence<C, M, Spec>,
): Promise<void> {
  const queued = room.pendingDebugArtifacts;
  if (!queued || queued.length === 0 || !writer.recordGameDebugArtifact) return;
  let failed = 0;
  let lastError: string | null = null;
  for (const artifact of queued) {
    try {
      await writer.recordGameDebugArtifact(artifact);
    } catch (err) {
      failed += 1;
      lastError = (err as Error).message;
    }
  }
  if (failed > 0) {
    logger.error(
      {
        kind: `${tenant.persistence.logKindPrefix}_debug_artifact_flush_failed`,
        room_id: room.id,
        queued: queued.length,
        failed,
        error: lastError,
      },
      `${tenant.persistence.logLabel} engine decision artifacts failed to persist at game end`,
    );
  }
}

function contextWithDefaults<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
>(
  tenant: { persistence: { logKindPrefix: string; logLabel: string } },
  ctx: TenantEventWriterContext<Kind, C, M, State, Spec>,
): Required<TenantEventWriterContext<Kind, C, M, State, Spec>> {
  return {
    logDeadlineRowFailure: (roomId, err) => logTenantDeadlineRowFailure(tenant, roomId, err),
    logGameAbortRecordFailure: (roomId, err) =>
      logTenantGameAbortRecordFailure(tenant, roomId, err),
    logGameEndRecordFailure: (roomId, err) => logTenantGameEndRecordFailure(tenant, roomId, err),
    persistence,
    onRoomResynced: () => {},
    scheduleLifecycleTimers: () => {},
    scheduleEngineMove: () => {},
    ...ctx,
  };
}

// Maintain the durable room_deadlines row for days-per-move rooms: upsert
// while the room has an enforceable deadline, delete once it doesn't
// (terminal, or back to waiting on a seat). Best-effort by design — the
// event log is the source of truth and the sweeper re-derives before acting,
// so a failed row write must never fail the move that caused it.
async function maintainTenantDeadlineRow<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  writer: Required<TenantEventWriterContext<Kind, C, M, State, Spec>>,
): Promise<void> {
  if (!writer.persistence.isInitialized()) return;
  if (clockPolicyKindFor(room.projection.timeControl) !== 'days-per-move') return;
  try {
    const deadline = tenantDurableDeadlineFor(tenant, room);
    if (deadline) {
      await writer.persistence.upsertRoomDeadline({
        roomId: room.id,
        gameSpecId: room.gameSpecId,
        seat: deadline.seat,
        seatUserId: room.seatTokens[deadline.seat]?.userId ?? null,
        dueAt: new Date(deadline.dueAt),
      });
    } else {
      await writer.persistence.deleteRoomDeadline(room.id);
    }
  } catch (err) {
    writer.logDeadlineRowFailure(room.id, err as Error);
  }
}

function logTenantDeadlineRowFailure(
  tenant: { persistence: { logKindPrefix: string; logLabel: string } },
  roomId: string,
  err: Error,
): void {
  logger.error(
    {
      kind: `${tenant.persistence.logKindPrefix}_deadline_row_failure`,
      room_id: roomId,
      error: err.message,
      at: Date.now(),
    },
    `${tenant.persistence.logLabel} deadline row failure`,
  );
}

function logTenantGameAbortRecordFailure(
  tenant: { persistence: { logKindPrefix: string; logLabel: string } },
  roomId: string,
  err: Error,
): void {
  logger.error(
    {
      kind: `${tenant.persistence.logKindPrefix}_game_abort_record_failure`,
      room_id: roomId,
      error: err.message,
      at: Date.now(),
    },
    `${tenant.persistence.logLabel} game abort record failure`,
  );
}

function logTenantGameEndRecordFailure(
  tenant: { persistence: { logKindPrefix: string; logLabel: string } },
  roomId: string,
  err: Error,
): void {
  logger.error(
    {
      kind: `${tenant.persistence.logKindPrefix}_game_end_record_failure`,
      room_id: roomId,
      error: err.message,
      at: Date.now(),
    },
    `${tenant.persistence.logLabel} game end record failure`,
  );
}

export function tenantParticipant<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  color: C,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  visibility: persistence.GameVisibility,
): persistence.GameParticipant {
  const seatedClientId = room.projection.seats[color];
  if (seatedClientId && tenant.engine?.isEngineClientId(seatedClientId)) {
    const internal = internalEngineTestFor(room.events);
    if (internal?.engineId === seatedClientId)
      return {
        color: color as persistence.GameParticipantColor,
        displayName: internal.displayName,
        subjectType: 'engine-version',
        subjectId: internal.engineId,
        engineVersion: internal.engineVersion,
        visibility: 'private',
      };
    const engineVersion = tenant.engine.engineVersion?.(seatedClientId) ?? null;
    // The live seat name, verbatim (tenantSeatDisplayNames): the finished game
    // keeps the name the room showed, rung label included.
    const engine = tenant.engine;
    const seatName = liveSeatEngineName(seatedClientId, room.pveBotId, () =>
      engine.displayName(seatedClientId),
    );
    if (room.pveBotId) {
      const bot = firstPartyBotForId(room.pveBotId);
      return {
        color: color as persistence.GameParticipantColor,
        displayName: seatName,
        subjectType: 'bot',
        // Canonicalize: a room created against a pre-consolidation bot id
        // still attributes its game to the merged identity.
        subjectId: bot?.id ?? room.pveBotId,
        engineId: seatedClientId,
        ...(engineVersion != null ? { engineVersion } : {}),
        visibility,
      };
    }
    const bot = firstPartyBotForEngine(seatedClientId);
    if (bot) {
      return {
        color: color as persistence.GameParticipantColor,
        displayName: seatName,
        subjectType: 'bot',
        subjectId: bot.id,
        engineId: seatedClientId,
        ...(engineVersion != null ? { engineVersion } : {}),
        visibility,
      };
    }
    return {
      color: color as persistence.GameParticipantColor,
      displayName: seatName,
      subjectType: 'engine-version',
      subjectId: seatedClientId,
      // Records the engine build for version-less subject_ids (variant-tenant UCI engines),
      // so PvE games are queryable by version. Omitted-when-null to keep the shape stable.
      ...(engineVersion != null ? { engineVersion } : {}),
      visibility,
    };
  }
  const token = room.seatTokens[color];
  if (token?.userId) {
    return {
      color: color as persistence.GameParticipantColor,
      displayName: token.userDisplayName ?? token.userHandle ?? 'Player',
      subjectType: 'user',
      subjectId: token.userId,
      visibility,
    };
  }
  return {
    color: color as persistence.GameParticipantColor,
    displayName: 'Guest',
    subjectType: 'guest',
    // The browser's device id (migration 137), so guest games are countable
    // per visitor; null for seats whose holder never connected.
    subjectId: token?.deviceId ?? null,
    visibility,
  };
}

function tenantEngineSeat<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
): C | null {
  if (!tenant.engine) return null;
  for (const color of tenant.colors) {
    if (tenant.engine.isEngineClientId(room.projection.seats[color])) return color;
  }
  return null;
}

export function persistenceRecordForTenantSeatToken<C extends string>(
  token: TenantSeatTokenState<C>,
): persistence.RoomSeatTokenRecord<C & persistence.RoomSeatTokenSeat> {
  return {
    seat: token.seat as C & persistence.RoomSeatTokenSeat,
    clientId: token.clientId,
    deviceId: token.deviceId ?? null,
    tokenHash: token.tokenHash,
    userId: token.userId,
    userHandle: token.userHandle,
    userDisplayName: token.userDisplayName,
    issuedAt: token.issuedAt,
    lastSeenAt: token.lastSeenAt,
    revokedAt: token.revokedAt,
  };
}
