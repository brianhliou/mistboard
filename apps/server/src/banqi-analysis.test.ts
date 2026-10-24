import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyBanqiMove,
  type BanqiColor,
  type BanqiDeal,
  type BanqiMove,
  type BanqiPieceRole,
  createInitialBanqiState,
  getBanqiLegalMoves,
  STANDARD_BANQI_DEAL,
  winPercent,
} from '@mistboard/game';
import {
  analyzeBanqiDecisions,
  analyzeBanqiPostgame,
  BANQI_ANALYSIS_ENGINE_ID,
  BANQI_DECISIONS_ENGINE_ID,
  type BanqiAnalysisCache,
  type BanqiDecision,
  type BanqiDecisionsCache,
  type BanqiGameAnalysis,
  banqiAnalysisRepetitionWindow,
  resolveBanqiAnalysis,
  resolveBanqiDecisions,
} from './banqi-analysis.js';
import { buildBanqiPositionCommand } from './banqi-engine.js';
import { banqiMoveToEngineUci, banqiStateToEngineFen } from './banqi-fen.js';
import type { SweepPlyEval } from './game-analysis-sweep.js';
import { VacuousAnalysisError } from './game-analysis-sweep.js';

// The fixed standard deal makes reconstruction deterministic; a few real legal moves off it
// (opening flips) keep the game in the playing phase — exactly what exercises the per-ply
// evaluate path.
function openingMoves(deal: BanqiDeal, count: number): BanqiMove[] {
  let state = createInitialBanqiState('t', deal);
  const moves: BanqiMove[] = [];
  for (let i = 0; i < count; i += 1) {
    const move = getBanqiLegalMoves(state)[0]!;
    moves.push(move);
    state = applyBanqiMove(state, move);
  }
  return moves;
}

function memoryCache(): BanqiAnalysisCache & { saves: number } {
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

test('analyzeBanqiPostgame reconstructs N+1 plies from the deal and evaluates each position', async () => {
  const moves = openingMoves(STANDARD_BANQI_DEAL, 4);
  const seenTurns: string[] = [];
  const analysis = await analyzeBanqiPostgame(moves, STANDARD_BANQI_DEAL, async (state) => {
    assert.equal(state.status.type, 'playing');
    seenTurns.push(state.status.type === 'playing' ? state.status.turn : 'x');
    return { cp: 42, mate: null, best: 'z' };
  });

  // Ply 0 (initial) .. ply N (after the last move): N+1 contiguous points.
  assert.equal(analysis.plies.length, moves.length + 1);
  analysis.plies.forEach((ply, i) => {
    assert.equal(ply.ply, i);
  });
  // Red seat moves first; a flip passes the turn, so the mover alternates.
  assert.deepEqual(seenTurns, ['red', 'black', 'red', 'black', 'red']);
  assert.ok(analysis.plies.every((ply) => ply.cp === 42));
  assert.equal(analysis.engineId, BANQI_ANALYSIS_ENGINE_ID);
});

test('Banqi analysis rebuilds a quiet-move repetition window', () => {
  const initial = createInitialBanqiState('window', STANDARD_BANQI_DEAL);
  const moves: BanqiMove[] = [
    { from: 'a1', to: 'a2' },
    { from: 'b1', to: 'b2' },
  ];
  const states = [initial, { ...initial, noProgressClock: 1 }, { ...initial, noProgressClock: 2 }];
  const window = banqiAnalysisRepetitionWindow(states, moves, 2);
  assert.equal(window.fen, banqiStateToEngineFen(initial));
  assert.deepEqual(window.moves, moves.map(banqiMoveToEngineUci));
  assert.equal(
    buildBanqiPositionCommand(window.fen, window.moves),
    `position fen ${window.fen} moves a0a1 b0b1`,
  );
});

test('resolveBanqiAnalysis: pure cache read misses without computing', async () => {
  const cache = memoryCache();
  let computes = 0;
  const analyze = async (): Promise<BanqiGameAnalysis> => {
    computes += 1;
    return { engineId: BANQI_ANALYSIS_ENGINE_ID, depth: 12, plies: [] };
  };
  const result = await resolveBanqiAnalysis(
    'room-a',
    [],
    STANDARD_BANQI_DEAL,
    cache,
    analyze,
    false,
  );
  assert.equal(result, null);
  assert.equal(computes, 0);
  assert.equal(cache.saves, 0);
});

test('resolveBanqiAnalysis computes once, persists, then serves from cache', async () => {
  const cache = memoryCache();
  let computes = 0;
  const analyze = async (): Promise<BanqiGameAnalysis> => {
    computes += 1;
    return {
      engineId: BANQI_ANALYSIS_ENGINE_ID,
      depth: 12,
      plies: [{ ply: 0, cp: 0, mate: null, best: null }],
    };
  };
  const first = await resolveBanqiAnalysis('room-b', [], STANDARD_BANQI_DEAL, cache, analyze, true);
  assert.ok(first);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);

  const second = await resolveBanqiAnalysis(
    'room-b',
    [],
    STANDARD_BANQI_DEAL,
    cache,
    analyze,
    true,
  );
  assert.ok(second);
  assert.equal(computes, 1);
  assert.deepEqual(second!.plies, first!.plies);
});

