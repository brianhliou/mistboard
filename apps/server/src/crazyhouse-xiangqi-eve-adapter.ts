// EvE adapter for Crazyhouse Xiangqi. Same shape as the live loop in
// server-crazyhouse-xiangqi-engine.ts: FSF search under the tier's skill + node
// budget, kernel validation, then the immediate-loss guard. The ladder is the
// Fortress table unmeasured on this variant; this is what makes it measurable.

import {
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  crazyhouseXiangqiMoveToUci,
  getCrazyhouseXiangqiLegalMoves,
} from '@mistboard/game';
import {
  CRAZYHOUSE_XIANGQI_RANDOM_ENGINE_ID,
  crazyhouseXiangqiEngineTierFor,
  crazyhouseXiangqiLiveEngineMove,
} from './crazyhouse-xiangqi-fsf-engine.js';
import { crazyhouseXiangqiTenant } from './crazyhouse-xiangqi-tenant.js';
import {
  guardCrazyhouseXiangqiEngineMove,
  legalMoveForUci,
} from './server-crazyhouse-xiangqi-engine.js';
import type { VariantEveAdapter } from './variant-eve.js';

export const crazyhouseXiangqiEveAdapter: VariantEveAdapter<
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState,
  typeof CRAZYHOUSE_XIANGQI_SPEC_ID
> = {
  gameSpecId: CRAZYHOUSE_XIANGQI_SPEC_ID,
  colors: ['red', 'black'],
  tenant: crazyhouseXiangqiTenant,
  tierFor: crazyhouseXiangqiEngineTierFor,
  randomEngineId: CRAZYHOUSE_XIANGQI_RANDOM_ENGINE_ID,
  legalMoves: getCrazyhouseXiangqiLegalMoves,
  moveToUci: crazyhouseXiangqiMoveToUci,
  legalMoveForUci,
  search: (engineId, history, opts) => crazyhouseXiangqiLiveEngineMove(engineId, history, opts),
  guard: guardCrazyhouseXiangqiEngineMove,
};
