/**
 * Xiangqi mahjong room-create route.
 *
 * PvE seats the in-process bot opposite the creator; PvP is a friend room the
 * creator shares by link. A friend room may be rated wherever Find opponent is
 * (rooms-route.ts gateRatedRoomRequest); a bot game never is. Both stay behind
 * the flag and the per-account grant (139), which the seat check enforces.
 */

import { type RoomTimeControl, XIANGQI_MAHJONG_SPEC_ID, type XmjSeat } from '@mistboard/game';
import type { DrainCreate } from '../deploy-gate.js';
import { isXmjBotClientId, XMJ_BOT_CLIENT_ID } from '../server-xiangqi-mahjong-bots.js';
import { createTenantRoomsRoute } from './../variant-tenant/rooms-route.js';

type XmjEngineSeat = { engineId: string; seat: XmjSeat; botId?: string };

export type XiangqiMahjongCreateContext = {
  databaseRequired: boolean;
  refusesCreate(create?: DrainCreate): boolean;
  drainDeadlineMs(): number | null;
  createXiangqiMahjongRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: XmjSeat | 'random',
    engine?: XmjEngineSeat,
    rated?: boolean,
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | {
        ok: false;
        error: 'xiangqi_mahjong_disabled' | 'persistence_failure' | 'room_id_collision';
      }
  >;
};

const XMJ_ROUTE_SEATS = ['east', 'west'] as const;

/**
 * Against the bot the human keeps east unless they named west. The shared
 * route coin-flips a 'random' preference; this table pinned it to east before
 * PvP existed, and the seat only alternates who deals, so the pin stays.
 */
export function xmjPveEngineSeat(
  engine: XmjEngineSeat | undefined,
  preferredColor: XmjSeat | 'random' | undefined,
): XmjEngineSeat | undefined {
  if (!engine) return undefined;
  return { ...engine, seat: preferredColor === 'west' ? 'east' : 'west' };
}

const xiangqiMahjongRoute = createTenantRoomsRoute<
  XiangqiMahjongCreateContext,
  XmjSeat | 'random',
  XmjSeat
>({
  gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
  errorPrefix: 'xiangqi_mahjong',
  hasDisabledFlag: true,
  preferredColors: ['east', 'west', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: XMJ_BOT_CLIENT_ID,
    isEngineClientId: isXmjBotClientId,
    seats: XMJ_ROUTE_SEATS,
  },
  createRoom: (ctx, { timeControl, preferredColor, rated, engine }) =>
    ctx.createXiangqiMahjongRoom(
      timeControl,
      preferredColor,
      xmjPveEngineSeat(engine, preferredColor),
      rated,
    ),
});

export const requestsXiangqiMahjong = xiangqiMahjongRoute.matchesCreateRequest;
export const handleXiangqiMahjongCreate = xiangqiMahjongRoute.handleCreate;