test('resolveBanqiAnalysis coalesces concurrent viewers into one compute', async () => {
  const cache = memoryCache();
  let computes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const analyze = async (): Promise<BanqiGameAnalysis> => {
    computes += 1;
    await gate;
    return { engineId: BANQI_ANALYSIS_ENGINE_ID, depth: 12, plies: [] };
  };
  const a = resolveBanqiAnalysis('room-c', [], STANDARD_BANQI_DEAL, cache, analyze, true);
  const b = resolveBanqiAnalysis('room-c', [], STANDARD_BANQI_DEAL, cache, analyze, true);
  release();
  await Promise.all([a, b]);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);
});

test('resolveBanqiAnalysis fails closed on a scoreless sweep: throws and caches nothing', async () => {
  const cache = memoryCache();
  const analyze = async (): Promise<BanqiGameAnalysis> => ({
    engineId: BANQI_ANALYSIS_ENGINE_ID,
    depth: 12,
    // Engine emitted moves but no evals — the broken-binary signature.
    plies: [
      { ply: 0, cp: null, mate: null, best: 'a0b0' },
      { ply: 1, cp: null, mate: null, best: 'c0d0' },
    ],
  });
  await assert.rejects(
    resolveBanqiAnalysis('room-vacuous', [], STANDARD_BANQI_DEAL, cache, analyze, true),
    VacuousAnalysisError,
  );
  assert.equal(cache.saves, 0);
});

test('BANQI_ANALYSIS_ENGINE_ID is a stable, version-tagged identifier', () => {
  assert.match(BANQI_ANALYSIS_ENGINE_ID, /^misty-banqi-analysis@/);
});

// ── Decision-vs-luck decomposition (Layer 2) ──────────────────────────────────────

// A sequence of pure FLIP moves (from === to) off the fixed deal: every ply is a chance ply, so
// every ply becomes a graded decision — exactly what exercises the pool-mean fan-out.
function openingFlips(deal: BanqiDeal, count: number): BanqiMove[] {
  let state = createInitialBanqiState('t', deal);
  const moves: BanqiMove[] = [];
  for (let i = 0; i < count; i += 1) {
    const flip = getBanqiLegalMoves(state).find((m) => m.from === m.to);
    if (!flip) break;
    moves.push(flip);
    state = applyBanqiMove(state, flip);
  }
  return moves;
}

// Every still-face-down tile of the pre-move position, keyed by ink+role — the banqi flip pool
// (both colours, unlike jieqi's mover-only pool).
function flipPool(deal: BanqiDeal): Map<string, { color: BanqiColor; role: BanqiPieceRole }> {
  const state = createInitialBanqiState('t', deal);
  const pool = new Map<string, { color: BanqiColor; role: BanqiPieceRole }>();
  for (const piece of Object.values(state.board)) {
    if (piece?.faceDown)
      pool.set(`${piece.color}-${piece.role}`, { color: piece.color, role: piece.role });
  }
  return pool;
}

