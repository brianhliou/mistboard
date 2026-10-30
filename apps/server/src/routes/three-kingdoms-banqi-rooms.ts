// Create route for the Three Kingdoms banqi playtest (#628, #684). With the
// local flag off, only an admin account may create a room (admits); everyone
// else gets 404 three_kingdoms_banqi_disabled, the same answer as before. PvE
// exists only when the engine binary resolves (three-kingdoms-banqi-engine.ts);
// without it a PvE create answers the same 404.

import { type RoomTimeControl, THREE_KINGDOMS_BANQI_SPEC_ID } from '@mistboard/game';
import type { DrainCreate } from '../deploy-gate.js';
import { threeKingdomsBanqiAdmits } from '../three-kingdoms-banqi-access.js';
import {
  isThreeKingdomsBanqiEngineClientId,
  THREE_KINGDOMS_BANQI_ENGINE_ID,
  threeKingdomsBanqiEngineAvailable,
} from '../three-kingdoms-banqi-engine.js';
import { createTenantRoomsRoute } from '../variant-tenant/rooms-route.js';

type Seat = 'red' | 'black';

export type ThreeKingdomsBanqiCreateContext = {
  databaseRequired: boolean;
  refusesCreate(create?: DrainCreate): boolean;
  drainDeadlineMs(): number | null;
  createThreeKingdomsBanqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: Seat | 'random',
    engine?: { engineId: string; seat: Seat; botId?: string },
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string; rated: boolean } }
    | {
        ok: false;
        error: 'three_kingdoms_banqi_disabled' | 'persistence_failure' | 'room_id_collision';
      }
  >;
};

const route = createTenantRoomsRoute<ThreeKingdomsBanqiCreateContext, Seat | 'random', Seat>({
  gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
  errorPrefix: 'three_kingdoms_banqi',
  hasDisabledFlag: true,
  admits: threeKingdomsBanqiAdmits,
  preferredColors: ['red', 'black', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: THREE_KINGDOMS_BANQI_ENGINE_ID,
    isEngineClientId: isThreeKingdomsBanqiEngineClientId,
    heldEngineError: (engineId) =>
      isThreeKingdomsBanqiEngineClientId(engineId) && !threeKingdomsBanqiEngineAvailable()
        ? 'three_kingdoms_banqi_disabled'
        : undefined,
    seats: ['red', 'black'],
  },
  createRoom: (ctx, { timeControl, preferredColor, engine }) =>
    ctx.createThreeKingdomsBanqiRoom(timeControl, preferredColor, engine),
});

export const requestsThreeKingdomsBanqi = route.matchesCreateRequest;
export const handleThreeKingdomsBanqiCreate = route.handleCreate;
