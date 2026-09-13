/**
 * Flip Jungle registry entry. Owns the tenant's live-room map, the room-factory
 * binding, and hydration. PvP + PvE (Tier-B MistyJungleFlip UCI engine);
 * matchmaking is casual random-seat (unrated). Imported for side effects by
 * variant-tenant/register-tenants.ts.
 */

import {
  jungleFlipInkForSeat,
  jungleFlipStateToEngineFen,
  type RoomTimeControl,
} from '@mistboard/game';
import { tenantCardBinding } from './game-card-tenant.js';
import { flipOrBoardMoveUci, tenantExportBinding } from './game-export-tenant.js';
import type { JungleFlipCreatorPreference, JungleFlipRuntimeRoom } from './jungle-flip-runtime.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import * as persistence from './persistence.js';
import { handleJungleFlipCreate, requestsJungleFlip } from './routes/jungle-flip-rooms.js';
import { isAllowedFullTimeControl } from './routes/lib.js';
import {
  createJungleFlipLiveRoom,
  type JungleFlipLiveRoomCreation,
  type JungleFlipRoomEngineSeat,
} from './server-jungle-flip-room-factory.js';
import {
  clearJungleFlipRuntimeTimers,
  handleJungleFlipWebSocketConnection,
  type JungleFlipLiveRoom,
} from './server-ws-jungle-flip.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { countActiveTenantGames } from './variant-tenant/runtime.js';

export const jungleFlipRooms = new Map<string, JungleFlipLiveRoom>();

export async function createJungleFlipRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: JungleFlipCreatorPreference,
  engine?: JungleFlipRoomEngineSeat,
): Promise<JungleFlipLiveRoomCreation> {
  return createJungleFlipLiveRoom(
    {
      appendRoomEvent: persistence.appendRoomEvent,
      jungleFlipRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, jungleFlipTenant.kind),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(jungleFlipTenant, roomId, seq, eventType, err),
    },
    timeControl,
    creatorPreference,
    engine,
  );
}

export async function getOrLoadJungleFlipRoom(roomId: string): Promise<JungleFlipLiveRoom | null> {
  const room = await getOrLoadTenantRoom(
    jungleFlipTenant,
    jungleFlipRooms as unknown as Map<string, JungleFlipRuntimeRoom>,
    roomId,
  );
  return room as JungleFlipLiveRoom | null;
}

registerVariantTenant({
  kind: jungleFlipTenant.kind,
  gameSpecId: jungleFlipTenant.gameSpecId,
  roomIdPrefix: jungleFlipTenant.roomIdPrefix,
  watch: {
    channelId: 'jungle-flip',
    family: 'jungle',
    label: 'Flip Jungle',
    legacyVariants: ['jungle-flip'],
  },
  ownsSpecRouting: true,
  errorPrefix: 'jungle_flip',
  enabled: jungleFlipTenant.enabled,
  rooms: jungleFlipRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(jungleFlipRooms.values()),
  getOrLoadRoom: (roomId) => getOrLoadJungleFlipRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    handleJungleFlipWebSocketConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as JungleFlipLiveRoom,
    ),
  clearRuntimeTimers: (room) => clearJungleFlipRuntimeTimers(room as unknown as JungleFlipLiveRoom),
  clearRooms: () => jungleFlipRooms.clear(),
  http: {
    matchesCreateRequest: requestsJungleFlip,
    handleCreate: (ctx, _request, response, body) =>
      handleJungleFlipCreate({ ...ctx, createJungleFlipRoom }, response, body),
  },
  lobby: {
    supportsRated: false,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl) => {
      const created = await createJungleFlipRoom(timeControl, 'random');
      if (!created.ok) throw new Error(`jungle_flip_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // JSON only. As in banqi, results are by SEAT and the first seat's bound ink
  // rides along.
  export: tenantExportBinding(jungleFlipTenant, {
    gameRouteBase: '/jungle-flip/game',
    uci: flipOrBoardMoveUci,
    firstMoverInk: (state) => state.firstColor,
  }),
  // Final position only: a flip swings the eval by luck (VariantTenantCard).
  card: tenantCardBinding(jungleFlipTenant, {
    variant: 'jungle-flip',
    analysis: null,
    fen: jungleFlipStateToEngineFen,
    seatInk: jungleFlipInkForSeat,
  }),
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
