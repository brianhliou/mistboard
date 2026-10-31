// Server-side jieqi analysis on AB-JChess (#482): which engine computes, how a read falls
// back to the other engine's stored rows, that each engine's cp become win% on its own
// curve, and that the decisions pass runs on ONE session instead of a process per eval.
// No real engine: fakes and injected evaluators throughout.
import assert from 'node:assert/strict';
import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  ABJCHESS_20261031_WIN_PCT_K,
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  type JieqiDeal,
  type JieqiMove,
  parseJieqiFen,
  STANDARD_JIEQI_DEAL,
  WIN_PCT_K,
  winPercent,
} from '@mistboard/game';
import type { SweepPlyEval } from './game-analysis-sweep.js';
import {
  ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID,
  ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  ABJCHESS_JIEQI_DECISIONS_ENGINE_ID,
  analyzeJieqiDecisions,
  analyzeJieqiPostgame,
  believedMoverPool,
  currentJieqiAnalysisProfile,
  isJieqiChanceMove,
  JIEQI_ANALYSIS_ENGINE_ID,
  JIEQI_DECISIONS_ENGINE_ID,
  JIEQI_LEGACY_DECISIONS_ENGINE_IDS,
  type JieqiAnalysisCache,
  type JieqiDecision,
  type JieqiDecisionsCache,
  jieqiAnalysisRepetitionWindows,
  jieqiChancePlies,
  jieqiDecisionDepsFromSession,
  jieqiDeterministicPlies,
  PIKAFISH_JIEQI_ANALYSIS_PROFILE,
  resolveJieqiAnalysis,
  resolveJieqiDecisions,
} from './jieqi-analysis.js';
import {
  ABJCHESS_ENGINE_REF,
  buildJieqiAnalysisInitCommands,
  type JieqiAnalysisEvaluators,
  type JieqiAnalysisRequest,
  jieqiAnalysisEngine,
  jieqiAnalysisEngineAvailable,
} from './jieqi-engine.js';
import {
  jieqiMoveToPikafishUci,
  jieqiStateToPikafishFen,
  pikafishUciToJieqiMove,
} from './jieqi-fen.js';

const fixtureDir = mkdtempSync(join(tmpdir(), 'jieqi-abjchess-analysis-'));
after(() => rmSync(fixtureDir, { recursive: true, force: true }));

