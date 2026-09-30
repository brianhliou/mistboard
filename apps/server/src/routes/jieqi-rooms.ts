import { JIEQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import {
  abJchessAvailable,
  isJieqiEngineClientId,
  JIEQI_ABJCHESS_ENGINE_ID,
  JIEQI_DEFAULT_ENGINE_ID,
} from './../jieqi-engine.js';
import {
  createTenantRoomsRoute,
  resolveFirstMoverHumanSeat,
} from './../variant-tenant/rooms-route.js';

// The slice of server context this route needs; the registry entry binds the
// tenant's room factory in (jieqi-registration.ts).
export type JieqiCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createJieqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    engine?: { engineId: string; seat: 'red' | 'black'; botId?: string },
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string } }
    | { ok: false; error: 'jieqi_disabled' | 'persistence_failure' | 'room_id_collision' }
  >;
};

const JIEQI_SEATS = ['red', 'black'] as const;

const jieqiRoute = createTenantRoomsRoute<
  JieqiCreateContext,
  'red' | 'black' | 'random',
  'red' | 'black'
>({
  gameSpecId: JIEQI_SPEC_ID,
  errorPrefix: 'jieqi',
  hasDisabledFlag: true,
  preferredColors: ['red', 'black', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: JIEQI_DEFAULT_ENGINE_ID,
    // The AB-JChess slot needs its binary and net (a dev box usually has neither);
    // refusing here beats a room that aborts at its first engine move.
    isEngineClientId: (engineId) =>
      isJieqiEngineClientId(engineId) &&
      (engineId !== JIEQI_ABJCHESS_ENGINE_ID || abJchessAvailable()),
    seats: JIEQI_SEATS,
  },
  rated: { kind: 'reject-as-surface' },
  createRoom: (ctx, { timeControl, preferredColor, engine }) =>
    ctx.createJieqiRoom(timeControl, preferredColor, engine),
});

export const requestsJieqi = jieqiRoute.matchesCreateRequest;
export const handleJieqiCreate = jieqiRoute.handleCreate;

// Red is the first mover; the human's default seat is red. Picking black puts the
// engine on red so it opens immediately.
export function jieqiPveHumanColor(
  preferredColor: 'red' | 'black' | 'random' | undefined,
  randomByte?: number,
): 'red' | 'black' {
  return resolveFirstMoverHumanSeat(preferredColor, JIEQI_SEATS, randomByte);
}
