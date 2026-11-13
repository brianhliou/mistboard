/**
 * Generic live-room creation for tenant rooms: id minting with cross-variant
 * collision retry, optional PvE engine seating (durable in the initial event
 * log so it replays on hydration), persistence-first event writes, and the
 * running-game record.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RoomTimeControl } from '@mistboard/game';
import * as persistence from '../persistence.js';
import { releaseLiveEngineReservation } from '../server-live-engine-reservations.js';
import { appendTenantSeatAssigned } from './events.js';
import { appendTenantRuntimeEvent, createTenantRuntimeRoom } from './runtime.js';
import { mintTenantSeatToken } from './seat-session.js';
import type {
  TenantGameStateLike,
  TenantRoomEvent,
  TenantRuntimeRoom,
  VariantTenant,
} from './tenant.js';
import { tenantTurnOrder } from './tenant.js';

// Set while the lobby route creates a matched room (routes/lobby.ts). Every
// tenant's lobby.createRoom ends in createTenantLiveRoom through its own
// positional create helpers, so marking the room here covers every tenant, and
// any future one, without threading a flag through each of them. Scoped to the
// one awaited call: nothing created outside it is marked.
const lobbyMatchScope = new AsyncLocalStorage<true>();

/** Run `create` so that every tenant room it makes is marked a lobby match. */
export function createAsLobbyMatch<T>(create: () => Promise<T>): Promise<T> {
  return lobbyMatchScope.run(true, create);
}

/** Seat an engine in `seat` at creation (its clientId is the engine id),
 * holding the given engine-service seat reservation for the game. Omit
 * reservationId for tenants whose engines run in-process with no seat
 * reservation system (an in-process Fairy-Stockfish). */
export type TenantRoomEngineSeat<C extends string> = {
  engineId: string;
  seat: C;
  reservationId?: string;
  botId?: string;
};

export type TenantLiveRoomCreation<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
> =
  | { ok: true; room: TenantRuntimeRoom<Kind, C, M, State, Spec> }
  | { ok: false; error: 'disabled' | 'persistence_failure' | 'room_id_collision' };

export type TenantLiveRoomFactoryContext<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
> = {
  rooms: Map<string, TenantRuntimeRoom<Kind, C, M, State, Spec>>;
  // Collision check across the OTHER variants' room maps (this tenant's own
  // map is checked via `rooms`).
  isRoomIdTaken(roomId: string): boolean;
  appendRoomEvent(roomId: string, seq: number, event: TenantRoomEvent<C, M, Spec>): Promise<void>;
  createRoomId?: () => string;
  isPersistenceEnabled(): boolean;
  // Omit for tenants that don't record running games (Dark Xiangqi).
  recordGameStart?(roomId: string, summary: persistence.RunningGameSummary): Promise<void>;
  recordPersistenceError(roomId: string, seq: number, eventType: string, err: Error): void;
  releaseEngineReservation?(reservationId: string, reason: string): void;
};

