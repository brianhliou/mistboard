/**
 * Atomic Xiangqi room-create route: PvP, plus PvE against the Fairy-Stockfish
 * ladder on the patched atomic binary (atomic-xiangqi-fsf-engine.ts).
 */

import { ATOMIC_XIANGQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import {
  ATOMIC_XIANGQI_DEFAULT_ENGINE_ID,
  isAtomicXiangqiEngineClientId,
} from './../server-atomic-xiangqi-engine.js';
import { createTenantRoomsRoute } from './../variant-tenant/rooms-route.js';

export type AtomicXiangqiCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createAtomicXiangqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    rated?: boolean,
    engine?: { engineId: string; seat: 'red' | 'black'; botId?: string },
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | {
        ok: false;
        error: 'atomic_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision';
      }
  >;
};

const ATOMIC_XIANGQI_SEATS = ['red', 'black'] as const;

const atomicXiangqiRoute = createTenantRoomsRoute<
  AtomicXiangqiCreateContext,
  'red' | 'black' | 'random',
  'red' | 'black'
>({
  gameSpecId: ATOMIC_XIANGQI_SPEC_ID,
  errorPrefix: 'atomic_xiangqi',
  hasDisabledFlag: true,
  preferredColors: ['red', 'black', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: ATOMIC_XIANGQI_DEFAULT_ENGINE_ID,
    isEngineClientId: isAtomicXiangqiEngineClientId,
    seats: ATOMIC_XIANGQI_SEATS,
  },
  // Rated only through Find opponent (the lobby seek, registration.ts), the
  // jieqi shape: a friend link or a PvE request asking for rated is turned
  // away as unsupported by this surface. The atomic_xiangqi pool itself is in
  // the user_ratings CHECK since migration 147.
  rated: { kind: 'reject-as-surface' },
  createRoom: (ctx, { timeControl, preferredColor, rated, engine }) =>
    ctx.createAtomicXiangqiRoom(timeControl, preferredColor, rated, engine),
});

export const requestsAtomicXiangqi = atomicXiangqiRoute.matchesCreateRequest;
export const handleAtomicXiangqiCreate = atomicXiangqiRoute.handleCreate;
