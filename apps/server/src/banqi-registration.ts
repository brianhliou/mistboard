/**
 * Banqi registry entry. Owns the tenant's live-room map, the room-factory
 * binding, and hydration. No rematch flow yet. Matchmaking is casual random-seat
 * (unrated); PvP, live-clock only (PvE and correspondence come later). Imported
 * for side effects by variant-tenant/register-tenants.ts.
 */

import { banqiInkForSeat, banqiStateToEngineFen, type RoomTimeControl } from '@mistboard/game';
import type { BanqiCreatorPreference, BanqiRuntimeRoom } from './banqi-runtime.js';
import { banqiTenant } from './banqi-tenant.js';
import { tenantCardBinding } from './game-card-tenant.js';
import { flipOrBoardMoveUci, tenantExportBinding } from './game-export-tenant.js';
import * as persistence from './persistence.js';
import { handleBanqiCreate, requestsBanqi } from './routes/banqi-rooms.js';
import { isAllowedFullTimeControl } from './routes/lib.js';
import {
  type BanqiLiveRoomCreation,
  type BanqiRoomEngineSeat,
  createBanqiLiveRoom,
} from './server-banqi-room-factory.js';
import {
  type BanqiLiveRoom,
  clearBanqiRuntimeTimers,
  handleBanqiWebSocketConnection,
} from './server-ws-banqi.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { countActiveTenantGames } from './variant-tenant/runtime.js';

export const banqiRooms = new Map<string, BanqiLiveRoom>();

export async function createBanqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: BanqiCreatorPreference,
  engine?: BanqiRoomEngineSeat,
): Promise<BanqiLiveRoomCreation> {
  return createBanqiLiveRoom(
    {
      appendRoomEvent: persistence.appendRoomEvent,
      banqiRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, banqiTenant.kind),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(banqiTenant, roomId, seq, eventType, err),
    },
    timeControl,
    creatorPreference,
    engine,
  );
}

export async function getOrLoadBanqiRoom(roomId: string): Promise<BanqiLiveRoom | null> {
  const room = await getOrLoadTenantRoom(
    banqiTenant,
    banqiRooms as unknown as Map<string, BanqiRuntimeRoom>,
    roomId,
  );
  return room as BanqiLiveRoom | null;
}

registerVariantTenant({
  kind: banqiTenant.kind,
  gameSpecId: banqiTenant.gameSpecId,
  roomIdPrefix: banqiTenant.roomIdPrefix,
  watch: {
    channelId: 'banqi',
    family: 'xiangqi',
    label: 'Banqi',
    legacyVariants: ['banqi'],
  },
  ownsSpecRouting: true,
  errorPrefix: 'banqi',
  enabled: banqiTenant.enabled,
  rooms: banqiRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(banqiRooms.values()),
  getOrLoadRoom: (roomId) => getOrLoadBanqiRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    handleBanqiWebSocketConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as BanqiLiveRoom,
    ),
  clearRuntimeTimers: (room) => clearBanqiRuntimeTimers(room as unknown as BanqiLiveRoom),
  clearRooms: () => banqiRooms.clear(),
  http: {
    matchesCreateRequest: requestsBanqi,
    handleCreate: (ctx, _request, response, body) =>
      handleBanqiCreate({ ...ctx, createBanqiRoom }, response, body),
  },
  lobby: {
    supportsRated: false,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl) => {
      const created = await createBanqiRoom(timeControl, 'random');
      if (!created.ok) throw new Error(`banqi_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // JSON only. Results are recorded by SEAT; the ink the first seat bound on its
  // opening flip rides along so a consumer can tell which pieces the winner played.
  export: tenantExportBinding(banqiTenant, {
    gameRouteBase: '/banqi/game',
    uci: flipOrBoardMoveUci,
    firstMoverInk: (state) => state.firstColor,
  }),
  // Final position only: a flip swings the eval by luck (VariantTenantCard).
  card: tenantCardBinding(banqiTenant, {
    variant: 'banqi',
    analysis: null,
    fen: banqiStateToEngineFen,
    seatInk: banqiInkForSeat,
  }),
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
