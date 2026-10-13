/**
 * Xiangqi mahjong registry entry. Narrow on purpose, like HK mahjong's: no TV
 * channel, no lobby, no export, no correspondence. The room is PvE: the creator
 * takes one seat and the in-process bot takes the other.
 */

import type {
  RoomTimeControl,
  XIANGQI_MAHJONG_SPEC_ID,
  XmjMove,
  XmjRoomState,
  XmjSeat,
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

export async function createXiangqiMahjongRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: XmjSeat | 'random',
): Promise<XmjLiveRoomCreation> {
  // A 'random' preference is pinned to east; the bot takes the other seat.
  const humanSeat: XmjSeat =
    creatorPreference && creatorPreference !== 'random' ? creatorPreference : 'east';
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
    {
      timeControl,
      creatorPreference: humanSeat,
      // Seated at creation, so the bot is in the initial event log and
      // survives hydration.
      engines: xiangqiMahjongTenant.colors
        .filter((seat) => seat !== humanSeat)
        .map((seat) => ({ engineId: XMJ_BOT_CLIENT_ID, seat, botId: XMJ_BOT_ID })),
    },
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
  // No TV channel: a playtest variant is never the homepage board.
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
    handleCreate: async (ctx, _request, response, body) => {
      await handleXiangqiMahjongCreate({ ...ctx, createXiangqiMahjongRoom }, response, body, null);
    },
  },
  lobby: null,
  // No export binding: there is no record format for this game here.
  export: null,
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
