// EvE uses the dealt live board and the native serving path, including seeded
// weakening for Levels 1–8 and the unmodified final move for strongest.
import { existsSync } from 'node:fs';
import {
  GOMOKU_DEALT_OPENINGS,
  GOMOKU_SPEC_ID,
  type GomokuColor,
  type GomokuMove,
  type GomokuRoomState,
  getGomokuLegalMoves,
  RAPFI_LEVELS,
  RAPFI_STRONGEST,
} from '@mistboard/game';
import { rapfiAnalysisBinaryPath } from './gomoku-analysis.js';
import { type GomokuMoveProvider, gomokuLiveEngineMove } from './gomoku-engine.js';
import { GOMOKU_RANDOM_ENGINE_ID } from './gomoku-engine-catalog.js';
import { type GomokuEvent, gomokuTenant } from './gomoku-tenant.js';
import { seededUnitRng } from './jieqi-eve-adapter.js';
import type { VariantEveAdapter } from './variant-eve.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';

export function createGomokuEveAdapter(
  provider: GomokuMoveProvider = gomokuLiveEngineMove,
): VariantEveAdapter<GomokuColor, GomokuMove, GomokuRoomState, typeof GOMOKU_SPEC_ID> {
  return {
    gameSpecId: GOMOKU_SPEC_ID,
    colors: ['black', 'white'],
    tenant: gomokuTenant,
    tierFor: (engineId) => {
      const tier =
        engineId === 'rapfi-strongest'
          ? RAPFI_STRONGEST
          : RAPFI_LEVELS.find((tier) => engineId === `rapfi-level-${tier.level}`);
      return tier ? { id: engineId!, movetimeMs: tier.timeMs } : null;
    },
    randomEngineId: GOMOKU_RANDOM_ENGINE_ID,
    createSetup: (seed) => {
      const index = Math.floor(seededUnitRng(seed)() * GOMOKU_DEALT_OPENINGS.length);
      const { stones, turn } = GOMOKU_DEALT_OPENINGS[index]!;
      return { stones, turn };
    },
    legalMoves: (state) =>
      state.status.type === 'playing'
        ? getGomokuLegalMoves({ ...state, status: state.status })
        : [],
    moveToUci: (move) => move.to,
    legalMoveForUci: (legal, uci) => legal.find((move) => move.to === uci) ?? null,
    search: async (engineId, _history, opts, context) => {
      const state = replayTenantEvents(
        gomokuTenant,
        context.events as readonly GomokuEvent[],
      ).state;
      if (state.status.type !== 'playing' || state.status.turn !== context.color)
        throw new Error('gomoku: invalid EvE search turn');
      const move = await provider(state, engineId, { movetimeMs: opts.movetimeMs });
      if (move && !gomokuTenant.rules.isLegalMove(state, move))
        throw new Error('gomoku: illegal EvE engine placement');
      return { best: move?.to ?? null };
    },
    requiredCapability: 'gomoku_engine',
    available: () => existsSync(rapfiAnalysisBinaryPath()),
  };
}

export const gomokuEveAdapter = createGomokuEveAdapter();
