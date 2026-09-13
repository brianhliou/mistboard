import { randomUUID } from 'node:crypto';
import {
  type GameEvent,
  type GameProjection,
  gameSpecForLegacyLiveRoom,
  type RoomTimeControl,
  replayGameEvents,
  type VariantId,
} from '@mistboard/game';
import * as persistence from './persistence.js';
import { recordRoomLifecycleAuditSafe } from './room-lifecycle-audit.js';
import {
  appendEvent,
  applyOrphanRecoveryIfNeeded,
  broadcastEventAppended,
  PersistenceFailure,
  type RoomManagerContext,
  resumeRoom,
  scheduleAbortTimeout,
  scheduleClockTimeout,
  scheduleRandomEngineMove,
  seatTokenStatesFromPersistence,
} from './room-manager.js';
import { normalizeRoomRegion } from './server-config.js';
import { clearRoomRuntimeTimers } from './server-lifecycle.js';
import {
  canonicalLiveEngineVersionId,
  pveEngineSeatForProjection,
} from './server-live-engine-reservations.js';
import { modeForProjection } from './server-policy.js';
import { verifySeatToken } from './server-seat-session.js';
import type { Client, Room } from './server-types.js';

type CreateRoomOptions = {
  randomSeating?: boolean;
  engineColor?: 'white' | 'black';
  engineReservationId?: string;
  botId?: string;
  // PvP only. When set, the first arrival in this room is assigned this seat;
  // the second arrival gets the other side. Mutually exclusive with randomSeating
  // (random preference uses randomSeating). Ignored for PvE.
  creatorPreference?: 'white' | 'black';
  region?: string;
};

type AbandonRoomResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'unauthorized' | 'already_terminal' };

type HydratedEngineReservation = {
  color: 'white' | 'black';
  engineId: string;
  roomId: string;
};

export type RoomLifecycleConfig = {
  rooms: Map<string, Room>;
  roomMgrCtx: RoomManagerContext;
  defaultRoomRegion: string;
  orphanThresholdMs: number;
  guestPrestartAbortMs: number;
  abortPolicySweepMs: number;
  stalePauseMs: number;
  stalePausedSweepMs: number;
  pauseGraceMs: number;
  recordPersistenceError: (roomId: string, seq: number, event: GameEvent, err: Error) => void;
  releaseLiveEngineReservation: (reservationId: string, reason: string) => void;
  reserveHydratedLiveEngineSeat: (reservation: HydratedEngineReservation) => Promise<string | null>;
  seatVacateGraceMs: () => number;
};

export type RoomLifecycle = {
  abandonRoom: (roomId: string, seatToken: string) => Promise<AbandonRoomResult>;
  clearPendingVacate: (room: Room, seat: Client['seat']) => void;
  createRoom: (
    mode: 'pvp' | 'pve',
    variant: VariantId,
    engineId: string,
    timeControl?: RoomTimeControl,
    rated?: boolean,
    options?: CreateRoomOptions,
  ) => Promise<Room>;
  getOrCreateRoom: (roomId: string, variant: VariantId) => Promise<Room>;
  isAbortedRoom: (roomId: string) => Promise<boolean>;
  resetRoom: (roomId: string, reason?: string) => void;
  scheduleSeatVacate: (room: Room, client: Client) => void;
  startAbortPolicySweep: () => void;
  startStalePausedSweep: () => void;
  stopSweeps: () => void;
};

