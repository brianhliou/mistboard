import { FORTRESS_XIANGQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import {
  FORTRESS_XIANGQI_DEFAULT_ENGINE_ID,
  isFortressXiangqiEngineClientId,
} from './../server-fortress-xiangqi-engine.js';
import {
  createTenantRoomsRoute,
  resolveFirstMoverHumanSeat,
} from './../variant-tenant/rooms-route.js';

export type FortressXiangqiCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createFortressXiangqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    rated?: boolean,
    engine?: { engineId: string; seat: 'red' | 'black'; botId?: string },
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | {
        ok: false;
        error: 'fortress_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision';
      }
  >;
};

const FORTRESS_XIANGQI_SEATS = ['red', 'black'] as const;

const fortressXiangqiRoute = createTenantRoomsRoute<
  FortressXiangqiCreateContext,
  'red' | 'black' | 'random',
  'red' | 'black'
>({
  gameSpecId: FORTRESS_XIANGQI_SPEC_ID,
  errorPrefix: 'fortress_xiangqi',
  hasDisabledFlag: true,
  preferredColors: ['red', 'black', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: FORTRESS_XIANGQI_DEFAULT_ENGINE_ID,
    isEngineClientId: isFortressXiangqiEngineClientId,
    seats: FORTRESS_XIANGQI_SEATS,
  },
  // Rated friend rooms follow the lobby (rooms-route.ts gateRatedRoomRequest):
  // PvP may be rated wherever Find opponent is; PvE never is.
  createRoom: (ctx, { timeControl, preferredColor, rated, engine }) =>
    ctx.createFortressXiangqiRoom(timeControl, preferredColor, rated, engine),
});

export const requestsFortressXiangqi = fortressXiangqiRoute.matchesCreateRequest;
export const handleFortressXiangqiCreate = fortressXiangqiRoute.handleCreate;

export function fortressXiangqiPveHumanColor(
  preferredColor: 'red' | 'black' | 'random' | undefined,
  randomByte?: number,
): 'red' | 'black' {
  return resolveFirstMoverHumanSeat(preferredColor, FORTRESS_XIANGQI_SEATS, randomByte);
}
