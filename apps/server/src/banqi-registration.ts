/**
 * Banqi registry entry. Owns the tenant's live-room map, the room-factory
 * binding, and hydration. No rematch flow yet. Matchmaking is random-seat,
 * rated or casual (lobby.supportsRated); PvP, live-clock only (PvE and
 * correspondence come later). Imported
 * for side effects by variant-tenant/register-tenants.ts.
 */

import {
  banqiInkForSeat,
  banqiPlyReveal,
  banqiStateToDealtFen,
  banqiStateToEngineFen,
  type RoomTimeControl,
} from '@mistboard/game';
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
  banqiWs,
  clearBanqiRuntimeTimers,
  handleBanqiWebSocketConnection,
} from './server-ws-banqi.js';
import { tenantCorrespondenceBinding } from './variant-tenant/correspondence.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import { pauseTenantRoomsOnShutdown } from './variant-tenant/lifecycle.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { countActiveTenantGames, tenantReplayCheck } from './variant-tenant/runtime.js';

export const banqiRooms = new Map<string, BanqiLiveRoom>();

export async function createBanqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: BanqiCreatorPreference,
  engine?: BanqiRoomEngineSeat,
  // Lobby matchmaking only: POST /api/rooms (friend links, PvE) never forwards it.
  rated = false,
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
    rated,
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

// Correspondence (days-per-move): seek accept seats both accounts, the sweeper
// enforces the durable deadline through the ws runtime (variant-tenant/correspondence.ts).
const banqiCorrespondence = tenantCorrespondenceBinding(banqiTenant, {
  factoryContext: () => ({
    rooms: banqiRooms as unknown as Map<string, BanqiRuntimeRoom>,
    isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, banqiTenant.kind),
    appendRoomEvent: persistence.appendRoomEvent,
    isPersistenceEnabled: persistence.isInitialized,
    recordPersistenceError: (roomId, seq, eventType, err) =>
      recordTenantPersistenceError(banqiTenant, roomId, seq, eventType, err),
  }),
  getOrLoadRoom: (roomId) =>
    getOrLoadTenantRoom(
      banqiTenant,
      banqiRooms as unknown as Map<string, BanqiRuntimeRoom>,
      roomId,
    ),
  lifecycleCtx: banqiWs.lifecycleCtx,
});

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
  // TV / current-games composition labelling: the engine ids live in this
  // tenant's own namespace, which the shared isServerEngineClient heuristic
  // does not recognise, so without this binding a bot seat reads as a nameless
  // human and the game as PvP.
  isEngineClientId: banqiTenant.engine?.isEngineClientId,
  engineDisplayName: (clientId) => banqiTenant.engine?.displayName(clientId) ?? null,
  ownsSpecRouting: true,
  replays: tenantReplayCheck(banqiTenant),
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
  pauseOnShutdown: (at) =>
    pauseTenantRoomsOnShutdown(banqiTenant, banqiRooms.values(), banqiWs.lifecycleCtx, at),
  clearRooms: () => banqiRooms.clear(),
  http: {
    matchesCreateRequest: requestsBanqi,
    handleCreate: (ctx, _request, response, body) =>
      handleBanqiCreate({ ...ctx, createBanqiRoom }, response, body),
  },
  lobby: {
    supportsRated: true,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl, rated) => {
      const created = await createBanqiRoom(timeControl, 'random', undefined, rated);
      if (!created.ok) throw new Error(`banqi_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // Results are recorded by SEAT; the ink the first seat bound on its opening
  // flip rides along so a consumer can tell which pieces the winner played. Each
  // flip names what it turned over and the deal rides along; the PGN movetext is
  // ICGA's (#484, hidden-piece-record.ts).
  export: tenantExportBinding(banqiTenant, {
    gameRouteBase: '/banqi/game',
    uci: flipOrBoardMoveUci,
    firstMoverInk: (state) => state.firstColor,
    hiddenPieces: { variant: 'banqi', reveal: banqiPlyReveal, dealFen: banqiStateToDealtFen },
  }),
  // Final position only: a flip swings the eval by luck (VariantTenantCard).
  card: tenantCardBinding(banqiTenant, {
    variant: 'banqi',
    analysis: null,
    fen: banqiStateToEngineFen,
    seatInk: banqiInkForSeat,
  }),
  ...banqiCorrespondence,
});
