/**
 * Three Kingdoms banqi (#628) registry entry: an admin-only prod playtest (#684).
 *
 * As narrow as mahjong's: no TV channel, no lobby seek, no export, no card, no
 * correspondence, never rated. A finished game has a review page
 * (/three-kingdoms-banqi/game/:id), behind the same admin gate. A room exists only through the create route,
 * which admits an admin account, or anyone when the local flag
 * MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED=true (three-kingdoms-banqi-access.ts).
 * The WebSocket door applies the same rule to every connection, live room or
 * persisted (admitsConnection). enabled() stays the env flag, so every listing
 * surface skips the variant. PvE seats the Rust engine
 * (three-kingdoms-banqi-engine.ts) when its binary resolves.
 */

import type { BanqiSeat, RoomTimeControl } from '@mistboard/game';
import { currentAccountUser } from './account-session.js';
import { threeKingdomsBanqiEnabled } from './feature-flags.js';
import * as persistence from './persistence.js';
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
    { timeControl, creatorPreference, engine, rated: false },
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
  // The env flag only: listing surfaces (current games, TV, lobby, bot
  // profiles, live stats) read this and must not show the admin playtest.
  enabled: threeKingdomsBanqiEnabled,
  admitsConnection: threeKingdomsBanqiAdmits,
  watch: null,
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
    // gate needs it for every create.
    handleCreate: async (ctx, request, response, body, accountUser) =>
      handleThreeKingdomsBanqiCreate(
        { ...ctx, createThreeKingdomsBanqiRoom },
        response,
        body,
        accountUser ?? (await currentAccountUser(request)),
      ),
  },
  lobby: null,
  // The review page (routes/three-kingdoms-banqi-games.ts, admin-gated like the
  // rooms), with no export: a playtest game is not downloadable.
  reviewRouteBase: '/three-kingdoms-banqi/game',
  export: null,
  card: null,
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
