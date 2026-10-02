// EvE adapter for Jungle (斗兽棋): scheduled data games between the site's own
// jungle engine tiers (#488), on the Rust binary prod serves (jungle-engine.ts).
// Jungle offers ONE bot (misty-jungle-level-2, "Misty"); the retired levels 1
// and 3 still resolve, attribute to Misty (first-party-bots.ts), and give the
// scheduler a three-rung ladder to pair. Not a rating adapter: there is no
// random floor, so no job of this variant carries a rating_policy.
//
// The engine is fed what the live Rust path feeds it (server-jungle-engine.ts):
// the full-board FEN (perfect information) and the repetition seeds of the game
// so far. No guard or pre-search scan runs on that path, so none runs here.

import {
  getJungleLegalMoves,
  JUNGLE_SPEC_ID,
  type JungleColor,
  type JungleGameState,
  type JungleMove,
} from '@mistboard/game';
import {
  jungleEngineBinaryAvailable,
  jungleLiveEngineMove,
  jungleRustTierFor,
} from './jungle-engine.js';
import {
  engineUciToJungleMove,
  jungleMoveToEngineUci,
  jungleRepSeedFens,
  jungleStateToEngineFen,
} from './jungle-fen.js';
import { jungleTenant } from './jungle-tenant.js';
import type { VariantEveAdapter } from './variant-eve.js';
import { applyTenantEvent, replayTenantEvents } from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';

type JungleEvent = TenantRoomEvent<JungleColor, JungleMove, typeof JUNGLE_SPEC_ID>;

/** Every position of the game so far, start first, for the repetition seeds. */
export function jungleEveStates(events: readonly JungleEvent[]): JungleGameState[] {
  let step = replayTenantEvents(jungleTenant, events.slice(0, 1));
  const states: JungleGameState[] = [step.state];
  for (const event of events.slice(1)) {
    step = applyTenantEvent(jungleTenant, step, event);
    if (event.type === 'move-played') states.push(step.state);
  }
  return states;
}

export const jungleEveAdapter: VariantEveAdapter<
  JungleColor,
  JungleMove,
  JungleGameState,
  typeof JUNGLE_SPEC_ID
> = {
  gameSpecId: JUNGLE_SPEC_ID,
  colors: ['red', 'black'],
  tenant: jungleTenant,
  tierFor: (engineId) => {
    const tier = jungleRustTierFor(engineId);
    return tier ? { id: tier.id, movetimeMs: tier.movetimeCapMs } : null;
  },
  legalMoves: getJungleLegalMoves,
  moveToUci: jungleMoveToEngineUci,
  legalMoveForUci: (legalMoves, uci) => {
    const parsed = engineUciToJungleMove(uci);
    if (!parsed) return null;
    return legalMoves.find((m) => m.from === parsed.from && m.to === parsed.to) ?? null;
  },
  search: (engineId, _history, opts, context) => {
    const states = jungleEveStates(context.events as readonly JungleEvent[]);
    return jungleLiveEngineMove(engineId, jungleStateToEngineFen(states[states.length - 1]!), {
      movetimeCapMs: opts.movetimeMs,
      repSeedFens: jungleRepSeedFens(states),
    });
  },
  requiredCapability: 'jungle_engine',
  available: jungleEngineBinaryAvailable,
};
