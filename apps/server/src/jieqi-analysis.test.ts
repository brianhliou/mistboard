import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  type JieqiDeal,
  type JieqiMove,
  type JieqiPieceRole,
  STANDARD_JIEQI_DEAL,
  winPercent,
} from '@mistboard/game';
import type { SweepPlyEval } from './game-analysis-sweep.js';
import { VacuousAnalysisError } from './game-analysis-sweep.js';
import {
  analyzeJieqiDecisions,
  analyzeJieqiPostgame,
  JIEQI_ANALYSIS_ENGINE_ID,
  JIEQI_DECISIONS_ENGINE_ID,
  type JieqiAnalysisCache,
  type JieqiDecision,
  type JieqiDecisionDeps,
  type JieqiDecisionsCache,
  type JieqiGameAnalysis,
  jieqiAnalysisRepetitionWindows,
  jieqiChancePlies,
  jieqiDeterministicPlies,
  PIKAFISH_JIEQI_ANALYSIS_PROFILE,
  resolveJieqiAnalysis,
  resolveJieqiDecisions,
} from './jieqi-analysis.js';
import { buildJieqiPositionCommand } from './jieqi-engine.js';
import { jieqiMoveToPikafishUci, jieqiStateToPikafishFen } from './jieqi-fen.js';
import type { UciMultiPvLine } from './uci-engine-harness.js';

// A real, deterministic game off the fixed standard deal. To guarantee the sequence contains
// BOTH reveal plies (moving a face-down piece) and non-reveal plies (moving an already-revealed
// one), we bias selection toward continuing to move the just-moved piece when that is legal —
// otherwise take the first legal move. `chance` records the ground-truth reveal plies (1-based)
// by checking the pre-move face-down state, so the test can compare jieqiChancePlies against it.
function playGame(deal: JieqiDeal, count: number): { moves: JieqiMove[]; chance: number[] } {
  let state = createInitialJieqiState('t', deal);
  const moves: JieqiMove[] = [];
  const chance: number[] = [];
  let lastTo: string | null = null;
  for (let i = 0; i < count; i += 1) {
    const legal = getJieqiLegalMoves(state);
    if (legal.length === 0) break;
    const move = legal.find((m) => m.from === lastTo) ?? legal[0]!;
    if (state.board[move.from]?.faceDown) chance.push(i + 1);
    moves.push(move);
    state = applyJieqiMove(state, move);
    lastTo = move.to;
  }
  return { moves, chance };
}

function memoryCache(): JieqiAnalysisCache & { saves: number } {
  const store = new Map<string, SweepPlyEval[]>();
  const cache = {
    saves: 0,
    async get(roomId: string, engineId: string, depth: number) {
      return store.get(`${roomId}:${engineId}:${depth}`) ?? null;
    },
    async save(roomId: string, engineId: string, depth: number, plies: SweepPlyEval[]) {
      cache.saves += 1;
      store.set(`${roomId}:${engineId}:${depth}`, plies);
    },
  };
  return cache;
}

test('analyzeJieqiPostgame reconstructs N+1 plies from the deal and evaluates each position', async () => {
  const { moves } = playGame(STANDARD_JIEQI_DEAL, 6);
  const seenTurns: string[] = [];
  const analysis = await analyzeJieqiPostgame(
    moves,
    STANDARD_JIEQI_DEAL,
    async (state) => {
      assert.equal(state.status.type, 'playing');
      seenTurns.push(state.status.type === 'playing' ? state.status.turn : 'x');
      return { cp: 42, mate: null, best: 'z' };
    },
    undefined,
    PIKAFISH_JIEQI_ANALYSIS_PROFILE,
  );

  // Ply 0 (initial) .. ply N (after the last move): N+1 contiguous points.
  assert.equal(analysis.plies.length, moves.length + 1);
  analysis.plies.forEach((ply, i) => {
    assert.equal(ply.ply, i);
  });
  // Every PLAYING state ply 0..N is evaluated, so seenTurns has N+1 entries. Red moves first
  // and the mover alternates every ply (xiangqi has no pass), so ply k is red on even k.
  assert.deepEqual(seenTurns, ['red', 'black', 'red', 'black', 'red', 'black', 'red']);
  assert.ok(analysis.plies.every((ply) => ply.cp === 42));
  assert.equal(analysis.engineId, JIEQI_ANALYSIS_ENGINE_ID);
});

