/**
 * Fortress Xiangqi registry entry. Owns the tenant's live-room map and binds the
 * generic tenant room factory, hydration, WebSocket runtime, HTTP create route,
 * lobby route, and watch metadata.
 */

import type {
  FORTRESS_XIANGQI_SPEC_ID,
  FortressXiangqiColor,
  FortressXiangqiGameState,
  FortressXiangqiMove,
  RoomTimeControl,
} from '@mistboard/game';
import { fortressXiangqiEngineFen } from '@mistboard/game';
import { currentAccountUser } from './account-session.js';
import {
  FORTRESS_XIANGQI_ANALYSIS_DEPTH,
  FORTRESS_XIANGQI_ANALYSIS_ENGINE_ID,
} from './fortress-xiangqi-fsf-engine.js';
import { type FortressXiangqiEvent, fortressXiangqiTenant } from './fortress-xiangqi-tenant.js';
import { tenantCardBinding } from './game-card-tenant.js';
import { fortressXiangqiExportUci, tenantExportBinding } from './game-export-tenant.js';
import * as persistence from './persistence.js';
import {
  handleFortressXiangqiCreate,
  requestsFortressXiangqi,
} from './routes/fortress-xiangqi-rooms.js';
import { isAllowedFullTimeControl } from './routes/lib.js';
import { scheduleFortressXiangqiEngineMove } from './server-fortress-xiangqi-engine.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import type { TenantRoomEngineSeat } from './variant-tenant/room-factory.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';
import { countActiveTenantGames } from './variant-tenant/runtime.js';
import type { TenantRuntimeRoom } from './variant-tenant/tenant.js';
import {
  clearTenantRuntimeTimers,
  createTenantWsRuntime,
  type TenantLiveRoom,
} from './variant-tenant/ws.js';

export type FortressXiangqiRuntimeRoom = TenantRuntimeRoom<
  'fortress-xiangqi',
  FortressXiangqiColor,
  FortressXiangqiMove,
  FortressXiangqiGameState,
  typeof FORTRESS_XIANGQI_SPEC_ID
>;

type FortressXiangqiLiveRoom = TenantLiveRoom<
  'fortress-xiangqi',
  FortressXiangqiColor,
  FortressXiangqiMove,
  FortressXiangqiGameState,
  typeof FORTRESS_XIANGQI_SPEC_ID
>;

export type FortressXiangqiLiveRoomCreation =
  | { ok: true; room: FortressXiangqiRuntimeRoom }
  | {
      ok: false;
      error: 'fortress_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision';
    };

export const fortressXiangqiRooms = new Map<string, FortressXiangqiRuntimeRoom>();

const fortressXiangqiWs = createTenantWsRuntime(fortressXiangqiTenant, {
  scheduleEngineMove: (ctx, room) => scheduleFortressXiangqiEngineMove(ctx, room),
});

export async function createFortressXiangqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: FortressXiangqiColor | 'random',
  rated = false,
  engine?: TenantRoomEngineSeat<FortressXiangqiColor>,
): Promise<FortressXiangqiLiveRoomCreation> {
  const created = await createTenantLiveRoom(
    fortressXiangqiTenant,
    {
      rooms: fortressXiangqiRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, fortressXiangqiTenant.kind),
      appendRoomEvent: (roomId, seq, event: FortressXiangqiEvent) =>
        persistence.appendRoomEvent(roomId, seq, event),
      isPersistenceEnabled: persistence.isInitialized,
      recordGameStart: persistence.recordGameStart,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(fortressXiangqiTenant, roomId, seq, eventType, err),
    },
    { timeControl, creatorPreference, rated, engine },
  );
  if (!created.ok) {
    return created.error === 'disabled'
      ? { ok: false, error: 'fortress_xiangqi_disabled' }
      : { ok: false, error: created.error };
  }
  return created;
}

export function getOrLoadFortressXiangqiRoom(
  roomId: string,
): Promise<FortressXiangqiRuntimeRoom | null> {
  return getOrLoadTenantRoom(fortressXiangqiTenant, fortressXiangqiRooms, roomId);
}

registerVariantTenant({
  kind: fortressXiangqiTenant.kind,
  gameSpecId: fortressXiangqiTenant.gameSpecId,
  roomIdPrefix: fortressXiangqiTenant.roomIdPrefix,
  watch: {
    channelId: 'fortress-xiangqi',
    family: 'xiangqi',
    label: 'Fortress Xiangqi',
    legacyVariants: ['fortress-xiangqi'],
  },
  isEngineClientId: fortressXiangqiTenant.engine?.isEngineClientId,
  engineDisplayName: (clientId) => fortressXiangqiTenant.engine?.displayName(clientId) ?? null,
  ownsSpecRouting: true,
  errorPrefix: 'fortress_xiangqi',
  enabled: fortressXiangqiTenant.enabled,
  rooms: fortressXiangqiRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(fortressXiangqiRooms.values()),
  getOrLoadRoom: (roomId) =>
    getOrLoadFortressXiangqiRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    fortressXiangqiWs.handleConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as FortressXiangqiLiveRoom,
    ),
  clearRuntimeTimers: (room) =>
    clearTenantRuntimeTimers(room as unknown as FortressXiangqiLiveRoom),
  clearRooms: () => fortressXiangqiRooms.clear(),
  http: {
    matchesCreateRequest: requestsFortressXiangqi,
    handleCreate: async (ctx, request, response, body) => {
      const accountUser = body.rated === true ? await currentAccountUser(request) : null;
      await handleFortressXiangqiCreate(
        { ...ctx, createFortressXiangqiRoom },
        response,
        body,
        accountUser,
      );
    },
  },
  lobby: {
    supportsRated: true,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl, rated) => {
      const created = await createFortressXiangqiRoom(timeControl, 'random', rated);
      if (!created.ok) throw new Error(`fortress_xiangqi_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // JSON only: drops ("R@d4") have no notation standard on this board.
  export: tenantExportBinding(fortressXiangqiTenant, {
    gameRouteBase: '/fortress-xiangqi/game',
    uci: fortressXiangqiExportUci,
  }),
  card: tenantCardBinding(fortressXiangqiTenant, {
    variant: 'fortress-xiangqi',
    analysis: {
      engineId: FORTRESS_XIANGQI_ANALYSIS_ENGINE_ID,
      depth: FORTRESS_XIANGQI_ANALYSIS_DEPTH,
    },
    fen: fortressXiangqiEngineFen,
  }),
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
