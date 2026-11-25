// Whole-game FFQ analysis replays the deal server-side. Each engine request
// is the live side-to-move masked view; scores are normalized to Red's POV.
import { type FFQBanqiState, ffqBanqiStateToFen, winPercent } from '@mistboard/game';
import {
  FFQ_BANQI_ENGINE_MOVETIME_CAP_MS,
  FFQ_BANQI_ENGINE_VERSION,
  type FFQBanqiEngineProvider,
  ffqBanqiEngineTierFor,
  ffqBanqiLiveEngineMove,
  ffqBanqiMoveToUci,
} from './ffq-banqi-engine.js';
import { ffqPublicSearchMovetimeMs, searchFFQPublicFen } from './ffq-banqi-public-analysis.js';
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
// Tier budget and evaluator changes invalidate cached results. The luck id derives
// from this base: the bounce re-search below changes review scores, not luck rows.
export const FFQ_BANQI_ANALYSIS_BASE_ENGINE_ID = `misty-ffq-banqi-analysis@${FFQ_BANQI_ENGINE_VERSION}+${tier.id}-n${tier.nodes}-${tier.evaluation}-ms${tier.movetimeCapMs}-masked2-winfit20261113`;
// Keeps `-winfit20261113` (winPercentK picks the fitted FFQ curve from it).
export const FFQ_BANQI_ANALYSIS_ENGINE_ID = `${FFQ_BANQI_ANALYSIS_BASE_ENGINE_ID}-reconcile1`;

/**
 * Win% points both movers must lose around one position for it to be re-searched:
 * the review's mistake line. The level-7 search is node-limited and reports its
 * last COMPLETED depth, and positions with different branching complete
 * different depths. A shallow depth often flatters the side to move, so one
 * position reads far out of line with both neighbours and the two moves around
 * it both look like mistakes or blunders (1306 / 345 / 1306 in red's view).
 * Real mutual blunders (one side leaves a piece, the other leaves it) have the
 * same shape, so a bounce alone is not an error: the deeper search decides.
 */
export const FFQ_BANQI_BOUNCE_WIN = 10;
/**
 * The bounce re-search budget, 40x the sweep's. A 4x re-search (jieqi's) mostly
 * completes the same depth and repeats the same score; this one reaches the next.
 */
export const FFQ_BANQI_RESEARCH_NODES = 1_000_000;
const RESEARCH_MOVETIME_CAP_MS = ffqPublicSearchMovetimeMs(FFQ_BANQI_RESEARCH_NODES);

export type FFQBanqiGameAnalysis = {
  engineId: string;
  depth: number;
  plies: SweepPlyEval[];
};
export type FFQBanqiAnalysisCache = GameAnalysisCacheOps<SweepPlyEval[]>;

export async function evaluateFFQBanqiPosition(
  state: FFQBanqiState,
  provider: FFQBanqiEngineProvider = ffqBanqiLiveEngineMove,
  nodes: number = tier.nodes,
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
  const request = ffqBanqiTierRequestFor(
    state,
    FFQ_BANQI_ANALYSIS_TIER,
    FFQ_BANQI_ENGINE_MOVETIME_CAP_MS,
  );
  const evaluation =
    provider === ffqBanqiLiveEngineMove
      ? await searchFFQPublicFen(ffqBanqiStateToFen(state), nodes)
      : await provider(
          nodes === tier.nodes
            ? request
            : { ...request, nodes, movetimeCapMs: RESEARCH_MOVETIME_CAP_MS },
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
  const states: FFQBanqiState[] = [projection.state];
  // chance[k]: move k turned over or took a covered piece, so its value is a reveal.
  const chance: boolean[] = [false];
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
    chance.push(projection.state.board[event.move.to]?.faceDown === true);
    projection = applyTenantEvent(ffqBanqiTenant, projection, event);
    states.push(projection.state);
    ply += 1;
    await evaluate(ply);
  }
  return {
    engineId: FFQ_BANQI_ANALYSIS_ENGINE_ID,
    depth: FFQ_BANQI_ANALYSIS_DEPTH,
    // The checkpoint keeps the plain sweep, so a resumed run reconciles the same input.
    plies: await reconcileFFQBanqiBounces(plies, states, chance, provider),
  };
}

/**
 * Re-search every position whose two neighbouring moves are both non-chance and
 * both lose at least FFQ_BANQI_BOUNCE_WIN for their movers, and keep the deeper
 * score. When the deeper score moved by at least that much and the bounce is
 * still there, neither budget is trustworthy and the position is marked
 * `unstable`, which leaves both moves ungraded. A bounce the deeper search
 * confirms stays graded: it is a real pair of mistakes.
 *
 * Not jieqi's reconcile: that one re-searches a position its mover GAINED from,
 * which a search-parity bounce never is (both moves are losses), and its 4x
 * budget does not reach the next depth here.
 */
async function reconcileFFQBanqiBounces(
  sweep: readonly SweepPlyEval[],
  states: readonly FFQBanqiState[],
  chance: readonly boolean[],
  provider: FFQBanqiEngineProvider,
): Promise<SweepPlyEval[]> {
  const plies = sweep.map((entry) => ({ ...entry }));
  const win = (entry: SweepPlyEval) =>
    winPercent(entry.cp, entry.mate, FFQ_BANQI_ANALYSIS_ENGINE_ID);
  const loss = (k: number, before: SweepPlyEval, after: SweepPlyEval) => {
    // Move k was played from position k - 1, which was therefore still in play.
    const { status } = states[k - 1]!;
    const redMoved = status.type === 'playing' && status.turn === 'red';
    return redMoved ? win(before) - win(after) : win(after) - win(before);
  };
  const bounces = (k: number, at: SweepPlyEval) =>
    loss(k, plies[k - 1]!, at) >= FFQ_BANQI_BOUNCE_WIN &&
    loss(k + 1, at, plies[k + 1]!) >= FFQ_BANQI_BOUNCE_WIN;
  for (let k = 1; k + 1 < plies.length; k += 1) {
    if (chance[k] || chance[k + 1] || states[k]!.status.type !== 'playing') continue;
    const shallow = plies[k]!;
    if (!bounces(k, shallow)) continue;
    const deep = await evaluateFFQBanqiPosition(states[k]!, provider, FFQ_BANQI_RESEARCH_NODES);
    if (deep.cp == null && deep.mate == null) continue;
    const replacement: SweepPlyEval = { ply: shallow.ply, ...deep };
    if (
      Math.abs(win(replacement) - win(shallow)) >= FFQ_BANQI_BOUNCE_WIN &&
      bounces(k, replacement)
    ) {
      replacement.unstable = true;
    }
    plies[k] = replacement;
  }
  return plies;
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
