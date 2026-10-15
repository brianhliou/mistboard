/**
 * Jieqi registry entry. Owns the tenant's live-room map, the room-factory
 * binding, hydration, and the PvP rematch context. Matchmaking is random-seat,
 * rated or casual (lobby.supportsRated); PvP, live-clock only (PvE and
 * correspondence come later). Imported
 * for side effects by variant-tenant/register-tenants.ts.
 */

import {
  jieqiPlyReveal,
  jieqiStateToDealtFen,
  jieqiStateToPikafishFen,
  jieqiUnknownSquares,
  type RoomTimeControl,
} from '@mistboard/game';
import { ratedEnabled } from './feature-flags.js';
import { tenantCardBinding } from './game-card-tenant.js';
import { tenantExportBinding } from './game-export-tenant.js';
import type { JieqiCreatorPreference, JieqiRuntimeRoom } from './jieqi-runtime.js';
import { jieqiTenant } from './jieqi-tenant.js';
import * as persistence from './persistence.js';
import { handleJieqiCreate, requestsJieqi } from './routes/jieqi-rooms.js';
import { isAllowedFullTimeControl, isAllowedRatedTimeControl } from './routes/lib.js';
import {
  createJieqiLiveRoom,
  type JieqiLiveRoomCreation,
  type JieqiRoomEngineSeat,
} from './server-jieqi-room-factory.js';
import {
  clearJieqiRuntimeTimers,
  handleJieqiWebSocketConnection,
  type JieqiLiveRoom,
  type JieqiRematchContext,
  jieqiWs,
} from './server-ws-jieqi.js';
import { tenantCorrespondenceBinding } from './variant-tenant/correspondence.js';
import {
  persistenceRecordForTenantSeatToken,
  recordTenantPersistenceError,
} from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import { pauseTenantRoomsOnShutdown } from './variant-tenant/lifecycle.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { countActiveTenantGames, tenantReplayCheck } from './variant-tenant/runtime.js';
import { mintTenantSeatToken } from './variant-tenant/seat-session.js';
import { xiangqiExportUci } from './xiangqi-game-export.js';

export const jieqiRooms = new Map<string, JieqiLiveRoom>();

export async function createJieqiRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: JieqiCreatorPreference,
  engine?: JieqiRoomEngineSeat,
  // Lobby seeks and rated friend rooms (POST /api/rooms PvP); PvE never rates.
  rated = false,
): Promise<JieqiLiveRoomCreation> {
  return createJieqiLiveRoom(
    {
      appendRoomEvent: persistence.appendRoomEvent,
      jieqiRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, jieqiTenant.kind),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(jieqiTenant, roomId, seq, eventType, err),
    },
    timeControl,
    creatorPreference,
    engine,
    rated,
  );
}

export async function getOrLoadJieqiRoom(roomId: string): Promise<JieqiLiveRoom | null> {
  const room = await getOrLoadTenantRoom(
    jieqiTenant,
    jieqiRooms as unknown as Map<string, JieqiRuntimeRoom>,
    roomId,
  );
  return room as JieqiLiveRoom | null;
}

// Mutual-confirm PvP rematch (variant-tenant/rematch.ts): when both players
// offer, a new room with the same clock, colours swapped and a fresh deal (the
// factory deals every room), with both seats pre-issued to the old players so
// nobody else, spectators included, can sit down. Rated carries over only while
// it would be granted to a new rated room: the generic finalize already
// requires both seats to be accounts; this adds the rated switch and a rated
// pace. A PvE room never reaches here (the engine never offers).
export const jieqiRematchContext: JieqiRematchContext = {
  send: (client, payload) => jieqiWs.sendPayload(client, payload),
  createRoom: async (timeControl, rated) => {
    const stillRated =
      rated &&
      ratedEnabled() &&
      timeControl !== undefined &&
      isAllowedRatedTimeControl(timeControl);
    const created = await createJieqiRoom(timeControl, 'random', undefined, stillRated);
    if (!created.ok) return created;
    return { ok: true, room: created.room as unknown as JieqiRuntimeRoom };
  },
  buildRoomUrl: (roomId) => `/room/${encodeURIComponent(roomId)}`,
  accountMayPlay: async (userId) =>
    !persistence.isInitialized() || !(await persistence.isUserIdPlayDisabled(userId)),
  issueSeatToken: async (room, seat, identity) => {
    const minted = mintTenantSeatToken(room, seat, identity);
    if (persistence.isInitialized()) {
      await persistence.upsertRoomSeatToken(
        room.id,
        persistenceRecordForTenantSeatToken(minted.state),
      );
    }
    return minted;
  },
};

