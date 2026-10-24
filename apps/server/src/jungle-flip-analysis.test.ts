import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyJungleFlipMove,
  createInitialJungleFlipState,
  getJungleFlipLegalMoves,
  type JungleFlipColor,
  type JungleFlipDeal,
  type JungleFlipMove,
  type JungleFlipPieceRole,
  jungleFlipRepSeedFens,
  STANDARD_JUNGLE_FLIP_DEAL,
  winPercent,
} from '@mistboard/game';
import type { SweepPlyEval } from './game-analysis-sweep.js';
import { VacuousAnalysisError } from './game-analysis-sweep.js';
import {
  analyzeJungleFlipDecisions,
  analyzeJungleFlipPostgame,
  JUNGLE_FLIP_ANALYSIS_ENGINE_ID,
  JUNGLE_FLIP_DECISIONS_ENGINE_ID,
  type JungleFlipAnalysisCache,
  type JungleFlipDecision,
  type JungleFlipDecisionsCache,
  type JungleFlipGameAnalysis,
  resolveJungleFlipAnalysis,
  resolveJungleFlipDecisions,
} from './jungle-flip-analysis.js';
import { jungleFlipMoveToEngineUci, jungleFlipStateToEngineFen } from './jungle-flip-fen.js';

// The fixed standard deal makes reconstruction deterministic; a few real legal moves off it
// (opening flips) keep the game in the playing phase — exactly what exercises the per-ply
// evaluate path.
function openingMoves(deal: JungleFlipDeal, count: number): JungleFlipMove[] {
  let state = createInitialJungleFlipState('t', deal);
  const moves: JungleFlipMove[] = [];
  for (let i = 0; i < count; i += 1) {
    const move = getJungleFlipLegalMoves(state)[0]!;
    moves.push(move);
    state = applyJungleFlipMove(state, move);
  }
  return moves;
}

function memoryCache(): JungleFlipAnalysisCache & { saves: number } {
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

test('analyzeJungleFlipPostgame reconstructs N+1 plies from the deal and evaluates each', async () => {
  const moves = openingMoves(STANDARD_JUNGLE_FLIP_DEAL, 4);
  const seenTurns: string[] = [];
  const seenSeeds: (readonly string[])[] = [];
  const analysis = await analyzeJungleFlipPostgame(
    moves,
    STANDARD_JUNGLE_FLIP_DEAL,
    async (state, repSeedFens = []) => {
      assert.equal(state.status.type, 'playing');
      seenTurns.push(state.status.type === 'playing' ? state.status.turn : 'x');
      seenSeeds.push(repSeedFens);
      return { cp: 42, mate: null, best: 'z' };
    },
  );

  assert.equal(analysis.plies.length, moves.length + 1);
  analysis.plies.forEach((ply, i) => {
    assert.equal(ply.ply, i);
  });
  // Red seat moves first; a flip passes the turn, so the mover alternates.
  assert.deepEqual(seenTurns, ['red', 'black', 'red', 'black', 'red']);
  let state = createInitialJungleFlipState('expected-seeds', STANDARD_JUNGLE_FLIP_DEAL);
  const states = [state];
  for (const move of moves) {
    state = applyJungleFlipMove(state, move);
    states.push(state);
  }
  assert.deepEqual(
    seenSeeds,
    states.map((_, ply) => jungleFlipRepSeedFens(states.slice(0, ply + 1))),
  );
  assert.ok(analysis.plies.every((ply) => ply.cp === 42));
  assert.equal(analysis.engineId, JUNGLE_FLIP_ANALYSIS_ENGINE_ID);
});

test('resolveJungleFlipAnalysis: pure cache read misses without computing', async () => {
  const cache = memoryCache();
  let computes = 0;
  const analyze = async (): Promise<JungleFlipGameAnalysis> => {
    computes += 1;
    return { engineId: JUNGLE_FLIP_ANALYSIS_ENGINE_ID, depth: 12, plies: [] };
  };
  const result = await resolveJungleFlipAnalysis(
    'room-a',
    [],
    STANDARD_JUNGLE_FLIP_DEAL,
    cache,
    analyze,
    false,
  );
  assert.equal(result, null);
  assert.equal(computes, 0);
  assert.equal(cache.saves, 0);
});

test('resolveJungleFlipAnalysis computes once, persists, then serves from cache', async () => {
  const cache = memoryCache();
  let computes = 0;
  const analyze = async (): Promise<JungleFlipGameAnalysis> => {
    computes += 1;
    return {
      engineId: JUNGLE_FLIP_ANALYSIS_ENGINE_ID,
      depth: 12,
      plies: [{ ply: 0, cp: 0, mate: null, best: null }],
    };
  };
  const first = await resolveJungleFlipAnalysis(
    'room-b',
    [],
    STANDARD_JUNGLE_FLIP_DEAL,
    cache,
    analyze,
    true,
  );
  assert.ok(first);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);

  const second = await resolveJungleFlipAnalysis(
    'room-b',
    [],
    STANDARD_JUNGLE_FLIP_DEAL,
    cache,
    analyze,
    true,
  );
  assert.ok(second);
  assert.equal(computes, 1);
  assert.deepEqual(second!.plies, first!.plies);
});