test('analyzeBanqiDecisions: only flip plies, per-mover POV, flat eval => zero luck/loss', async () => {
  const moves = openingFlips(STANDARD_BANQI_DEAL, 6);
  // Constant side-to-move eval (+100 for whoever is to move AFTER the flip, i.e. the opponent);
  // from the mover's POV that is winPercent(-100) for every possible tile — identical, so the pool
  // mean, realized, and best all collapse to one value: no decision loss, no luck.
  const decisions = await analyzeBanqiDecisions([...moves], STANDARD_BANQI_DEAL, {
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
// donor face-down tile holding `entry` to the true `source` tile, so the hidden multiset is
// preserved (an off-ink draw must NOT add a phantom piece). The mock evals key on these FENs, so
// they have to be built the same way the source builds them.
function banqiCounterfactualCf(
  state: ReturnType<typeof createInitialBanqiState>,
  from: BanqiMove['from'],
  entry: { color: BanqiColor; role: BanqiPieceRole },
  source: { color: BanqiColor; role: BanqiPieceRole },
): ReturnType<typeof createInitialBanqiState> {
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

test('analyzeBanqiDecisions: playedWin is the TRUE pool-weighted mean over BOTH inks; realizedWin is the actual tile', async () => {
  const deal = STANDARD_BANQI_DEAL;
  const state0 = createInitialBanqiState('t', deal);
  const flip = getBanqiLegalMoves(state0).find((m) => m.from === m.to)!; // red's first flip (ply 1)
  const source = state0.board[flip.from]!; // the actual (colour, role) under that square
  const pool = flipPool(deal); // ALL face-down tiles, both inks

  // Distinct side-to-move cp per counterfactual (colour, role), keyed on the REAL post-move FEN the
  // source builds (no FEN-format assumptions — we replay the same construction here). Both inks are
  // in the pool, and each binds the first mover's ink differently, so the FENs are all distinct.
  const keyCp = new Map<string, number>();
  let n = 0;
  for (const key of pool.keys()) keyCp.set(key, -600 + n++ * 37);
  const fenToCp = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const piece of Object.values(state0.board)) {
    if (!piece?.faceDown) continue;
    const key = `${piece.color}-${piece.role}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, entry] of pool) {
    const cf = banqiCounterfactualCf(state0, flip.from, entry, source);
    fenToCp.set(banqiStateToEngineFen(applyBanqiMove(cf, flip)), keyCp.get(key)!);
  }

  const decisions = await analyzeBanqiDecisions([flip], deal, {
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

test('analyzeBanqiDecisions: counterfactuals preserve material — an off-ink draw adds no phantom piece', async () => {
  // Regression for the pool-rebalance bug: poolMeanWin used to relabel the flipped square WITHOUT
  // rebalancing the hidden pool, so an off-ink counterfactual gained ~2 pieces of phantom material
  // and inflated the baseline (a first-flip advisor read as -11% luck when it was really ~neutral).
  // With the multiset-preserving swap, EVERY first-flip counterfactual is materially even, so a pure
  // material-imbalance eval scores 0 for all of them and the pool-mean is exactly 50. On the old
  // code the off-ink halves score ±, so playedWin would land far from 50.
  const deal = STANDARD_BANQI_DEAL;
  const state0 = createInitialBanqiState('t', deal);
  const flip = getBanqiLegalMoves(state0).find((m) => m.from === m.to)!;
  const redMinusBlack = (fen: string): number => {
    const [boardF = '', , poolF = ''] = fen.split(' ');
    let bal = 0;
    for (const ch of boardF) {
      if (ch === 'X' || ch === '/' || (ch >= '0' && ch <= '9')) continue;
      if (ch >= 'A' && ch <= 'Z') bal += 1;
      else if (ch >= 'a' && ch <= 'z') bal -= 1;
    }
    for (const m of poolF.matchAll(/([A-Za-z])(\d+)/g)) {
      bal += m[1]! >= 'A' && m[1]! <= 'Z' ? Number(m[2]) : -Number(m[2]);
    }
    return bal;
  };
  const decisions = await analyzeBanqiDecisions([flip], deal, {
    evalPosition: async (fen) => ({ cp: 300 * redMinusBlack(fen), mate: null }),
  });
  const d = decisions[0]!;
  assert.ok(
    Math.abs(d.playedWin - 50) < 1e-6,
    `balanced counterfactuals => playedWin 50, got ${d.playedWin}`,
  );
  assert.ok(Math.abs(d.realizedWin - 50) < 1e-6);
});

test('analyzeBanqiDecisions: a better candidate flip lifts bestWin above playedWin (decision loss)', async () => {
  const deal = STANDARD_BANQI_DEAL;
  const state0 = createInitialBanqiState('t', deal);
  const flips = getBanqiLegalMoves(state0).filter((m) => m.from === m.to);
  const played = flips[0]!;
  const better = flips[1]!;
  const betterSource = state0.board[better.from]!;
  const pool = flipPool(deal);

  // Every post-move FEN reachable by playing `better` (across the pool) scores well for the mover
  // (very negative side-to-move cp -> high mover win% after negation); everything else scores low.
  const betterFens = new Set<string>();
  for (const entry of pool.values()) {
    const cf = banqiCounterfactualCf(state0, better.from, entry, betterSource);
    betterFens.add(banqiStateToEngineFen(applyBanqiMove(cf, better)));
  }
  const decisions = await analyzeBanqiDecisions([played], deal, {
    evalPosition: async (fen) => ({ cp: betterFens.has(fen) ? -400 : -50, mate: null }),
  });
  const d = decisions[0]!;
  assert.ok(d.bestWin > d.playedWin, `best ${d.bestWin} should beat played ${d.playedWin}`);
  assert.ok(Math.abs(d.playedWin - winPercent(50, null)) < 1e-6); // played: winPercent(-(-50))
  assert.ok(Math.abs(d.bestWin - winPercent(400, null)) < 1e-6); // better: winPercent(-(-400))
  assert.equal(d.playedRank, 2); // one candidate strictly beat the played move
});

test('analyzeBanqiDecisions: ranks three alternatives plus played by pool mean, without hidden identities', async () => {
  const deal = STANDARD_BANQI_DEAL;
  const state = createInitialBanqiState('t', deal);
  const flips = getBanqiLegalMoves(state).filter((m) => m.from === m.to);
  const played = flips.at(-1)!;
  const top = flips.slice(0, 3);
  const scores = new Map<string, number>();
  for (const [index, move] of top.entries()) {
    for (const entry of flipPool(deal).values()) {
      const cf = banqiCounterfactualCf(state, move.from, entry, state.board[move.from]!);
      scores.set(banqiStateToEngineFen(applyBanqiMove(cf, move)), -600 + index * 150);
    }
  }
  const decisions = await analyzeBanqiDecisions([played], deal, {
    evalPosition: async (fen) => ({ cp: scores.get(fen) ?? 100, mate: null }),
  });
  const d = decisions[0]!;
  assert.equal(d.playedRank, 4);
  const expected = [
    ...top.map((move, index) => ({
      move: banqiMoveToEngineUci(move),
      win: winPercent(600 - index * 150, null),
    })),
    { move: banqiMoveToEngineUci(played), win: winPercent(-100, null), played: true },
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

test('analyzeBanqiDecisions: shortlists quiet moves with the live repetition history', async () => {
  const deal = STANDARD_BANQI_DEAL;
  let state = createInitialBanqiState('t', deal);
  const prefix: BanqiMove[] = [];
  // Open enough squares through real legal play to offer a quiet move beside flips.
  for (let i = 0; i < 32; i += 1) {
    const legal = getBanqiLegalMoves(state);
    if (legal.some((m) => m.from !== m.to && !state.board[m.to])) break;
    const next = legal.find((m) => m.from !== m.to) ?? legal.find((m) => m.from === m.to)!;
    assert.ok(next);
    prefix.push(next);
    state = applyBanqiMove(state, next);
  }
  const legal = getBanqiLegalMoves(state);
  const quiet = legal.find((m) => m.from !== m.to && !state.board[m.to])!;
  const played = legal.find((m) => m.from === m.to)!;
  assert.ok(quiet && played);
  const quietUci = banqiMoveToEngineUci(quiet);
  const quietFen = banqiStateToEngineFen(applyBanqiMove(state, quiet));
  let sawQuiet = false;
  const decisions = await analyzeBanqiDecisions(
    [...prefix, played],
    deal,
    {
      evalPosition: async (fen, history) => {
        if (fen === quietFen) {
          sawQuiet = true;
          assert.equal(history?.moves.at(-1), quietUci);
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

test('analyzeBanqiDecisions: deduplicates played and bounds ranking and pool fan-out', async () => {
  const deal = STANDARD_BANQI_DEAL;
  const state = createInitialBanqiState('t', deal);
  const legal = getBanqiLegalMoves(state);
  const played = legal[0]!;
  let active = 0;
  let peak = 0;
  let calls = 0;
  const [d] = await analyzeBanqiDecisions([played], deal, {
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

test('analyzeBanqiDecisions: pool means override lucky ranking scores', async () => {
  const deal = STANDARD_BANQI_DEAL;
  const state = createInitialBanqiState('t', deal);
  const flips = getBanqiLegalMoves(state).filter((m) => m.from === m.to);
  const lucky = flips[0]!;
  const played = flips[1]!;
  const luckyFens = new Set<string>();
  for (const entry of flipPool(deal).values()) {
    const cf = banqiCounterfactualCf(state, lucky.from, entry, state.board[lucky.from]!);
    luckyFens.add(banqiStateToEngineFen(applyBanqiMove(cf, lucky)));
  }
  const actualFen = banqiStateToEngineFen(applyBanqiMove(state, lucky));
  const [d] = await analyzeBanqiDecisions([played], deal, {
    evalPosition: async (fen) => ({
      cp: fen === actualFen ? -1200 : luckyFens.has(fen) ? 1200 : 0,
      mate: null,
    }),
  });
  assert.equal(d!.playedRank, 1);
  assert.ok(d!.candidates!.at(-1)!.win < d!.playedWin);
  assert.equal(d!.candidates!.at(-1)!.move, banqiMoveToEngineUci(lucky));
});

function decisionsMemoryCache(): BanqiDecisionsCache & { saves: number } {
  const store = new Map<string, BanqiDecision[]>();
  const cache = {
    saves: 0,
    async get(roomId: string, engineId: string, depth: number) {
      return store.get(`${roomId}:${engineId}:${depth}`) ?? null;
    },
    async save(roomId: string, engineId: string, depth: number, decisions: BanqiDecision[]) {
      cache.saves += 1;
      store.set(`${roomId}:${engineId}:${depth}`, decisions);
    },
  };
  return cache;
}

const sampleDecision = (ply: number): BanqiDecision => ({
  ply,
  mover: ply % 2 === 1 ? 'red' : 'black',
  bestWin: 62,
  playedWin: 55,
  realizedWin: 48,
  playedRank: 2,
});

test('resolveBanqiDecisions: pure cache read misses without computing', async () => {
  const cache = decisionsMemoryCache();
  let computes = 0;
  const analyze = async (): Promise<BanqiDecision[]> => {
    computes += 1;
    return [];
  };
  const result = await resolveBanqiDecisions(
    'room-d',
    [],
    STANDARD_BANQI_DEAL,
    cache,
    analyze,
    false,
  );
  assert.equal(result, null);
  assert.equal(computes, 0);
  assert.equal(cache.saves, 0);
});

test('resolveBanqiDecisions computes once, persists, then serves from cache', async () => {
  const cache = decisionsMemoryCache();
  let computes = 0;
  const analyze = async (): Promise<BanqiDecision[]> => {
    computes += 1;
    return [sampleDecision(3)];
  };
  const first = await resolveBanqiDecisions('room-e', [], STANDARD_BANQI_DEAL, cache, analyze);
  assert.ok(first);
  assert.equal(first!.engineId, BANQI_DECISIONS_ENGINE_ID);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);

  const second = await resolveBanqiDecisions('room-e', [], STANDARD_BANQI_DEAL, cache, analyze);
  assert.equal(computes, 1);
  assert.deepEqual(second!.decisions, first!.decisions);
});

test('resolveBanqiDecisions coalesces concurrent viewers into one compute', async () => {
  const cache = decisionsMemoryCache();
  let computes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const analyze = async (): Promise<BanqiDecision[]> => {
    computes += 1;
    await gate;
    return [sampleDecision(1)];
  };
  const a = resolveBanqiDecisions('room-f', [], STANDARD_BANQI_DEAL, cache, analyze);
  const b = resolveBanqiDecisions('room-f', [], STANDARD_BANQI_DEAL, cache, analyze);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);
  assert.deepEqual(ra!.decisions, rb!.decisions);
});

test('resolveBanqiDecisions fails closed when every win% collapses to the null-eval 50', async () => {
  const cache = decisionsMemoryCache();
  const analyze = async (): Promise<BanqiDecision[]> => [
    { ply: 1, mover: 'red', bestWin: 50, playedWin: 50, realizedWin: 50, playedRank: 1 },
    { ply: 2, mover: 'black', bestWin: 50, playedWin: 50, realizedWin: 50, playedRank: 1 },
  ];
  await assert.rejects(
    resolveBanqiDecisions('room-vac', [], STANDARD_BANQI_DEAL, cache, analyze),
    VacuousAnalysisError,
  );
  assert.equal(cache.saves, 0);
});

test('resolveBanqiDecisions caches an empty result (a game with no flip plies)', async () => {
  const cache = decisionsMemoryCache();
  const analyze = async (): Promise<BanqiDecision[]> => [];
  const result = await resolveBanqiDecisions('room-empty', [], STANDARD_BANQI_DEAL, cache, analyze);
  assert.ok(result);
  assert.deepEqual(result!.decisions, []);
  assert.equal(cache.saves, 1); // empty is a valid, cacheable result — not vacuous
});

test('BANQI_DECISIONS_ENGINE_ID is a stable, version-tagged identifier distinct from the sweep', () => {
  assert.match(BANQI_DECISIONS_ENGINE_ID, /^misty-banqi-decisions@/);
  assert.notEqual(BANQI_DECISIONS_ENGINE_ID, BANQI_ANALYSIS_ENGINE_ID);
});
