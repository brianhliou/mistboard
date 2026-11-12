// The admin-playtest ladder is measurable without opening any public surface.
// Live play and EvE use the same masked turn request.
import {
  type BanqiColor,
  createFFQBanqiSetup,
  FFQ_BANQI_SPEC_ID,
  type FFQBanqiMove,
  type FFQBanqiState,
  getFFQBanqiLegalMoves,
} from '@mistboard/game';
import {
  FFQ_BANQI_RANDOM_ENGINE_ID,
  ffqBanqiEngineAvailable,
  ffqBanqiEngineTierFor,
  ffqBanqiLiveEngineMove,
  ffqBanqiMoveToUci,
} from './ffq-banqi-engine.js';
import { type FFQBanqiEvent, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { seededUnitRng } from './jieqi-eve-adapter.js';
import { ffqBanqiTierRequestFor } from './server-ffq-banqi-engine.js';
import type { VariantEveAdapter } from './variant-eve.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';

export const ffqBanqiEveAdapter: VariantEveAdapter<
  BanqiColor,
  FFQBanqiMove,
  FFQBanqiState,
  typeof FFQ_BANQI_SPEC_ID
> = {
  gameSpecId: FFQ_BANQI_SPEC_ID,
  colors: ['red', 'black'],
  tenant: ffqBanqiTenant,
  tierFor: (engineId) => {
    const tier = ffqBanqiEngineTierFor(engineId);
    return tier ? { id: tier.id, movetimeMs: tier.movetimeCapMs } : null;
  },
  randomEngineId: FFQ_BANQI_RANDOM_ENGINE_ID,
  createSetup: (seed) => createFFQBanqiSetup(seededUnitRng(seed)),
  legalMoves: getFFQBanqiLegalMoves,
  moveToUci: ffqBanqiMoveToUci,
  legalMoveForUci: (legal, uci) => legal.find((move) => ffqBanqiMoveToUci(move) === uci) ?? null,
  search: async (engineId, _history, opts, context) => {
    const events = context.events as readonly FFQBanqiEvent[];
    const state = replayTenantEvents(ffqBanqiTenant, events).state;
    const response = await ffqBanqiLiveEngineMove(
      ffqBanqiTierRequestFor(state, engineId, opts.movetimeMs),
    );
    return { best: ffqBanqiMoveToUci(response.move) };
  },
  // Workers fail closed without the native binary.
  requiredCapability: 'ffq_banqi_engine',
  available: () => ffqBanqiEngineAvailable('misty-ffq-banqi-level-8'),
};
