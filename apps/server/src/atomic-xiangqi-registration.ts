/**
 * Atomic Xiangqi registry entry. Owns the tenant's live-room map and binds the
 * generic tenant room factory, hydration, WebSocket runtime and HTTP create
 * route.
 *
 * Scope: PvP, unrated, unlisted. No lobby seek (the Find-opponent picker
 * offers the product shelf, and this is not on it), no TV channel (a channel
 * is a listing), no correspondence. Deep links and the rules page are the
 * whole front door, which is what "unlisted" means in board-plan.md. The bot
 * arrives in stage 3 and is the only thing that changes this file.
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
import { type AtomicXiangqiEvent, atomicXiangqiTenant } from './atomic-xiangqi-tenant.js';
import { tenantCardBinding } from './game-card-tenant.js';
import { boardMoveUci, tenantExportBinding } from './game-export-tenant.js';
import * as persistence from './persistence.js';
import { handleAtomicXiangqiCreate, requestsAtomicXiangqi } from './routes/atomic-xiangqi-rooms.js';
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

const atomicXiangqiWs = createTenantWsRuntime(atomicXiangqiTenant);

export async function createAtomicXiangqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: AtomicXiangqiColor | 'random',
  rated = false,
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
    { timeControl, creatorPreference, rated },
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
  ownsSpecRouting: true,
  errorPrefix: 'atomic_xiangqi',
  enabled: atomicXiangqiTenant.enabled,
  // No `watch` block: a TV channel is a listing, and this variant is unlisted.
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
  // No lobby: a seek is a listing too. Two people who want a game share an
  // invite link, which is how a variant nobody has played yet should meet its
  // first twenty games.
  lobby: null,
  // The moves are ordinary board moves; the explosion is implied by the rules
  // the replayer runs. JSON only (export-formats.ts): the WXF writer would
  // replay a game that does not explode.
  export: tenantExportBinding(atomicXiangqiTenant, {
    gameRouteBase: '/atomic-xiangqi/game',
    uci: boardMoveUci,
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
