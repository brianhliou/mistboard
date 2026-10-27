// Create route for the Three Kingdoms banqi local playtest (#628). PvE exists
// only when MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH names a binary; without
// it a PvE create answers 404 three_kingdoms_banqi_disabled.

import { type RoomTimeControl, THREE_KINGDOMS_BANQI_SPEC_ID } from '@mistboard/game';
import type { DrainCreate } from '../deploy-gate.js';
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
