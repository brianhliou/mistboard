// Layer 2: separate the choice of a covered square from the tile it revealed.
// Only the public engine pool supplies the counterfactual distribution. The
// actual deal is read once per played flip, solely to select its realized term.
import {
  applyThreeKingdomsBanqiMove,
  type BanqiPiece,
  type BanqiPieceRole,
  banqiPieceLetter,
  getThreeKingdomsBanqiLegalMoves,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiSquare,
  type ThreeKingdomsBanqiState,
  winPercent,
} from '@mistboard/game';
import type { BanqiDecision, BanqiDecisionCandidate } from './banqi-analysis.js';
import {
  type AnalysisProgressStore,
  type GameAnalysisCacheOps,
  liveAnalysisProgressStore,
  mapWithConcurrency,
  resolveCachedComputation,
} from './game-analysis-kernel.js';
import { VacuousAnalysisError } from './game-analysis-sweep.js';
import * as persistence from './persistence.js';
import {
  threeKingdomsBanqiMoveToUci,
  threeKingdomsBanqiTierRequestFor,
} from './server-three-kingdoms-banqi-engine.js';
import {
  THREE_KINGDOMS_BANQI_ANALYSIS_DEPTH,
  THREE_KINGDOMS_BANQI_ANALYSIS_TIER,
} from './three-kingdoms-banqi-analysis.js';
import {
  THREE_KINGDOMS_BANQI_ENGINE_VERSION,
  type ThreeKingdomsBanqiEngineProvider,
  threeKingdomsBanqiLiveEngineMove,
} from './three-kingdoms-banqi-engine.js';
import {
  type ThreeKingdomsBanqiEvent,
  threeKingdomsBanqiTenant,
} from './three-kingdoms-banqi-tenant.js';
import { applyTenantEvent, replayTenantEvents } from './variant-tenant/runtime.js';

// Up to 3 root searches + 4 candidates × 14 distinct outcomes per flip.
// 30 flips: <= 1,770 searches. Measured 2026-11-07 on an M-series laptop: 16k nodes
// ran a 31-flip game in 16 s, so the budget is 128k nodes with a 1 s cap; the cap and
// two-slot fan-out keep it to a few minutes on a laptop, rather than L8's 2M
// nodes for EVERY outcome. Startup/NNUE loading adds machine-dependent cost.
export const THREE_KINGDOMS_BANQI_DECISION_NODES = 128_000;
export const THREE_KINGDOMS_BANQI_DECISION_MOVETIME_CAP_MS = 1_000;
const CANDIDATES = 3;
const CONCURRENCY = 2;
export const THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID = `misty-three-kingdoms-banqi-decisions@${THREE_KINGDOMS_BANQI_ENGINE_VERSION}+d1-n128000-ms1000-c3-nnue-mix-history1`;
export type ThreeKingdomsBanqiDecision = BanqiDecision;
export type ThreeKingdomsBanqiDecisionsCache = GameAnalysisCacheOps<ThreeKingdomsBanqiDecision[]>;

type PoolEntry = { piece: BanqiPiece; count: number };

function publicPool(fen: string): PoolEntry[] {
  const field = fen.split(' ')[7];
  if (!field || field === '-') throw new Error('three_kingdoms_banqi_decisions_missing_pool');
  const roles: Record<string, BanqiPieceRole> = {
    G: 'general',
    A: 'advisor',
    E: 'elephant',
    R: 'chariot',
    H: 'horse',
    C: 'cannon',
    S: 'soldier',
  };
  const entries: PoolEntry[] = [];
  let consumed = '';
  for (const match of field.matchAll(/([GAERHCSgaerhcs])(\d+)/g)) {
    const [term, letter, count] = match as unknown as [string, string, string];
    const role = roles[letter.toUpperCase()];
    if (!role || Number(count) <= 0) throw new Error('three_kingdoms_banqi_decisions_bad_pool');
    consumed += term;
    entries.push({
      piece: { color: letter === letter.toUpperCase() ? 'red' : 'black', role, faceDown: true },
      count: Number(count),
    });
  }
  if (consumed !== field) throw new Error('three_kingdoms_banqi_decisions_bad_pool');
  return entries;
}