test('jieqiChancePlies flags reveals (dark-piece moves), not already-revealed moves', async () => {
  const { moves, chance } = playGame(STANDARD_JIEQI_DEAL, 12);
  // Reveals happen (a dark piece must eventually move), so the set is non-empty...
  assert.ok(chance.length > 0, 'expected some reveal (chance) plies');
  // ...but not every ply is a reveal: face-up pieces (generals) and the biased generator's
  // "keep moving the just-moved piece" both produce already-revealed, graded moves.
  assert.ok(chance.length < moves.length, 'expected some non-reveal (graded) plies');
  // jieqiChancePlies re-derives exactly the same set by an independent replay.
  assert.deepEqual(jieqiChancePlies(moves, STANDARD_JIEQI_DEAL), chance);
});

test('Jieqi analysis resets repetition history on reveal/capture and replays quiet moves', () => {
  const { moves } = playGame(STANDARD_JIEQI_DEAL, 16);
  const windows = jieqiAnalysisRepetitionWindows(moves, STANDARD_JIEQI_DEAL);
  assert.equal(windows.length, moves.length + 1);

  let state = createInitialJieqiState('window', STANDARD_JIEQI_DEAL);
  let expectedMoves: string[] = [];
  for (let ply = 1; ply < windows.length; ply += 1) {
    const move = moves[ply - 1]!;
    const irreversible = state.board[move.from]?.faceDown === true || state.board[move.to] != null;
    state = applyJieqiMove(state, move);
    expectedMoves = irreversible ? [] : [...expectedMoves, jieqiMoveToPikafishUci(move)];
    assert.deepEqual(windows[ply]!.moves, expectedMoves);
  }

  const last = windows.at(-1)!;
  assert.equal(
    buildJieqiPositionCommand(last.fen, last.moves),
    last.moves.length > 0
      ? `position fen ${last.fen} moves ${last.moves.join(' ')}`
      : `position fen ${last.fen}`,
  );
});

test('resolveJieqiAnalysis: pure cache read misses without computing', async () => {
  const cache = memoryCache();
  let computes = 0;
  const analyze = async (): Promise<JieqiGameAnalysis> => {
    computes += 1;
    return { engineId: JIEQI_ANALYSIS_ENGINE_ID, depth: 12, plies: [] };
  };
  const result = await resolveJieqiAnalysis(
    'room-a',
    [],
    STANDARD_JIEQI_DEAL,
    cache,
    analyze,
    false,
  );
  assert.equal(result, null);
  assert.equal(computes, 0);
  assert.equal(cache.saves, 0);
});

test('resolveJieqiAnalysis computes once, persists, then serves from cache', async () => {
  const cache = memoryCache();
  let computes = 0;
  const analyze = async (): Promise<JieqiGameAnalysis> => {
    computes += 1;
    return {
      engineId: JIEQI_ANALYSIS_ENGINE_ID,
      depth: 12,
      plies: [{ ply: 0, cp: 0, mate: null, best: null }],
    };
  };
  const first = await resolveJieqiAnalysis('room-b', [], STANDARD_JIEQI_DEAL, cache, analyze, true);
  assert.ok(first);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);

  const second = await resolveJieqiAnalysis(
    'room-b',
    [],
    STANDARD_JIEQI_DEAL,
    cache,
    analyze,
    true,
  );
  assert.ok(second);
  assert.equal(computes, 1);
  assert.deepEqual(second!.plies, first!.plies);
});

test('resolveJieqiAnalysis coalesces concurrent viewers into one compute', async () => {
  const cache = memoryCache();
  let computes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const analyze = async (): Promise<JieqiGameAnalysis> => {
    computes += 1;
    await gate;
    return { engineId: JIEQI_ANALYSIS_ENGINE_ID, depth: 12, plies: [] };
  };
  const a = resolveJieqiAnalysis('room-c', [], STANDARD_JIEQI_DEAL, cache, analyze, true);
  const b = resolveJieqiAnalysis('room-c', [], STANDARD_JIEQI_DEAL, cache, analyze, true);
  release();
  await Promise.all([a, b]);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);
});

