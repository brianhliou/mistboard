/**
 * Dark Crazyhouse (chess + drops under fog, hidden/dev-only) registry entry.
 * Owns the tenant's live-room map, the room-factory binding, hydration, and
 * watch channel metadata. No rematch/lobby yet (deep-link PvP only) — the lobby route answers dark_crazyhouse_not_integrated while the flag
 * is on. Imported for side effects by variant-tenant/register-tenants.ts.
 */

import type { RoomTimeControl } from '@mistboard/game';
import type {
  DarkCrazyhouseCreatorPreference,
  DarkCrazyhouseRuntimeRoom,
} from './dark-crazyhouse-runtime.js';
import { darkCrazyhouseTenant } from './dark-crazyhouse-tenant.js';
import * as persistence from './persistence.js';
import {
  handleDarkCrazyhouseCreate,
  requestsDarkCrazyhouse,
} from './routes/dark-crazyhouse-rooms.js';
import {
  createDarkCrazyhouseLiveRoom,
  type DarkCrazyhouseLiveRoomCreation,
} from './server-dark-crazyhouse-room-factory.js';
import {
  clearDarkCrazyhouseRuntimeTimers,
  type DarkCrazyhouseLiveRoom,
  handleDarkCrazyhouseWebSocketConnection,
} from './server-ws-dark-crazyhouse.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { countActiveTenantGames } from './variant-tenant/runtime.js';

export const darkCrazyhouseRooms = new Map<string, DarkCrazyhouseLiveRoom>();

export async function createDarkCrazyhouseRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: DarkCrazyhouseCreatorPreference,
): Promise<DarkCrazyhouseLiveRoomCreation> {
  return createDarkCrazyhouseLiveRoom(
    {
      appendRoomEvent: persistence.appendRoomEvent,
      darkCrazyhouseRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, darkCrazyhouseTenant.kind),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(darkCrazyhouseTenant, roomId, seq, eventType, err),
    },
    timeControl,
    creatorPreference,
  );
}

export async function getOrLoadDarkCrazyhouseRoom(
  roomId: string,
): Promise<DarkCrazyhouseLiveRoom | null> {
  const room = await getOrLoadTenantRoom(
    darkCrazyhouseTenant,
    darkCrazyhouseRooms as unknown as Map<string, DarkCrazyhouseRuntimeRoom>,
    roomId,
  );
  return room as DarkCrazyhouseLiveRoom | null;
}

registerVariantTenant({
  kind: darkCrazyhouseTenant.kind,
  gameSpecId: darkCrazyhouseTenant.gameSpecId,
  roomIdPrefix: darkCrazyhouseTenant.roomIdPrefix,
  watch: {
    channelId: darkCrazyhouseTenant.gameSpecId,
    label: 'Dark Crazyhouse',
    family: 'chess',
    legacyVariants: ['dark-crazyhouse'],
  },
  ownsSpecRouting: true,
  errorPrefix: 'dark_crazyhouse',
  enabled: darkCrazyhouseTenant.enabled,
  rooms: darkCrazyhouseRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(darkCrazyhouseRooms.values()),
  getOrLoadRoom: (roomId) =>
    getOrLoadDarkCrazyhouseRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    handleDarkCrazyhouseWebSocketConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as DarkCrazyhouseLiveRoom,
    ),
  clearRuntimeTimers: (room) =>
    clearDarkCrazyhouseRuntimeTimers(room as unknown as DarkCrazyhouseLiveRoom),
  clearRooms: () => darkCrazyhouseRooms.clear(),
  http: {
    matchesCreateRequest: requestsDarkCrazyhouse,
    handleCreate: (ctx, _request, response, body) =>
      handleDarkCrazyhouseCreate({ ...ctx, createDarkCrazyhouseRoom }, response, body),
  },
  lobby: null,
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
