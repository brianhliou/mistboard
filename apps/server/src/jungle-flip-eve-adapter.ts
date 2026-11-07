// Flip Jungle's ladder uses the live redacted FEN, repetition seeds and per-game
// tie/noise seed. The extra random mover is an EvE-only rating anchor.
import {
  createJungleFlipDeal,
  getJungleFlipLegalMoves,
  JUNGLE_FLIP_SPEC_ID,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipSeat,
} from '@mistboard/game';
import { seededUnitRng } from './jieqi-eve-adapter.js';
import {
  JUNGLE_FLIP_RANDOM_ENGINE_ID,
  jungleFlipEngineBinaryAvailable,
  jungleFlipEngineTierFor,
  jungleFlipLiveEngineMove,
  jungleFlipTieSeed,
} from './jungle-flip-engine.js';
import {
  engineUciToJungleFlipMove,
  jungleFlipMoveToEngineUci,
  jungleFlipRepSeedFens,
  jungleFlipStateToEngineFen,
} from './jungle-flip-fen.js';
import type { JungleFlipEvent } from './jungle-flip-runtime.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import type { VariantEveAdapter } from './variant-eve.js';
import { applyTenantEvent, replayTenantEvents } from './variant-tenant/runtime.js';

export const jungleFlipEveAdapter: VariantEveAdapter<
  JungleFlipSeat,
  JungleFlipMove,
  JungleFlipGameState,
  typeof JUNGLE_FLIP_SPEC_ID
> = {
  gameSpecId: JUNGLE_FLIP_SPEC_ID,
  colors: ['red', 'black'],
  tenant: jungleFlipTenant,
  tierFor: (engineId) => {
    const tier = jungleFlipEngineTierFor(engineId);
    return tier ? { id: tier.id, movetimeMs: tier.movetimeCapMs } : null;
  },
  randomEngineId: JUNGLE_FLIP_RANDOM_ENGINE_ID,
  createSetup: (seed) => createJungleFlipDeal(seededUnitRng(seed)),
  legalMoves: getJungleFlipLegalMoves,
  moveToUci: jungleFlipMoveToEngineUci,
  legalMoveForUci: (legal, uci) => {
    const parsed = engineUciToJungleFlipMove(uci);
    return parsed
      ? (legal.find((move) => move.from === parsed.from && move.to === parsed.to) ?? null)
      : null;
  },
  search: (engineId, _history, opts, context) => {
    const events = context.events as readonly JungleFlipEvent[];
    let projection = replayTenantEvents(jungleFlipTenant, events.slice(0, 1));
    const states = [projection.state];
    for (const event of events.slice(1)) {
      projection = applyTenantEvent(jungleFlipTenant, projection, event);
      if (event.type === 'move-played') states.push(projection.state);
    }
    return jungleFlipLiveEngineMove(engineId, jungleFlipStateToEngineFen(projection.state), {
      movetimeCapMs: opts.movetimeMs,
      repSeedFens: jungleFlipRepSeedFens(states),
      tieSeed: jungleFlipTieSeed(events[0]!.roomId),
    });
  },
  requiredCapability: 'jungle_flip_engine',
  available: jungleFlipEngineBinaryAvailable,
};
