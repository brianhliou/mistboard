/**
 * Standard Xiangqi (9x10, open information) registry entry. Owns the tenant's
 * live-room map, the room-factory binding, and hydration. Matchmaking is casual
 * random-seat (unrated); the room factory has no rated options yet. Imported for
 * side effects by variant-tenant/register-tenants.ts.
 */

import { type RoomTimeControl, standardXiangqiFen } from '@mistboard/game';
import { tenantCardBinding } from './game-card-tenant.js';
import { tenantExportBinding } from './game-export-tenant.js';
import * as persistence from './persistence.js';
import { isAllowedFullTimeControl } from './routes/lib.js';
import { handleXiangqiCreate, requestsXiangqi } from './routes/xiangqi-rooms.js';
import {
  clearXiangqiRuntimeTimers,
  handleXiangqiWebSocketConnection,
  type XiangqiLiveRoom,
  xiangqiWs,
} from './server-ws-xiangqi.js';
import {
  createXiangqiLiveRoom,
  type XiangqiLiveRoomCreation,
  type XiangqiRoomEngineSeat,
} from './server-xiangqi-room-factory.js';
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
import { XIANGQI_ANALYSIS_ENGINE_ID, XIANGQI_ANALYSIS_REQUEST_DEPTH } from './xiangqi-analysis.js';
import {
  xiangqiExportUci,
  xiangqiPgnStyle,
  xiangqiPgnWriter,
  xiangqiWxfLabels,
} from './xiangqi-game-export.js';
import type { XiangqiCreatorPreference, XiangqiRuntimeRoom } from './xiangqi-runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

export const xiangqiRooms = new Map<string, XiangqiLiveRoom>();

export async function createXiangqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: XiangqiCreatorPreference,
  rated = false,
  engine?: XiangqiRoomEngineSeat,
): Promise<XiangqiLiveRoomCreation> {
  return createXiangqiLiveRoom(
    {
      appendRoomEvent: persistence.appendRoomEvent,
      xiangqiRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, xiangqiTenant.kind),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(xiangqiTenant, roomId, seq, eventType, err),
    },
    timeControl,
    creatorPreference,
    rated,
    engine,
  );
}

export async function getOrLoadXiangqiRoom(roomId: string): Promise<XiangqiLiveRoom | null> {
  // The live map stores rooms with connected-client sets; hydration only ever
  // inserts freshly loaded rooms (empty client set), same as the factory cast.
  const room = await getOrLoadTenantRoom(
    xiangqiTenant,
    xiangqiRooms as unknown as Map<string, XiangqiRuntimeRoom>,
    roomId,
  );
  return room as XiangqiLiveRoom | null;
}

// Correspondence: seek accept seats both accounts (`first` lands on red,
// xiangqiTenant.colors[0]), and the sweeper enforces the durable deadline through
// the ws runtime's lifecycle context. recordGameStart stays omitted to match
// createXiangqiRoom: xiangqi deliberately keeps no running-game record at creation.
const xiangqiCorrespondence = tenantCorrespondenceBinding(xiangqiTenant, {
  factoryContext: () => ({
    rooms: xiangqiRooms as unknown as Map<string, XiangqiRuntimeRoom>,
    isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, xiangqiTenant.kind),
    appendRoomEvent: persistence.appendRoomEvent,
    isPersistenceEnabled: persistence.isInitialized,
    recordPersistenceError: (roomId, seq, eventType, err) =>
      recordTenantPersistenceError(xiangqiTenant, roomId, seq, eventType, err),
  }),
  getOrLoadRoom: (roomId) =>
    getOrLoadTenantRoom(
      xiangqiTenant,
      xiangqiRooms as unknown as Map<string, XiangqiRuntimeRoom>,
      roomId,
    ),
  lifecycleCtx: xiangqiWs.lifecycleCtx,
});

registerVariantTenant({
  kind: xiangqiTenant.kind,
  gameSpecId: xiangqiTenant.gameSpecId,
  roomIdPrefix: xiangqiTenant.roomIdPrefix,
  watch: {
    channelId: 'xiangqi',
    family: 'xiangqi',
    label: 'Xiangqi',
    legacyVariants: ['xiangqi'],
  },
  isEngineClientId: xiangqiTenant.engine?.isEngineClientId,
  engineDisplayName: (clientId) => xiangqiTenant.engine?.displayName(clientId) ?? null,
  ownsSpecRouting: true,
  replays: tenantReplayCheck(xiangqiTenant),
  errorPrefix: 'xiangqi',
  enabled: xiangqiTenant.enabled,
  rooms: xiangqiRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(xiangqiRooms.values()),
  getOrLoadRoom: (roomId) => getOrLoadXiangqiRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    handleXiangqiWebSocketConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as XiangqiLiveRoom,
    ),
  clearRuntimeTimers: (room) => clearXiangqiRuntimeTimers(room as unknown as XiangqiLiveRoom),
  pauseOnShutdown: (at) =>
    pauseTenantRoomsOnShutdown(xiangqiTenant, xiangqiRooms.values(), xiangqiWs.lifecycleCtx, at),
  clearRooms: () => xiangqiRooms.clear(),
  http: {
    matchesCreateRequest: requestsXiangqi,
    // POST /api/rooms resolves the account for a rated request (registry.ts).
    handleCreate: (ctx, _request, response, body, accountUser) =>
      handleXiangqiCreate({ ...ctx, createXiangqiRoom }, response, body, accountUser),
  },
  lobby: {
    supportsRated: true,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl, rated) => {
      const created = await createXiangqiRoom(timeControl, 'random', rated);
      if (!created.ok) throw new Error(`xiangqi_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // WXF movetext + `san` when the line replays under standard rules (it always
  // should for this tenant); ICCS coordinates otherwise. See xiangqi-game-export.ts.
  export: tenantExportBinding(xiangqiTenant, {
    gameRouteBase: '/xiangqi/game',
    uci: xiangqiExportUci,
    san: xiangqiWxfLabels,
    writePgn: (moves) => xiangqiPgnWriter(moves, xiangqiPgnStyle(moves)),
  }),
  card: tenantCardBinding(xiangqiTenant, {
    variant: 'xiangqi',
    analysis: { engineId: XIANGQI_ANALYSIS_ENGINE_ID, depth: XIANGQI_ANALYSIS_REQUEST_DEPTH },
    fen: standardXiangqiFen,
  }),
  ...xiangqiCorrespondence,
});