export async function createTenantLiveRoom<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  ctx: TenantLiveRoomFactoryContext<Kind, C, M, State, Spec>,
  options: {
    timeControl?: RoomTimeControl;
    creatorPreference?: C | 'random';
    engine?: TenantRoomEngineSeat<C>;
    /**
     * Engines at any table: every seat the humans are not taking, or every
     * seat for an EvE room (scheduling stays disabled in this lifecycle slice).
     *
     * `engine` seats one opponent, which is the whole story for a two-player
     * game. A mahjong room against bots needs three, so this takes a list.
     * Supply one or the other, never both.
     */
    engines?: readonly TenantRoomEngineSeat<C>[];
    internalEngineTest?: import('../internal-engine-test.js').InternalEngineTest;
    rated?: boolean;
    /** Made by a lobby match. Defaults to whether createAsLobbyMatch is running. */
    lobbyMatch?: boolean;
    /**
     * The creator named a seat rather than Random. Only rules.createSetup reads
     * it (xiangqi mahjong deals east first); the setup it returns is persisted.
     */
    sideChosen?: boolean;
  } = {},
): Promise<TenantLiveRoomCreation<Kind, C, M, State, Spec>> {
  const { timeControl, creatorPreference, engine, engines, rated = false } = options;
  const lobbyMatch = options.lobbyMatch ?? lobbyMatchScope.getStore() === true;
  // Passing reservations transfers their ownership to this creation attempt.
  // Until the room is published, every failure must return all admitted seats.
  const admitted = [...(engines ?? []), ...(engine ? [engine] : [])];
  let published = false;
  try {
    if (engine && engines) {
      throw new Error('pass either engine or engines, not both');
    }
    const engineSeats: readonly TenantRoomEngineSeat<C>[] = engines ?? (engine ? [engine] : []);
    const firstEngine = engineSeats[0];
    const seats = new Set<C>();
    const reservations = new Set<string>();
    const engineBotIds: Partial<Record<C, string>> = {};
    for (const seated of engineSeats) {
      if (
        !tenant.colors.includes(seated.seat) ||
        seats.has(seated.seat) ||
        !tenant.engine?.isEngineClientId(seated.engineId) ||
        (seated.reservationId && reservations.has(seated.reservationId))
      ) {
        throw new Error('invalid or duplicate engine seat');
      }
      seats.add(seated.seat);
      if (seated.reservationId) reservations.add(seated.reservationId);
      if (seated.botId) engineBotIds[seated.seat] = seated.botId;
    }
    const mode =
      engineSeats.length === 0
        ? 'pvp'
        : engineSeats.length === tenant.colors.length
          ? 'eve'
          : 'pve';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const roomId = ctx.createRoomId?.() ?? `${tenant.roomIdPrefix}${randomUUID()}`;
      if (ctx.rooms.has(roomId) || ctx.isRoomIdTaken(roomId)) {
        continue;
      }
      const created = createTenantRuntimeRoom(tenant, roomId, {
        creatorPreference,
        internalEngineTest: options.internalEngineTest,
        pveBotId: engineSeats.length === 1 ? firstEngine?.botId : undefined,
        engineBotIds: engineSeats.length > 1 ? engineBotIds : undefined,
        rated: rated && mode === 'pvp',
        timeControl,
        lobbyMatch: lobbyMatch && engineSeats.length === 0,
        ...(options.sideChosen ? { sideChosen: true } : {}),
      });
      if (!created.ok) return created;
      const room = created.room;
      // PvE: seat the engine before persistence so the seat-assigned event is part
      // of the room's initial event log (durable + replays on hydration). The human
      // then takes the only empty seat on connect.
      for (const seated of engineSeats) {
        appendTenantRuntimeEvent(tenant, room, {
          type: 'seat-assigned',
          at: Date.now(),
          roomId,
          clientId: seated.engineId,
          seat: seated.seat,
        });
      }
      for (const seated of engineSeats) {
        room.engineReservationIds[seated.seat] = seated.reservationId ?? null;
      }
      // Compatibility for the existing PvE callers. EvE has no single seat.
      room.engineReservationId =
        engineSeats.length === 1 ? (firstEngine?.reservationId ?? null) : null;
      if (ctx.isPersistenceEnabled()) {
        let writingSeq = 0;
        let writingEventType = 'room-created';
        try {
          for (const [seq, event] of room.events.entries()) {
            writingSeq = seq;
            writingEventType = event.type;
            await ctx.appendRoomEvent(roomId, seq, event);
          }
          if (ctx.recordGameStart) {
            writingSeq = room.events.length;
            writingEventType = 'game-start';
            await ctx.recordGameStart(roomId, {
              variant: tenant.gameSpecId,
              mode,
              startedAt: new Date(room.events[0]?.at ?? Date.now()),
              whiteClient: null,
              blackClient: null,
              whiteName: null,
              blackName: null,
              corpusId: null,
              // Public from the start (lichess model): human games are no longer
              // private. Fog live-spectate stays gated separately.
              visibility: 'public',
            });
          }
        } catch (err) {
          ctx.recordPersistenceError(roomId, writingSeq, writingEventType, err as Error);
          return { ok: false, error: 'persistence_failure' };
        }
      }
      ctx.rooms.set(roomId, room);
      published = true;
      return { ok: true, room };
    }
    return { ok: false, error: 'room_id_collision' };
  } finally {
    if (!published) {
      const release = ctx.releaseEngineReservation ?? releaseLiveEngineReservation;
      for (const id of new Set(admitted.map((seated) => seated.reservationId))) {
        if (id) release(id, 'room-create-failed');
      }
    }
  }
}

