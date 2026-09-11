/**
 * Generic event writer for tenant rooms: persistence-first append serialized
 * through room.pendingWrites, lifecycle re-arming, engine-reservation release
 * on game end, and the terminal GameSummary build. Persistence kinds/labels
 * come from the tenant so structured logs keep their per-variant identity.
 */

import { clockPolicyKindFor } from '@mistboard/game';
import { engineFailureAbort } from '../engine-failure-abort.js';
import { firstPartyBotForEngine, firstPartyBotForId } from '../first-party-bots.js';
import { logger } from '../obs.js';
import * as persistence from '../persistence.js';
import { releaseLiveEngineReservation } from '../server-live-engine-reservations.js';
import { tenantDurableDeadlineFor } from './lifecycle.js';
import { appendTenantRuntimeEvent, applyTenantEvent, tenantEventWasAccepted } from './runtime.js';
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
  scheduleLifecycleTimers?(room: TenantRuntimeRoom<Kind, C, M, State, Spec>): void;
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
  event: TenantRoomEvent<C, M, Spec>,
  ctx: TenantEventWriterContext<Kind, C, M, State, Spec> = {},
): Promise<number> {
  const writer = contextWithDefaults(tenant, ctx);
  const write = room.pendingWrites.then(async () => {
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
      await writer.persistence.appendRoomEvent(room.id, seq, event);
    }
    // Commit the projection computed above rather than re-deriving it. Applying
    // twice from the same projection gives the same answer while applyMove stays
    // pure, so this is thrift, not a fix — but it removes a second apply whose
    // correctness quietly depends on that purity.
    room.events.push(event);
    room.projection = projected;
    const appendedSeq = room.events.length - 1;
    writer.scheduleLifecycleTimers(room);
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
      await writer.persistence.appendRoomEvent(room.id, seq, args.event);
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
  const visibility: persistence.GameVisibility = 'public';
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
    corpusId: null,
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
    scheduleLifecycleTimers: () => {},
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
    const engineVersion = tenant.engine.engineVersion?.(seatedClientId) ?? null;
    if (room.pveBotId) {
      const bot = firstPartyBotForId(room.pveBotId);
      return {
        color: color as persistence.GameParticipantColor,
        displayName: bot?.displayName ?? tenant.engine.displayName(seatedClientId),
        subjectType: 'bot',
        // Canonicalize: a room created against a pre-consolidation bot id
        // still attributes its game to the merged identity.
        subjectId: bot?.id ?? room.pveBotId,
        ...(engineVersion != null ? { engineVersion } : {}),
        visibility,
      };
    }
    const bot = firstPartyBotForEngine(seatedClientId);
    if (bot) {
      return {
        color: color as persistence.GameParticipantColor,
        displayName: bot.displayName,
        subjectType: 'bot',
        subjectId: bot.id,
        ...(engineVersion != null ? { engineVersion } : {}),
        visibility,
      };
    }
    return {
      color: color as persistence.GameParticipantColor,
      displayName: tenant.engine.displayName(seatedClientId),
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
