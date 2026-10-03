// EvE adapter for Jungle (斗兽棋): scheduled data games between the site's own
// jungle engine tiers (#488), on the engines prod serves. Jungle offers two bots:
// KataGo-AnimalChess on top (katago-jungle, jungle-katago-engine.ts) and Misty
// (misty-jungle-level-2, the Rust binary in jungle-engine.ts); Misty's retired
// levels 1 and 3 still resolve and attribute to her (first-party-bots.ts), so the
// scheduler has a four-rung ladder to pair. Not a rating adapter: there is no
// random floor, so no job of this variant carries a rating_policy.
//
// Each engine is fed what its live path feeds it (server-jungle-engine.ts): Misty
// the full-board FEN and the repetition seeds of the game so far, KataGo the FEN
// and the side to move (its loop rule is NONE; the kernel's repetition rule
// governs). No guard or pre-search scan runs on either path, so none runs here.

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
import {
  katagoJungleAvailable,
  katagoJungleLiveEngineMove,
  katagoJungleTierFor,
} from './jungle-katago-engine.js';
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
    const tier = jungleRustTierFor(engineId) ?? katagoJungleTierFor(engineId);
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
    const state = states[states.length - 1]!;
    const fen = jungleStateToEngineFen(state);
    const katago = katagoJungleTierFor(engineId);
    if (katago) {
      if (state.status.type !== 'playing')
        throw new Error('katago-jungle asked to move a finished game');
      return katagoJungleLiveEngineMove(fen, state.status.turn, {
        visits: katago.visits,
        movetimeCapMs: opts.movetimeMs,
      });
    }
    return jungleLiveEngineMove(engineId, fen, {
      movetimeCapMs: opts.movetimeMs,
      repSeedFens: jungleRepSeedFens(states),
    });
  },
  // A jungle task may seat either engine, so a worker claims one only when it can
  // run both: a missing binary or net leaves the game queued instead of failing it.
  requiredCapability: 'jungle_engine',
  available: () => jungleEngineBinaryAvailable() && katagoJungleAvailable(),
};
