// EvE adapter for Fortress Xiangqi. Same shape as the live loop in
// server-fortress-xiangqi-engine.ts: FSF search under the tier's skill + node
// budget, kernel validation, then the immediate-loss guard. The ladder shipped
// with tiers interpolated between three retired presets and no measurement
// (fortress-xiangqi-fsf-engine.ts); this is what makes it measurable.

import {
  FORTRESS_XIANGQI_SPEC_ID,
  type FortressXiangqiColor,
  type FortressXiangqiGameState,
  type FortressXiangqiMove,
  getFortressXiangqiLegalMoves,
} from '@mistboard/game';
import {
  FORTRESS_XIANGQI_RANDOM_ENGINE_ID,
  fortressXiangqiEngineTierFor,
  fortressXiangqiLiveEngineMove,
} from './fortress-xiangqi-fsf-engine.js';
import { fortressXiangqiTenant } from './fortress-xiangqi-tenant.js';
import {
  fortressXiangqiMoveToUci,
  guardFortressXiangqiEngineMove,
  legalMoveForUci,
} from './server-fortress-xiangqi-engine.js';
import type { VariantEveAdapter } from './variant-eve.js';

export const fortressXiangqiEveAdapter: VariantEveAdapter<
  FortressXiangqiColor,
  FortressXiangqiMove,
  FortressXiangqiGameState,
  typeof FORTRESS_XIANGQI_SPEC_ID
> = {
  gameSpecId: FORTRESS_XIANGQI_SPEC_ID,
  colors: ['red', 'black'],
  tenant: fortressXiangqiTenant,
  tierFor: fortressXiangqiEngineTierFor,
  randomEngineId: FORTRESS_XIANGQI_RANDOM_ENGINE_ID,
  legalMoves: getFortressXiangqiLegalMoves,
  moveToUci: fortressXiangqiMoveToUci,
  legalMoveForUci,
  search: (engineId, history, opts) => fortressXiangqiLiveEngineMove(engineId, history, opts),
  guard: guardFortressXiangqiEngineMove,
};
