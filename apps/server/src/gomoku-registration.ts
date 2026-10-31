// Built-hidden, flag-gated casual PvP only. No TV, bot, export or correspondence.
import { GOMOKU_SPEC_ID, type GomokuColor, type RoomTimeControl } from '@mistboard/game';
import { gomokuEnabled } from './feature-flags.js';
import { type GomokuEvent, type GomokuRuntimeRoom, gomokuTenant } from './gomoku-tenant.js';
import * as persistence from './persistence.js';
import { isAllowedFullTimeControl } from './routes/lib.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import { pauseTenantRoomsOnShutdown } from './variant-tenant/lifecycle.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';
import {
  createTenantRoomsRoute,
  type TenantRoomCreateBaseContext,
} from './variant-tenant/rooms-route.js';
import { countActiveTenantGames, tenantReplayCheck } from './variant-tenant/runtime.js';
import {
  clearTenantRuntimeTimers,
  createTenantWsRuntime,
  type TenantLiveRoom,
} from './variant-tenant/ws.js';

export const gomokuRooms = new Map<string, GomokuRuntimeRoom>();
export const gomokuWs = createTenantWsRuntime(gomokuTenant);
type LiveRoom = TenantLiveRoom<
  'gomoku',
  GomokuColor,
  import('@mistboard/game').GomokuMove,
  import('@mistboard/game').GomokuRoomState,
  typeof gomokuTenant.gameSpecId
>;

export async function createGomokuRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: GomokuColor | 'random',
) {
  const created = await createTenantLiveRoom(
    gomokuTenant,
    {
      rooms: gomokuRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, gomokuTenant.kind),
      appendRoomEvent: (roomId, seq, event: GomokuEvent) =>
        persistence.appendRoomEvent(roomId, seq, event),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(gomokuTenant, roomId, seq, eventType, err),
    },
    { timeControl, creatorPreference, rated: false },
  );
  if (!created.ok && created.error === 'disabled')
    return { ok: false as const, error: 'gomoku_disabled' as const };
  return created;
}

// A dedicated, fail-closed room route; no engine branch until build 3.
const route = createTenantRoomsRoute<
  TenantRoomCreateBaseContext & { createGomokuRoom: typeof createGomokuRoom },
  GomokuColor | 'random',
  GomokuColor
>({
  gameSpecId: GOMOKU_SPEC_ID,
  errorPrefix: 'gomoku',
  hasDisabledFlag: true,
  preferredColors: ['black', 'white', 'random'],
  engine: { kind: 'none', rejectEngineId: true },
  createRoom: (ctx, { timeControl, preferredColor }) =>
    ctx.createGomokuRoom(timeControl, preferredColor),
});
export const handleGomokuCreate = route.handleCreate;

registerVariantTenant({
  kind: gomokuTenant.kind,
  gameSpecId: gomokuTenant.gameSpecId,
  roomIdPrefix: gomokuTenant.roomIdPrefix,
  // PvP only: there is no engine id namespace in this build.
  isEngineClientId: () => false,
  ownsSpecRouting: true,
  replays: tenantReplayCheck(gomokuTenant),
  errorPrefix: 'gomoku',
  enabled: gomokuEnabled,
  admitsConnection: gomokuEnabled,
  rooms: gomokuRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(gomokuRooms.values(), gomokuTenant),
  getOrLoadRoom: (roomId) =>
    getOrLoadTenantRoom(gomokuTenant, gomokuRooms, roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    gomokuWs.handleConnection(ctx, socket, request, room as unknown as LiveRoom),
  clearRuntimeTimers: (room) => clearTenantRuntimeTimers(room as unknown as LiveRoom),
  pauseOnShutdown: (at) =>
    pauseTenantRoomsOnShutdown(gomokuTenant, gomokuRooms.values(), gomokuWs.lifecycleCtx, at),
  clearRooms: () => gomokuRooms.clear(),
  http: {
    matchesCreateRequest: route.matchesCreateRequest,
    handleCreate: (ctx, _request, response, body, accountUser) =>
      handleGomokuCreate({ ...ctx, createGomokuRoom }, response, body, accountUser),
  },
  lobby: {
    supportsRated: false,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl, rated) => {
      if (rated) throw new Error('gomoku_unsupported_surface');
      const created = await createGomokuRoom(timeControl, 'random');
      if (!created.ok) throw new Error(`gomoku_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  finishedGameOpensRoom: true,
  watch: null,
  export: null,
  card: null,
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