export function createRoomLifecycle(config: RoomLifecycleConfig): RoomLifecycle {
  let abortPolicyTimer: ReturnType<typeof setInterval> | null = null;
  let stalePausedSweepTimer: ReturnType<typeof setInterval> | null = null;

  function scheduleRoomTimers(room: Room): void {
    scheduleClockTimeout(config.roomMgrCtx, room);
    scheduleAbortTimeout(config.roomMgrCtx, room);
    scheduleRandomEngineMove(config.roomMgrCtx, room);
  }

  function scheduleSeatVacate(room: Room, client: Client): void {
    if (client.seat === 'spectator') return;
    const seat = client.seat;
    const existing = room.pendingVacates[seat];
    if (existing) clearTimeout(existing);
    const clientId = client.id;
    room.pendingVacates[seat] = setTimeout(() => {
      delete room.pendingVacates[seat];
      // Only vacate if (a) game hasn't started in the meantime and
      // (b) no other client has taken this seat. If a different client has
      // displaced this seat, projection.seats[seat] no longer equals clientId.
      if (
        !(room.projection.state.moveNumber === 1 && room.projection.state.lastMove === undefined)
      ) {
        return;
      }
      if (room.projection.state.clock !== undefined) return;
      if (room.projection.seats[seat] !== clientId) return;
      for (const c of room.clients) {
        if (c.seat === seat && !c.displaced) return;
      }
      void appendEvent(config.roomMgrCtx, room, {
        type: 'seat-vacated',
        at: Date.now(),
        roomId: room.id,
        clientId,
        seat,
      }).catch((err) => {
        if (err instanceof PersistenceFailure) return;
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'seat_vacate_append_failure',
            roomId: room.id,
            seat,
            error: (err as Error).message,
            at: Date.now(),
          }),
        );
      });
    }, config.seatVacateGraceMs());
  }

  function clearPendingVacate(room: Room, seat: Client['seat']): void {
    if (seat === 'spectator') return;
    const timer = room.pendingVacates[seat];
    if (!timer) return;
    clearTimeout(timer);
    delete room.pendingVacates[seat];
  }

  async function getOrCreateRoom(roomId: string, variant: VariantId): Promise<Room> {
    const existing = config.rooms.get(roomId);
    if (existing) return existing;

    let events: GameEvent[] | null = null;
    let createdNewPersistentRoom = false;
    if (persistence.isInitialized()) {
      try {
        events = await persistence.loadRoom(roomId);
      } catch (err) {
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'persistence_load_failure',
            roomId,
            error: (err as Error).message,
            at: Date.now(),
          }),
        );
        events = null;
      }
    }

    if (!events) {
      const gameSpecId = gameSpecForLegacyLiveRoom({ variant }).id;
      const created: GameEvent = {
        type: 'room-created',
        at: Date.now(),
        roomId,
        variant,
        gameSpecId,
        region: config.defaultRoomRegion,
      };
      if (persistence.isInitialized()) {
        try {
          await persistence.appendEvent(roomId, 0, created);
          createdNewPersistentRoom = true;
        } catch (err) {
          config.recordPersistenceError(roomId, 0, created, err as Error);
          throw new PersistenceFailure();
        }
      }
      events = [created];
    }

    const recoveredEvents = applyOrphanRecoveryIfNeeded(
      events,
      Date.now(),
      config.orphanThresholdMs,
    );
    if (recoveredEvents.length > events.length) {
      const synthPause = recoveredEvents[recoveredEvents.length - 1]!;
      const synthPauseSeq = recoveredEvents.length - 1;
      if (persistence.isInitialized()) {
        try {
          await persistence.appendEvent(roomId, synthPauseSeq, synthPause);
        } catch (err) {
          config.recordPersistenceError(roomId, synthPauseSeq, synthPause, err as Error);
          throw new PersistenceFailure();
        }
      }
      await recordRoomLifecycleAuditSafe({
        roomId,
        kind: 'orphan_recovery_synth_pause',
        atMs: synthPause.at,
        eventSeq: synthPauseSeq,
        payload: {
          lastEventType: events[events.length - 1]!.type,
          lastEventAtMs: events[events.length - 1]!.at,
          orphanThresholdMs: config.orphanThresholdMs,
        },
      });
      console.log(
        JSON.stringify({
          level: 'info',
          kind: 'orphan_recovery_synth_pause',
          roomId,
          lastEventAt: events[events.length - 1]!.at,
          synthPauseAt: synthPause.at,
          at: Date.now(),
        }),
      );
      events = recoveredEvents;
    }

    const projection = replayGameEvents(events);
    const mode = modeForProjection(projection);
    const seatTokens = persistence.isInitialized()
      ? seatTokenStatesFromPersistence(await persistence.loadRoomSeatTokens(roomId))
      : {};
    const roomCreatedEvent = events.find((e) => e.type === 'room-created') as
      | Extract<GameEvent, { type: 'room-created' }>
      | undefined;
    const region = normalizeRoomRegion(roomCreatedEvent?.region ?? config.defaultRoomRegion);
    const roomCreatedPveBotId = pveBotIdForRoomCreatedEvent(roomCreatedEvent);
    if (createdNewPersistentRoom) {
      await persistGameStart(
        roomId,
        projection,
        mode,
        new Date(events[0]?.at ?? Date.now()),
        region,
      );
    }
    const hydratedPveEngine = pveEngineSeatForProjection(projection);
    const hydratedPveEngineId = hydratedPveEngine
      ? canonicalLiveEngineVersionId(hydratedPveEngine.clientId)
      : null;
    const room: Room = {
      id: roomId,
      clients: new Set(),
      events,
      projection,
      seatTokens,
      clockTimer: null,
      engineTimer: null,
      abortTimer: null,
      abortDeadline: null,
      abortPhase: null,
      forfeitTimer: null,
      forfeitDeadline: null,
      forfeitSeat: null,
      mode,
      gameSpecId: projection.gameSpecId,
      region,
      // Rated request is persisted on the room-created event, so hydration
      // after a restart preserves it. Defaults casual if absent.
      rated: roomCreatedEvent?.rated ?? false,
      randomEngine: hydratedPveEngine !== null,
      engineReservationId: null,
      randomSeating: false,
      creatorPreference: null,
      pveEngineId: hydratedPveEngineId,
      pveBotId: roomCreatedPveBotId,
      pendingWrites: Promise.resolve(),
      gameEndRecorded: projection.state.status.type === 'finished',
      variant: projection.variant,
      timeControl: projection.timeControl,
      rematch: { offers: {} },
      pendingVacates: {},
      pauseGraceTimer: null,
    };
    if (
      hydratedPveEngineId &&
      hydratedPveEngine &&
      room.projection.state.status.type === 'playing'
    ) {
      room.engineReservationId = await config.reserveHydratedLiveEngineSeat({
        color: hydratedPveEngine.color,
        engineId: hydratedPveEngineId,
        roomId: room.id,
      });
    }
    config.rooms.set(roomId, room);
    scheduleRoomTimers(room);
    if (room.projection.paused) {
      await recordRoomLifecycleAuditSafe({
        roomId: room.id,
        kind: 'paused_room_hydrated',
        atMs: Date.now(),
        payload: {
          mode: room.mode,
          pauseReason: room.projection.pauseReason,
          pausedAtMs: room.projection.pausedAt,
          eventCount: room.events.length,
        },
      });
      armPauseGraceTimer(room);
    }
    return room;
  }

  async function createRoom(
    mode: 'pvp' | 'pve',
    variant: VariantId,
    engineId: string,
    timeControl?: RoomTimeControl,
    rated = false,
    options: CreateRoomOptions = {},
  ): Promise<Room> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const roomId = randomUUID();
      const existing =
        config.rooms.get(roomId) ??
        (persistence.isInitialized() ? await persistence.loadRoom(roomId) : null);
      if (existing) continue;

      const at = Date.now();
      const gameSpecId = gameSpecForLegacyLiveRoom({ variant }).id;
      const region = normalizeRoomRegion(options.region ?? config.defaultRoomRegion);
      const roomCreated: Extract<GameEvent, { type: 'room-created' }> = {
        type: 'room-created',
        at,
        roomId,
        variant,
        gameSpecId,
        region,
        ...(mode === 'pve' && options.botId ? { pveBotId: options.botId } : {}),
        ...(timeControl ? { timeControl } : {}),
        ...(rated ? { rated: true } : {}),
      };
      const events: GameEvent[] = [roomCreated];
      if (mode === 'pve') {
        const engineSeat: 'white' | 'black' = options.engineColor ?? 'black';
        events.push({
          type: 'seat-assigned',
          at,
          roomId,
          clientId: engineId,
          seat: engineSeat,
        });
      }

      if (persistence.isInitialized()) {
        for (const [seq, event] of events.entries()) {
          try {
            await persistence.appendEvent(roomId, seq, event);
          } catch (err) {
            config.recordPersistenceError(roomId, seq, event, err as Error);
            throw new PersistenceFailure();
          }
        }
      }

      const projection = replayGameEvents(events);
      if (persistence.isInitialized()) {
        await persistGameStart(roomId, projection, mode, new Date(at), region);
      }
      const room: Room = {
        id: roomId,
        clients: new Set(),
        events,
        projection,
        seatTokens: {},
        clockTimer: null,
        engineTimer: null,
        abortTimer: null,
        abortDeadline: null,
        abortPhase: null,
        forfeitTimer: null,
        forfeitDeadline: null,
        forfeitSeat: null,
        mode,
        gameSpecId: projection.gameSpecId,
        region,
        rated,
        randomEngine: mode === 'pve',
        engineReservationId: mode === 'pve' ? (options.engineReservationId ?? null) : null,
        randomSeating: options.randomSeating === true && mode === 'pvp',
        creatorPreference:
          mode === 'pvp' && options.creatorPreference ? options.creatorPreference : null,
        pveEngineId: mode === 'pve' ? engineId : null,
        pveBotId: mode === 'pve' ? (options.botId ?? null) : null,
        pendingWrites: Promise.resolve(),
        gameEndRecorded: false,
        variant,
        timeControl,
        rematch: { offers: {} },
        pendingVacates: {},
        pauseGraceTimer: null,
      };
      config.rooms.set(roomId, room);
      scheduleRoomTimers(room);
      return room;
    }
    throw new Error('room_id_collision');
  }

  async function persistGameStart(
    roomId: string,
    projection: GameProjection,
    mode: persistence.GameMode,
    startedAt: Date,
    region = config.defaultRoomRegion,
  ): Promise<void> {
    if (!persistence.isInitialized()) return;
    try {
      await persistence.recordGameStart(roomId, {
        variant: projection.variant,
        mode,
        region,
        startedAt,
        whiteClient: projection.seats.white ?? null,
        blackClient: projection.seats.black ?? null,
        whiteName: null,
        blackName: null,
        corpusId: null,
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'game_start_record_failure',
          roomId,
          error: (err as Error).message,
          at: Date.now(),
        }),
      );
      throw new PersistenceFailure();
    }
  }

  async function isAbortedRoom(roomId: string): Promise<boolean> {
    if (!persistence.isInitialized()) return false;
    const lifecycle = await persistence.getGameLifecycleStatus(roomId).catch((err) => {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'game_lifecycle_status_failure',
          roomId,
          error: (err as Error).message,
          at: Date.now(),
        }),
      );
      return null;
    });
    return lifecycle?.status === 'aborted';
  }

  function startAbortPolicySweep(): void {
    if (!persistence.isInitialized()) return;
    if (config.guestPrestartAbortMs <= 0) return;
    void runAbortPolicySweep();
    abortPolicyTimer = setInterval(() => {
      void runAbortPolicySweep();
    }, config.abortPolicySweepMs);
  }

  async function runAbortPolicySweep(): Promise<void> {
    try {
      const result = await persistence.abortStaleGuestPrestartGames(
        new Date(),
        config.guestPrestartAbortMs,
      );
      if (result.aborted > 0) {
        for (const roomId of result.roomIds) {
          resetRoom(roomId, 'guest-prestart-timeout');
        }
        console.log(
          JSON.stringify({
            level: 'info',
            kind: 'abort_policy_sweep',
            policy: 'guest-prestart-timeout',
            aborted: result.aborted,
            at: Date.now(),
          }),
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'abort_policy_sweep_failure',
          error: (err as Error).message,
          at: Date.now(),
        }),
      );
    }
  }

  function startStalePausedSweep(): void {
    if (!persistence.isInitialized()) return;
    if (config.stalePauseMs <= 0) return;
    void runStalePausedSweep();
    stalePausedSweepTimer = setInterval(() => {
      void runStalePausedSweep();
    }, config.stalePausedSweepMs);
  }

  async function runStalePausedSweep(): Promise<void> {
    const now = new Date();
    try {
      const result = await persistence.finalizeStalePausedRooms(now, config.stalePauseMs);
      if (result.finalized === 0) return;
      for (const room of result.rooms) {
        resetRoom(room.roomId, 'stale-paused-finalized');
        console.log(
          JSON.stringify({
            level: 'warn',
            kind: 'stale_paused_finalized',
            roomId: room.roomId,
            mode: room.mode,
            pause_seq: room.pauseSeq,
            pause_reason: room.pauseReason,
            paused_at: room.pausedAtMs,
            paused_duration_ms: now.getTime() - room.pausedAtMs,
            started_at: room.startedAt.getTime(),
            ply_count: room.plyCount,
            at: now.getTime(),
          }),
        );
      }
      console.log(
        JSON.stringify({
          level: 'info',
          kind: 'stale_paused_sweep',
          stale_paused_finalized_total: result.finalized,
          at: now.getTime(),
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'stale_paused_sweep_failure',
          error: (err as Error).message,
          at: now.getTime(),
        }),
      );
    }
  }

  async function abandonRoom(roomId: string, seatToken: string): Promise<AbandonRoomResult> {
    if (persistence.isInitialized()) {
      const lifecycle = await persistence.getGameLifecycleStatus(roomId);
      if (!lifecycle) return { ok: false, error: 'not_found' };
      if (lifecycle.status !== 'running') return { ok: false, error: 'already_terminal' };
      const verified = await persistence.verifyRoomSeatToken(roomId, seatToken);
      if (!verified) return { ok: false, error: 'unauthorized' };
      await persistence.abortRunningGame(roomId, {
        abortedReason: 'abandoned by creator',
        termination: 'abandoned',
      });
      resetRoom(roomId, 'abandoned');
      return { ok: true };
    }
    const room = config.rooms.get(roomId);
    if (!room) return { ok: false, error: 'not_found' };
    if (!verifySeatToken(room, seatToken)) return { ok: false, error: 'unauthorized' };
    if (room.projection.state.status.type === 'finished')
      return { ok: false, error: 'already_terminal' };
    resetRoom(roomId, 'abandoned');
    return { ok: true };
  }

  function resetRoom(roomId: string, reason = 'room-reset'): void {
    const room = config.rooms.get(roomId);
    if (room) {
      clearRoomRuntimeTimers(room, {
        releaseEngineReservation: config.releaseLiveEngineReservation,
        reservationReleaseReason: reason,
      });
    }
    config.rooms.delete(roomId);
  }

  function armPauseGraceTimer(room: Room): void {
    if (!room.projection.paused) return;
    if (room.pauseGraceTimer) return;
    room.pauseGraceTimer = setTimeout(() => {
      room.pauseGraceTimer = null;
      const fromSeq = room.events.length;
      void resumeRoom(config.roomMgrCtx, room, Date.now(), 'grace-elapsed')
        .then(() => {
          if (room.projection.state.status.type === 'playing' && !room.projection.paused) {
            scheduleRoomTimers(room);
          }
          broadcastEventAppended(config.roomMgrCtx, room, fromSeq);
        })
        .catch((err) => {
          if (!(err instanceof PersistenceFailure)) {
            console.error(
              JSON.stringify({
                level: 'error',
                kind: 'pause_grace_resume_failure',
                roomId: room.id,
                error: (err as Error).message,
                at: Date.now(),
              }),
            );
          }
        });
    }, config.pauseGraceMs);
  }

  function stopSweeps(): void {
    if (abortPolicyTimer) {
      clearInterval(abortPolicyTimer);
      abortPolicyTimer = null;
    }
    if (stalePausedSweepTimer) {
      clearInterval(stalePausedSweepTimer);
      stalePausedSweepTimer = null;
    }
  }

  return {
    abandonRoom,
    clearPendingVacate,
    createRoom,
    getOrCreateRoom,
    isAbortedRoom,
    resetRoom,
    scheduleSeatVacate,
    startAbortPolicySweep,
    startStalePausedSweep,
    stopSweeps,
  };
}

function pveBotIdForRoomCreatedEvent(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) return null;
  const botId = (event as { pveBotId?: unknown }).pveBotId;
  return typeof botId === 'string' ? botId : null;
}
