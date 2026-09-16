// EvE adapter for Atomic Xiangqi. Mirrors the live loop in
// server-atomic-xiangqi-engine.ts: remove a general on offer without
// searching (the Skill Level knob otherwise declines found wins), FSF search
// under the tier's skill + node budget, kernel validation. No immediate-loss
// guard: the node-anchored rungs are the strength control, and the ladder is
// rated on what the live loop plays.

import {
  ATOMIC_XIANGQI_SPEC_ID,
  type AtomicXiangqiColor,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  getAtomicXiangqiLegalMoves,
} from '@mistboard/game';
import {
  ATOMIC_XIANGQI_RANDOM_ENGINE_ID,
  atomicXiangqiEngineTierFor,
  atomicXiangqiLiveEngineMove,
} from './atomic-xiangqi-fsf-engine.js';
import { atomicXiangqiTenant } from './atomic-xiangqi-tenant.js';
import {
  atomicXiangqiMoveToUci,
  atomicXiangqiWinningMove,
  legalMoveForUci,
} from './server-atomic-xiangqi-engine.js';
import type { VariantEveAdapter } from './variant-eve.js';

export const atomicXiangqiEveAdapter: VariantEveAdapter<
  AtomicXiangqiColor,
  AtomicXiangqiMove,
  AtomicXiangqiGameState,
  typeof ATOMIC_XIANGQI_SPEC_ID
> = {
  gameSpecId: ATOMIC_XIANGQI_SPEC_ID,
  colors: ['red', 'black'],
  tenant: atomicXiangqiTenant,
  tierFor: atomicXiangqiEngineTierFor,
  randomEngineId: ATOMIC_XIANGQI_RANDOM_ENGINE_ID,
  legalMoves: getAtomicXiangqiLegalMoves,
  moveToUci: atomicXiangqiMoveToUci,
  legalMoveForUci,
  search: (engineId, history, opts) => atomicXiangqiLiveEngineMove(engineId, history, opts),
  beforeSearch: atomicXiangqiWinningMove,
};
