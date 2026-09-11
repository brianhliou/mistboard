/**
 * Mahjong room-create route.
 *
 * PvE only, and not as a limitation to be lifted later by a flag: a mahjong
 * table needs four players, and the reason this variant exists right now is for
 * one person to sit down against three bots and tell us whether the scoring is
 * right. A PvP room would need three other humans to arrive at the same URL.
 *
 * So there is no engine policy here and no rated policy worth having. The three
 * bot seats are filled by the factory, not requested by the client, which is
 * why `rejectEngineId` is on: a client naming an engine is asking for something
 * this surface does not offer.
 */

import { MAHJONG_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import type { MahjongSeat } from '@mistboard/mahjong';
import { createTenantRoomsRoute } from './../variant-tenant/rooms-route.js';

export type MahjongCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createMahjongRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: MahjongSeat | 'random',
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | { ok: false; error: 'mahjong_disabled' | 'persistence_failure' | 'room_id_collision' }
  >;
};

const mahjongRoute = createTenantRoomsRoute<
  MahjongCreateContext,
  MahjongSeat | 'random',
  MahjongSeat
>({
  gameSpecId: MAHJONG_SPEC_ID,
  errorPrefix: 'mahjong',
  hasDisabledFlag: true,
  preferredColors: ['east', 'south', 'west', 'north', 'random'],
  engine: { kind: 'none', rejectEngineId: true },
  // Unrated, and not close to being otherwise: the faan values have never been
  // checked by anybody who plays the game, so a rating built on them would be
  // measuring the wrong thing precisely.
  rated: { kind: 'reject-as-surface' },
  createRoom: (ctx, { timeControl, preferredColor }) =>
    ctx.createMahjongRoom(timeControl, preferredColor),
});

export const requestsMahjong = mahjongRoute.matchesCreateRequest;
export const handleMahjongCreate = mahjongRoute.handleCreate;
