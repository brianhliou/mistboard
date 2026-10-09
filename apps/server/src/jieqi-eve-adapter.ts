// EvE adapter for Jieqi (揭棋): what makes the jieqi ladder rateable.
//
// Two things differ from the xiangqi-family adapters. The deal is a server secret
// stamped on room-created, so createSetup mints one from the pairing's seed (both
// colour orders of a pairing play the same deal, as a paired opening does in
// xiangqi). And the engine is not fed a move list: it gets the redacted FEN window
// the live room builds (jieqiEngineWindowFromEvents), through the same
// jieqiLiveEngineMove, so the Skill Level pick a rated bot makes is the one a
// served bot makes. The live path's one guard, the draw guard (jieqi-draw-guard.ts),
// runs here too with the same re-search, so a rated bot avoids the rule draws a
// served one avoids; there is no pre-search scan.

import {
  createJieqiDeal,
  getJieqiLegalMoves,
  JIEQI_SPEC_ID,
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
} from '@mistboard/game';
import { guardJieqiRuleEnding } from './jieqi-draw-guard.js';
import { JIEQI_RANDOM_ENGINE_ID, jieqiEngineTierFor, jieqiLiveEngineMove } from './jieqi-engine.js';
import { jieqiMoveToPikafishUci, pikafishUciToJieqiMove } from './jieqi-fen.js';
import type { JieqiEvent } from './jieqi-runtime.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { jieqiEngineWindowFromEvents } from './server-jieqi-engine.js';
import type { VariantEveAdapter } from './variant-eve.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';

/** A [0,1) stream from a 63-bit seed (the EvE loop's LCG), for a reproducible deal. */
export function seededUnitRng(seed: bigint): () => number {
  let state = seed & ((1n << 63n) - 1n);
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 63n) - 1n);
    return Number(state >> 11n) / 2 ** 52;
  };
}

export const jieqiEveAdapter: VariantEveAdapter<
  JieqiColor,
  JieqiMove,
  JieqiGameState,
  typeof JIEQI_SPEC_ID
> = {
  gameSpecId: JIEQI_SPEC_ID,
  colors: ['red', 'black'],
  tenant: jieqiTenant,
  tierFor: (engineId) => {
    const tier = jieqiEngineTierFor(engineId);
    return tier && !tier.retired ? tier : null;
  },
  randomEngineId: JIEQI_RANDOM_ENGINE_ID,
  createSetup: (seed) => createJieqiDeal(seededUnitRng(seed)),
  legalMoves: getJieqiLegalMoves,
  moveToUci: jieqiMoveToPikafishUci,
  legalMoveForUci: (legalMoves, uci) => {
    const parsed = pikafishUciToJieqiMove(uci);
    if (!parsed) return null;
    return legalMoves.find((m) => m.from === parsed.from && m.to === parsed.to) ?? null;
  },
  search: async (engineId, _history, opts, context) => {
    const seat = context.color as JieqiColor;
    const window = jieqiEngineWindowFromEvents(
      context.events as readonly JieqiEvent[],
      seat,
      () => {
        throw new Error('jieqi EvE game has no room-created event');
      },
    );
    const search = await jieqiLiveEngineMove(engineId, window.fen, {
      movetimeMs: opts.movetimeMs,
      moves: window.moves,
      newGame: window.gameMoves.length <= 1,
    });
    const state = replayTenantEvents(
      jieqiTenant,
      context.events as readonly TenantRoomEvent<JieqiColor, JieqiMove, typeof JIEQI_SPEC_ID>[],
    ).state;
    const guarded = await guardJieqiRuleEnding({
      state,
      search,
      // Untimed, so half the tier's movetime: the live path's re-search share.
      research: (searchMoves) =>
        jieqiLiveEngineMove(engineId, window.fen, {
          movetimeMs: Math.max(50, Math.floor(opts.movetimeMs / 2)),
          moves: window.moves,
          searchMoves,
        }),
    });
    return guarded.search;
  },
};
