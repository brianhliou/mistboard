// EvE adapter for Duck Xiangqi. Mirrors the live loop in
// server-duck-xiangqi-engine.ts: take a general on offer without searching
// (the Skill Level knob otherwise declines found wins), FSF search under the
// tier's skill + node budget, kernel validation. No immediate-loss guard, for
// the reason the live loop gives: the legal set runs to thousands of turns and
// replaying every reply to every candidate would cost more than the search.

import {
  DUCK_XIANGQI_SPEC_ID,
  type DuckXiangqiColor,
  type DuckXiangqiGameState,
  type DuckXiangqiTurn,
  getDuckXiangqiLegalTurns,
} from '@mistboard/game';
import {
  DUCK_XIANGQI_RANDOM_ENGINE_ID,
  duckXiangqiEngineTierFor,
  duckXiangqiLiveEngineMove,
} from './duck-xiangqi-fsf-engine.js';
import { duckXiangqiTenant } from './duck-xiangqi-tenant.js';
import {
  duckXiangqiTurnToFsfUci,
  duckXiangqiWinningTurn,
  legalTurnForUci,
} from './server-duck-xiangqi-engine.js';
import type { VariantEveAdapter } from './variant-eve.js';

export const duckXiangqiEveAdapter: VariantEveAdapter<
  DuckXiangqiColor,
  DuckXiangqiTurn,
  DuckXiangqiGameState,
  typeof DUCK_XIANGQI_SPEC_ID
> = {
  gameSpecId: DUCK_XIANGQI_SPEC_ID,
  colors: ['red', 'black'],
  tenant: duckXiangqiTenant,
  tierFor: duckXiangqiEngineTierFor,
  randomEngineId: DUCK_XIANGQI_RANDOM_ENGINE_ID,
  legalMoves: getDuckXiangqiLegalTurns,
  moveToUci: duckXiangqiTurnToFsfUci,
  legalMoveForUci: legalTurnForUci,
  search: (engineId, history, opts) => duckXiangqiLiveEngineMove(engineId, history, opts),
  beforeSearch: duckXiangqiWinningTurn,
};
