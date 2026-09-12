/**
 * Kriegspiel registry entry. Owns the tenant's live-room map, the room-factory
 * binding, hydration, and watch channel metadata. No rematch/lobby yet
 * (deep-link PvP only, like the Dark Xiangqi
 * launches) — the lobby route answers kriegspiel_not_integrated while the flag
 * is on. Imported for side effects by variant-tenant/register-tenants.ts.
 */

import type { RoomTimeControl } from '@mistboard/game';
import type { KriegspielCreatorPreference, KriegspielRuntimeRoom } from './kriegspiel-runtime.js';
import { kriegspielTenant } from './kriegspiel-tenant.js';
import * as persistence from './persistence.js';
import { handleKriegspielCreate, requestsKriegspiel } from './routes/kriegspiel-rooms.js';
import {
  createKriegspielLiveRoom,
  type KriegspielLiveRoomCreation,
} from './server-kriegspiel-room-factory.js';
import {
  clearKriegspielRuntimeTimers,
  handleKriegspielWebSocketConnection,
  type KriegspielLiveRoom,
} from './server-ws-kriegspiel.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { countActiveTenantGames } from './variant-tenant/runtime.js';

export const kriegspielRooms = new Map<string, KriegspielLiveRoom>();

export async function createKriegspielRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: KriegspielCreatorPreference,
): Promise<KriegspielLiveRoomCreation> {
  return createKriegspielLiveRoom(
    {
      appendRoomEvent: persistence.appendRoomEvent,
      kriegspielRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, kriegspielTenant.kind),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(kriegspielTenant, roomId, seq, eventType, err),
    },
    timeControl,
    creatorPreference,
  );
}

export async function getOrLoadKriegspielRoom(roomId: string): Promise<KriegspielLiveRoom | null> {
  const room = await getOrLoadTenantRoom(
    kriegspielTenant,
    kriegspielRooms as unknown as Map<string, KriegspielRuntimeRoom>,
    roomId,
  );
  return room as KriegspielLiveRoom | null;
}

registerVariantTenant({
  kind: kriegspielTenant.kind,
  gameSpecId: kriegspielTenant.gameSpecId,
  roomIdPrefix: kriegspielTenant.roomIdPrefix,
  watch: {
    channelId: kriegspielTenant.gameSpecId,
    label: 'Kriegspiel',
    family: 'chess',
    legacyVariants: ['kriegspiel'],
  },
  ownsSpecRouting: true,
  errorPrefix: 'kriegspiel',
  enabled: kriegspielTenant.enabled,
  rooms: kriegspielRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(kriegspielRooms.values()),
  getOrLoadRoom: (roomId) => getOrLoadKriegspielRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    handleKriegspielWebSocketConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as KriegspielLiveRoom,
    ),
  clearRuntimeTimers: (room) => clearKriegspielRuntimeTimers(room as unknown as KriegspielLiveRoom),
  clearRooms: () => kriegspielRooms.clear(),
  http: {
    matchesCreateRequest: requestsKriegspiel,
    handleCreate: (ctx, _request, response, body) =>
      handleKriegspielCreate({ ...ctx, createKriegspielRoom }, response, body),
  },
  lobby: null,
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
