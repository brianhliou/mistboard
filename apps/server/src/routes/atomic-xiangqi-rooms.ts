/**
 * Atomic Xiangqi room-create route. PvP only until stage 3 seats the patched
 * Fairy-Stockfish ladder: an engine id in the body is turned away as an
 * unsupported surface rather than silently seating a human against nobody.
 */

import { ATOMIC_XIANGQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import { createTenantRoomsRoute } from './../variant-tenant/rooms-route.js';

export type AtomicXiangqiCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createAtomicXiangqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    rated?: boolean,
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | {
        ok: false;
        error: 'atomic_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision';
      }
  >;
};

const atomicXiangqiRoute = createTenantRoomsRoute<
  AtomicXiangqiCreateContext,
  'red' | 'black' | 'random',
  'red' | 'black'
>({
  gameSpecId: ATOMIC_XIANGQI_SPEC_ID,
  errorPrefix: 'atomic_xiangqi',
  hasDisabledFlag: true,
  preferredColors: ['red', 'black', 'random'],
  engine: { kind: 'none', rejectEngineId: true },
  // Casual only. There is no `atomic_xiangqi` pool in the user_ratings CHECK,
  // so a rated request is turned away as unsupported by the surface, the way
  // the other unrated tenants do it.
  rated: { kind: 'reject-as-surface' },
  createRoom: (ctx, { timeControl, preferredColor, rated }) =>
    ctx.createAtomicXiangqiRoom(timeControl, preferredColor, rated),
});

export const requestsAtomicXiangqi = atomicXiangqiRoute.matchesCreateRequest;
export const handleAtomicXiangqiCreate = atomicXiangqiRoute.handleCreate;
