// The admin-playtest ladder is measurable without opening any public surface.
// Live play and EvE use the same redacted repetition window and tier request.
import {
  type BanqiSeat,
  createThreeKingdomsBanqiSetup,
  getThreeKingdomsBanqiLegalMoves,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiState,
} from '@mistboard/game';
import { seededUnitRng } from './jieqi-eve-adapter.js';
import {
  threeKingdomsBanqiMoveToUci,
  threeKingdomsBanqiTierRequestFor,
} from './server-three-kingdoms-banqi-engine.js';
import {
  THREE_KINGDOMS_BANQI_RANDOM_ENGINE_ID,
  threeKingdomsBanqiEngineAvailable,
  threeKingdomsBanqiEngineTierFor,
  threeKingdomsBanqiLiveEngineMove,
} from './three-kingdoms-banqi-engine.js';
import {
  type ThreeKingdomsBanqiEvent,
  threeKingdomsBanqiTenant,
} from './three-kingdoms-banqi-tenant.js';
import type { VariantEveAdapter } from './variant-eve.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';

export const threeKingdomsBanqiEveAdapter: VariantEveAdapter<
  BanqiSeat,
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiState,
  typeof THREE_KINGDOMS_BANQI_SPEC_ID
> = {
  gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
  colors: ['red', 'black'],
  tenant: threeKingdomsBanqiTenant,
  tierFor: (engineId) => {
    const tier = threeKingdomsBanqiEngineTierFor(engineId);
    return tier ? { id: tier.id, movetimeMs: tier.movetimeCapMs } : null;
  },
  randomEngineId: THREE_KINGDOMS_BANQI_RANDOM_ENGINE_ID,
  createSetup: (seed) => createThreeKingdomsBanqiSetup(seededUnitRng(seed)),
  legalMoves: getThreeKingdomsBanqiLegalMoves,
  moveToUci: threeKingdomsBanqiMoveToUci,
  legalMoveForUci: (legal, uci) =>
    legal.find((move) => threeKingdomsBanqiMoveToUci(move) === uci) ?? null,
  search: (engineId, _history, opts, context) => {
    const events = context.events as readonly ThreeKingdomsBanqiEvent[];
    const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
    return threeKingdomsBanqiLiveEngineMove(
      threeKingdomsBanqiTierRequestFor(events, state, engineId, opts.movetimeMs),
    );
  },
  // A single capability covers the whole ladder, including L8's required net.
  requiredCapability: 'three_kingdoms_banqi_engine',
  available: () => threeKingdomsBanqiEngineAvailable('misty-three-kingdoms-banqi-level-8'),
};
