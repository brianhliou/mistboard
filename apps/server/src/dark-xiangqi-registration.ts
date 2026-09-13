/**
 * Dark Xiangqi (9x10, hidden/dev-only) registry entry. Owns the tenant's
 * live-room map, the room-factory binding, and hydration (moved out of
 * index.ts at the registry dispatch collapse). No rematch flow yet. Matchmaking
 * is casual random-seat (unrated) and gated by the tenant enable flag. Imported
 * for side effects by variant-tenant/register-tenants.ts.
 */

import { type RoomTimeControl, standardXiangqiFen } from '@mistboard/game';
import type {
  DarkXiangqiCreatorPreference,
  DarkXiangqiRuntimeRoom,
} from './dark-xiangqi-runtime.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import { tenantCardBinding } from './game-card-tenant.js';
import { tenantExportBinding } from './game-export-tenant.js';
import * as persistence from './persistence.js';
import { handleDarkXiangqiCreate, requestsDarkXiangqi } from './routes/dark-xiangqi-rooms.js';
import { isAllowedFullTimeControl } from './routes/lib.js';
import {
  createDarkXiangqiLiveRoom,
  type DarkXiangqiLiveRoomCreation,
  type DarkXiangqiRoomEngineSeat,
} from './server-dark-xiangqi-room-factory.js';
import {
  clearDarkXiangqiRuntimeTimers,
  type DarkXiangqiLiveRoom,
  handleDarkXiangqiWebSocketConnection,
} from './server-ws-dark-xiangqi.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { countActiveTenantGames } from './variant-tenant/runtime.js';
import { xiangqiExportUci, xiangqiPgnWriter } from './xiangqi-game-export.js';

export const darkXiangqiRooms = new Map<string, DarkXiangqiLiveRoom>();

export async function createDarkXiangqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: DarkXiangqiCreatorPreference,
  engine?: DarkXiangqiRoomEngineSeat,
): Promise<DarkXiangqiLiveRoomCreation> {
  return createDarkXiangqiLiveRoom(
    {
      appendRoomEvent: persistence.appendRoomEvent,
      darkXiangqiRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, darkXiangqiTenant.kind),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(darkXiangqiTenant, roomId, seq, eventType, err),
    },
    timeControl,
    creatorPreference,
    engine,
  );
}

export async function getOrLoadDarkXiangqiRoom(
  roomId: string,
): Promise<DarkXiangqiLiveRoom | null> {
  // The live map stores rooms with connected-client sets; hydration only ever
  // inserts freshly loaded rooms (empty client set), same as the factory cast.
  const room = await getOrLoadTenantRoom(
    darkXiangqiTenant,
    darkXiangqiRooms as unknown as Map<string, DarkXiangqiRuntimeRoom>,
    roomId,
  );
  return room as DarkXiangqiLiveRoom | null;
}

registerVariantTenant({
  kind: darkXiangqiTenant.kind,
  gameSpecId: darkXiangqiTenant.gameSpecId,
  roomIdPrefix: darkXiangqiTenant.roomIdPrefix,
  watch: {
    channelId: 'dark-xiangqi',
    family: 'xiangqi',
    label: 'Fog Xiangqi',
    legacyVariants: ['dark-xiangqi'],
  },
  ownsSpecRouting: true,
  errorPrefix: 'dark_xiangqi',
  enabled: darkXiangqiTenant.enabled,
  rooms: darkXiangqiRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(darkXiangqiRooms.values()),
  getOrLoadRoom: (roomId) => getOrLoadDarkXiangqiRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    handleDarkXiangqiWebSocketConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as DarkXiangqiLiveRoom,
    ),
  clearRuntimeTimers: (room) =>
    clearDarkXiangqiRuntimeTimers(room as unknown as DarkXiangqiLiveRoom),
  clearRooms: () => darkXiangqiRooms.clear(),
  http: {
    matchesCreateRequest: requestsDarkXiangqi,
    handleCreate: (ctx, _request, response, body) =>
      handleDarkXiangqiCreate({ ...ctx, createDarkXiangqiRoom }, response, body),
  },
  lobby: {
    supportsRated: false,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl) => {
      const created = await createDarkXiangqiRoom(timeControl, 'random');
      if (!created.ok) throw new Error(`dark_xiangqi_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // Fog moves may be illegal under standard rules (walking into check, taking
  // the general), so the movetext is ICCS coordinates and there is no WXF `san`;
  // position-relative notation would silently go wrong. See xiangqi-game-export.ts.
  export: tenantExportBinding(darkXiangqiTenant, {
    gameRouteBase: '/dark-xiangqi/game',
    uci: xiangqiExportUci,
    writePgn: (moves) => xiangqiPgnWriter(moves, 'iccs'),
  }),
  // A finished fog game reveals in full (the finished-room rule), so the card
  // draws the whole board. No analysis exists for fog xiangqi: final position.
  card: tenantCardBinding(darkXiangqiTenant, {
    variant: 'dark-xiangqi',
    analysis: null,
    fen: standardXiangqiFen,
  }),
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
