/**
 * Atomic Xiangqi registry entry. Owns the tenant's live-room map and binds the
 * generic tenant room factory, hydration, WebSocket runtime and HTTP create
 * route.
 *
 * Scope: PvP, PvE against the patched Fairy-Stockfish ladder, a lobby seek
 * and a TV channel, all unrated; no correspondence. Listed 2026-09-17 with the
 * rules page (rails, tiles, the product profile); the play menu is the one
 * switch still closed, on the web side.
 */

import type {
  ATOMIC_XIANGQI_SPEC_ID,
  AtomicXiangqiColor,
  AtomicXiangqiGameState,
  AtomicXiangqiMove,
  RoomTimeControl,
} from '@mistboard/game';
import { atomicXiangqiFen } from '@mistboard/game';
import { currentAccountUser } from './account-session.js';
import {
  atomicXiangqiPgnStyle,
  atomicXiangqiPgnWriter,
  atomicXiangqiWxfLabels,
} from './atomic-xiangqi-game-export.js';
import { type AtomicXiangqiEvent, atomicXiangqiTenant } from './atomic-xiangqi-tenant.js';
import { tenantCardBinding } from './game-card-tenant.js';
import { boardMoveUci, tenantExportBinding } from './game-export-tenant.js';
import * as persistence from './persistence.js';
import { handleAtomicXiangqiCreate, requestsAtomicXiangqi } from './routes/atomic-xiangqi-rooms.js';
import { isAllowedFullTimeControl } from './routes/lib.js';
import { scheduleAtomicXiangqiEngineMove } from './server-atomic-xiangqi-engine.js';
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

export type AtomicXiangqiRuntimeRoom = TenantRuntimeRoom<
  'atomic-xiangqi',
  AtomicXiangqiColor,
  AtomicXiangqiMove,
  AtomicXiangqiGameState,
  typeof ATOMIC_XIANGQI_SPEC_ID
>;

type AtomicXiangqiLiveRoom = TenantLiveRoom<
  'atomic-xiangqi',
  AtomicXiangqiColor,
  AtomicXiangqiMove,
  AtomicXiangqiGameState,
  typeof ATOMIC_XIANGQI_SPEC_ID
>;

export type AtomicXiangqiLiveRoomCreation =
  | { ok: true; room: AtomicXiangqiRuntimeRoom }
  | {
      ok: false;
      error: 'atomic_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision';
    };

export const atomicXiangqiRooms = new Map<string, AtomicXiangqiRuntimeRoom>();

const atomicXiangqiWs = createTenantWsRuntime(atomicXiangqiTenant, {
  scheduleEngineMove: (ctx, room) => scheduleAtomicXiangqiEngineMove(ctx, room),
});

export async function createAtomicXiangqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: AtomicXiangqiColor | 'random',
  rated = false,
  engine?: TenantRoomEngineSeat<AtomicXiangqiColor>,
): Promise<AtomicXiangqiLiveRoomCreation> {
  const created = await createTenantLiveRoom(
    atomicXiangqiTenant,
    {
      rooms: atomicXiangqiRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, atomicXiangqiTenant.kind),
      appendRoomEvent: (roomId, seq, event: AtomicXiangqiEvent) =>
        persistence.appendRoomEvent(roomId, seq, event),
      isPersistenceEnabled: persistence.isInitialized,
      recordGameStart: persistence.recordGameStart,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(atomicXiangqiTenant, roomId, seq, eventType, err),
    },
    { timeControl, creatorPreference, rated, engine },
  );
  if (!created.ok) {
    return created.error === 'disabled'
      ? { ok: false, error: 'atomic_xiangqi_disabled' }
      : { ok: false, error: created.error };
  }
  return created;
}

export function getOrLoadAtomicXiangqiRoom(
  roomId: string,
): Promise<AtomicXiangqiRuntimeRoom | null> {
  return getOrLoadTenantRoom(atomicXiangqiTenant, atomicXiangqiRooms, roomId);
}

registerVariantTenant({
  kind: atomicXiangqiTenant.kind,
  gameSpecId: atomicXiangqiTenant.gameSpecId,
  roomIdPrefix: atomicXiangqiTenant.roomIdPrefix,
  isEngineClientId: atomicXiangqiTenant.engine?.isEngineClientId,
  engineDisplayName: (clientId) => atomicXiangqiTenant.engine?.displayName(clientId) ?? null,
  ownsSpecRouting: true,
  errorPrefix: 'atomic_xiangqi',
  enabled: atomicXiangqiTenant.enabled,
  // Mistboard TV channel, listed with the rules page (2026-09-17). Like the
  // others it inherits this tenant's `enabled`, so it stays dark behind the
  // flag.
  watch: {
    channelId: 'atomic-xiangqi',
    family: 'xiangqi',
    label: 'Atomic Xiangqi',
    legacyVariants: ['atomic-xiangqi'],
  },
  rooms: atomicXiangqiRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(atomicXiangqiRooms.values()),
  getOrLoadRoom: (roomId) =>
    getOrLoadAtomicXiangqiRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    atomicXiangqiWs.handleConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as AtomicXiangqiLiveRoom,
    ),
  clearRuntimeTimers: (room) => clearTenantRuntimeTimers(room as unknown as AtomicXiangqiLiveRoom),
  clearRooms: () => atomicXiangqiRooms.clear(),
  http: {
    matchesCreateRequest: requestsAtomicXiangqi,
    handleCreate: async (ctx, request, response, body) => {
      const accountUser = body.rated === true ? await currentAccountUser(request) : null;
      await handleAtomicXiangqiCreate(
        { ...ctx, createAtomicXiangqiRoom },
        response,
        body,
        accountUser,
      );
    },
  },
  // Find-opponent seek, rated on request: the atomic_xiangqi pool is in the
  // user_ratings CHECK since migration 147.
  lobby: {
    supportsRated: true,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl, rated) => {
      const created = await createAtomicXiangqiRoom(timeControl, 'random', rated);
      if (!created.ok) throw new Error(`atomic_xiangqi_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // The moves are ordinary board moves; the explosion is implied by the rules
  // the replayer runs. WXF movetext + `san` when the line replays under the
  // ATOMIC kernel (it always should for this tenant); ICCS coordinates
  // otherwise. See atomic-xiangqi-game-export.ts.
  export: tenantExportBinding(atomicXiangqiTenant, {
    gameRouteBase: '/atomic-xiangqi/game',
    uci: boardMoveUci,
    san: atomicXiangqiWxfLabels,
    writePgn: (moves) => atomicXiangqiPgnWriter(moves, atomicXiangqiPgnStyle(moves)),
  }),
  // Share card: the standard xiangqi board and FEN spelling (og-position.ts
  // draws the atomic slug with the xiangqi renderer), final position, no
  // analysis engine.
  card: tenantCardBinding(atomicXiangqiTenant, {
    variant: 'atomic-xiangqi',
    analysis: null,
    fen: atomicXiangqiFen,
  }),
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
