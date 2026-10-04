/**
 * Crazyhouse Xiangqi registry entry. Owns the tenant's live-room map and binds
 * the generic tenant room factory, hydration, WebSocket runtime and HTTP
 * create route.
 *
 * Scope: a public casual variant. PvP by friend link and a lobby seek, PvE
 * against the stock Fairy-Stockfish ladder, a TV channel, JSON export. The
 * lobby seek may be rated (crazyhouse_xiangqi pool, migration 158); friend
 * links and PvE stay casual. No correspondence.
 */

import type {
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiGameState,
  CrazyhouseXiangqiMove,
  RoomTimeControl,
} from '@mistboard/game';
import { crazyhouseXiangqiFen, crazyhouseXiangqiMoveToUci } from '@mistboard/game';
import {
  CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH,
  CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID,
} from './crazyhouse-xiangqi-fsf-engine.js';
import {
  type CrazyhouseXiangqiEvent,
  crazyhouseXiangqiTenant,
} from './crazyhouse-xiangqi-tenant.js';
import { tenantCardBinding } from './game-card-tenant.js';
import { tenantExportBinding } from './game-export-tenant.js';
import * as persistence from './persistence.js';
import {
  handleCrazyhouseXiangqiCreate,
  requestsCrazyhouseXiangqi,
} from './routes/crazyhouse-xiangqi-rooms.js';
import { isAllowedFullTimeControl } from './routes/lib.js';
import { scheduleCrazyhouseXiangqiEngineMove } from './server-crazyhouse-xiangqi-engine.js';
import { tenantCorrespondenceBinding } from './variant-tenant/correspondence.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import { pauseTenantRoomsOnShutdown } from './variant-tenant/lifecycle.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import type { TenantRoomEngineSeat } from './variant-tenant/room-factory.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';
import { countActiveTenantGames, tenantReplayCheck } from './variant-tenant/runtime.js';
import type { TenantRuntimeRoom } from './variant-tenant/tenant.js';
import {
  clearTenantRuntimeTimers,
  createTenantWsRuntime,
  type TenantLiveRoom,
} from './variant-tenant/ws.js';

export type CrazyhouseXiangqiRuntimeRoom = TenantRuntimeRoom<
  'crazyhouse-xiangqi',
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState,
  typeof CRAZYHOUSE_XIANGQI_SPEC_ID
>;

type CrazyhouseXiangqiLiveRoom = TenantLiveRoom<
  'crazyhouse-xiangqi',
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState,
  typeof CRAZYHOUSE_XIANGQI_SPEC_ID
>;

export type CrazyhouseXiangqiLiveRoomCreation =
  | { ok: true; room: CrazyhouseXiangqiRuntimeRoom }
  | {
      ok: false;
      error: 'crazyhouse_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision';
    };

export const crazyhouseXiangqiRooms = new Map<string, CrazyhouseXiangqiRuntimeRoom>();

const crazyhouseXiangqiWs = createTenantWsRuntime(crazyhouseXiangqiTenant, {
  scheduleEngineMove: (ctx, room) => scheduleCrazyhouseXiangqiEngineMove(ctx, room),
});

export async function createCrazyhouseXiangqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: CrazyhouseXiangqiColor | 'random',
  rated = false,
  engine?: TenantRoomEngineSeat<CrazyhouseXiangqiColor>,
): Promise<CrazyhouseXiangqiLiveRoomCreation> {
  const created = await createTenantLiveRoom(
    crazyhouseXiangqiTenant,
    {
      rooms: crazyhouseXiangqiRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, crazyhouseXiangqiTenant.kind),
      appendRoomEvent: (roomId, seq, event: CrazyhouseXiangqiEvent) =>
        persistence.appendRoomEvent(roomId, seq, event),
      isPersistenceEnabled: persistence.isInitialized,
      recordGameStart: persistence.recordGameStart,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(crazyhouseXiangqiTenant, roomId, seq, eventType, err),
    },
    { timeControl, creatorPreference, rated, engine },
  );
  if (!created.ok) {
    return created.error === 'disabled'
      ? { ok: false, error: 'crazyhouse_xiangqi_disabled' }
      : { ok: false, error: created.error };
  }
  return created;
}

export function getOrLoadCrazyhouseXiangqiRoom(
  roomId: string,
): Promise<CrazyhouseXiangqiRuntimeRoom | null> {
  return getOrLoadTenantRoom(crazyhouseXiangqiTenant, crazyhouseXiangqiRooms, roomId);
}