test('resolveJieqiAnalysis fails closed on a scoreless sweep: throws and caches nothing', async () => {
  const cache = memoryCache();
  const analyze = async (): Promise<JieqiGameAnalysis> => ({
    engineId: JIEQI_ANALYSIS_ENGINE_ID,
    depth: 12,
    // Engine emitted moves but no evals — the broken-binary signature.
    plies: [
      { ply: 0, cp: null, mate: null, best: 'a0b0' },
      { ply: 1, cp: null, mate: null, best: 'c0d0' },
    ],
  });
  await assert.rejects(
    resolveJieqiAnalysis('room-vacuous', [], STANDARD_JIEQI_DEAL, cache, analyze, true),
    VacuousAnalysisError,
  );
  assert.equal(cache.saves, 0);
});

test('JIEQI_ANALYSIS_ENGINE_ID is a stable, version-tagged identifier', () => {
  assert.match(JIEQI_ANALYSIS_ENGINE_ID, /^pikafish-jieqi-analysis@/);
});

// ── Decision-vs-luck decomposition (Layer 2) ──────────────────────────────────────

// The initial position is all-dark but the generals, so the first legal move is (almost always)
// a reveal — a good single-reveal fixture. Returns the move + its Pikafish UCI.
function firstRevealMove(deal: JieqiDeal): { move: JieqiMove; uci: string } {
  const state = createInitialJieqiState('t', deal);
  const move = getJieqiLegalMoves(state).find((m) => state.board[m.from]?.faceDown === true)!;
  return { move, uci: jieqiMoveToPikafishUci(move) };
}

function mpvLine(index: number, move: string, cp: number): UciMultiPvLine {
  return { index, move, cp, mate: null, depth: 10, pv: [move], bound: null };
}

// Red's remaining hidden pool (role -> count) at the initial position.
function redPool(deal: JieqiDeal): Map<JieqiPieceRole, number> {
  const state = createInitialJieqiState('t', deal);
  const pool = new Map<JieqiPieceRole, number>();
  for (const piece of Object.values(state.board)) {
    if (piece?.color === 'red' && piece.faceDown)
      pool.set(piece.role, (pool.get(piece.role) ?? 0) + 1);
  }
  return pool;
}

test('analyzeJieqiDecisions: only reveal plies, per-mover POV, flat eval => zero luck/loss', async () => {
  const { moves, chance } = playGame(STANDARD_JIEQI_DEAL, 8);
  // Constant side-to-move eval (+100 for whoever is to move AFTER the reveal, i.e. the opponent);
  // from the mover's POV that is winPercent(-100) for every possible reveal — identical, so the
  // pool mean, realized, and best all collapse to one value: no decision loss, no luck.
  const deps: JieqiDecisionDeps = {
    multiPv: async () => [mpvLine(1, 'no-match', 0)],
    evalPosition: async () => ({ cp: 100, mate: null }),
  };
  const decisions = await analyzeJieqiDecisions([...moves], STANDARD_JIEQI_DEAL, deps);
  assert.deepEqual(
    decisions.map((d) => d.ply),
    chance,
  );
  const moverWin = winPercent(-100, null); // mover POV = negated opponent (post-move) score
  for (const d of decisions) {
    assert.equal(d.mover, d.ply % 2 === 1 ? 'red' : 'black');
    assert.ok(Math.abs(d.playedWin - moverWin) < 1e-6);
    assert.ok(Math.abs(d.realizedWin - moverWin) < 1e-6);
    assert.ok(Math.abs(d.bestWin - moverWin) < 1e-6);
    assert.equal(d.playedRank, 1);
  }
});

