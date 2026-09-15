// EvE adapter for standard xiangqi: the ladder that was rated by hand-rolled
// loop on 2026-09-02 (memory `project_xiangqi_fsf_l8_rebuild`), now expressed
// through the shared adapter so the other xiangqi-family ladders rate the same
// way. Includes the live immediate-loss guard: the rated bot is the offered bot.

import {
  getStandardXiangqiLegalMoves,
  XIANGQI_SPEC_ID,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  xiangqiMoveToPikafishUci,
} from '@mistboard/game';
import { guardXiangqiEngineMove, legalMoveForUci } from './server-xiangqi-engine.js';
import type { VariantEveAdapter } from './variant-eve.js';
import { xiangqiEngineTierFor, xiangqiLiveEngineMove } from './xiangqi-engine-catalog.js';
import { XIANGQI_RANDOM_ENGINE_ID } from './xiangqi-random-engine.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

export const xiangqiEveAdapter: VariantEveAdapter<
  XiangqiColor,
  XiangqiMove,
  XiangqiGameState,
  typeof XIANGQI_SPEC_ID
> = {
  gameSpecId: XIANGQI_SPEC_ID,
  colors: ['red', 'black'],
  tenant: xiangqiTenant,
  tierFor: xiangqiEngineTierFor,
  randomEngineId: XIANGQI_RANDOM_ENGINE_ID,
  legalMoves: getStandardXiangqiLegalMoves,
  moveToUci: xiangqiMoveToPikafishUci,
  legalMoveForUci,
  search: (engineId, history, opts) => xiangqiLiveEngineMove(engineId, history, opts),
  guard: guardXiangqiEngineMove,
};
