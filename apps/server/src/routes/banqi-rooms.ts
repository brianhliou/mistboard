import { BANQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import { BANQI_DEFAULT_ENGINE_ID, isBanqiEngineClientId } from './../banqi-engine.js';
import {
  createTenantRoomsRoute,
  resolveFirstMoverHumanSeat,
} from './../variant-tenant/rooms-route.js';

// The slice of server context this route needs; the registry entry binds the
// tenant's room factory in (banqi-registration.ts). `preferredColor` selects the
// move-order SEAT — 'red' = first mover, 'black' = second (banqi binds the actual
// ink on the first flip, so the seat is a move-order choice, not an ink choice):
// 'red' | 'black' | 'random'.
export type BanqiCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createBanqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    engine?: { engineId: string; seat: 'red' | 'black'; botId?: string },
    rated?: boolean,
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | { ok: false; error: 'banqi_disabled' | 'persistence_failure' | 'room_id_collision' }
  >;
};

const BANQI_SEATS = ['red', 'black'] as const;

const banqiRoute = createTenantRoomsRoute<
  BanqiCreateContext,
  'red' | 'black' | 'random',
  'red' | 'black'
>({
  gameSpecId: BANQI_SPEC_ID,
  errorPrefix: 'banqi',
  hasDisabledFlag: true,
  preferredColors: ['red', 'black', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: BANQI_DEFAULT_ENGINE_ID,
    isEngineClientId: isBanqiEngineClientId,
    seats: BANQI_SEATS,
  },
  // Rated friend rooms follow the lobby (rooms-route.ts gateRatedRoomRequest):
  // PvP may be rated wherever Find opponent is; PvE never is.
  createRoom: (ctx, { timeControl, preferredColor, rated, engine }) =>
    ctx.createBanqiRoom(timeControl, preferredColor, engine, rated),
});

export const requestsBanqi = banqiRoute.matchesCreateRequest;
export const handleBanqiCreate = banqiRoute.handleCreate;

// Red is the first mover; the human's default seat is red. Picking black puts the
// engine on red so it opens immediately.
export function banqiPveHumanSeat(
  preferredSeat: 'red' | 'black' | 'random' | undefined,
  randomByte?: number,
): 'red' | 'black' {
  return resolveFirstMoverHumanSeat(preferredSeat, BANQI_SEATS, randomByte);
}