// Mirror poolMeanWin's counterfactual EXACTLY: relabel the reveal square to `role`, then swap a
// donor dark tile of the mover holding `role` to the true `sourceRole`, so the mover's hidden-role
// multiset is preserved. The mock evals key on these FENs, so build them the same way the source does.
function jieqiCounterfactualCf(
  state: ReturnType<typeof createInitialJieqiState>,
  from: JieqiMove['from'],
  role: JieqiPieceRole,
  sourceRole: JieqiPieceRole,
  mover: 'red' | 'black',
): ReturnType<typeof createInitialJieqiState> {
  const cf = {
    ...state,
    board: { ...state.board, [from]: { color: mover, role, faceDown: true } },
  };
  if (role !== sourceRole) {
    const donor = (Object.keys(state.board) as (keyof typeof state.board)[]).find(
      (sq) =>
        sq !== from &&
        state.board[sq]?.faceDown === true &&
        state.board[sq]?.color === mover &&
        state.board[sq]?.role === role,
    );
    if (donor) cf.board[donor] = { color: mover, role: sourceRole, faceDown: true };
  }
  return cf;
}

test('analyzeJieqiDecisions: playedWin is the TRUE pool-weighted mean; realizedWin is the actual role', async () => {
  const deal = STANDARD_JIEQI_DEAL;
  const { move, uci } = firstRevealMove(deal); // red's first reveal (ply 1)
  const state0 = createInitialJieqiState('t', deal);
  const pool = redPool(deal);
  const actualRole = state0.board[move.from]!.role;

  // Distinct side-to-move cp per counterfactual role, keyed on the REAL post-move FEN the source
  // builds (no FEN-format assumptions — we replay the same construction here).
  const roleCp: Record<JieqiPieceRole, number> = {
    chariot: -500,
    advisor: -100,
    cannon: -300,
    soldier: -50,
    horse: -200,
    elephant: 100,
    general: 0,
  };
  const fenToCp = new Map<string, number>();
  for (const role of pool.keys()) {
    const cf = jieqiCounterfactualCf(state0, move.from, role, actualRole, 'red');
    fenToCp.set(jieqiStateToPikafishFen(applyJieqiMove(cf, move)), roleCp[role]);
  }

  const decisions = await analyzeJieqiDecisions([move], deal, {
    multiPv: async () => [mpvLine(1, uci, 0)], // played is the only candidate => best === played
    evalPosition: async (fen) => ({ cp: fenToCp.get(fen) ?? 0, mate: null }),
  });
  const d = decisions[0]!;

  const total = [...pool.values()].reduce((a, b) => a + b, 0);
  let expectedMean = 0;
  for (const [role, count] of pool)
    expectedMean += (count / total) * winPercent(-roleCp[role], null);
  const expectedRealized = winPercent(-roleCp[actualRole], null);

  assert.ok(
    Math.abs(d.playedWin - expectedMean) < 1e-6,
    `playedWin ${d.playedWin} vs ${expectedMean}`,
  );
  assert.ok(Math.abs(d.realizedWin - expectedRealized) < 1e-6);
  assert.ok(Math.abs(d.bestWin - d.playedWin) < 1e-6); // only candidate
  assert.equal(d.playedRank, 1);
});

test('analyzeJieqiDecisions: a better candidate lifts bestWin above playedWin (decision loss)', async () => {
  const deal = STANDARD_JIEQI_DEAL;
  const state0 = createInitialJieqiState('t', deal);
  const reveals = getJieqiLegalMoves(state0).filter((m) => state0.board[m.from]?.faceDown === true);
  const played = reveals[0]!;
  const better = reveals[1]!;
  const betterRole = state0.board[better.from]!.role;
  const pool = redPool(deal);

  // Every post-move FEN reachable by playing `better` (across the pool) scores well for the mover
  // (very negative side-to-move cp -> high mover win% after negation); everything else scores low.
  const betterFens = new Set<string>();
  for (const role of pool.keys()) {
    const cf = jieqiCounterfactualCf(state0, better.from, role, betterRole, 'red');
    betterFens.add(jieqiStateToPikafishFen(applyJieqiMove(cf, better)));
  }
  const decisions = await analyzeJieqiDecisions([played], deal, {
    multiPv: async () => [mpvLine(1, jieqiMoveToPikafishUci(better), 0)],
    evalPosition: async (fen) => ({ cp: betterFens.has(fen) ? -400 : -50, mate: null }),
  });
  const d = decisions[0]!;
  assert.ok(d.bestWin > d.playedWin, `best ${d.bestWin} should beat played ${d.playedWin}`);
  assert.ok(Math.abs(d.playedWin - winPercent(50, null)) < 1e-6); // played: winPercent(-(-50))
  assert.ok(Math.abs(d.bestWin - winPercent(400, null)) < 1e-6); // better: winPercent(-(-400))
  assert.equal(d.playedRank, 2); // one candidate strictly beat the played move
});

