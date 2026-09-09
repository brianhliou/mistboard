/**
 * Duck Xiangqi room-create route: PvP, plus PvE against the Fairy-Stockfish
 * ladder that runs on the patched duck binary (duck-xiangqi-fsf-engine.ts).
 */

import { DUCK_XIANGQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import {
  DUCK_XIANGQI_DEFAULT_ENGINE_ID,
  isDuckXiangqiEngineClientId,
} from './../server-duck-xiangqi-engine.js';
import { createTenantRoomsRoute } from './../variant-tenant/rooms-route.js';

export type DuckXiangqiCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createDuckXiangqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    rated?: boolean,
    engine?: { engineId: string; seat: 'red' | 'black'; botId?: string },
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | {
        ok: false;
        error: 'duck_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision';
      }
  >;
};

const DUCK_XIANGQI_SEATS = ['red', 'black'] as const;

const duckXiangqiRoute = createTenantRoomsRoute<
  DuckXiangqiCreateContext,
  'red' | 'black' | 'random',
  'red' | 'black'
>({
  gameSpecId: DUCK_XIANGQI_SPEC_ID,
  errorPrefix: 'duck_xiangqi',
  hasDisabledFlag: true,
  preferredColors: ['red', 'black', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: DUCK_XIANGQI_DEFAULT_ENGINE_ID,
    isEngineClientId: isDuckXiangqiEngineClientId,
    seats: DUCK_XIANGQI_SEATS,
  },
  // PvE stays UNRATED here, and the policy is unchanged by the bot shipping:
  // the `duck_xiangqi` pool does not exist in the user_ratings CHECK and the
  // ladder has no EvE calibration behind it. `reject-as-surface` is what the
  // other unrated tenants use (banqi, jungle, dark-shogi): a rated request is
  // turned away as unsupported by the surface rather than as a
  // rating-eligibility failure, which is the honest reason here.
  rated: { kind: 'reject-as-surface' },
  createRoom: (ctx, { timeControl, preferredColor, rated, engine }) =>
    ctx.createDuckXiangqiRoom(timeControl, preferredColor, rated, engine),
});

export const requestsDuckXiangqi = duckXiangqiRoute.matchesCreateRequest;
export const handleDuckXiangqiCreate = duckXiangqiRoute.handleCreate;
