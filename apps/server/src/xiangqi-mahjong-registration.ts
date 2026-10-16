/**
 * Xiangqi mahjong registry entry. Narrow on purpose: no TV channel, no export.
 * A room is PvE (the in-process bot takes the other seat), PvP (a friend room,
 * or a Find opponent pairing through the lobby), or correspondence (a seek or
 * challenge between two granted accounts, casual only). The rated unit is the
 * whole match, since the room finishes when the match does.
 */

import {
  findTimeControl,
  type RoomTimeControl,
  type XIANGQI_MAHJONG_SPEC_ID,
  type XmjMove,
  type XmjRoomState,
  type XmjSeat,
} from '@mistboard/game';
import * as persistence from './persistence.js';
import {
  handleXiangqiMahjongCreate,
  requestsXiangqiMahjong,
} from './routes/xiangqi-mahjong-rooms.js';
import {
  isXmjBotClientId,
  scheduleXmjBotMove,
  XMJ_BOT_CLIENT_ID,
  XMJ_BOT_ID,
} from './server-xiangqi-mahjong-bots.js';
import { tenantCorrespondenceBinding } from './variant-tenant/correspondence.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import { pauseTenantRoomsOnShutdown } from './variant-tenant/lifecycle.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';
import { countActiveTenantGames, tenantReplayCheck } from './variant-tenant/runtime.js';
import type { TenantRuntimeRoom } from './variant-tenant/tenant.js';
import {
  clearTenantRuntimeTimers,
  createTenantWsRuntime,
  type TenantLiveRoom,
} from './variant-tenant/ws.js';
import { type XmjEvent, xiangqiMahjongTenant } from './xiangqi-mahjong-tenant.js';

export type XmjRuntimeRoom = TenantRuntimeRoom<
  'xiangqi-mahjong',
  XmjSeat,
  XmjMove,
  XmjRoomState,
  typeof XIANGQI_MAHJONG_SPEC_ID
>;

type XmjLiveRoom = TenantLiveRoom<
  'xiangqi-mahjong',
  XmjSeat,
  XmjMove,
  XmjRoomState,
  typeof XIANGQI_MAHJONG_SPEC_ID
>;

export type XmjLiveRoomCreation =
  | { ok: true; room: XmjRuntimeRoom }
  | { ok: false; error: 'xiangqi_mahjong_disabled' | 'persistence_failure' | 'room_id_collision' };

export const xiangqiMahjongRooms = new Map<string, XmjRuntimeRoom>();

const xiangqiMahjongWs = createTenantWsRuntime(xiangqiMahjongTenant, {
  scheduleEngineMove: (ctx, room) => scheduleXmjBotMove(ctx, room as XmjRuntimeRoom),
});

/**
 * The paces the table offers (web registry timePresetIds: 5+5 and 10+5). A
 * match is about 21 decisions a player over four hands; 3+2 and 1+1 would
 * flag players who stop to read a claim. Only 5+5 is a rated pace.
 */
const XMJ_LOBBY_TIME_CONTROL_IDS: ReadonlySet<string> = new Set(['5m5', '10m5']);

export function xmjLobbyAllowsTimeControl(timeControl: RoomTimeControl): boolean {
  const spec = findTimeControl(timeControl.initialMs, timeControl.incrementMs);
  return spec !== null && XMJ_LOBBY_TIME_CONTROL_IDS.has(spec.id);
}

export async function createXiangqiMahjongRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: XmjSeat | 'random',
  engine?: { engineId: string; seat: XmjSeat; botId?: string },
  rated = false,
): Promise<XmjLiveRoomCreation> {
  const created = await createTenantLiveRoom(
    xiangqiMahjongTenant,
    {
      rooms: xiangqiMahjongRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, xiangqiMahjongTenant.kind),
      appendRoomEvent: (roomId, seq, event: XmjEvent) =>
        persistence.appendRoomEvent(roomId, seq, event),
      isPersistenceEnabled: persistence.isInitialized,
      recordGameStart: persistence.recordGameStart,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(xiangqiMahjongTenant, roomId, seq, eventType, err),
    },
    engine
      ? {
          timeControl,
          creatorPreference: xiangqiMahjongTenant.oppositeColor(engine.seat),
          // Seated at creation, so the bot is in the initial event log and
          // survives hydration. A bot game never rates.
          engine: { engineId: XMJ_BOT_CLIENT_ID, seat: engine.seat, botId: XMJ_BOT_ID },
        }
      : // PvP: both seats are human and handed out on connect.
        { timeControl, creatorPreference, rated },
  );
  if (!created.ok) {
    return created.error === 'disabled'
      ? { ok: false, error: 'xiangqi_mahjong_disabled' }
      : { ok: false, error: created.error };
  }
  return created;
}

