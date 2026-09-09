/**
 * Duck Xiangqi room-create route. PvP only for now: no `engine` block, because
 * the bot needs a patched Fairy-Stockfish built on engine-worker and that is a
 * separate deploy with its own hazards.
 */

import { DUCK_XIANGQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import { createTenantRoomsRoute } from './../variant-tenant/rooms-route.js';

export type DuckXiangqiCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createDuckXiangqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    rated?: boolean,
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | {
        ok: false;
        error: 'duck_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision';
      }
  >;
};

const duckXiangqiRoute = createTenantRoomsRoute<
  DuckXiangqiCreateContext,
  'red' | 'black' | 'random',
  'red' | 'black'
>({
  gameSpecId: DUCK_XIANGQI_SPEC_ID,
  errorPrefix: 'duck_xiangqi',
  hasDisabledFlag: true,
  preferredColors: ['red', 'black', 'random'],
  // PvP only for now. `rejectEngineId: true` turns away a request that asks for
  // a bot rather than silently creating a human room the player will sit alone
  // in — the failure mode is a seat nobody ever takes.
  engine: { kind: 'none', rejectEngineId: true },
  // Unrated until the `duck_xiangqi` pool exists in the user_ratings CHECK and
  // the bot ladder is calibrated. `reject-as-surface` is what the other
  // PvP-only tenants use (banqi, jungle, dark-shogi): a rated request is turned
  // away as unsupported by the surface rather than as a rating-eligibility
  // failure, which is the honest reason here.
  rated: { kind: 'reject-as-surface' },
  createRoom: (ctx, { timeControl, preferredColor, rated }) =>
    ctx.createDuckXiangqiRoom(timeControl, preferredColor, rated),
});

export const requestsDuckXiangqi = duckXiangqiRoute.matchesCreateRequest;
export const handleDuckXiangqiCreate = duckXiangqiRoute.handleCreate;
