// EvE adapter for Banqi (半棋): scheduled data games between the site's own bot
// (#488). Not a rating adapter: banqi has ONE bot (MistyBanqi) and no random
// floor, so its games are MistyBanqi against itself, and with no anchor nothing
// can stamp a rating_policy on them (variant-eve-registry.test.ts pins both).
//
// Like jieqi, the deal is a server secret stamped on room-created: createSetup
// draws one from the pairing's seed, so every scheduled game (a fresh seed each)
// is dealt afresh and its export carries deal_fen (#484). The engine is fed what
// the live loop feeds it (server-banqi-engine.ts): the redacted FEN at the start
// of the no-progress window plus the quiet moves since, so it sees repetitions.
// The live path has no guard or pre-search scan, so neither does this.

import {
  BANQI_SPEC_ID,
  type BanqiGameState,
  type BanqiMove,
  type BanqiSeat,
  createBanqiDeal,
  getBanqiLegalMoves,
} from '@mistboard/game';
import {
  BANQI_PLAYABLE_ENGINES,
  banqiEngineBinaryAvailable,
  banqiLiveEngineMove,
} from './banqi-engine.js';
import { banqiMoveToEngineUci, banqiStateToEngineFen, engineUciToBanqiMove } from './banqi-fen.js';
import type { BanqiEvent } from './banqi-runtime.js';
import { banqiTenant } from './banqi-tenant.js';
import { seededUnitRng } from './jieqi-eve-adapter.js';
import type { VariantEveAdapter } from './variant-eve.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';

const BANQI_TIERS = new Map(BANQI_PLAYABLE_ENGINES.map((tier) => [tier.id, tier]));

/** The engine's view at the mover's turn, as server-banqi-engine.ts builds it live. */
export function banqiEveEngineWindow(events: readonly BanqiEvent[]): {
  fen: string;
  moves: string[];
} {
  const state = replayTenantEvents(banqiTenant, events).state;
  const moveEvents = events.filter(
    (e): e is Extract<BanqiEvent, { type: 'move-played' }> => e.type === 'move-played',
  );
  const k = state.noProgressClock;
  if (k <= 0 || k >= moveEvents.length) return { fen: banqiStateToEngineFen(state), moves: [] };
  const cutoff = events.indexOf(moveEvents[moveEvents.length - k]!);
  const start = replayTenantEvents(banqiTenant, events.slice(0, cutoff)).state;
  return {
    fen: banqiStateToEngineFen(start),
    moves: moveEvents.slice(moveEvents.length - k).map((e) => banqiMoveToEngineUci(e.move)),
  };
}

export const banqiEveAdapter: VariantEveAdapter<
  BanqiSeat,
  BanqiMove,
  BanqiGameState,
  typeof BANQI_SPEC_ID
> = {
  gameSpecId: BANQI_SPEC_ID,
  colors: ['red', 'black'],
  tenant: banqiTenant,
  // The offered bot only; the retired tier ids resolve live for old rooms but
  // are not something a scheduled game should play.
  tierFor: (engineId) => {
    const tier = engineId ? BANQI_TIERS.get(engineId) : undefined;
    return tier ? { id: tier.id, movetimeMs: tier.movetimeCapMs } : null;
  },
  createSetup: (seed) => createBanqiDeal(seededUnitRng(seed)),
  legalMoves: getBanqiLegalMoves,
  moveToUci: banqiMoveToEngineUci,
  legalMoveForUci: (legalMoves, uci) => {
    const parsed = engineUciToBanqiMove(uci);
    if (!parsed) return null;
    return legalMoves.find((m) => m.from === parsed.from && m.to === parsed.to) ?? null;
  },
  search: (engineId, _history, opts, context) => {
    const window = banqiEveEngineWindow(context.events as readonly BanqiEvent[]);
    return banqiLiveEngineMove(engineId, window.fen, {
      movetimeCapMs: opts.movetimeMs,
      moves: window.moves,
    });
  },
  requiredCapability: 'banqi_engine',
  available: banqiEngineBinaryAvailable,
};
