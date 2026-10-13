/**
 * Xiangqi mahjong room-create route.
 *
 * PvE only for the playtest: the creator takes one seat and the server seats
 * the bot in the other. No engine choice (`always-seated` refuses an engineId)
 * and never rated.
 */

import { type RoomTimeControl, XIANGQI_MAHJONG_SPEC_ID, type XmjSeat } from '@mistboard/game';
import { createTenantRoomsRoute } from './../variant-tenant/rooms-route.js';

export type XiangqiMahjongCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createXiangqiMahjongRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: XmjSeat | 'random',
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | {
        ok: false;
        error: 'xiangqi_mahjong_disabled' | 'persistence_failure' | 'room_id_collision';
      }
  >;
};

const xiangqiMahjongRoute = createTenantRoomsRoute<
  XiangqiMahjongCreateContext,
  XmjSeat | 'random',
  XmjSeat
>({
  gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
  errorPrefix: 'xiangqi_mahjong',
  hasDisabledFlag: true,
  preferredColors: ['east', 'west', 'random'],
  engine: { kind: 'always-seated' },
  createRoom: (ctx, { timeControl, preferredColor }) =>
    ctx.createXiangqiMahjongRoom(timeControl, preferredColor),
});

export const requestsXiangqiMahjong = xiangqiMahjongRoute.matchesCreateRequest;
export const handleXiangqiMahjongCreate = xiangqiMahjongRoute.handleCreate;
