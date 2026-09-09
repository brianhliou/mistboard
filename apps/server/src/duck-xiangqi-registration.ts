/**
 * Duck Xiangqi registry entry. Owns the tenant's live-room map and binds the
 * generic tenant room factory, hydration, WebSocket runtime and HTTP create
 * route.
 *
 * MVP scope, deliberately narrow while the variant is flag-gated: PvP only.
 * No engine (the bot needs a patched Fairy-Stockfish on engine-worker, which is
 * its own deploy), no lobby seek, no watch channel, no export binding. Each of
 * those is additive and none of them gates playing a game.
 */

import type {
  DUCK_XIANGQI_SPEC_ID,
  DuckXiangqiColor,
  DuckXiangqiGameState,
  DuckXiangqiTurn,
  RoomTimeControl,
} from '@mistboard/game';
import { currentAccountUser } from './account-session.js';
import { type DuckXiangqiEvent, duckXiangqiTenant } from './duck-xiangqi-tenant.js';
import * as persistence from './persistence.js';
import { handleDuckXiangqiCreate, requestsDuckXiangqi } from './routes/duck-xiangqi-rooms.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';
import { countActiveTenantGames } from './variant-tenant/runtime.js';
import type { TenantRuntimeRoom } from './variant-tenant/tenant.js';
import {
  clearTenantRuntimeTimers,
  createTenantWsRuntime,
  type TenantLiveRoom,
} from './variant-tenant/ws.js';

export type DuckXiangqiRuntimeRoom = TenantRuntimeRoom<
  'duck-xiangqi',
  DuckXiangqiColor,
  DuckXiangqiTurn,
  DuckXiangqiGameState,
  typeof DUCK_XIANGQI_SPEC_ID
>;

type DuckXiangqiLiveRoom = TenantLiveRoom<
  'duck-xiangqi',
  DuckXiangqiColor,
  DuckXiangqiTurn,
  DuckXiangqiGameState,
  typeof DUCK_XIANGQI_SPEC_ID
>;

export type DuckXiangqiLiveRoomCreation =
  | { ok: true; room: DuckXiangqiRuntimeRoom }
  | {
      ok: false;
      error: 'duck_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision';
    };

export const duckXiangqiRooms = new Map<string, DuckXiangqiRuntimeRoom>();

const duckXiangqiWs = createTenantWsRuntime(duckXiangqiTenant);

export async function createDuckXiangqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: DuckXiangqiColor | 'random',
  rated = false,
): Promise<DuckXiangqiLiveRoomCreation> {
  const created = await createTenantLiveRoom(
    duckXiangqiTenant,
    {
      rooms: duckXiangqiRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, duckXiangqiTenant.kind),
      appendRoomEvent: (roomId, seq, event: DuckXiangqiEvent) =>
        persistence.appendRoomEvent(roomId, seq, event),
      isPersistenceEnabled: persistence.isInitialized,
      recordGameStart: persistence.recordGameStart,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(duckXiangqiTenant, roomId, seq, eventType, err),
    },
    { timeControl, creatorPreference, rated },
  );
  if (!created.ok) {
    return created.error === 'disabled'
      ? { ok: false, error: 'duck_xiangqi_disabled' }
      : { ok: false, error: created.error };
  }
  return created;
}

export function getOrLoadDuckXiangqiRoom(roomId: string): Promise<DuckXiangqiRuntimeRoom | null> {
  return getOrLoadTenantRoom(duckXiangqiTenant, duckXiangqiRooms, roomId);
}

registerVariantTenant({
  kind: duckXiangqiTenant.kind,
  gameSpecId: duckXiangqiTenant.gameSpecId,
  roomIdPrefix: duckXiangqiTenant.roomIdPrefix,
  ownsSpecRouting: true,
  errorPrefix: 'duck_xiangqi',
  enabled: duckXiangqiTenant.enabled,
  rooms: duckXiangqiRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(duckXiangqiRooms.values()),
  getOrLoadRoom: (roomId) => getOrLoadDuckXiangqiRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    duckXiangqiWs.handleConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as DuckXiangqiLiveRoom,
    ),
  clearRuntimeTimers: (room) => clearTenantRuntimeTimers(room as unknown as DuckXiangqiLiveRoom),
  clearRooms: () => duckXiangqiRooms.clear(),
  http: {
    matchesCreateRequest: requestsDuckXiangqi,
    handleCreate: async (ctx, request, response, body) => {
      const accountUser = body.rated === true ? await currentAccountUser(request) : null;
      await handleDuckXiangqiCreate({ ...ctx, createDuckXiangqiRoom }, response, body, accountUser);
    },
  },
  // No public seek while the variant is hidden: a lobby entry would advertise a
  // game nobody can accept.
  lobby: null,
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