// Build an arbitrary representative deal FROM THE PUBLIC BAG, fixing the
// candidate square's outcome. No donor identity or hidden location is read.
function counterfactual(
  state: ThreeKingdomsBanqiState,
  square: ThreeKingdomsBanqiSquare,
  outcome: PoolEntry,
  pool: readonly PoolEntry[],
): ThreeKingdomsBanqiState {
  const remaining = pool.flatMap((entry) =>
    Array.from({ length: entry.count - (entry === outcome ? 1 : 0) }, () => entry.piece),
  );
  const board = { ...state.board, [square]: { ...outcome.piece } };
  for (const key of Object.keys(state.board).sort() as ThreeKingdomsBanqiSquare[]) {
    if (key === square || !state.board[key]?.faceDown) continue;
    const piece = remaining.shift();
    if (!piece) throw new Error('three_kingdoms_banqi_decisions_pool_mismatch');
    board[key] = { ...piece };
  }
  if (remaining.length) throw new Error('three_kingdoms_banqi_decisions_pool_mismatch');
  return { ...state, board };
}

/** All values are win%, mover-SEAT POV, independent of the opening ink. */
export async function evaluateThreeKingdomsBanqiFlipDecision(
  state: ThreeKingdomsBanqiState,
  history: readonly ThreeKingdomsBanqiEvent[],
  played: ThreeKingdomsBanqiMove,
  ply: number,
  provider: ThreeKingdomsBanqiEngineProvider = threeKingdomsBanqiLiveEngineMove,
): Promise<ThreeKingdomsBanqiDecision> {
  if (
    state.status.type !== 'playing' ||
    played.from !== played.to ||
    !state.board[played.from]?.faceDown
  ) {
    throw new Error('three_kingdoms_banqi_decisions_not_a_flip');
  }
  const mover = state.status.turn;
  const requestFor = (
    position: ThreeKingdomsBanqiState,
    events: readonly ThreeKingdomsBanqiEvent[],
  ) => ({
    ...threeKingdomsBanqiTierRequestFor(
      events,
      position,
      THREE_KINGDOMS_BANQI_ANALYSIS_TIER,
      THREE_KINGDOMS_BANQI_DECISION_MOVETIME_CAP_MS,
    ),
    nodes: THREE_KINGDOMS_BANQI_DECISION_NODES,
  });
  const root = requestFor(state, history);
  // Quiet history cannot change the pool, so the window-start FEN has the
  // same bag as the mover's current position.
  const pool = publicPool(root.fen);
  const legal = getThreeKingdomsBanqiLegalMoves(state);
  const playedUci = threeKingdomsBanqiMoveToUci(played);
  const candidates = new Map<string, ThreeKingdomsBanqiMove>([[playedUci, played]]);
  let remaining = legal;
  // ChanceMix proposes alternatives from public inputs; only their exact
  // pool means decide the final ranking. This is a bounded candidate ceiling,
  // not an exhaustive proof of the best of every legal move.
  for (let i = 0; i < CANDIDATES && remaining.length; i += 1) {
    const evaluation = await provider({
      ...root,
      searchMoves: remaining.map(threeKingdomsBanqiMoveToUci),
    });
    const selected = remaining.find(
      (move) => threeKingdomsBanqiMoveToUci(move) === evaluation.best,
    );
    if (!selected) throw new Error('three_kingdoms_banqi_decisions_invalid_candidate');
    candidates.set(threeKingdomsBanqiMoveToUci(selected), selected);
    remaining = remaining.filter((move) => move !== selected);
  }
  const winAfter = async (before: ThreeKingdomsBanqiState, move: ThreeKingdomsBanqiMove) => {
    const post = applyThreeKingdomsBanqiMove(before, move);
    if (post === before) throw new Error('three_kingdoms_banqi_decisions_invalid_move');
    if (post.status.type === 'finished') {
      return post.status.winner === mover ? 100 : post.status.winner === null ? 50 : 0;
    }
    const event: ThreeKingdomsBanqiEvent = {
      type: 'move-played',
      at: 0,
      roomId: state.id,
      color: mover,
      move,
    };
    const evaluation = await provider(requestFor(post, [...history, event]));
    if (evaluation.cp === null && evaluation.mate === null)
      throw new VacuousAnalysisError('three-kingdoms-banqi');
    // Engine scores are side-to-move: post has the opponent to move. This
    // equals converting base-analysis red-seat POV back to the mover's POV.
    return winPercent(
      evaluation.cp === null ? null : -evaluation.cp,
      evaluation.mate === null ? null : -evaluation.mate,
      THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID,
    );
  };
  const total = pool.reduce((sum, entry) => sum + entry.count, 0);
  let playedWin = 0;
  let realizedWin = 0;
  const scored: BanqiDecisionCandidate[] = [];
  for (const [uci, move] of candidates) {
    let win: number;
    if (move.from === move.to) {
      const wins = await mapWithConcurrency(pool, CONCURRENCY, (entry) =>
        winAfter(counterfactual(state, move.from, entry, pool), move),
      );
      // Center the weighted mean so equal outcomes remain exactly equal to
      // a deterministic board move's value (no rounding-only decision loss).
      const reference = wins[0]!;
      win =
        reference +
        pool.reduce(
          (sum, entry, index) => sum + (entry.count / total) * (wins[index]! - reference),
          0,
        );
      if (uci === playedUci) {
        const realized = pool.findIndex(
          (entry) => banqiPieceLetter(entry.piece) === banqiPieceLetter(state.board[played.from]!),
        );
        if (realized < 0) throw new Error('three_kingdoms_banqi_decisions_missing_outcome');
        realizedWin = wins[realized]!;
      }
    } else win = await winAfter(state, move);
    scored.push({ move: uci, win, ...(uci === playedUci ? { played: true } : {}) });
    if (uci === playedUci) playedWin = win;
  }
  scored.sort((a, b) => b.win - a.win || a.move.localeCompare(b.move));
  return {
    ply,
    mover,
    bestWin: scored[0]!.win,
    playedWin,
    realizedWin,
    playedRank: 1 + scored.filter((entry) => entry.win > playedWin + 1e-9).length,
    candidates: scored,
  };
}

