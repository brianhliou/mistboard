// Whole-game FFQ analysis replays the deal server-side. Each engine request
// is the live side-to-move masked view; scores are normalized to Red's POV.
import { type FFQBanqiState, ffqBanqiStateToFen } from '@mistboard/game';
import {
  FFQ_BANQI_ENGINE_MOVETIME_CAP_MS,
  FFQ_BANQI_ENGINE_VERSION,
  type FFQBanqiEngineProvider,
  ffqBanqiEngineTierFor,
  ffqBanqiLiveEngineMove,
  ffqBanqiMoveToUci,
} from './ffq-banqi-engine.js';
import { searchFFQPublicFen } from './ffq-banqi-public-analysis.js';
import { type FFQBanqiEvent, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import {
  type AnalysisProgressStore,
  type GameAnalysisCacheOps,
  liveAnalysisProgressStore,
  resolveCachedComputation,
} from './game-analysis-kernel.js';
import {
  isVacuousAnalysis,
  type SweepPlyEval,
  VacuousAnalysisError,
} from './game-analysis-sweep.js';
import * as persistence from './persistence.js';
import { ffqBanqiTierRequestFor } from './server-ffq-banqi-engine.js';
import { applyTenantEvent, replayTenantEvents } from './variant-tenant/runtime.js';

export const FFQ_BANQI_ANALYSIS_TIER = 'misty-ffq-banqi-level-7';
// Legacy analysis-cache depth key; the search itself is node-limited.
export const FFQ_BANQI_ANALYSIS_DEPTH = 12;
const tier = ffqBanqiEngineTierFor(FFQ_BANQI_ANALYSIS_TIER)!;
// Tier budget and evaluator changes invalidate cached results.
export const FFQ_BANQI_ANALYSIS_ENGINE_ID = `misty-ffq-banqi-analysis@${FFQ_BANQI_ENGINE_VERSION}+${tier.id}-n${tier.nodes}-${tier.evaluation}-ms${tier.movetimeCapMs}-masked2-winfit20261113`;

export type FFQBanqiGameAnalysis = {
  engineId: string;
  depth: number;
  plies: SweepPlyEval[];
};
export type FFQBanqiAnalysisCache = GameAnalysisCacheOps<SweepPlyEval[]>;

export async function evaluateFFQBanqiPosition(
  state: FFQBanqiState,
  provider: FFQBanqiEngineProvider = ffqBanqiLiveEngineMove,
): Promise<Omit<SweepPlyEval, 'ply'>> {
  if (state.status.type === 'finished') {
    return {
      cp: state.status.winner === 'red' ? 30_000 : state.status.winner === 'black' ? -30_000 : 0,
      mate: null,
      best: null,
    };
  }
  if (state.status.type !== 'playing') {
    throw new Error('ffq_banqi_analysis_position_not_playing');
  }
  const evaluation =
    provider === ffqBanqiLiveEngineMove
      ? await searchFFQPublicFen(ffqBanqiStateToFen(state))
      : await provider(
          ffqBanqiTierRequestFor(state, FFQ_BANQI_ANALYSIS_TIER, FFQ_BANQI_ENGINE_MOVETIME_CAP_MS),
        );
  const sign = state.status.turn === 'red' ? 1 : -1;
  return {
    cp: evaluation.cp == null ? null : evaluation.cp * sign,
    mate: evaluation.mate == null ? null : evaluation.mate * sign,
    best: 'best' in evaluation ? evaluation.best : ffqBanqiMoveToUci(evaluation.move),
  };
}

export async function analyzeFFQBanqiPostgame(
  events: readonly FFQBanqiEvent[],
  provider: FFQBanqiEngineProvider = ffqBanqiLiveEngineMove,
  progress?: AnalysisProgressStore<SweepPlyEval>,
): Promise<FFQBanqiGameAnalysis> {
  const created = events[0];
  // Never generate a new random deal for an incomplete log.
  if (created?.type !== 'room-created' || !created.setup) {
    throw new Error('ffq_banqi_analysis_missing_deal');
  }
  const history: FFQBanqiEvent[] = [created];
  let projection = replayTenantEvents(ffqBanqiTenant, history);
  const resumed = await progress?.load();
  const plies = resumed ? [...resumed.items] : [];
  const evaluate = async (ply: number) => {
    if (ply < plies.length) return;
    const evaluation = await evaluateFFQBanqiPosition(projection.state, provider);
    plies.push({ ply, ...evaluation });
    await progress?.save({ nextIndex: ply + 1, items: plies });
  };
  await evaluate(0);
  let ply = 0;
  // Resignation/timeout are not board moves: the last point evaluates the
  // position actually played, as in banqi, rather than revealing the final deal.
  for (const event of events.slice(1)) {
    if (event.type !== 'move-played') continue;
    history.push(event);
    projection = applyTenantEvent(ffqBanqiTenant, projection, event);
    ply += 1;
    await evaluate(ply);
  }
  return {
    engineId: FFQ_BANQI_ANALYSIS_ENGINE_ID,
    depth: FFQ_BANQI_ANALYSIS_DEPTH,
    plies,
  };
}

const liveCache: FFQBanqiAnalysisCache = {
  get: (roomId, engineId, depth) => persistence.getGameAnalysis(roomId, engineId, depth),
  save: (roomId, engineId, depth, plies) =>
    persistence.saveGameAnalysis(roomId, engineId, depth, plies),
};

export async function resolveFFQBanqiAnalysis(
  roomId: string,
  events: readonly FFQBanqiEvent[],
  cache: FFQBanqiAnalysisCache = liveCache,
  analyze?: (events: readonly FFQBanqiEvent[]) => Promise<FFQBanqiGameAnalysis>,
  computeIfMissing = true,
): Promise<FFQBanqiGameAnalysis | null> {
  const engineId = FFQ_BANQI_ANALYSIS_ENGINE_ID;
  const depth = FFQ_BANQI_ANALYSIS_DEPTH;
  const progress = analyze
    ? null
    : liveAnalysisProgressStore<SweepPlyEval>(roomId, engineId, depth);
  const plies = await resolveCachedComputation({
    roomId,
    engineId,
    depth,
    cache,
    computeIfMissing,
    compute: async () =>
      (analyze
        ? await analyze(events)
        : await analyzeFFQBanqiPostgame(events, undefined, progress ?? undefined)
      ).plies,
    validate: (series) => {
      if (isVacuousAnalysis(series)) throw new VacuousAnalysisError('ffq-banqi');
    },
    afterSave: progress ? () => progress.clear() : undefined,
  }).catch(async (error: unknown) => {
    // A scoreless checkpoint must not make every retry resume the same broken
    // sweep after an engine repair. Keep checkpoints for genuine interruptions.
    if (error instanceof VacuousAnalysisError) await progress?.clear();
    throw error;
  });
  return plies ? { engineId, depth, plies } : null;
}
