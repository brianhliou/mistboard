import { type RoomTimeControl, XIANGQI_SPEC_ID } from '@mistboard/game';
import { isXiangqiEngineClientId, XIANGQI_DEFAULT_ENGINE_ID } from './../server-xiangqi-engine.js';
import {
  createTenantRoomsRoute,
  resolveFirstMoverHumanSeat,
} from './../variant-tenant/rooms-route.js';

// The slice of server context this route needs; the registry entry binds the
// tenant's room factory in (xiangqi-registration.ts). Rated PvP is
// account-gated (#151 rated flip); PvE is served by mainline Pikafish and
// stays casual.
export type XiangqiCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createXiangqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    rated?: boolean,
    engine?: { engineId: string; seat: 'red' | 'black'; botId?: string },
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | { ok: false; error: 'xiangqi_disabled' | 'persistence_failure' | 'room_id_collision' }
  >;
};

const XIANGQI_SEATS = ['red', 'black'] as const;

const xiangqiRoute = createTenantRoomsRoute<
  XiangqiCreateContext,
  'red' | 'black' | 'random',
  'red' | 'black'
>({
  gameSpecId: XIANGQI_SPEC_ID,
  errorPrefix: 'xiangqi',
  hasDisabledFlag: true,
  preferredColors: ['red', 'black', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: XIANGQI_DEFAULT_ENGINE_ID,
    isEngineClientId: isXiangqiEngineClientId,
    seats: XIANGQI_SEATS,
  },
  // Rated friend rooms follow the lobby (rooms-route.ts gateRatedRoomRequest):
  // PvP may be rated wherever Find opponent is; PvE never is.
  createRoom: (ctx, { timeControl, preferredColor, rated, engine }) =>
    ctx.createXiangqiRoom(timeControl, preferredColor, rated, engine),
});

export const requestsXiangqi = xiangqiRoute.matchesCreateRequest;
export const handleXiangqiCreate = xiangqiRoute.handleCreate;

// Red is the first mover; the human's default seat is red. Picking black puts the
// engine on red so it opens immediately.
export function xiangqiPveHumanColor(
  preferredColor: 'red' | 'black' | 'random' | undefined,
  randomByte?: number,
): 'red' | 'black' {
  return resolveFirstMoverHumanSeat(preferredColor, XIANGQI_SEATS, randomByte);
}
