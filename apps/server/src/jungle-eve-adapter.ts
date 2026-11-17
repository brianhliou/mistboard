// EvE adapter for Jungle: KataGo plus the classical Misty ladder. Historical
// Misty IDs remain resolvable for stored games. There is no random anchor or
// published level rating; calibration lives in scripts/jungle-classical-ladder.ts.
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
  jungleClassicalSeed,
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
      seed: jungleClassicalSeed(
        state.id,
        states.length - 1,
        jungleRustTierFor(engineId)?.level ?? 7,
      ),
    });
  },
  // A jungle task may seat either engine, so a worker claims one only when it can
  // run both: a missing binary or net leaves the game queued instead of failing it.
  requiredCapability: 'jungle_engine',
  available: () => jungleEngineBinaryAvailable() && katagoJungleAvailable(),
};
