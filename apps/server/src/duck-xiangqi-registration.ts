/**
 * Duck Xiangqi registry entry. Owns the tenant's live-room map and binds the
 * generic tenant room factory, hydration, WebSocket runtime and HTTP create
 * route.
 *
 * Scope while the variant is flag-gated: PvP and PvE against the Fairy-Stockfish
 * ladder, but no lobby seek, since a public seek would advertise a game nobody
 * can accept. The watch channel and the export binding are here, and all of it
 * inherits this tenant's `enabled` predicate, so it stays dark until the flag
 * flips.
 *
 * The bot is deliberately fortress-shaped: a playable ladder with no
 * engine-vs-engine tournament entry and no published bot ratings. The EvE
 * pipeline only knows dark-chess and xiangqi, and widening it is its own job.
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
import { duckXiangqiExportUci, tenantExportBinding } from './game-export-tenant.js';
import * as persistence from './persistence.js';
import { handleDuckXiangqiCreate, requestsDuckXiangqi } from './routes/duck-xiangqi-rooms.js';
import { scheduleDuckXiangqiEngineMove } from './server-duck-xiangqi-engine.js';
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

const duckXiangqiWs = createTenantWsRuntime(duckXiangqiTenant, {
  scheduleEngineMove: (ctx, room) => scheduleDuckXiangqiEngineMove(ctx, room),
});

export async function createDuckXiangqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: DuckXiangqiColor | 'random',
  rated = false,
  engine?: TenantRoomEngineSeat<DuckXiangqiColor>,
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
    { timeControl, creatorPreference, rated, engine },
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
  isEngineClientId: duckXiangqiTenant.engine?.isEngineClientId,
  engineDisplayName: (clientId) => duckXiangqiTenant.engine?.displayName(clientId) ?? null,
  ownsSpecRouting: true,
  errorPrefix: 'duck_xiangqi',
  enabled: duckXiangqiTenant.enabled,
  // Mistboard TV channel. This block is the whole switch: the watch channel
  // list, the /api/games/showcase pool and the homepage featured board are all
  // derived from the registrations that declare one, and the channel inherits
  // this tenant's own `enabled` predicate, so it stays dark behind the flag.
  watch: {
    channelId: 'duck-xiangqi',
    family: 'xiangqi',
    label: 'Duck Xiangqi',
    legacyVariants: ['duck-xiangqi'],
  },
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
  export: tenantExportBinding(duckXiangqiTenant, {
    gameRouteBase: '/duck-xiangqi/game',
    uci: duckXiangqiExportUci,
  }),
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