// Correspondence (days-per-move): seek accept seats both accounts, the sweeper
// enforces the durable deadline through the ws runtime (variant-tenant/correspondence.ts).
const jieqiCorrespondence = tenantCorrespondenceBinding(jieqiTenant, {
  factoryContext: () => ({
    rooms: jieqiRooms as unknown as Map<string, JieqiRuntimeRoom>,
    isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, jieqiTenant.kind),
    appendRoomEvent: persistence.appendRoomEvent,
    isPersistenceEnabled: persistence.isInitialized,
    recordPersistenceError: (roomId, seq, eventType, err) =>
      recordTenantPersistenceError(jieqiTenant, roomId, seq, eventType, err),
  }),
  getOrLoadRoom: (roomId) =>
    getOrLoadTenantRoom(
      jieqiTenant,
      jieqiRooms as unknown as Map<string, JieqiRuntimeRoom>,
      roomId,
    ),
  lifecycleCtx: jieqiWs.lifecycleCtx,
});

registerVariantTenant({
  kind: jieqiTenant.kind,
  gameSpecId: jieqiTenant.gameSpecId,
  roomIdPrefix: jieqiTenant.roomIdPrefix,
  watch: {
    channelId: 'jieqi',
    family: 'xiangqi',
    label: 'Jieqi',
    legacyVariants: ['jieqi'],
  },
  // TV / current-games composition labelling: the engine ids live in this
  // tenant's own namespace, which the shared isServerEngineClient heuristic
  // does not recognise, so without this binding a bot seat reads as a nameless
  // human and the game as PvP.
  isEngineClientId: jieqiTenant.engine?.isEngineClientId,
  engineDisplayName: (clientId) => jieqiTenant.engine?.displayName(clientId) ?? null,
  ownsSpecRouting: true,
  replays: tenantReplayCheck(jieqiTenant),
  errorPrefix: 'jieqi',
  enabled: jieqiTenant.enabled,
  rooms: jieqiRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(jieqiRooms.values()),
  getOrLoadRoom: (roomId) => getOrLoadJieqiRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    handleJieqiWebSocketConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
        rematch: jieqiRematchContext,
      },
      socket,
      request,
      room as unknown as JieqiLiveRoom,
    ),
  clearRuntimeTimers: (room) => clearJieqiRuntimeTimers(room as unknown as JieqiLiveRoom),
  pauseOnShutdown: (at) =>
    pauseTenantRoomsOnShutdown(jieqiTenant, jieqiRooms.values(), jieqiWs.lifecycleCtx, at),
  clearRooms: () => jieqiRooms.clear(),
  http: {
    matchesCreateRequest: requestsJieqi,
    // POST /api/rooms resolves the account for a rated request (registry.ts).
    handleCreate: (ctx, _request, response, body, accountUser) =>
      handleJieqiCreate({ ...ctx, createJieqiRoom }, response, body, accountUser),
  },
  lobby: {
    // Rated opened 2026-08-28, in step with the web tenant's capability flag;
    // until 2026-10-02 createRoom dropped the flag, so every rated seek made a
    // casual room (lobby-rated.test.ts now holds every tenant to threading it).
    // Both sides have to agree: the client decides whether to OFFER a rated seek
    // and this decides whether one is honoured, so flipping either alone gives a
    // rated toggle the lobby rejects, or a rated pool nothing can reach.
    supportsRated: true,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl, rated) => {
      const created = await createJieqiRoom(timeControl, 'random', undefined, rated);
      if (!created.ok) throw new Error(`jieqi_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // Moves are ICCS coordinates on the shared 9x10 board. Each ply names what it
  // turned over and any face-down piece it captured, and a site game carries
  // its deal, so the JSON and the PGN both replay (#484, hidden-piece-record.ts).
  export: tenantExportBinding(jieqiTenant, {
    gameRouteBase: '/jieqi/game',
    uci: xiangqiExportUci,
    hiddenPieces: { variant: 'jieqi', reveal: jieqiPlyReveal, dealFen: jieqiStateToDealtFen },
    neverRevealed: (state) => {
      const squares = jieqiUnknownSquares(state);
      if (squares.length === 0) return null;
      const color = (square: string) => state.board[square as keyof typeof state.board]?.color;
      return {
        red: squares.filter((square) => color(square) === 'red'),
        black: squares.filter((square) => color(square) === 'black'),
      };
    },
  }),
  // Final position only: a reveal swings the eval by luck, not by a decision,
  // so an analysis-picked ply would show a lucky flip (VariantTenantCard).
  card: tenantCardBinding(jieqiTenant, {
    variant: 'jieqi',
    analysis: null,
    fen: jieqiStateToPikafishFen,
  }),
  ...jieqiCorrespondence,
});