// The candidate table used to be computed and thrown away: the surface could say "you ranked
// 2nd" without being able to say what came 1st. Every row here was already true-baselined to
// derive bestWin/playedRank, so keeping them costs no extra engine work.
test('decisions keep the true-baselined candidates, best first, with the played move marked', async () => {
  const deal = STANDARD_JIEQI_DEAL;
  const state0 = createInitialJieqiState('t', deal);
  const reveals = getJieqiLegalMoves(state0).filter((m) => state0.board[m.from]?.faceDown === true);
  const played = reveals[0]!;
  const better = reveals[1]!;
  const betterRole = state0.board[better.from]!.role;
  const pool = redPool(deal);

  const betterFens = new Set<string>();
  for (const role of pool.keys()) {
    const cf = jieqiCounterfactualCf(state0, better.from, role, betterRole, 'red');
    betterFens.add(jieqiStateToPikafishFen(applyJieqiMove(cf, better)));
  }
  const decisions = await analyzeJieqiDecisions([played], deal, {
    multiPv: async () => [mpvLine(1, jieqiMoveToPikafishUci(better), 0)],
    evalPosition: async (fen) => ({ cp: betterFens.has(fen) ? -400 : -50, mate: null }),
  });
  const d = decisions[0]!;
  const candidates = d.candidates ?? [];
  assert.equal(candidates.length, 2, 'the engine candidate plus the played move');
  // Best first, and the ordering is by the SAME true baseline that produced bestWin.
  assert.ok(candidates[0]!.win > candidates[1]!.win);
  assert.ok(Math.abs(candidates[0]!.win - d.bestWin) < 1e-6);
  assert.equal(candidates[0]!.move, jieqiMoveToPikafishUci(better));
  assert.equal(candidates[0]!.played, undefined);
  // The played move is marked so the reader is not left counting rows to find themselves.
  const playedRow = candidates.find((c) => c.played === true);
  assert.ok(playedRow, 'the played move is present and flagged');
  assert.equal(playedRow!.move, jieqiMoveToPikafishUci(played));
  assert.ok(Math.abs(playedRow!.win - d.playedWin) < 1e-6);
});

function decisionsMemoryCache(): JieqiDecisionsCache & { saves: number } {
  const store = new Map<string, JieqiDecision[]>();
  const cache = {
    saves: 0,
    async get(roomId: string, engineId: string, depth: number) {
      return store.get(`${roomId}:${engineId}:${depth}`) ?? null;
    },
    async save(roomId: string, engineId: string, depth: number, decisions: JieqiDecision[]) {
      cache.saves += 1;
      store.set(`${roomId}:${engineId}:${depth}`, decisions);
    },
  };
  return cache;
}

const sampleDecision = (ply: number): JieqiDecision => ({
  ply,
  mover: ply % 2 === 1 ? 'red' : 'black',
  bestWin: 62,
  playedWin: 55,
  realizedWin: 48,
  playedRank: 2,
});

test('resolveJieqiDecisions: pure cache read misses without computing', async () => {
  const cache = decisionsMemoryCache();
  let computes = 0;
  const analyze = async (): Promise<JieqiDecision[]> => {
    computes += 1;
    return [];
  };
  const result = await resolveJieqiDecisions(
    'room-d',
    [],
    STANDARD_JIEQI_DEAL,
    cache,
    analyze,
    false,
  );
  assert.equal(result, null);
  assert.equal(computes, 0);
  assert.equal(cache.saves, 0);
});

