// Whole-game TK analysis at L8: replay the original deal, but give the engine
// only the live turn's public FEN, quiet history and legal chase restrictions.
// Scores stay in the first (red) SEAT's POV, independent of the opening ink.
import type { ThreeKingdomsBanqiState } from '@mistboard/game';
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
import { threeKingdomsBanqiTierRequestFor } from './server-three-kingdoms-banqi-engine.js';
import {
  THREE_KINGDOMS_BANQI_ENGINE_MOVETIME_CAP_MS,
  THREE_KINGDOMS_BANQI_ENGINE_VERSION,
  type ThreeKingdomsBanqiEngineProvider,
  threeKingdomsBanqiLiveEngineMove,
} from './three-kingdoms-banqi-engine.js';
import {
  type ThreeKingdomsBanqiEvent,
  threeKingdomsBanqiTenant,
} from './three-kingdoms-banqi-tenant.js';
import { applyTenantEvent, replayTenantEvents } from './variant-tenant/runtime.js';

export const THREE_KINGDOMS_BANQI_ANALYSIS_TIER = 'misty-three-kingdoms-banqi-level-8';
export const THREE_KINGDOMS_BANQI_ANALYSIS_DEPTH = 12;
// Invalidate if the budget, evaluator, ChanceMix or history semantics change.
export const THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID = `misty-three-kingdoms-banqi-analysis@${THREE_KINGDOMS_BANQI_ENGINE_VERSION}+l8-n2048000-nnue-mix-history1`;

export type ThreeKingdomsBanqiGameAnalysis = {
  engineId: string;
  depth: number;
  plies: SweepPlyEval[];
};
export type ThreeKingdomsBanqiAnalysisCache = GameAnalysisCacheOps<SweepPlyEval[]>;

export async function evaluateThreeKingdomsBanqiPosition(
  state: ThreeKingdomsBanqiState,
  events: readonly ThreeKingdomsBanqiEvent[],
  provider: ThreeKingdomsBanqiEngineProvider = threeKingdomsBanqiLiveEngineMove,
): Promise<Omit<SweepPlyEval, 'ply'>> {
  if (state.status.type === 'finished') {
    return {
      cp: state.status.winner === 'red' ? 30_000 : state.status.winner === 'black' ? -30_000 : 0,
      mate: null,
      best: null,
    };
  }
  if (state.status.type !== 'playing') {
    throw new Error('three_kingdoms_banqi_analysis_position_not_playing');
  }
  const evaluation = await provider(
    threeKingdomsBanqiTierRequestFor(
      events,
      state,
      THREE_KINGDOMS_BANQI_ANALYSIS_TIER,
      THREE_KINGDOMS_BANQI_ENGINE_MOVETIME_CAP_MS,
    ),
  );
  const sign = state.status.turn === 'red' ? 1 : -1;
  return {
    cp: evaluation.cp == null ? null : evaluation.cp * sign,
    mate: evaluation.mate == null ? null : evaluation.mate * sign,
    best: evaluation.best,
  };
}

export async function analyzeThreeKingdomsBanqiPostgame(
  events: readonly ThreeKingdomsBanqiEvent[],
  provider: ThreeKingdomsBanqiEngineProvider = threeKingdomsBanqiLiveEngineMove,
  progress?: AnalysisProgressStore<SweepPlyEval>,
): Promise<ThreeKingdomsBanqiGameAnalysis> {
  const created = events[0];
  // Never generate a new random deal for an incomplete log.
  if (created?.type !== 'room-created' || !created.setup) {
    throw new Error('three_kingdoms_banqi_analysis_missing_deal');
  }
  const history: ThreeKingdomsBanqiEvent[] = [created];
  let projection = replayTenantEvents(threeKingdomsBanqiTenant, history);
  const resumed = await progress?.load();
  const plies = resumed ? [...resumed.items] : [];
  const evaluate = async (ply: number) => {
    if (ply < plies.length) return;
    const evaluation = await evaluateThreeKingdomsBanqiPosition(
      projection.state,
      history,
      provider,
    );
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
    projection = applyTenantEvent(threeKingdomsBanqiTenant, projection, event);
    ply += 1;
    await evaluate(ply);
  }
  return {
    engineId: THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID,
    depth: THREE_KINGDOMS_BANQI_ANALYSIS_DEPTH,
    plies,
  };
}

const liveCache: ThreeKingdomsBanqiAnalysisCache = {
  get: (roomId, engineId, depth) => persistence.getGameAnalysis(roomId, engineId, depth),
  save: (roomId, engineId, depth, plies) =>
    persistence.saveGameAnalysis(roomId, engineId, depth, plies),
};

export async function resolveThreeKingdomsBanqiAnalysis(
  roomId: string,
  events: readonly ThreeKingdomsBanqiEvent[],
  cache: ThreeKingdomsBanqiAnalysisCache = liveCache,
  analyze?: (events: readonly ThreeKingdomsBanqiEvent[]) => Promise<ThreeKingdomsBanqiGameAnalysis>,
  computeIfMissing = true,
): Promise<ThreeKingdomsBanqiGameAnalysis | null> {
  const engineId = THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID;
  const depth = THREE_KINGDOMS_BANQI_ANALYSIS_DEPTH;
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
        : await analyzeThreeKingdomsBanqiPostgame(events, undefined, progress ?? undefined)
      ).plies,
    validate: (series) => {
      if (isVacuousAnalysis(series)) throw new VacuousAnalysisError('three-kingdoms-banqi');
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
