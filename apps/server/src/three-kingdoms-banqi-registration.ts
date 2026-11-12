/** Three Kingdoms Banqi registry: rated PvP, TV, cards and casual correspondence.
 * Public admission and listing follow the runtime access gate.
 * No export: covered identities stay masked after the game (#1002), and
 * an export would carry the deal, which names pieces nobody turned over. */

import {
  type BanqiSeat,
  banqiInkForSeat,
  type RoomTimeControl,
  threeKingdomsBanqiStateToPublicFen,
} from '@mistboard/game';
import { currentAccountUser } from './account-session.js';
import { threeKingdomsBanqiEnabled } from './feature-flags.js';
import { tenantCardBinding } from './game-card-tenant.js';
import * as persistence from './persistence.js';
import { isAllowedFullTimeControl } from './routes/lib.js';
import {
  handleThreeKingdomsBanqiCreate,
  requestsThreeKingdomsBanqi,
} from './routes/three-kingdoms-banqi-rooms.js';
import {
  scheduleThreeKingdomsBanqiEngineMove,
  type ThreeKingdomsBanqiEngineRoom,
} from './server-three-kingdoms-banqi-engine.js';
import { threeKingdomsBanqiAdmits } from './three-kingdoms-banqi-access.js';
import {
  type ThreeKingdomsBanqiEvent,
  type ThreeKingdomsBanqiRuntimeRoom,
  threeKingdomsBanqiTenant,
} from './three-kingdoms-banqi-tenant.js';
import { tenantCorrespondenceBinding } from './variant-tenant/correspondence.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import { pauseTenantRoomsOnShutdown } from './variant-tenant/lifecycle.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';
import { countActiveTenantGames, tenantReplayCheck } from './variant-tenant/runtime.js';
import { clearTenantRuntimeTimers, createTenantWsRuntime } from './variant-tenant/ws.js';

export const threeKingdomsBanqiRooms = new Map<string, ThreeKingdomsBanqiRuntimeRoom>();

export const threeKingdomsBanqiWs = createTenantWsRuntime(threeKingdomsBanqiTenant, {
  scheduleEngineMove: (ctx, room) => scheduleThreeKingdomsBanqiEngineMove(ctx, room),
});

export type ThreeKingdomsBanqiLiveRoomCreation =
  | { ok: true; room: ThreeKingdomsBanqiRuntimeRoom }
  | {
      ok: false;
      error: 'three_kingdoms_banqi_disabled' | 'persistence_failure' | 'room_id_collision';
    };

export async function createThreeKingdomsBanqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: BanqiSeat | 'random',
  engine?: { engineId: string; seat: BanqiSeat; botId?: string },
  rated = false,
): Promise<ThreeKingdomsBanqiLiveRoomCreation> {
  const created = await createTenantLiveRoom(
    threeKingdomsBanqiTenant,
    {
      rooms: threeKingdomsBanqiRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, threeKingdomsBanqiTenant.kind),
      appendRoomEvent: (roomId, seq, event: ThreeKingdomsBanqiEvent) =>
        persistence.appendRoomEvent(roomId, seq, event),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(threeKingdomsBanqiTenant, roomId, seq, eventType, err),
    },
    { timeControl, creatorPreference, engine, rated: engine ? false : rated },
  );
  if (!created.ok) {
    return created.error === 'disabled'
      ? { ok: false, error: 'three_kingdoms_banqi_disabled' }
      : { ok: false, error: created.error };
  }
  return { ok: true, room: created.room };
}

export function getOrLoadThreeKingdomsBanqiRoom(
  roomId: string,
): Promise<ThreeKingdomsBanqiRuntimeRoom | null> {
  return getOrLoadTenantRoom(threeKingdomsBanqiTenant, threeKingdomsBanqiRooms, roomId);
}

registerVariantTenant({
  kind: threeKingdomsBanqiTenant.kind,
  gameSpecId: threeKingdomsBanqiTenant.gameSpecId,
  roomIdPrefix: threeKingdomsBanqiTenant.roomIdPrefix,
  isEngineClientId: threeKingdomsBanqiTenant.engine?.isEngineClientId,
  engineDisplayName: (clientId) => threeKingdomsBanqiTenant.engine?.displayName(clientId) ?? null,
  ownsSpecRouting: true,
  replays: tenantReplayCheck(threeKingdomsBanqiTenant),
  errorPrefix: 'three_kingdoms_banqi',
  // Runtime kill-switch for TV, current games, lobby, bot profiles and live stats.
  enabled: threeKingdomsBanqiEnabled,
  admitsConnection: threeKingdomsBanqiAdmits,
  watch: {
    channelId: 'three-kingdoms-banqi',
    family: 'xiangqi',
    label: 'Three Kingdoms Banqi',
    legacyVariants: ['three-kingdoms-banqi'],
  },
  rooms: threeKingdomsBanqiRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () =>
    countActiveTenantGames(threeKingdomsBanqiRooms.values(), threeKingdomsBanqiTenant),
  getOrLoadRoom: (roomId) =>
    getOrLoadThreeKingdomsBanqiRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    threeKingdomsBanqiWs.handleConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as ThreeKingdomsBanqiEngineRoom,
    ),
  clearRuntimeTimers: (room) =>
    clearTenantRuntimeTimers(room as unknown as ThreeKingdomsBanqiEngineRoom),
  pauseOnShutdown: (at) =>
    pauseTenantRoomsOnShutdown(
      threeKingdomsBanqiTenant,
      threeKingdomsBanqiRooms.values(),
      threeKingdomsBanqiWs.lifecycleCtx,
      at,
    ),
  clearRooms: () => threeKingdomsBanqiRooms.clear(),
  http: {
    matchesCreateRequest: requestsThreeKingdomsBanqi,
    // The dispatcher resolves the account only for a rated request; the admin
    // fallback needs it for every create while the runtime flag is off.
    handleCreate: async (ctx, request, response, body, accountUser) =>
      handleThreeKingdomsBanqiCreate(
        { ...ctx, createThreeKingdomsBanqiRoom },
        response,
        body,
        accountUser ?? (await currentAccountUser(request)),
      ),
  },
  lobby: {
    supportsRated: true,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl, rated) => {
      const created = await createThreeKingdomsBanqiRoom(timeControl, 'random', undefined, rated);
      if (!created.ok) throw new Error(`three_kingdoms_banqi_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  reviewRouteBase: '/three-kingdoms-banqi/game',
  export: null,
  card: tenantCardBinding(threeKingdomsBanqiTenant, {
    variant: 'three-kingdoms-banqi',
    analysis: null,
    fen: threeKingdomsBanqiStateToPublicFen,
    seatInk: banqiInkForSeat,
  }),
  ...tenantCorrespondenceBinding(threeKingdomsBanqiTenant, {
    factoryContext: () => ({
      rooms: threeKingdomsBanqiRooms,
      isRoomIdTaken: (id) => variantTenantRoomIdTaken(id, threeKingdomsBanqiTenant.kind),
      appendRoomEvent: persistence.appendRoomEvent,
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (id, seq, type, err) =>
        recordTenantPersistenceError(threeKingdomsBanqiTenant, id, seq, type, err),
    }),
    getOrLoadRoom: getOrLoadThreeKingdomsBanqiRoom,
    lifecycleCtx: threeKingdomsBanqiWs.lifecycleCtx,
    casualOnly: true,
  }),
});