test('resolveJieqiDecisions computes once, persists, then serves from cache', async () => {
  const cache = decisionsMemoryCache();
  let computes = 0;
  const analyze = async (): Promise<JieqiDecision[]> => {
    computes += 1;
    return [sampleDecision(3)];
  };
  const first = await resolveJieqiDecisions('room-e', [], STANDARD_JIEQI_DEAL, cache, analyze);
  assert.ok(first);
  assert.equal(first!.engineId, JIEQI_DECISIONS_ENGINE_ID);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);

  const second = await resolveJieqiDecisions('room-e', [], STANDARD_JIEQI_DEAL, cache, analyze);
  assert.equal(computes, 1);
  assert.deepEqual(second!.decisions, first!.decisions);
});

test('resolveJieqiDecisions coalesces concurrent viewers into one compute', async () => {
  const cache = decisionsMemoryCache();
  let computes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const analyze = async (): Promise<JieqiDecision[]> => {
    computes += 1;
    await gate;
    return [sampleDecision(1)];
  };
  const a = resolveJieqiDecisions('room-f', [], STANDARD_JIEQI_DEAL, cache, analyze);
  const b = resolveJieqiDecisions('room-f', [], STANDARD_JIEQI_DEAL, cache, analyze);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);
  assert.deepEqual(ra!.decisions, rb!.decisions);
});

test('resolveJieqiDecisions fails closed when every win% collapses to the null-eval 50', async () => {
  const cache = decisionsMemoryCache();
  const analyze = async (): Promise<JieqiDecision[]> => [
    { ply: 1, mover: 'red', bestWin: 50, playedWin: 50, realizedWin: 50, playedRank: 1 },
    { ply: 3, mover: 'red', bestWin: 50, playedWin: 50, realizedWin: 50, playedRank: 1 },
  ];
  await assert.rejects(
    resolveJieqiDecisions('room-vac', [], STANDARD_JIEQI_DEAL, cache, analyze),
    VacuousAnalysisError,
  );
  assert.equal(cache.saves, 0);
});

test('resolveJieqiDecisions caches an empty result (a game with no reveal plies)', async () => {
  const cache = decisionsMemoryCache();
  const analyze = async (): Promise<JieqiDecision[]> => [];
  const result = await resolveJieqiDecisions('room-empty', [], STANDARD_JIEQI_DEAL, cache, analyze);
  assert.ok(result);
  assert.deepEqual(result!.decisions, []);
  assert.equal(cache.saves, 1); // empty is a valid, cacheable result — not vacuous
});

// ── Parent/child consistency (reconcileJieqiSeries) ──────────────────────────────
//
// The defect these guard is real and shipped: in jq_2dd49c51 the depth-16 sweep scored the
// position before Black's 26th move at +104 for RED, then scored the position after it at
// -414 — a 518cp swing produced by a quiet-looking soldier step. The move was a discovered
// check the parent search never found, so the graph blamed the wrong side and let Red's actual
// blunder (the move before) through ungraded. A mover cannot conjure value the parent position
// did not have; when the series says otherwise, the parent is under-searched.

/** Drive analyzeJieqiPostgame with a scripted series, keyed by ply, so a specific
 *  parent/child violation can be planted. `cpAt(ply, nodes)` returns the red-seat POV cp the
 *  fake engine reports for that ply at that budget. */
async function analyzeWithSeries(
  moves: JieqiMove[],
  deal: JieqiDeal,
  cpAt: (ply: number, nodes: number | undefined) => number,
): Promise<{ analysis: JieqiGameAnalysis; researched: number[] }> {
  const windows = jieqiAnalysisRepetitionWindows(moves, deal);
  const plyOf = new Map(windows.map((w, ply) => [`${w.fen}|${w.moves.join(',')}`, ply]));
  const researched: number[] = [];
  const analysis = await analyzeJieqiPostgame(moves, deal, async (_state, window, nodes) => {
    const ply = plyOf.get(`${window.fen}|${window.moves.join(',')}`);
    assert.notEqual(ply, undefined, 'every eval must be identifiable by its repetition window');
    if (nodes !== undefined) researched.push(ply!);
    return { cp: cpAt(ply!, nodes), mate: null, best: `best${ply}` };
  });
  return { analysis, researched };
}