// Correspondence (days-per-move): seek accept seats both accounts, the sweeper
// enforces the durable deadline through the ws runtime (variant-tenant/correspondence.ts).
const crazyhouseXiangqiCorrespondence = tenantCorrespondenceBinding(crazyhouseXiangqiTenant, {
  factoryContext: () => ({
    rooms: crazyhouseXiangqiRooms,
    isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, crazyhouseXiangqiTenant.kind),
    appendRoomEvent: persistence.appendRoomEvent,
    isPersistenceEnabled: persistence.isInitialized,
    recordPersistenceError: (roomId, seq, eventType, err) =>
      recordTenantPersistenceError(crazyhouseXiangqiTenant, roomId, seq, eventType, err),
  }),
  getOrLoadRoom: (roomId) =>
    getOrLoadTenantRoom(crazyhouseXiangqiTenant, crazyhouseXiangqiRooms, roomId),
  lifecycleCtx: crazyhouseXiangqiWs.lifecycleCtx,
});

registerVariantTenant({
  kind: crazyhouseXiangqiTenant.kind,
  gameSpecId: crazyhouseXiangqiTenant.gameSpecId,
  roomIdPrefix: crazyhouseXiangqiTenant.roomIdPrefix,
  isEngineClientId: crazyhouseXiangqiTenant.engine?.isEngineClientId,
  engineDisplayName: (clientId) => crazyhouseXiangqiTenant.engine?.displayName(clientId) ?? null,
  ownsSpecRouting: true,
  replays: tenantReplayCheck(crazyhouseXiangqiTenant),
  errorPrefix: 'crazyhouse_xiangqi',
  enabled: crazyhouseXiangqiTenant.enabled,
  // Mistboard TV channel. Like the others it inherits this tenant's `enabled`,
  // so it stays dark behind the flag.
  watch: {
    channelId: 'crazyhouse-xiangqi',
    family: 'xiangqi',
    label: 'Crazyhouse Xiangqi',
    legacyVariants: ['crazyhouse-xiangqi'],
  },
  rooms: crazyhouseXiangqiRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(crazyhouseXiangqiRooms.values()),
  getOrLoadRoom: (roomId) =>
    getOrLoadCrazyhouseXiangqiRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    crazyhouseXiangqiWs.handleConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as CrazyhouseXiangqiLiveRoom,
    ),
  clearRuntimeTimers: (room) =>
    clearTenantRuntimeTimers(room as unknown as CrazyhouseXiangqiLiveRoom),
  pauseOnShutdown: (at) =>
    pauseTenantRoomsOnShutdown(
      crazyhouseXiangqiTenant,
      crazyhouseXiangqiRooms.values(),
      crazyhouseXiangqiWs.lifecycleCtx,
      at,
    ),
  clearRooms: () => crazyhouseXiangqiRooms.clear(),
  http: {
    matchesCreateRequest: requestsCrazyhouseXiangqi,
    // POST /api/rooms resolves the account for a rated request (registry.ts).
    handleCreate: (ctx, _request, response, body, accountUser) =>
      handleCrazyhouseXiangqiCreate(
        { ...ctx, createCrazyhouseXiangqiRoom },
        response,
        body,
        accountUser,
      ),
  },
  // Find-opponent seek, rated on request: the crazyhouse_xiangqi pool is in
  // the user_ratings CHECK since migration 158.
  lobby: {
    supportsRated: true,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl, rated) => {
      const created = await createCrazyhouseXiangqiRoom(timeControl, 'random', rated);
      if (!created.ok) throw new Error(`crazyhouse_xiangqi_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // JSON only (export-formats.ts): a drop has no WXF or ICCS spelling. The uci
  // is the engine's, drops as `P@e5`.
  export: tenantExportBinding(crazyhouseXiangqiTenant, {
    gameRouteBase: '/crazyhouse-xiangqi/game',
    uci: crazyhouseXiangqiMoveToUci,
  }),
  // Share card: every exporting tenant binds one (og-game-tenant.test.ts). The
  // standard xiangqi board from the FEN. The card reads the stored whole-game
  // analysis to show the turning point rather than the final position, the
  // atomic terms: an eval swing here is a decision, not a reveal.
  card: tenantCardBinding(crazyhouseXiangqiTenant, {
    variant: 'crazyhouse-xiangqi',
    analysis: {
      engineId: CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID,
      depth: CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH,
    },
    fen: crazyhouseXiangqiFen,
  }),
  ...crazyhouseXiangqiCorrespondence,
});
