/**
 * Crazyhouse Xiangqi room-create route: PvP (a friend link), plus PvE against
 * the Fairy-Stockfish ladder on the stock binary (crazyhouse-xiangqi-fsf-engine.ts).
 *
 * Creating a room is not the access gate. The spec is allowlisted
 * (persistence-variant-access.ts), so the WebSocket seat path refuses an
 * account that is neither an admin nor holding a grant; a room created by
 * anyone else is a table nobody without a grant can sit at.
 */

import { CRAZYHOUSE_XIANGQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import {
  CRAZYHOUSE_XIANGQI_DEFAULT_ENGINE_ID,
  isCrazyhouseXiangqiEngineClientId,
} from './../server-crazyhouse-xiangqi-engine.js';
import { createTenantRoomsRoute } from './../variant-tenant/rooms-route.js';

export type CrazyhouseXiangqiCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createCrazyhouseXiangqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    rated?: boolean,
    engine?: { engineId: string; seat: 'red' | 'black'; botId?: string },
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | {
        ok: false;
        error: 'crazyhouse_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision';
      }
  >;
};

const CRAZYHOUSE_XIANGQI_SEATS = ['red', 'black'] as const;

const crazyhouseXiangqiRoute = createTenantRoomsRoute<
  CrazyhouseXiangqiCreateContext,
  'red' | 'black' | 'random',
  'red' | 'black'
>({
  gameSpecId: CRAZYHOUSE_XIANGQI_SPEC_ID,
  errorPrefix: 'crazyhouse_xiangqi',
  hasDisabledFlag: true,
  preferredColors: ['red', 'black', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: CRAZYHOUSE_XIANGQI_DEFAULT_ENGINE_ID,
    isEngineClientId: isCrazyhouseXiangqiEngineClientId,
    seats: CRAZYHOUSE_XIANGQI_SEATS,
  },
  // Rated friend rooms follow the lobby (rooms-route.ts gateRatedRoomRequest):
  // PvP may be rated wherever Find opponent is; PvE never is.
  createRoom: (ctx, { timeControl, preferredColor, rated, engine }) =>
    ctx.createCrazyhouseXiangqiRoom(timeControl, preferredColor, rated, engine),
});

export const requestsCrazyhouseXiangqi = crazyhouseXiangqiRoute.matchesCreateRequest;
export const handleCrazyhouseXiangqiCreate = crazyhouseXiangqiRoute.handleCreate;