test('resolveJungleFlipAnalysis coalesces concurrent viewers into one compute', async () => {
  const cache = memoryCache();
  let computes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const analyze = async (): Promise<JungleFlipGameAnalysis> => {
    computes += 1;
    await gate;
    return { engineId: JUNGLE_FLIP_ANALYSIS_ENGINE_ID, depth: 12, plies: [] };
  };
  const a = resolveJungleFlipAnalysis(
    'room-c',
    [],
    STANDARD_JUNGLE_FLIP_DEAL,
    cache,
    analyze,
    true,
  );
  const b = resolveJungleFlipAnalysis(
    'room-c',
    [],
    STANDARD_JUNGLE_FLIP_DEAL,
    cache,
    analyze,
    true,
  );
  release();
  await Promise.all([a, b]);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);
});

test('resolveJungleFlipAnalysis fails closed on a scoreless sweep: throws and caches nothing', async () => {
  const cache = memoryCache();
  const analyze = async (): Promise<JungleFlipGameAnalysis> => ({
    engineId: JUNGLE_FLIP_ANALYSIS_ENGINE_ID,
    depth: 12,
    plies: [
      { ply: 0, cp: null, mate: null, best: 'a0b0' },
      { ply: 1, cp: null, mate: null, best: 'c0d0' },
    ],
  });
  await assert.rejects(
    resolveJungleFlipAnalysis('room-vacuous', [], STANDARD_JUNGLE_FLIP_DEAL, cache, analyze, true),
    VacuousAnalysisError,
  );
  assert.equal(cache.saves, 0);
});

test('JUNGLE_FLIP_ANALYSIS_ENGINE_ID is a stable, version-tagged identifier', () => {
  assert.match(JUNGLE_FLIP_ANALYSIS_ENGINE_ID, /^misty-jungle-flip-analysis@/);
});

// ── Decision-vs-luck decomposition (Layer 2) ──────────────────────────────────────

// A sequence of pure FLIP moves (from === to) off the fixed deal: every ply is a chance ply, so
// every ply becomes a graded decision — exactly what exercises the pool-mean fan-out.
function openingFlips(deal: JungleFlipDeal, count: number): JungleFlipMove[] {
  let state = createInitialJungleFlipState('t', deal);
  const moves: JungleFlipMove[] = [];
  for (let i = 0; i < count; i += 1) {
    const flip = getJungleFlipLegalMoves(state).find((m) => m.from === m.to);
    if (!flip) break;
    moves.push(flip);
    state = applyJungleFlipMove(state, flip);
  }
  return moves;
}

// Every still-face-down tile of the pre-move position, keyed by ink+role — the flip pool
// (both colours, since a tile's ink is hidden from both seats).
function flipPool(
  deal: JungleFlipDeal,
): Map<string, { color: JungleFlipColor; role: JungleFlipPieceRole }> {
  const state = createInitialJungleFlipState('t', deal);
  const pool = new Map<string, { color: JungleFlipColor; role: JungleFlipPieceRole }>();
  for (const piece of Object.values(state.board)) {
    if (piece?.faceDown)
      pool.set(`${piece.color}-${piece.role}`, { color: piece.color, role: piece.role });
  }
  return pool;
}