async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T> | T) {
  const prior = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await run();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function playGame(deal: JieqiDeal, count: number): JieqiMove[] {
  let state = createInitialJieqiState('t', deal);
  const moves: JieqiMove[] = [];
  let lastTo: string | null = null;
  for (let i = 0; i < count; i += 1) {
    const legal = getJieqiLegalMoves(state);
    if (legal.length === 0) break;
    const move = legal.find((m) => m.from === lastTo) ?? legal[0]!;
    moves.push(move);
    state = applyJieqiMove(state, move);
    lastTo = move.to;
  }
  return moves;
}

function keyedCache<T>(): {
  get(roomId: string, engineId: string, depth: number): Promise<T | null>;
  save(roomId: string, engineId: string, depth: number, value: T): Promise<void>;
  saved: string[];
  store: Map<string, T>;
} {
  const store = new Map<string, T>();
  const saved: string[] = [];
  return {
    store,
    saved,
    async get(roomId, engineId, depth) {
      return store.get(`${roomId}|${engineId}|${depth}`) ?? null;
    },
    async save(roomId, engineId, depth, value) {
      saved.push(engineId);
      store.set(`${roomId}|${engineId}|${depth}`, value);
    },
  };
}

// ── Which engine computes ────────────────────────────────────────────────────

test('AB-JChess computes new analysis when its binary and net resolve, PikaJieQi otherwise', async () => {
  const bin = join(fixtureDir, 'ab-jchess');
  const net = join(fixtureDir, 'abjchess-20261030.nnue');
  writeFileSync(bin, '');
  writeFileSync(net, '');
  await withEnv({ MISTBOARD_ABJCHESS_PATH: bin, MISTBOARD_ABJCHESS_NET: net }, () => {
    assert.equal(jieqiAnalysisEngine(), 'ab-jchess');
    assert.equal(currentJieqiAnalysisProfile(), ABJCHESS_JIEQI_ANALYSIS_PROFILE);
    assert.equal(jieqiAnalysisEngineAvailable(), true);
  });
  await withEnv(
    { MISTBOARD_ABJCHESS_PATH: join(fixtureDir, 'missing'), MISTBOARD_ABJCHESS_NET: net },
    () => {
      assert.equal(jieqiAnalysisEngine(), 'pikafish-jieqi');
      assert.equal(currentJieqiAnalysisProfile(), PIKAFISH_JIEQI_ANALYSIS_PROFILE);
    },
  );
  // A binary without its net is not AB-JChess either: the net is the engine.
  await withEnv(
    { MISTBOARD_ABJCHESS_PATH: bin, MISTBOARD_ABJCHESS_NET: join(fixtureDir, 'no-net.nnue') },
    () => assert.equal(jieqiAnalysisEngine(), 'pikafish-jieqi'),
  );
});

test('the two engines file under different ids, and the AB ids name its ref and net', () => {
  assert.notEqual(ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID, JIEQI_ANALYSIS_ENGINE_ID);
  assert.notEqual(ABJCHESS_JIEQI_DECISIONS_ENGINE_ID, JIEQI_DECISIONS_ENGINE_ID);
  for (const id of [ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID, ABJCHESS_JIEQI_DECISIONS_ENGINE_ID]) {
    // The client picks AB's win curve off this prefix (winPercentK).
    assert.match(id, /^ab-jchess-/);
    assert.ok(id.includes(ABJCHESS_ENGINE_REF), `${id} carries the binary ref`);
    assert.ok(id.includes('abjchess-20261030'), `${id} carries the net, so a new net re-keys`);
  }
  // The served net is AB-JChess-20261031's, on the jqe-lineage curve (winPercentK).
  assert.equal(ABJCHESS_JIEQI_ANALYSIS_PROFILE.winK, ABJCHESS_20261031_WIN_PCT_K);
  assert.equal(PIKAFISH_JIEQI_ANALYSIS_PROFILE.winK, WIN_PCT_K);
});

test('an AB-JChess analysis session loads its net on a single-threaded fixed table', async () => {
  const net = join(fixtureDir, 'abjchess-20261030.nnue');
  writeFileSync(net, '');
  await withEnv({ MISTBOARD_ABJCHESS_NET: net }, () => {
    const commands = buildJieqiAnalysisInitCommands('ab-jchess');
    assert.ok(commands.includes(`setoption name EvalFile value ${net}`));
    assert.ok(commands.includes('setoption name Threads value 1'));
    assert.ok(commands.includes('setoption name Hash value 64'));
  });
});

// ── Coexistence: a read serves whichever engine's row exists ─────────────────

test('an AB read with only a PikaJieQi row serves that row under its own id, and computes nothing', async () => {
  const cache = keyedCache<SweepPlyEval[]>();
  const legacy: SweepPlyEval[] = [{ ply: 0, cp: 12, mate: null, best: 'a0a1' }];
  await cache.save('room-old', JIEQI_ANALYSIS_ENGINE_ID, 16, legacy);
  cache.saved.length = 0;
  let computes = 0;
  const result = await resolveJieqiAnalysis(
    'room-old',
    [],
    STANDARD_JIEQI_DEAL,
    cache as JieqiAnalysisCache,
    async () => {
      computes += 1;
      return { engineId: ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID, depth: 16, plies: [] };
    },
    true,
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  assert.equal(result?.engineId, JIEQI_ANALYSIS_ENGINE_ID, 'drawn on the curve it was computed on');
  assert.deepEqual(result?.plies, legacy);
  assert.equal(computes, 0);
  assert.deepEqual(cache.saved, []);
});

test('an AB row wins over a PikaJieQi row, and a room with neither computes under the AB id', async () => {
  const cache = keyedCache<SweepPlyEval[]>();
  const abPlies: SweepPlyEval[] = [{ ply: 0, cp: 3, mate: null, best: 'b0c2' }];
  await cache.save('room-both', JIEQI_ANALYSIS_ENGINE_ID, 16, [
    { ply: 0, cp: 99, mate: null, best: null },
  ]);
  await cache.save('room-both', ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID, 16, abPlies);
  const both = await resolveJieqiAnalysis(
    'room-both',
    [],
    STANDARD_JIEQI_DEAL,
    cache as JieqiAnalysisCache,
    undefined,
    false,
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  assert.equal(both?.engineId, ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID);
  assert.deepEqual(both?.plies, abPlies);

  cache.saved.length = 0;
  const moves = playGame(STANDARD_JIEQI_DEAL, 4);
  const fresh = await resolveJieqiAnalysis(
    'room-new',
    moves,
    STANDARD_JIEQI_DEAL,
    cache as JieqiAnalysisCache,
    (m, d) =>
      analyzeJieqiPostgame(
        m,
        d,
        async () => ({ cp: 10, mate: null, best: 'x' }),
        undefined,
        ABJCHESS_JIEQI_ANALYSIS_PROFILE,
      ),
    true,
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  assert.equal(fresh?.engineId, ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID);
  assert.deepEqual(cache.saved, [ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID]);
});

test('a PikaJieQi-only box still serves an AB row it finds (and its own first)', async () => {
  const cache = keyedCache<SweepPlyEval[]>();
  await cache.save('room-ab', ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID, 16, [
    { ply: 0, cp: 1, mate: null, best: null },
  ]);
  const result = await resolveJieqiAnalysis(
    'room-ab',
    [],
    STANDARD_JIEQI_DEAL,
    cache as JieqiAnalysisCache,
    undefined,
    false,
    PIKAFISH_JIEQI_ANALYSIS_PROFILE,
  );
  assert.equal(result?.engineId, ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID);
});

test('decisions fall back the same way: a PikaJieQi blob is served under its own id', async () => {
  const cache = keyedCache<JieqiDecision[]>();
  const legacy: JieqiDecision[] = [
    { ply: 1, mover: 'red', bestWin: 60, playedWin: 40, realizedWin: 45, playedRank: 2 },
  ];
  await cache.save('room-old', JIEQI_DECISIONS_ENGINE_ID, 16, legacy);
  let computes = 0;
  const result = await resolveJieqiDecisions(
    'room-old',
    [],
    STANDARD_JIEQI_DEAL,
    cache as JieqiDecisionsCache,
    async () => {
      computes += 1;
      return [];
    },
    true,
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  assert.equal(result?.engineId, JIEQI_DECISIONS_ENGINE_ID);
  assert.deepEqual(result?.decisions, legacy);
  assert.equal(computes, 0);
});

test('the public re-key (d6) serves no row graded from the real deal', async () => {
  // Since 2026-10-16 decisions are graded from the public deal. Every earlier row was graded
  // from the real one, so none is served: a read recomputes under the d6-public id.
  assert.match(ABJCHESS_JIEQI_DECISIONS_ENGINE_ID, /^ab-jchess-jieqi-decisions@2\+.*\+d6-public$/);
  assert.match(JIEQI_DECISIONS_ENGINE_ID, /^pikafish-jieqi-decisions@.*\+d6-public$/);
  assert.deepEqual(JIEQI_LEGACY_DECISIONS_ENGINE_IDS, []);
  const old: JieqiDecision[] = [
    { ply: 3, mover: 'red', bestWin: 55, playedWin: 50, realizedWin: 30, playedRank: 2 },
  ];
  const fresh: JieqiDecision[] = [
    { ply: 3, mover: 'red', bestWin: 55, playedWin: 50, realizedWin: 50, playedRank: 2 },
  ];
  const retired = [
    ABJCHESS_JIEQI_DECISIONS_ENGINE_ID.replace(/d6-public$/, 'd5-capture'),
    JIEQI_DECISIONS_ENGINE_ID.replace(/d6-public$/, 'd5-capture'),
    JIEQI_DECISIONS_ENGINE_ID.replace(/d6-public$/, 'd4-mover'),
  ];
  for (const id of retired) {
    for (const profile of [ABJCHESS_JIEQI_ANALYSIS_PROFILE, PIKAFISH_JIEQI_ANALYSIS_PROFILE]) {
      const cache = keyedCache<JieqiDecision[]>();
      await cache.save('room-legacy', id, 16, old);
      const result = await resolveJieqiDecisions(
        'room-legacy',
        [],
        STANDARD_JIEQI_DEAL,
        cache as JieqiDecisionsCache,
        async () => fresh,
        true,
        profile,
      );
      assert.equal(result?.engineId, profile.decisionsEngineId);
      assert.deepEqual(result?.decisions, fresh);
    }
  }
});

// ── Each engine's cp on its own curve ────────────────────────────────────────

test('AB decisions turn engine cp into win% on AB-JChess’s curve, not lila’s', async () => {
  const moves = playGame(STANDARD_JIEQI_DEAL, 6);
  const deps = {
    multiPv: async () => [],
    evalPosition: async () => ({ cp: 100, mate: null }),
  };
  const ab = await analyzeJieqiDecisions(
    moves,
    STANDARD_JIEQI_DEAL,
    deps,
    undefined,
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  const pika = await analyzeJieqiDecisions(
    moves,
    STANDARD_JIEQI_DEAL,
    deps,
    undefined,
    PIKAFISH_JIEQI_ANALYSIS_PROFILE,
  );
  assert.ok(ab.length > 0);
  // The post-move score is the opponent's +100; the mover sits at -100 on each curve.
  for (const d of ab) {
    assert.ok(Math.abs(d.playedWin - winPercent(-100, null, ABJCHESS_20261031_WIN_PCT_K)) < 1e-6);
  }
  for (const d of pika) assert.ok(Math.abs(d.playedWin - winPercent(-100, null)) < 1e-6);
});

// The re-search rule is a win% swing on the engine's own curve for AB-JChess. The threshold
// is lila's 200cp swing (~17.6 points); AB-JChess-20261031's curve is flatter than lila's,
// so +230cp out of equality is ~15 points there (no re-search) while the cp rule re-searches
// it, and +300cp is ~19 points (re-search).
test('the AB consistency rule triggers on a win% swing, not on 200cp', async () => {
  const moves = playGame(STANDARD_JIEQI_DEAL, 12);
  const target = jieqiDeterministicPlies(moves, STANDARD_JIEQI_DEAL)[0]!;
  const moverSign = target % 2 === 1 ? 1 : -1;
  const windows = jieqiAnalysisRepetitionWindows(moves, STANDARD_JIEQI_DEAL);
  const plyOf = new Map(windows.map((w, ply) => [`${w.fen}|${w.moves.join(',')}`, ply]));
  const run = async (profile: typeof ABJCHESS_JIEQI_ANALYSIS_PROFILE, cp: number) => {
    const researched: Array<{ ply: number; nodes: number }> = [];
    await analyzeJieqiPostgame(
      moves,
      STANDARD_JIEQI_DEAL,
      async (_state, window, nodes) => {
        const ply = plyOf.get(`${window.fen}|${window.moves.join(',')}`)!;
        if (nodes !== undefined) researched.push({ ply, nodes });
        return { cp: ply >= target ? cp * moverSign : 0, mate: null, best: null };
      },
      undefined,
      profile,
    );
    return researched;
  };
  assert.deepEqual(await run(ABJCHESS_JIEQI_ANALYSIS_PROFILE, 230), []);
  assert.deepEqual(await run(PIKAFISH_JIEQI_ANALYSIS_PROFILE, 230), [
    { ply: target - 1, nodes: PIKAFISH_JIEQI_ANALYSIS_PROFILE.researchNodes },
  ]);
  assert.deepEqual(await run(ABJCHESS_JIEQI_ANALYSIS_PROFILE, 300), [
    { ply: target - 1, nodes: ABJCHESS_JIEQI_ANALYSIS_PROFILE.researchNodes },
  ]);
});

// ── Decisions reuse one session ──────────────────────────────────────────────

test('AB decision searches never put a reveal or capture in UCI history', async () => {
  const evaluations: Array<{ fen: string; opts: JieqiAnalysisRequest }> = [];
  const deps = jieqiDecisionDepsFromSession(
    {
      multiPv: async () => assert.fail('AB does not support MultiPV'),
      evaluateFen: async (fen, opts) => {
        evaluations.push({ fen, opts });
        return { cp: 0, mate: null, best: null, depth: 4 };
      },
    },
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  const initial = createInitialJieqiState('recording', STANDARD_JIEQI_DEAL);
  const legal = getJieqiLegalMoves(initial);
  assert.ok(legal.some((m) => initial.board[m.from]?.faceDown && !initial.board[m.to]));
  assert.ok(
    legal.some((m) => initial.board[m.to]),
    'fixture offers captures too',
  );
  const decisions = await analyzeJieqiDecisions(
    [
      { from: 'b3', to: 'b10' },
      { from: 'a10', to: 'b10' },
    ],
    STANDARD_JIEQI_DEAL,
    deps,
    undefined,
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  assert.equal(decisions.length, 2);
  assert.ok(evaluations.length > 0);
  for (const { fen, opts } of evaluations) {
    const parsed = parseJieqiFen(fen, { rng: () => 0 });
    assert.ok(parsed.ok);
    let state = parsed.state;
    assert.equal(fen.trim().split(/\s+/).length, 5, 'only public FENs reach the engine');
    assert.equal(jieqiStateToPikafishFen(state, { public: true }), fen);
    for (const uci of opts.moves ?? []) {
      const move = pikafishUciToJieqiMove(uci);
      assert.ok(move);
      assert.equal(state.board[move.from]?.faceDown, false, `UCI reveal: ${uci}`);
      assert.equal(state.board[move.to], undefined, `UCI capture: ${uci}`);
      state = applyJieqiMove(state, move);
    }
    assert.ok(opts.nodes === 50_000 || opts.nodes === 200_000);
    assert.equal(opts.movetimeMs, 30_000);
    assert.equal(opts.fresh, true);
  }
});

test('AB ranks every legal move at 50k and uses only 200k evals for final values', async () => {
  const state = createInitialJieqiState('candidates', STANDARD_JIEQI_DEAL);
  const played = { from: 'b1', to: 'c3' } as const;
  const playedUci = jieqiMoveToPikafishUci(played);
  const evaluations: Array<{ fen: string; opts: JieqiAnalysisRequest; cp: number }> = [];
  const cpByRole = {
    chariot: -900,
    horse: -600,
    elephant: -300,
    advisor: 0,
    cannon: 300,
    soldier: 900,
  };
  const session: JieqiAnalysisEvaluators = {
    multiPv: async () => assert.fail('new profile must not request MultiPV'),
    evaluateFen: async (fen, opts) => {
      const parsed = parseJieqiFen(fen, { rng: () => 0 });
      assert.ok(parsed.ok);
      const landing = parsed.state.board[played.to];
      const rankCp =
        landing && !landing.faceDown && landing.role !== 'general' ? cpByRole[landing.role] : 1200;
      // Distinct scores make leaking even one ranking term into the output observable.
      const cp = opts.nodes === 50_000 ? rankCp : rankCp + 200;
      evaluations.push({ fen, opts, cp });
      return { cp, mate: null, best: null, depth: 4 };
    },
  };
  const deps = jieqiDecisionDepsFromSession(session, ABJCHESS_JIEQI_ANALYSIS_PROFILE);
  const rank = deps.multiPv;
  let table: Awaited<ReturnType<typeof rank>> = [];
  let callsAfterRanking = 0;
  deps.multiPv = async (...args) => {
    table = await rank(...args);
    callsAfterRanking = evaluations.length;
    return table;
  };
  const decisions = await analyzeJieqiDecisions(
    [played],
    STANDARD_JIEQI_DEAL,
    deps,
    undefined,
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  const pool = believedMoverPool(state, 'red');
  const total = [...pool.values()].reduce((a, b) => a + b, 0);
  const expected = [...pool].reduce((sum, [role, count]) => {
    assert.notEqual(role, 'general');
    return (
      sum +
      (count / total) *
        winPercent(-cpByRole[role as keyof typeof cpByRole], null, ABJCHESS_20261031_WIN_PCT_K)
    );
  }, 0);
  const ranked = table.find((line) => line.move === playedUci)!;
  assert.ok(
    Math.abs(ranked.win! - expected) < 1e-9,
    'ranking is the probability-weighted win mean',
  );
  const fullExpected = [...pool].reduce(
    (sum, [role, count]) =>
      sum +
      (count / total) *
        winPercent(
          -(cpByRole[role as keyof typeof cpByRole] + 200),
          null,
          ABJCHESS_20261031_WIN_PCT_K,
        ),
    0,
  );
  const decision = decisions[0]!;
  assert.ok(Math.abs(decision.playedWin - fullExpected) < 1e-9);
  assert.equal(
    decision.realizedWin,
    winPercent(-(cpByRole.horse + 200), null, ABJCHESS_20261031_WIN_PCT_K),
    'realized score uses the actual role, not the parser sample',
  );
  assert.ok(
    table.slice(0, 3).some((line) => line.move === playedUci),
    'reveal reaches top three',
  );
  const rankingCalls = evaluations.slice(0, callsAfterRanking);
  const fullCalls = evaluations.slice(callsAfterRanking);
  assert.equal(rankingCalls.length, 259, 'opening: 43 reveals * 6 roles + one quiet move');
  assert.ok(fullCalls.length > 0, 'selected candidates are independently true-baselined');
  for (const { opts } of rankingCalls) assert.equal(opts.nodes, 50_000);
  for (const { opts } of fullCalls) assert.equal(opts.nodes, 200_000);
  assert.equal(
    new Set(evaluations.map(({ fen, opts }) => JSON.stringify([fen, opts.moves, opts.nodes]))).size,
    evaluations.length,
    'each role term searched once per budget',
  );
  const candidateWins: number[] = [];
  for (const candidate of decision.candidates!) {
    const move = pikafishUciToJieqiMove(candidate.move)!;
    const calls = fullCalls.filter(({ fen }) => {
      const parsed = parseJieqiFen(fen, { rng: () => 0 });
      assert.ok(parsed.ok);
      return !parsed.state.board[move.from] && parsed.state.board[move.to]?.faceDown === false;
    });
    assert.equal(calls.length, 6, 'each selected reveal has six full-budget role terms');
    const candidateWin = calls.reduce((sum, { fen, cp }) => {
      const parsed = parseJieqiFen(fen, { rng: () => 0 });
      assert.ok(parsed.ok);
      const role = parsed.state.board[move.to]!.role;
      return sum + (pool.get(role)! / total) * winPercent(-cp, null, ABJCHESS_20261031_WIN_PCT_K);
    }, 0);
    assert.ok(Math.abs(candidate.win - candidateWin) < 1e-9);
    candidateWins.push(candidateWin);
  }
  assert.equal(fullCalls.length, decision.candidates!.length * 6);
  assert.ok(Math.abs(decision.bestWin - Math.max(...candidateWins)) < 1e-9);
  assert.deepEqual(
    table.map((line) => line.move).sort(),
    getJieqiLegalMoves(state).map(jieqiMoveToPikafishUci).sort(),
  );
  assert.deepEqual(
    table.map((line) => line.index),
    table.map((_, i) => i + 1),
  );
  assert.deepEqual(
    decisions[0]!.candidates?.map((candidate) => candidate.move).sort(),
    [...new Set([...table.slice(0, 3).map((line) => line.move), playedUci])].sort(),
  );
});

test('AB true-baselines a selected quiet move and a played reveal outside the top three at 200k', async () => {
  const played = { from: 'b1', to: 'c3' } as const;
  const playedUci = jieqiMoveToPikafishUci(played);
  const fullCalls: Array<{ fen: string; opts: JieqiAnalysisRequest }> = [];
  let rankingComplete = false;
  const deps = jieqiDecisionDepsFromSession(
    {
      multiPv: async () => assert.fail('new profile must not request MultiPV'),
      evaluateFen: async (fen, opts) => {
        assert.equal(opts.nodes, rankingComplete ? 200_000 : 50_000);
        const parsed = parseJieqiFen(fen, { rng: () => 0 });
        assert.ok(parsed.ok);
        // Rank the quiet general move first and the played reveal below the top three.
        // Every full-budget eval returns equality, regardless of its ranking score.
        const landing = parsed.state.board[played.to];
        const rankCp = opts.moves?.length ? -2000 : landing && !landing.faceDown ? 2000 : 0;
        if (rankingComplete) fullCalls.push({ fen, opts });
        return { cp: rankingComplete ? 0 : rankCp, mate: null, best: null, depth: 4 };
      },
    },
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  const rank = deps.multiPv;
  let selected: string[] = [];
  deps.multiPv = async (...args) => {
    const table = await rank(...args);
    selected = table.slice(0, 3).map((line) => line.move);
    assert.ok(!selected.includes(playedUci));
    rankingComplete = true;
    return table;
  };
  const [decision] = await analyzeJieqiDecisions(
    [played],
    STANDARD_JIEQI_DEAL,
    deps,
    undefined,
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  assert.ok(decision);
  assert.deepEqual(
    decision.candidates!.map((candidate) => candidate.move).sort(),
    [...selected, playedUci].sort(),
  );
  for (const value of [
    decision.bestWin,
    decision.playedWin,
    decision.realizedWin,
    ...decision.candidates!.map((candidate) => candidate.win),
  ]) {
    assert.ok(Math.abs(value - 50) < 1e-9, 'all output scores use full-budget equality');
  }
  const quietCalls = fullCalls.filter(({ opts }) => opts.moves?.length);
  assert.equal(quietCalls.length, 1);
  assert.deepEqual(quietCalls[0]!.opts.moves, [selected[0]]);
  assert.equal(fullCalls.length, 1 + 3 * 6, 'quiet child plus three reveal pool means');
  assert.equal(decision.playedRank, 1);
});

test('AB only appends reversible moves to the repetition window', async () => {
  let state = createInitialJieqiState('history', STANDARD_JIEQI_DEAL);
  const anchorFen = jieqiStateToPikafishFen(state, { public: true });
  const moves: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const move = getJieqiLegalMoves(state).find((m) => state.board[m.from]?.role === 'general')!;
    moves.push(jieqiMoveToPikafishUci(move));
    state = applyJieqiMove(state, move);
  }
  const expected = getJieqiLegalMoves(state)
    .filter((m) => !isJieqiChanceMove(state, m) && !state.board[m.to])
    .map(jieqiMoveToPikafishUci)
    .sort();
  const searched: string[] = [];
  const deps = jieqiDecisionDepsFromSession(
    {
      multiPv: async () => assert.fail('new profile must not request MultiPV'),
      evaluateFen: async (fen, opts) => {
        assert.equal(opts.nodes, 50_000, 'reversible child ranking uses the rank budget');
        if (opts.moves?.length) {
          assert.equal(fen, anchorFen);
          assert.deepEqual(opts.moves.slice(0, -1), moves);
          searched.push(opts.moves.at(-1)!);
        }
        assert.equal(opts.fresh, true);
        return { cp: 40, mate: null, best: null, depth: 3 };
      },
    },
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  const table = await deps.multiPv(jieqiStateToPikafishFen(state, { public: true }), {
    fen: anchorFen,
    moves,
  });
  assert.ok(expected.length > 0);
  assert.deepEqual(searched.sort(), expected);
  for (const uci of expected) assert.equal(table.find((line) => line.move === uci)?.cp, -40);
  assert.equal(moves.length, 2, 'caller history was not mutated');
});

test('AB known captures use a fresh public child FEN with public pool surplus intact', async () => {
  const state = createInitialJieqiState('capture', STANDARD_JIEQI_DEAL);
  state.board = {
    e1: { color: 'red', role: 'general', faceDown: false },
    e10: { color: 'black', role: 'general', faceDown: false },
    e5: { color: 'red', role: 'soldier', faceDown: false },
    a2: { color: 'red', role: 'chariot', faceDown: false },
    a3: { color: 'black', role: 'horse', faceDown: false },
    c1: { color: 'red', role: 'cannon', faceDown: true },
    b2: { color: 'red', role: 'chariot', faceDown: false },
    b8: { color: 'black', role: 'horse', faceDown: true },
  };
  state.captures = [{ owner: 'black', role: 'elephant', revealedAtCapture: false }];
  const move = { from: 'a2', to: 'a3' } as const;
  const childFen = jieqiStateToPikafishFen(applyJieqiMove(state, move), { public: true });
  const calls: Array<{ fen: string; opts: JieqiAnalysisRequest }> = [];
  const deps = jieqiDecisionDepsFromSession(
    {
      multiPv: async () => assert.fail('new profile must not request MultiPV'),
      evaluateFen: async (fen, opts) => {
        assert.equal(opts.nodes, 50_000, 'known and dark capture ranking uses the rank budget');
        calls.push({ fen, opts });
        return { cp: 70, mate: null, best: null, depth: 3 };
      },
    },
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  const table = await deps.multiPv(jieqiStateToPikafishFen(state, { public: true }), {
    fen: 'old anchor',
    moves: ['e0e1'],
  });
  const capture = calls.filter((call) => call.fen === childFen);
  assert.equal(capture.length, 1);
  assert.deepEqual(capture[0]!.opts.moves, []);
  assert.equal(table.find((line) => line.move === jieqiMoveToPikafishUci(move))?.cp, -70);
  const darkCapture = { from: 'b2', to: 'b8' } as const;
  assert.equal(isJieqiChanceMove(state, darkCapture), true);
  const darkChildFen = jieqiStateToPikafishFen(applyJieqiMove(state, darkCapture), {
    public: true,
  });
  const darkCalls = calls.filter((call) => call.fen === darkChildFen);
  assert.equal(darkCalls.length, 1, 'face-up capture of a dark piece has one pool-mean term');
  assert.deepEqual(darkCalls[0]!.opts.moves, []);
  assert.equal(
    table.find((line) => line.move === jieqiMoveToPikafishUci(darkCapture))?.win,
    winPercent(-70, null, ABJCHESS_20261031_WIN_PCT_K),
  );
});

test('legacy decision profiles still request MultiPV 12 with their original budget', async () => {
  const fen = jieqiStateToPikafishFen(createInitialJieqiState('legacy', STANDARD_JIEQI_DEAL));
  const calls: unknown[] = [];
  const deps = jieqiDecisionDepsFromSession(
    {
      evaluateFen: async (requestedFen, opts) => {
        calls.push({ fen: requestedFen, opts });
        return { cp: 0, mate: null, best: null, depth: 16 };
      },
      multiPv: async (requestedFen, opts) => {
        calls.push({ fen: requestedFen, opts });
        return [];
      },
    },
    PIKAFISH_JIEQI_ANALYSIS_PROFILE,
  );
  await deps.multiPv(fen, { fen: 'anchor', moves: ['e0e1'] });
  await deps.evalPosition(fen, { fen: 'child anchor', moves: ['e9e8'] });
  assert.deepEqual(calls, [
    {
      fen: 'anchor',
      opts: {
        depth: 16,
        movetimeMs: 6_000,
        multiPv: 12,
        moves: ['e0e1'],
        fresh: true,
      },
    },
    {
      fen: 'child anchor',
      opts: { depth: 16, movetimeMs: 6_000, moves: ['e9e8'], fresh: true },
    },
  ]);
});

test('AB-JChess-20261031 budgets use 500k sweep, 2M re-search, 50k ranking and 200k decisions', () => {
  const profile = ABJCHESS_JIEQI_ANALYSIS_PROFILE;
  assert.equal(profile.sweepNodes, 500_000);
  assert.equal(profile.researchNodes, 2_000_000);
  assert.equal(profile.movetimeCapMs, 30_000);
  assert.equal(profile.decisionCandidates, 'legal-moves');
  assert.deepEqual(profile.decisionEval, { nodes: 200_000, movetimeMs: 30_000 });
  assert.deepEqual(profile.decisionRank, { nodes: 50_000, movetimeMs: 30_000 });
  assert.ok(profile.decisionsEngineId.includes('+nodes200000+rank50000+'));
  assert.equal(PIKAFISH_JIEQI_ANALYSIS_PROFILE.decisionCandidates, 'multipv');
  assert.equal(PIKAFISH_JIEQI_ANALYSIS_PROFILE.sweepNodes, 500_000);
  assert.equal(PIKAFISH_JIEQI_ANALYSIS_PROFILE.researchNodes, 2_000_000);
  assert.equal(PIKAFISH_JIEQI_ANALYSIS_PROFILE.movetimeCapMs, 6_000);
  assert.deepEqual(PIKAFISH_JIEQI_ANALYSIS_PROFILE.decisionEval, { depth: 16, movetimeMs: 6_000 });
  assert.equal(PIKAFISH_JIEQI_ANALYSIS_PROFILE.decisionRank, undefined);
});

// A fake UCI engine that logs each spawn and each `go` to a file, answers every search
// with one scored line, and advertises the options the analysis handshake sets.
const countingBin = join(fixtureDir, 'counting-engine.mjs');
writeFileSync(
  countingBin,
  `#!/usr/bin/env node
import fs from 'node:fs';
const log = process.env.JIEQI_TEST_ENGINE_LOG;
fs.appendFileSync(log, 'spawn\\n');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line === 'uci') {
      process.stdout.write('option name Hash type spin default 16 min 1 max 1024\\n');
      process.stdout.write('option name Threads type spin default 1 min 1 max 64\\n');
      process.stdout.write('option name MultiPV type spin default 1 min 1 max 128\\n');
      process.stdout.write('uciok\\n');
    }
    if (line === 'isready') process.stdout.write('readyok\\n');
    if (line.startsWith('go')) {
      fs.appendFileSync(log, 'go\\n');
      process.stdout.write('info depth 3 score cp 25\\nbestmove (none)\\n');
    }
  }
});
`,
);
chmodSync(countingBin, 0o755);

test('the decisions pass runs every eval through ONE engine process', async () => {
  const log = join(fixtureDir, `engine-log-${Date.now()}`);
  writeFileSync(log, '');
  const moves = playGame(STANDARD_JIEQI_DEAL, 6);
  assert.ok(jieqiChancePlies(moves, STANDARD_JIEQI_DEAL).length >= 2, 'fixture has reveals');
  const decisions = await withEnv(
    { MISTBOARD_PIKAFISH_PATH: countingBin, JIEQI_TEST_ENGINE_LOG: log },
    () =>
      analyzeJieqiDecisions(
        moves,
        STANDARD_JIEQI_DEAL,
        undefined,
        undefined,
        PIKAFISH_JIEQI_ANALYSIS_PROFILE,
      ),
  );
  appendFileSync(log, '');
  const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const spawns = lines.filter((l) => l === 'spawn').length;
  const gos = lines.filter((l) => l === 'go').length;
  assert.ok(decisions.length >= 2);
  assert.ok(gos > decisions.length, `many evals ran (${gos})`);
  assert.equal(spawns, 1, `one process for ${gos} evals`);
  // And the numbers came from that engine: the fake's +25 for the side to move.
  for (const d of decisions) assert.ok(Math.abs(d.playedWin - winPercent(-25, null)) < 1e-6);
});