/** A step series that violates the invariant exactly once, at `ply`: everything before it is
 *  level, everything from it on is `magnitude` better for the mover of that ply. A step (not a
 *  spike) so the ply AFTER it stays level and only one pair is in violation. */
function stepSeries(ply: number, magnitude: number): (p: number) => number {
  const moverSign = ply % 2 === 1 ? 1 : -1;
  return (p) => (p >= ply ? magnitude * moverSign : 0);
}

test('a mover who gains on a deterministic ply forces the parent to be re-searched', async () => {
  const { moves } = playGame(STANDARD_JIEQI_DEAL, 12);
  const target = jieqiDeterministicPlies(moves, STANDARD_JIEQI_DEAL)[0]!;
  const moverSign = target % 2 === 1 ? 1 : -1;
  const step = stepSeries(target, 500);
  // At the base budget the parent misses it (0). At the escalated budget it sees further than
  // the child does (600), which is what a real horizon fix looks like.
  const { analysis, researched } = await analyzeWithSeries(
    moves,
    STANDARD_JIEQI_DEAL,
    (ply, nodes) => (nodes !== undefined && ply === target - 1 ? 600 * moverSign : step(ply)),
  );

  assert.deepEqual(researched, [target - 1], 'only the suspect parent is re-searched');
  assert.equal(analysis.plies[target - 1]!.cp, 600 * moverSign, 'the deeper number is kept');
  assert.equal(analysis.plies[target - 1]!.best, `best${target - 1}`);
  assert.ok(!analysis.plies[target - 1]!.unstable, 'a cleared violation is not flagged');
});

test('a violation the re-search cannot clear is flagged, never clamped', async () => {
  const { moves } = playGame(STANDARD_JIEQI_DEAL, 12);
  const target = jieqiDeterministicPlies(moves, STANDARD_JIEQI_DEAL)[0]!;
  const step = stepSeries(target, 500);
  // The engine will not budge: same number at 4x the budget. Pikafish's chance-node value is
  // risk-averse, so with dark pieces on the board this is not proof the parent is wrong —
  // overwriting it would publish a number no search produced.
  const { analysis, researched } = await analyzeWithSeries(moves, STANDARD_JIEQI_DEAL, step);

  assert.deepEqual(researched, [target - 1]);
  assert.equal(analysis.plies[target - 1]!.unstable, true, 'the ply is flagged for the client');
  assert.equal(analysis.plies[target - 1]!.cp, step(target - 1), 'and its cp is left alone');
});

test('a level series is never re-searched and never flagged', async () => {
  const { moves } = playGame(STANDARD_JIEQI_DEAL, 12);
  const { analysis, researched } = await analyzeWithSeries(moves, STANDARD_JIEQI_DEAL, () => 25);

  assert.deepEqual(researched, [], 'no violation, no extra engine work');
  assert.ok(analysis.plies.every((ply) => !ply.unstable));
});

// The threshold is a noise floor, not a formality: 36% of deterministic plies in real games
// violate the invariant by SOME amount (p90 +62cp). Re-searching all of those would triple the
// sweep to chase search noise.
test('a violation inside the noise floor is left alone', async () => {
  const { moves } = playGame(STANDARD_JIEQI_DEAL, 12);
  const target = jieqiDeterministicPlies(moves, STANDARD_JIEQI_DEAL)[0]!;
  const { analysis, researched } = await analyzeWithSeries(
    moves,
    STANDARD_JIEQI_DEAL,
    stepSeries(target, 150),
  );

  assert.deepEqual(researched, []);
  assert.ok(analysis.plies.every((ply) => !ply.unstable));
});

