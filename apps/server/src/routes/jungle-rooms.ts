import { JUNGLE_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import {
  isJunglePlayableEngineClientId,
  JUNGLE_PLAYABLE_ENGINE_ID,
} from './../server-jungle-engine.js';
import {
  createTenantRoomsRoute,
  resolveFirstMoverHumanSeat,
} from './../variant-tenant/rooms-route.js';

// The slice of server context this route needs; the registry entry binds the
// tenant's room factory in (jungle-registration.ts). `preferredColor` selects the
// move-order seat — 'red' = first mover (and the red pieces), 'black' = second.
export type JungleCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  createJungleRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    engine?: { engineId: string; seat: 'red' | 'black'; botId?: string },
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string } }
    | { ok: false; error: 'jungle_disabled' | 'persistence_failure' | 'room_id_collision' }
  >;
};

const JUNGLE_SEATS = ['red', 'black'] as const;

const jungleRoute = createTenantRoomsRoute<
  JungleCreateContext,
  'red' | 'black' | 'random',
  'red' | 'black'
>({
  gameSpecId: JUNGLE_SPEC_ID,
  errorPrefix: 'jungle',
  hasDisabledFlag: true,
  preferredColors: ['red', 'black', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: JUNGLE_PLAYABLE_ENGINE_ID,
    // PLAYABLE, not "is an engine": this is a create-time allowlist, so it must reject
    // the retired level-1/level-3 ids that the tenant runtime still recognises for
    // finished games. See server-jungle-engine.ts for why the two predicates differ.
    // The KataGo top seat passes only where its binary, net and config resolve.
    isEngineClientId: isJunglePlayableEngineClientId,
    seats: JUNGLE_SEATS,
  },
  // PvP + PvE (the in-process Misty Jungle engine). Rated is still unsupported.
  rated: { kind: 'reject-as-surface' },
  createRoom: (ctx, { timeControl, preferredColor, engine }) =>
    ctx.createJungleRoom(timeControl, preferredColor, engine),
});

export const requestsJungle = jungleRoute.matchesCreateRequest;
export const handleJungleCreate = jungleRoute.handleCreate;

// Red is the first mover; the human's default seat is red. Picking black puts the
// engine on red so it opens immediately.
export function junglePveHumanSeat(
  preferredColor: 'red' | 'black' | 'random' | undefined,
  randomByte?: number,
): 'red' | 'black' {
  return resolveFirstMoverHumanSeat(preferredColor, JUNGLE_SEATS, randomByte);
}