test('analyzeJungleFlipDecisions: only flip plies, per-mover POV, flat eval => zero luck/loss', async () => {
  const moves = openingFlips(STANDARD_JUNGLE_FLIP_DEAL, 6);
  const decisions = await analyzeJungleFlipDecisions([...moves], STANDARD_JUNGLE_FLIP_DEAL, {
    evalPosition: async () => ({ cp: 100, mate: null }),
  });
  assert.deepEqual(
    decisions.map((d) => d.ply),
    moves.map((_, i) => i + 1),
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

// Mirror poolMeanWin's counterfactual EXACTLY: relabel the flipped square to `entry`, then swap a
// donor face-down tile holding `entry` to the true `source` tile so the hidden multiset is preserved
// (an off-ink draw must NOT add a phantom piece). The mock evals key on these FENs. Mirrors banqi.
function jungleFlipCounterfactualCf(
  state: ReturnType<typeof createInitialJungleFlipState>,
  from: JungleFlipMove['from'],
  entry: { color: JungleFlipColor; role: JungleFlipPieceRole },
  source: { color: JungleFlipColor; role: JungleFlipPieceRole },
): ReturnType<typeof createInitialJungleFlipState> {
  const cf = {
    ...state,
    board: { ...state.board, [from]: { color: entry.color, role: entry.role, faceDown: true } },
  };
  if (entry.color !== source.color || entry.role !== source.role) {
    const donor = (Object.keys(state.board) as (keyof typeof state.board)[]).find(
      (sq) =>
        sq !== from &&
        state.board[sq]?.faceDown === true &&
        state.board[sq]?.color === entry.color &&
        state.board[sq]?.role === entry.role,
    );
    if (donor) cf.board[donor] = { color: source.color, role: source.role, faceDown: true };
  }
  return cf;
}

test('analyzeJungleFlipDecisions: playedWin is the TRUE pool-weighted mean over BOTH inks; realizedWin is the actual tile', async () => {
  const deal = STANDARD_JUNGLE_FLIP_DEAL;
  const state0 = createInitialJungleFlipState('t', deal);
  const flip = getJungleFlipLegalMoves(state0).find((m) => m.from === m.to)!; // red's first flip (ply 1)
  const source = state0.board[flip.from]!;
  const pool = flipPool(deal);

  const keyCp = new Map<string, number>();
  let n = 0;
  for (const key of pool.keys()) keyCp.set(key, -600 + n++ * 31);
  const counts = new Map<string, number>();
  for (const piece of Object.values(state0.board)) {
    if (!piece?.faceDown) continue;
    const key = `${piece.color}-${piece.role}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const fenToCp = new Map<string, number>();
  for (const [key, entry] of pool) {
    const cf = jungleFlipCounterfactualCf(state0, flip.from, entry, source);
    fenToCp.set(jungleFlipStateToEngineFen(applyJungleFlipMove(cf, flip)), keyCp.get(key)!);
  }

  const decisions = await analyzeJungleFlipDecisions([flip], deal, {
    evalPosition: async (fen) => ({ cp: fenToCp.get(fen) ?? 0, mate: null }),
  });
  const d = decisions[0]!;

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  let expectedMean = 0;
  for (const [key, count] of counts)
    expectedMean += (count / total) * winPercent(-keyCp.get(key)!, null);
  const expectedRealized = winPercent(-keyCp.get(`${source.color}-${source.role}`)!, null);

  assert.ok(
    Math.abs(d.playedWin - expectedMean) < 1e-6,
    `playedWin ${d.playedWin} vs ${expectedMean}`,
  );
  assert.ok(Math.abs(d.realizedWin - expectedRealized) < 1e-6);
  assert.ok(Math.abs(d.bestWin - d.playedWin) < 1e-6); // played flip remains best
  assert.equal(d.playedRank, 1);
});

test('analyzeJungleFlipDecisions: a better candidate flip lifts bestWin above playedWin (decision loss)', async () => {
  const deal = STANDARD_JUNGLE_FLIP_DEAL;
  const state0 = createInitialJungleFlipState('t', deal);
  const flips = getJungleFlipLegalMoves(state0).filter((m) => m.from === m.to);
  const played = flips[0]!;
  const better = flips[1]!;
  const betterSource = state0.board[better.from]!;
  const pool = flipPool(deal);

  const betterFens = new Set<string>();
  for (const entry of pool.values()) {
    const cf = jungleFlipCounterfactualCf(state0, better.from, entry, betterSource);
    betterFens.add(jungleFlipStateToEngineFen(applyJungleFlipMove(cf, better)));
  }
  const decisions = await analyzeJungleFlipDecisions([played], deal, {
    evalPosition: async (fen) => ({ cp: betterFens.has(fen) ? -400 : -50, mate: null }),
  });
  const d = decisions[0]!;
  assert.ok(d.bestWin > d.playedWin, `best ${d.bestWin} should beat played ${d.playedWin}`);
  assert.ok(Math.abs(d.playedWin - winPercent(50, null)) < 1e-6);
  assert.ok(Math.abs(d.bestWin - winPercent(400, null)) < 1e-6);
  assert.equal(d.playedRank, 2);
});

test('analyzeJungleFlipDecisions: ranks three alternatives plus played by pool mean, without hidden identities', async () => {
  const deal = STANDARD_JUNGLE_FLIP_DEAL;
  const state = createInitialJungleFlipState('t', deal);
  const flips = getJungleFlipLegalMoves(state).filter((m) => m.from === m.to);
  const played = flips.at(-1)!;
  const top = flips.slice(0, 3);
  const scores = new Map<string, number>();
  for (const [index, move] of top.entries()) {
    for (const entry of flipPool(deal).values()) {
      const cf = jungleFlipCounterfactualCf(state, move.from, entry, state.board[move.from]!);
      scores.set(jungleFlipStateToEngineFen(applyJungleFlipMove(cf, move)), -600 + index * 150);
    }
  }
  const decisions = await analyzeJungleFlipDecisions([played], deal, {
    evalPosition: async (fen) => ({ cp: scores.get(fen) ?? 100, mate: null }),
  });
  const d = decisions[0]!;
  assert.equal(d.playedRank, 4);
  const expected = [
    ...top.map((move, index) => ({
      move: jungleFlipMoveToEngineUci(move),
      win: winPercent(600 - index * 150, null),
    })),
    { move: jungleFlipMoveToEngineUci(played), win: winPercent(-100, null), played: true },
  ];
  assert.deepEqual(
    d.candidates?.map((c) => ({ ...c, win: Math.round(c.win * 1e6) })),
    expected.map((c) => ({ ...c, win: Math.round(c.win * 1e6) })),
  );
  assert.equal(d.bestWin, d.candidates![0]!.win);
  assert.equal(d.playedWin, d.candidates!.at(-1)!.win);
  // Serialize the entire persisted decision: candidates disclose only public moves and scores.
  assert.deepEqual(JSON.parse(JSON.stringify(d)), {
    ply: 1,
    mover: 'red',
    bestWin: d.bestWin,
    playedWin: d.playedWin,
    realizedWin: d.realizedWin,
    playedRank: 4,
    candidates: d.candidates,
  });
});

test('analyzeJungleFlipDecisions: shortlists quiet moves with the live repetition history', async () => {
  const deal = STANDARD_JUNGLE_FLIP_DEAL;
  let state = createInitialJungleFlipState('t', deal);
  const prefix: JungleFlipMove[] = [];
  const states = [state];
  // Open enough squares through real legal play to offer a quiet move beside flips.
  for (let i = 0; i < 32; i += 1) {
    const legal = getJungleFlipLegalMoves(state);
    if (legal.some((m) => m.from !== m.to && !state.board[m.to])) break;
    const next = legal.find((m) => m.from !== m.to) ?? legal.find((m) => m.from === m.to)!;
    assert.ok(next);
    prefix.push(next);
    state = applyJungleFlipMove(state, next);
    states.push(state);
  }
  const legal = getJungleFlipLegalMoves(state);
  const quiet = legal.find((m) => m.from !== m.to && !state.board[m.to])!;
  const played = legal.find((m) => m.from === m.to)!;
  assert.ok(quiet && played);
  const quietUci = jungleFlipMoveToEngineUci(quiet);
  const quietFen = jungleFlipStateToEngineFen(applyJungleFlipMove(state, quiet));
  let sawQuiet = false;
  const decisions = await analyzeJungleFlipDecisions(
    [...prefix, played],
    deal,
    {
      evalPosition: async (fen, history) => {
        if (fen === quietFen) {
          sawQuiet = true;
          assert.deepEqual(
            history,
            jungleFlipRepSeedFens([...states, applyJungleFlipMove(state, quiet)]),
          );
        }
        return { cp: fen === quietFen ? -800 : 100, mate: null };
      },
    },
    {
      load: async () => ({ nextIndex: prefix.length, items: [] }),
      save: async () => {},
    },
  );
  assert.ok(sawQuiet);
  const d = decisions[0]!;
  assert.equal(d.ply, prefix.length + 1);
  assert.equal(d.candidates![0]!.move, quietUci);
  assert.ok(Math.abs(d.bestWin - winPercent(800, null)) < 1e-6);
  assert.ok(d.bestWin > d.playedWin);
});

test('analyzeJungleFlipDecisions: deduplicates played and bounds ranking and pool fan-out', async () => {
  const deal = STANDARD_JUNGLE_FLIP_DEAL;
  const state = createInitialJungleFlipState('t', deal);
  const legal = getJungleFlipLegalMoves(state);
  const played = legal[0]!;
  let active = 0;
  let peak = 0;
  let calls = 0;
  const [d] = await analyzeJungleFlipDecisions([played], deal, {
    evalPosition: async () => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return { cp: 0, mate: null };
    },
  });
  assert.equal(d!.candidates!.length, 3);
  assert.equal(d!.candidates!.filter((c) => c.played).length, 1);
  assert.equal(d!.playedRank, 1);
  assert.equal(calls, legal.length + 3 * flipPool(deal).size);
  assert.equal(peak, 2);
});

test('analyzeJungleFlipDecisions: pool means override lucky ranking scores', async () => {
  const deal = STANDARD_JUNGLE_FLIP_DEAL;
  const state = createInitialJungleFlipState('t', deal);
  const flips = getJungleFlipLegalMoves(state).filter((m) => m.from === m.to);
  const lucky = flips[0]!;
  const played = flips[1]!;
  const luckyFens = new Set<string>();
  for (const entry of flipPool(deal).values()) {
    const cf = jungleFlipCounterfactualCf(state, lucky.from, entry, state.board[lucky.from]!);
    luckyFens.add(jungleFlipStateToEngineFen(applyJungleFlipMove(cf, lucky)));
  }
  const actualFen = jungleFlipStateToEngineFen(applyJungleFlipMove(state, lucky));
  const [d] = await analyzeJungleFlipDecisions([played], deal, {
    evalPosition: async (fen) => ({
      cp: fen === actualFen ? -1200 : luckyFens.has(fen) ? 1200 : 0,
      mate: null,
    }),
  });
  assert.equal(d!.playedRank, 1);
  assert.ok(d!.candidates!.at(-1)!.win < d!.playedWin);
  assert.equal(d!.candidates!.at(-1)!.move, jungleFlipMoveToEngineUci(lucky));
});

function decisionsMemoryCache(): JungleFlipDecisionsCache & { saves: number } {
  const store = new Map<string, JungleFlipDecision[]>();
  const cache = {
    saves: 0,
    async get(roomId: string, engineId: string, depth: number) {
      return store.get(`${roomId}:${engineId}:${depth}`) ?? null;
    },
    async save(roomId: string, engineId: string, depth: number, decisions: JungleFlipDecision[]) {
      cache.saves += 1;
      store.set(`${roomId}:${engineId}:${depth}`, decisions);
    },
  };
  return cache;
}

const sampleDecision = (ply: number): JungleFlipDecision => ({
  ply,
  mover: ply % 2 === 1 ? 'red' : 'black',
  bestWin: 62,
  playedWin: 55,
  realizedWin: 48,
  playedRank: 2,
});

test('resolveJungleFlipDecisions: pure cache read misses without computing', async () => {
  const cache = decisionsMemoryCache();
  let computes = 0;
  const analyze = async (): Promise<JungleFlipDecision[]> => {
    computes += 1;
    return [];
  };
  const result = await resolveJungleFlipDecisions(
    'room-d',
    [],
    STANDARD_JUNGLE_FLIP_DEAL,
    cache,
    analyze,
    false,
  );
  assert.equal(result, null);
  assert.equal(computes, 0);
  assert.equal(cache.saves, 0);
});

test('resolveJungleFlipDecisions computes once, persists, then serves from cache', async () => {
  const cache = decisionsMemoryCache();
  let computes = 0;
  const analyze = async (): Promise<JungleFlipDecision[]> => {
    computes += 1;
    return [sampleDecision(3)];
  };
  const first = await resolveJungleFlipDecisions(
    'room-e',
    [],
    STANDARD_JUNGLE_FLIP_DEAL,
    cache,
    analyze,
  );
  assert.ok(first);
  assert.equal(first!.engineId, JUNGLE_FLIP_DECISIONS_ENGINE_ID);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);

  const second = await resolveJungleFlipDecisions(
    'room-e',
    [],
    STANDARD_JUNGLE_FLIP_DEAL,
    cache,
    analyze,
  );
  assert.equal(computes, 1);
  assert.deepEqual(second!.decisions, first!.decisions);
});

test('resolveJungleFlipDecisions coalesces concurrent viewers into one compute', async () => {
  const cache = decisionsMemoryCache();
  let computes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const analyze = async (): Promise<JungleFlipDecision[]> => {
    computes += 1;
    await gate;
    return [sampleDecision(1)];
  };
  const a = resolveJungleFlipDecisions('room-f', [], STANDARD_JUNGLE_FLIP_DEAL, cache, analyze);
  const b = resolveJungleFlipDecisions('room-f', [], STANDARD_JUNGLE_FLIP_DEAL, cache, analyze);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);
  assert.deepEqual(ra!.decisions, rb!.decisions);
});

test('resolveJungleFlipDecisions fails closed when every win% collapses to the null-eval 50', async () => {
  const cache = decisionsMemoryCache();
  const analyze = async (): Promise<JungleFlipDecision[]> => [
    { ply: 1, mover: 'red', bestWin: 50, playedWin: 50, realizedWin: 50, playedRank: 1 },
    { ply: 2, mover: 'black', bestWin: 50, playedWin: 50, realizedWin: 50, playedRank: 1 },
  ];
  await assert.rejects(
    resolveJungleFlipDecisions('room-vac', [], STANDARD_JUNGLE_FLIP_DEAL, cache, analyze),
    VacuousAnalysisError,
  );
  assert.equal(cache.saves, 0);
});

test('resolveJungleFlipDecisions caches an empty result (a game with no flip plies)', async () => {
  const cache = decisionsMemoryCache();
  const analyze = async (): Promise<JungleFlipDecision[]> => [];
  const result = await resolveJungleFlipDecisions(
    'room-empty',
    [],
    STANDARD_JUNGLE_FLIP_DEAL,
    cache,
    analyze,
  );
  assert.ok(result);
  assert.deepEqual(result!.decisions, []);
  assert.equal(cache.saves, 1);
});

test('JUNGLE_FLIP_DECISIONS_ENGINE_ID is version-tagged and distinct from the sweep', () => {
  assert.match(JUNGLE_FLIP_DECISIONS_ENGINE_ID, /^misty-jungle-flip-decisions@/);
  assert.notEqual(JUNGLE_FLIP_DECISIONS_ENGINE_ID, JUNGLE_FLIP_ANALYSIS_ENGINE_ID);
});
