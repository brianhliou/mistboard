/**
 * Generic live-room creation for tenant rooms: id minting with cross-variant
 * collision retry, optional PvE engine seating (durable in the initial event
 * log so it replays on hydration), persistence-first event writes, and the
 * running-game record.
 */

import { randomUUID } from 'node:crypto';
import type { RoomTimeControl } from '@mistboard/game';
import type * as persistence from '../persistence.js';
import { appendTenantSeatAssigned } from './events.js';
import { appendTenantRuntimeEvent, createTenantRuntimeRoom } from './runtime.js';
import { mintTenantSeatToken } from './seat-session.js';
import type {
  TenantGameStateLike,
  TenantRoomEvent,
  TenantRuntimeRoom,
  VariantTenant,
} from './tenant.js';

/** PvE: seat an engine in `seat` at creation (its clientId is the engine id),
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
     * PvE at a table of more than two: every seat the humans are not taking.
     *
     * `engine` seats one opponent, which is the whole story for a two-player
     * game. A mahjong room against bots needs three, so this takes a list.
     * Supply one or the other, never both.
     */
    engines?: readonly TenantRoomEngineSeat<C>[];
    rated?: boolean;
  } = {},
): Promise<TenantLiveRoomCreation<Kind, C, M, State, Spec>> {
  const { timeControl, creatorPreference, engine, engines, rated = false } = options;
  if (engine && engines) {
    throw new Error('pass either engine or engines, not both');
  }
  const engineSeats: readonly TenantRoomEngineSeat<C>[] = engines ?? (engine ? [engine] : []);
  const firstEngine = engineSeats[0];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomId = ctx.createRoomId?.() ?? `${tenant.roomIdPrefix}${randomUUID()}`;
    if (ctx.rooms.has(roomId) || ctx.isRoomIdTaken(roomId)) {
      continue;
    }
    const created = createTenantRuntimeRoom(tenant, roomId, {
      creatorPreference,
      pveBotId: firstEngine?.botId,
      rated,
      timeControl,
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
    // One reservation per room, which is what the engine service issues. Bots
    // that run in-process (mahjong) hold none, and leave this null.
    room.engineReservationId = firstEngine?.reservationId ?? null;
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
            mode: engineSeats.length > 0 ? 'pve' : 'pvp',
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
    return { ok: true, room };
  }
  return { ok: false, error: 'room_id_collision' };
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
 * never name a color. Hoisted from the dark-chess-only original, which was already written
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
    /** The account taking the first-mover seat (tenant.colors[0]). */
    first: { userId: string };
    /** The account taking the second seat (tenant.colors[1]). */
    second: { userId: string };
  },
): Promise<TenantLiveRoomCreation<Kind, C, M, State, Spec>> {
  const created = await createTenantLiveRoom(tenant, ctx, { timeControl: args.timeControl });
  if (!created.ok) return created;
  const room = created.room;
  const at = Date.now();
  const seats: ReadonlyArray<readonly [C, { userId: string }]> = [
    [tenant.colors[0], args.first],
    [tenant.colors[1], args.second],
  ];
  for (const [seat, identity] of seats) {
    // handle/display resolve via the users join everywhere they're shown; the seat-token
    // row persists only user_id, so null here is exact, not lossy.
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
  return { ok: true, room };
}