export function getOrLoadXiangqiMahjongRoom(roomId: string): Promise<XmjRuntimeRoom | null> {
  return getOrLoadTenantRoom(xiangqiMahjongTenant, xiangqiMahjongRooms, roomId);
}

// Correspondence (days per move): accepting a seek seats both accounts, the
// sweeper flags a missed deadline. No seatBoard: the inbox carries no board for
// this game, so no card or listing can show a concealed tile. The seek routes
// admit it only between granted accounts and never rated
// (CORRESPONDENCE_ALLOWLISTED_SPEC_IDS).
const xiangqiMahjongCorrespondence = tenantCorrespondenceBinding(xiangqiMahjongTenant, {
  factoryContext: () => ({
    rooms: xiangqiMahjongRooms,
    isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, xiangqiMahjongTenant.kind),
    appendRoomEvent: (roomId, seq, event: XmjEvent) =>
      persistence.appendRoomEvent(roomId, seq, event),
    isPersistenceEnabled: persistence.isInitialized,
    recordPersistenceError: (roomId, seq, eventType, err) =>
      recordTenantPersistenceError(xiangqiMahjongTenant, roomId, seq, eventType, err),
  }),
  getOrLoadRoom: getOrLoadXiangqiMahjongRoom,
  lifecycleCtx: xiangqiMahjongWs.lifecycleCtx,
});

registerVariantTenant({
  kind: xiangqiMahjongTenant.kind,
  gameSpecId: xiangqiMahjongTenant.gameSpecId,
  roomIdPrefix: xiangqiMahjongTenant.roomIdPrefix,
  isEngineClientId: isXmjBotClientId,
  engineDisplayName: (clientId) => (isXmjBotClientId(clientId) ? 'Xiangqi mahjong bot' : null),
  ownsSpecRouting: true,
  replays: tenantReplayCheck(xiangqiMahjongTenant),
  errorPrefix: 'xiangqi_mahjong',
  enabled: xiangqiMahjongTenant.enabled,
  // No TV channel: the hands are concealed, so there is nothing a spectator
  // can follow live (xiangqi-mahjong-tenant.test.ts pins it).
  watch: null,
  rooms: xiangqiMahjongRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(xiangqiMahjongRooms.values()),
  getOrLoadRoom: (roomId) =>
    getOrLoadXiangqiMahjongRoom(roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    xiangqiMahjongWs.handleConnection(
      {
        defaultRoomRegion: ctx.defaultRoomRegion,
        wsMessageLimit: ctx.wsMessageLimit,
        wsMessageWindowMs: ctx.wsMessageWindowMs,
      },
      socket,
      request,
      room as unknown as XmjLiveRoom,
    ),
  clearRuntimeTimers: (room) => clearTenantRuntimeTimers(room as unknown as XmjLiveRoom),
  pauseOnShutdown: (at) =>
    pauseTenantRoomsOnShutdown(
      xiangqiMahjongTenant,
      xiangqiMahjongRooms.values(),
      xiangqiMahjongWs.lifecycleCtx,
      at,
    ),
  clearRooms: () => xiangqiMahjongRooms.clear(),
  http: {
    matchesCreateRequest: requestsXiangqiMahjong,
    // POST /api/rooms resolves the account for a rated request (registry.ts).
    handleCreate: (ctx, _request, response, body, accountUser) =>
      handleXiangqiMahjongCreate({ ...ctx, createXiangqiMahjongRoom }, response, body, accountUser),
  },
  // Find opponent. Both seats still pass the grant check when they connect, and
  // the lobby route refuses a seek from an account without the grant.
  lobby: {
    supportsRated: true,
    allowsTimeControl: xmjLobbyAllowsTimeControl,
    createRoom: async (timeControl, rated) => {
      const created = await createXiangqiMahjongRoom(timeControl, 'random', undefined, rated);
      if (!created.ok) throw new Error(`xiangqi_mahjong_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  // No export binding: there is no record format for this game here.
  export: null,
  // No postgame page either: a finished game opens at its room, which shows
  // every hand and never the walls (xiangqi-mahjong-pvp.test.ts).
  finishedGameOpensRoom: true,
  ...xiangqiMahjongCorrespondence,
});