/**
 * Accept a correspondence seek: create the room and pre-seat BOTH accounts (the seek's
 * creator and the accepter) up front, so the game is live the instant the seek is taken —
 * before either player connects. Each seat-assigned event is durable in the log and
 * persists the seat token; players reclaim their seat by account on connect
 * (assignTenantSeat's user-id path), so no raw token is handed back.
 *
 * Generic over the tenant's colors: the seek stores MOVE ORDER ('first'/'second', migration
 * 106) and this maps it onto `tenant.colors`, whose [0] is the first mover by contract. That
 * is the whole reason a red/black variant can ride the same seek board as chess — callers
 * never name a color. A tenant with a dealt first mover rotates that order from
 * its recorded setup. Hoisted from the dark-chess-only original, which was already written
 * against generic Color/mintTenantSeatToken/appendTenantSeatAssigned and only looked
 * chess-specific because its args were named white/black.
 */
export async function createTenantCorrespondenceGameForSeek<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  ctx: TenantLiveRoomFactoryContext<Kind, C, M, State, Spec>,
  args: {
    timeControl: RoomTimeControl;
    /** The account taking the first-mover seat of this game's turn order. */
    first: { userId: string };
    /** The account taking the second seat (tenant.colors[1]). */
    second: { userId: string };
    /** A rated correspondence seek (the route admits it only for isCorrespondenceRatedSpec).
     *  Durable in the room-created event, so a hydrated room stays rated. */
    rated?: boolean;
  },
): Promise<TenantLiveRoomCreation<Kind, C, M, State, Spec>> {
  const created = await createTenantLiveRoom(tenant, ctx, {
    timeControl: args.timeControl,
    rated: args.rated === true,
  });
  if (!created.ok) return created;
  const room = created.room;
  const at = Date.now();
  const colors = tenantTurnOrder(tenant, room.projection.state);
  const seats: ReadonlyArray<readonly [C, { userId: string }]> = [
    [colors[0]!, args.first],
    [colors[1]!, args.second],
  ];
  for (const [seat, identity] of seats) {
    // The durable token stores only user_id. Resolve public names below once
    // both tokens are persisted, before either account needs to connect.
    const { state } = mintTenantSeatToken(room, seat, {
      userId: identity.userId,
      userHandle: null,
      userDisplayName: null,
    });
    await appendTenantSeatAssigned(tenant, room, {
      event: { type: 'seat-assigned', at, roomId: room.id, clientId: state.clientId, seat },
      tokenState: state,
    });
  }
  if (ctx.isPersistenceEnabled()) {
    const tokens = await persistence.loadRoomSeatTokens<persistence.RoomSeatTokenSeat>(room.id);
    for (const token of Object.values(tokens)) {
      if (!token) continue;
      const state = room.seatTokens[token.seat as C];
      // A reconnect can run while the lookup is pending. Fill only the public
      // identity of the same account, preserving its current connection/token.
      if (!state || state.userId !== token.userId) continue;
      state.userHandle = token.userHandle;
      state.userDisplayName = token.userDisplayName;
    }
  }
  return { ok: true, room };
}
