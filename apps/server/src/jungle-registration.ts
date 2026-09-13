/**
 * Jungle registry entry. Owns the tenant's live-room map, the room-factory binding,
 * and hydration. PvP, live-clock only at this checkpoint (PvE bot + correspondence
 * come later). Matchmaking is casual random-seat (unrated). Imported for side
 * effects by variant-tenant/register-tenants.ts.
 */

import { jungleStateToEngineFen, type RoomTimeControl } from '@mistboard/game';
import { tenantCardBinding } from './game-card-tenant.js';
import { boardMoveUci, tenantExportBinding } from './game-export-tenant.js';
import { JUNGLE_ANALYSIS_DEPTH, JUNGLE_ANALYSIS_ENGINE_ID } from './jungle-analysis.js';
import type { JungleCreatorPreference, JungleRuntimeRoom } from './jungle-runtime.js';
import { jungleTenant } from './jungle-tenant.js';
import * as persistence from './persistence.js';
import { handleJungleCreate, requestsJungle } from './routes/jungle-rooms.js';
import { isAllowedFullTimeControl } from './routes/lib.js';
import {
  createJungleLiveRoom,
  type JungleLiveRoomCreation,
  type JungleRoomEngineSeat,
} from './server-jungle-room-factory.js';
import {
  clearJungleRuntimeTimers,
  handleJungleWebSocketConnection,
  type JungleLiveRoom,
} from './server-ws-jungle.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { countActiveTenantGames } from './variant-tenant/runtime.js';

export const jungleRooms = new Map<string, JungleLiveRoom>();

export async function createJungleRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: JungleCreatorPreference,
  engine?: JungleRoomEngineSeat,
): Promise<JungleLiveRoomCreation> {
  return createJungleLiveRoom(
    {
      appendRoomEvent: persistence.appendRoomEvent,
      jungleRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, jungleTenant.kind),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(jungleTenant, roomId, seq, eventType, err),
    },
    timeControl,
    creatorPreference,
    engine,
  );
}

export async function getOrLoadJungleRoom(roomId: string): Promise<JungleLiveRoom | null> {
  const room = await getOrLoadTenantRoom(
    jungleTenant,
    jungleRooms as unknown as Map<string, JungleRuntimeRoom>,
    roomId,
  );
  return room as JungleLiveRoom | null;
}

registerVariantTenant({
  kind: jungleTenant.kind,
  gameSpecId: jungleTenant.gameSpecId,
  roomIdPrefix: jungleTenant.roomIdPrefix,
  watch: {
    channelId: 'jungle',
    family: 'jungle',
    label: 'Jungle Chess',
    legacyVariants: ['jungle'],
  },
  isEngineClientId: jungleTenant.engine?.isEngineClientId,
  engineDisplayName: (clientId) => jungleTenant.engine?.displayName(clientId) ?? null,
  ownsSpecRouting: true,
  errorPrefix: 'jungle',
  enabled: jungleTenant.enabled,
  rooms: jungleRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(jungleRooms.values()),
  getOrLoadRoom: (roomId) => getOrLoadJungleRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    handleJungleWebSocketConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as JungleLiveRoom,
    ),
  clearRuntimeTimers: (room) => clearJungleRuntimeTimers(room as unknown as JungleLiveRoom),
  clearRooms: () => jungleRooms.clear(),
  http: {
    matchesCreateRequest: requestsJungle,
    handleCreate: (ctx, _request, response, body) =>
      handleJungleCreate({ ...ctx, createJungleRoom }, response, body),
  },
  lobby: {
    supportsRated: false,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl) => {
      const created = await createJungleRoom(timeControl, 'random');
      if (!created.ok) throw new Error(`jungle_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // JSON only: jungle has no move notation beyond coordinates.
  export: tenantExportBinding(jungleTenant, {
    gameRouteBase: '/jungle/game',
    uci: boardMoveUci,
  }),
  card: tenantCardBinding(jungleTenant, {
    variant: 'jungle',
    analysis: { engineId: JUNGLE_ANALYSIS_ENGINE_ID, depth: JUNGLE_ANALYSIS_DEPTH },
    fen: jungleStateToEngineFen,
  }),
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