// A reveal hands the mover value the parent could only average over, so "the mover gained" is
// the variance the Layer-2 decomposition measures, not a search defect. Re-searching there
// would burn budget forever and flagging it would grey out every interesting move in the game.
test('a chance ply is exempt from the consistency check', async () => {
  const { moves, chance } = playGame(STANDARD_JIEQI_DEAL, 12);
  const target = chance[0]!;
  assert.ok(target >= 1, 'the fixture game must contain a reveal');
  const { analysis, researched } = await analyzeWithSeries(
    moves,
    STANDARD_JIEQI_DEAL,
    stepSeries(target, 2_000),
  );

  assert.deepEqual(researched, [], 'a reveal never triggers a re-search');
  assert.ok(analysis.plies.every((ply) => !ply.unstable));
});

// Deterministic is STRICTLY narrower than "not a chance ply": capturing an opponent's dark
// piece is graded as a normal move (jieqiChancePlies deliberately ignores it) but it still
// resolves a hidden identity and moves the flip pool, so the parent could only average over
// it. Reusing the chance-ply set here would have let those plies into the check.
test('deterministic plies exclude captures of a face-down piece', async () => {
  // playGame's "keep moving the same piece" heuristic never captures a dark piece, so drive a
  // game that prefers exactly that: a revealed piece taking a face-down one.
  const moves: JieqiMove[] = [];
  {
    let state = createInitialJieqiState('t', STANDARD_JIEQI_DEAL);
    for (let i = 0; i < 80; i += 1) {
      const legal = getJieqiLegalMoves(state);
      if (legal.length === 0) break;
      const move =
        legal.find((m) => !state.board[m.from]?.faceDown && state.board[m.to]?.faceDown) ??
        legal.find((m) => state.board[m.to] != null) ??
        legal.find((m) => state.board[m.from]?.faceDown) ??
        legal[0]!;
      moves.push(move);
      state = applyJieqiMove(state, move);
      if (state.status.type !== 'playing') break;
    }
  }
  const deterministic = new Set(jieqiDeterministicPlies(moves, STANDARD_JIEQI_DEAL));
  const chance = new Set(jieqiChancePlies(moves, STANDARD_JIEQI_DEAL));

  let state = createInitialJieqiState('t', STANDARD_JIEQI_DEAL);
  let darkCaptures = 0;
  moves.forEach((move, i) => {
    const ply = i + 1;
    const source = state.board[move.from];
    const target = state.board[move.to];
    if (!source?.faceDown && target?.faceDown) {
      darkCaptures += 1;
      assert.ok(!chance.has(ply), 'a dark capture is not a chance ply (it is graded)');
      assert.ok(!deterministic.has(ply), 'but it is not deterministic either');
    }
    if (deterministic.has(ply)) {
      assert.ok(!source?.faceDown && !target?.faceDown, 'no hidden identity resolved');
    }
    state = applyJieqiMove(state, move);
  });
  assert.ok(darkCaptures > 0, 'the fixture game must contain at least one dark capture');
});

// A re-search that comes back with no score at all (stalled or stale binary) must not be
// written over a ply that had a perfectly good number: enough of those and isVacuousAnalysis
// starts firing on a sweep that was fine.
test('a scoreless re-search leaves the swept eval intact', async () => {
  const { moves } = playGame(STANDARD_JIEQI_DEAL, 12);
  const target = jieqiDeterministicPlies(moves, STANDARD_JIEQI_DEAL)[0]!;
  const step = stepSeries(target, 500);
  const windows = jieqiAnalysisRepetitionWindows(moves, STANDARD_JIEQI_DEAL);
  const plyOf = new Map(windows.map((w, ply) => [`${w.fen}|${w.moves.join(',')}`, ply]));
  const analysis = await analyzeJieqiPostgame(
    moves,
    STANDARD_JIEQI_DEAL,
    async (_state, window, nodes) => {
      const ply = plyOf.get(`${window.fen}|${window.moves.join(',')}`)!;
      if (nodes !== undefined) return { cp: null, mate: null, best: null };
      return { cp: step(ply), mate: null, best: `best${ply}` };
    },
  );

  assert.equal(analysis.plies[target - 1]!.cp, step(target - 1), 'the swept cp survives');
  assert.equal(analysis.plies[target - 1]!.best, `best${target - 1}`, 'and so does its best move');
  assert.equal(analysis.plies[target - 1]!.unstable, true, 'still flagged: nothing cleared it');
});