export async function analyzeThreeKingdomsBanqiDecisions(
  events: readonly ThreeKingdomsBanqiEvent[],
  provider: ThreeKingdomsBanqiEngineProvider = threeKingdomsBanqiLiveEngineMove,
  progress?: AnalysisProgressStore<ThreeKingdomsBanqiDecision>,
): Promise<ThreeKingdomsBanqiDecision[]> {
  const created = events[0];
  if (created?.type !== 'room-created' || !created.setup)
    throw new Error('three_kingdoms_banqi_analysis_missing_deal');
  const history: ThreeKingdomsBanqiEvent[] = [created];
  let projection = replayTenantEvents(threeKingdomsBanqiTenant, history);
  const resumed = await progress?.load();
  const decisions = resumed ? [...resumed.items] : [];
  let ply = 0;
  for (const event of events.slice(1)) {
    if (event.type !== 'move-played') continue;
    ply += 1;
    if (ply > (resumed?.nextIndex ?? 0) && event.move.from === event.move.to) {
      decisions.push(
        await evaluateThreeKingdomsBanqiFlipDecision(
          projection.state,
          history,
          event.move,
          ply,
          provider,
        ),
      );
      await progress?.save({ nextIndex: ply, items: decisions });
    }
    history.push(event);
    projection = applyTenantEvent(threeKingdomsBanqiTenant, projection, event);
  }
  return decisions;
}

const liveCache: ThreeKingdomsBanqiDecisionsCache = {
  get: (roomId, engineId, depth) => persistence.getGameAnalysisBlob(roomId, engineId, depth),
  save: (roomId, engineId, depth, decisions) =>
    persistence.saveGameAnalysisBlob(roomId, engineId, depth, decisions),
};

export async function resolveThreeKingdomsBanqiDecisions(
  roomId: string,
  events: readonly ThreeKingdomsBanqiEvent[],
  cache: ThreeKingdomsBanqiDecisionsCache = liveCache,
  analyze?: (events: readonly ThreeKingdomsBanqiEvent[]) => Promise<ThreeKingdomsBanqiDecision[]>,
  computeIfMissing = true,
) {
  const engineId = THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID;
  const depth = THREE_KINGDOMS_BANQI_ANALYSIS_DEPTH;
  const progress = analyze
    ? null
    : liveAnalysisProgressStore<ThreeKingdomsBanqiDecision>(roomId, engineId, depth);
  const decisions = await resolveCachedComputation({
    roomId,
    engineId,
    depth,
    cache,
    computeIfMissing,
    compute: () =>
      analyze
        ? analyze(events)
        : analyzeThreeKingdomsBanqiDecisions(events, undefined, progress ?? undefined),
    afterSave: progress ? () => progress.clear() : undefined,
  });
  return decisions ? { engineId, depth, decisions } : null;
}
