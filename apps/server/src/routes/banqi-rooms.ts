import type { ServerResponse } from 'node:http';
import { BANQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import {
  BANQI_DEFAULT_ENGINE_ID,
  banqiEngineAvailable,
  isBanqiEngineClientId,
} from './../banqi-engine.js';
import { internalBanqiConfiguration } from '../banqi-internal-provider.js';
import type { DrainCreate } from '../deploy-gate.js';
import { banqiEnabled } from '../feature-flags.js';
import type { InternalEngineTest } from './../internal-engine-test.js';
import { INTERNAL_BANQI_ENGINE_ID } from '../internal-engine-test.js';
import type { UserAccount } from '../persistence.js';
import {
  createTenantRoomsRoute,
  resolveFirstMoverHumanSeat,
} from './../variant-tenant/rooms-route.js';
import { parseRoomTimeControl, writeJson } from './lib.js';

// The slice of server context this route needs; the registry entry binds the
// tenant's room factory in (banqi-registration.ts). `preferredColor` selects the
// move-order SEAT — 'red' = first mover, 'black' = second (banqi binds the actual
// ink on the first flip, so the seat is a move-order choice, not an ink choice):
// 'red' | 'black' | 'random'.
export type BanqiCreateContext = {
  databaseRequired: boolean;
  refusesCreate(create?: DrainCreate): boolean;
  drainDeadlineMs(): number | null;
  createBanqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    engine?: { engineId: string; seat: 'red' | 'black'; botId?: string },
    rated?: boolean,
    internalEngineTest?: InternalEngineTest,
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
    heldEngineError: (engineId) =>
      isBanqiEngineClientId(engineId) && !banqiEngineAvailable(engineId)
        ? 'banqi_disabled'
        : undefined,
    seats: BANQI_SEATS,
  },
  // Rated friend rooms follow the lobby (rooms-route.ts gateRatedRoomRequest):
  // PvP may be rated wherever Find opponent is; PvE never is.
  createRoom: (ctx, { timeControl, preferredColor, rated, engine }) =>
    ctx.createBanqiRoom(timeControl, preferredColor, engine, rated),
});

export const requestsBanqi = banqiRoute.matchesCreateRequest;
export async function handleBanqiCreate(
  ctx: BanqiCreateContext,
  response: ServerResponse,
  body: Record<string, unknown>,
  accountUser: UserAccount | null = null,
): Promise<void> {
  if (body.engineId !== INTERNAL_BANQI_ENGINE_ID && body.internalEngineTest === undefined)
    return banqiRoute.handleCreate(ctx, response, body, accountUser);
  if (accountUser?.accountRole !== 'admin') {
    writeJson(response, 403, { error: 'admin_required' });
    return;
  }
  const allowed = new Set([
    'gameSpecId',
    'mode',
    'engineId',
    'internalEngineTest',
    'preferredColor',
    'timeControl',
  ]);
  if (
    body.gameSpecId !== 'banqi' ||
    body.mode !== 'pve' ||
    body.engineId !== INTERNAL_BANQI_ENGINE_ID ||
    body.internalEngineTest !== true ||
    Object.keys(body).some((key) => !allowed.has(key)) ||
    !['red', 'black', undefined].includes(body.preferredColor as 'red' | 'black' | undefined)
  ) {
    writeJson(response, 400, { error: 'invalid_internal_engine_test' });
    return;
  }
  const stamp = internalBanqiConfiguration(accountUser.id);
  if (!banqiEnabled() || !stamp) {
    writeJson(response, 503, { error: 'internal_provider_unavailable' });
    return;
  }
  if (ctx.refusesCreate()) {
    writeJson(response, 503, { error: 'server_draining' });
    return;
  }
  const timeControl = parseRoomTimeControl(body.timeControl);
  if (body.timeControl !== undefined && !timeControl) {
    writeJson(response, 400, { error: 'invalid_time_control' });
    return;
  }
  const humanSeat = body.preferredColor === 'black' ? 'black' : 'red';
  const result = await ctx.createBanqiRoom(
    timeControl ?? undefined,
    humanSeat,
    { engineId: INTERNAL_BANQI_ENGINE_ID, seat: humanSeat === 'red' ? 'black' : 'red' },
    false,
    stamp,
  );
  if (!result.ok) {
    writeJson(response, 503, { error: result.error });
    return;
  }
  writeJson(response, 201, {
    roomId: result.room.id,
    gameSpecId: 'banqi',
    rated: false,
    internalEngineTest: true,
  });
}

// Red is the first mover; the human's default seat is red. Picking black puts the
// engine on red so it opens immediately.
export function banqiPveHumanSeat(
  preferredSeat: 'red' | 'black' | 'random' | undefined,
  randomByte?: number,
): 'red' | 'black' {
  return resolveFirstMoverHumanSeat(preferredSeat, BANQI_SEATS, randomByte);
}
