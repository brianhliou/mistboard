/**
 * Mahjong registry entry.
 *
 * Narrower than every other registration here, deliberately. No watch channel,
 * no lobby seek, no export binding, no correspondence: a variant whose scoring
 * has never been checked by somebody who plays the game should not be on
 * Mistboard TV, should not advertise itself in the lobby, and should not be
 * publishing game records. All of that can be added the day a player has walked
 * the faan table; none of it should arrive before then.
 *
 * NOT yet imported by register-tenants.ts, deliberately. The moment it is, the
 * web/server parity test demands a matching WEB_VARIANT_TENANTS entry, and that
 * needs a live-room client that does not exist yet. Jieqi was staged the same
 * way: the module and its contract land first, the side-effect import is the
 * capstone. Adding that one line is what turns this on.
 *
 * The room is PvE by construction. The creator takes one seat and the factory
 * fills the other three with the kernel's efficiency bot, which runs in-process
 * and needs no engine service, no reservation and no warm session.
 */

import type { MAHJONG_SPEC_ID, RoomTimeControl } from '@mistboard/game';
import type { MahjongMove, MahjongSeat, MahjongTenantState } from '@mistboard/mahjong';
import { type MahjongEvent, mahjongTenant } from './mahjong-tenant.js';
import * as persistence from './persistence.js';
import { handleMahjongCreate, requestsMahjong } from './routes/mahjong-rooms.js';
import {
  isMahjongBotClientId,
  MAHJONG_BOT_CLIENT_ID,
  MAHJONG_BOT_ID,
  scheduleMahjongBotMove,
} from './server-mahjong-bots.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';
import { countActiveTenantGames } from './variant-tenant/runtime.js';
import type { TenantRuntimeRoom } from './variant-tenant/tenant.js';
import {
  clearTenantRuntimeTimers,
  createTenantWsRuntime,
  type TenantLiveRoom,
} from './variant-tenant/ws.js';

export type MahjongRuntimeRoom = TenantRuntimeRoom<
  'mahjong',
  MahjongSeat,
  MahjongMove,
  MahjongTenantState,
  typeof MAHJONG_SPEC_ID
>;

type MahjongLiveRoom = TenantLiveRoom<
  'mahjong',
  MahjongSeat,
  MahjongMove,
  MahjongTenantState,
  typeof MAHJONG_SPEC_ID
>;

export type MahjongLiveRoomCreation =
  | { ok: true; room: MahjongRuntimeRoom }
  | { ok: false; error: 'mahjong_disabled' | 'persistence_failure' | 'room_id_collision' };

export const mahjongRooms = new Map<string, MahjongRuntimeRoom>();

const mahjongWs = createTenantWsRuntime(mahjongTenant, {
  scheduleEngineMove: (ctx, room) => scheduleMahjongBotMove(ctx, room as MahjongRuntimeRoom),
});

export async function createMahjongRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: MahjongSeat | 'random',
): Promise<MahjongLiveRoomCreation> {
  // The human's seat, resolved here rather than left to chance, so the other
  // three can be filled before the room is persisted. A 'random' preference is
  // resolved by the factory's own seat assignment, so pin it to east and let
  // the creator ask for a different wind explicitly.
  const humanSeat: MahjongSeat =
    creatorPreference && creatorPreference !== 'random' ? creatorPreference : 'east';
  const created = await createTenantLiveRoom(
    mahjongTenant,
    {
      rooms: mahjongRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, mahjongTenant.kind),
      appendRoomEvent: (roomId, seq, event: MahjongEvent) =>
        persistence.appendRoomEvent(roomId, seq, event),
      isPersistenceEnabled: persistence.isInitialized,
      recordGameStart: persistence.recordGameStart,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(mahjongTenant, roomId, seq, eventType, err),
    },
    {
      timeControl,
      creatorPreference: humanSeat,
      // Every seat but the human's. Seated at creation, so they are part of the
      // room's initial event log and survive hydration.
      engines: mahjongTenant.colors
        .filter((seat) => seat !== humanSeat)
        .map((seat) => ({ engineId: MAHJONG_BOT_CLIENT_ID, seat, botId: MAHJONG_BOT_ID })),
    },
  );
  if (!created.ok) {
    return created.error === 'disabled'
      ? { ok: false, error: 'mahjong_disabled' }
      : { ok: false, error: created.error };
  }
  return created;
}

export function getOrLoadMahjongRoom(roomId: string): Promise<MahjongRuntimeRoom | null> {
  return getOrLoadTenantRoom(mahjongTenant, mahjongRooms, roomId);
}

registerVariantTenant({
  kind: mahjongTenant.kind,
  gameSpecId: mahjongTenant.gameSpecId,
  roomIdPrefix: mahjongTenant.roomIdPrefix,
  isEngineClientId: isMahjongBotClientId,
  engineDisplayName: (clientId) => (isMahjongBotClientId(clientId) ? 'Mahjong bot' : null),
  ownsSpecRouting: true,
  errorPrefix: 'mahjong',
  enabled: mahjongTenant.enabled,
  // No TV channel. A table whose scoring is unverified should not be the board
  // a visitor to the homepage happens to land on.
  watch: null,
  rooms: mahjongRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(mahjongRooms.values()),
  getOrLoadRoom: (roomId) => getOrLoadMahjongRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    mahjongWs.handleConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as MahjongLiveRoom,
    ),
  clearRuntimeTimers: (room) => clearTenantRuntimeTimers(room as unknown as MahjongLiveRoom),
  clearRooms: () => mahjongRooms.clear(),
  http: {
    matchesCreateRequest: requestsMahjong,
    handleCreate: async (ctx, _request, response, body) => {
      await handleMahjongCreate({ ...ctx, createMahjongRoom }, response, body, null);
    },
  },
  lobby: null,
  // No export binding. Mahjong has no UCI and no established text format here,
  // and inventing one before the rules are confirmed would mean publishing
  // records in a notation we might have to change.
  export: null,
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
