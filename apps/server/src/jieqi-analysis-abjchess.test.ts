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
  ABJCHESS_WIN_PCT_K,
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  type JieqiDeal,
  type JieqiMove,
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
  currentJieqiAnalysisProfile,
  JIEQI_ANALYSIS_ENGINE_ID,
  JIEQI_DECISIONS_ENGINE_ID,
  JIEQI_LEGACY_DECISIONS_ENGINE_IDS,
  type JieqiAnalysisCache,
  type JieqiDecision,
  type JieqiDecisionsCache,
  jieqiAnalysisRepetitionWindows,
  jieqiChancePlies,
  jieqiDeterministicPlies,
  PIKAFISH_JIEQI_ANALYSIS_PROFILE,
  resolveJieqiAnalysis,
  resolveJieqiDecisions,
} from './jieqi-analysis.js';
import {
  ABJCHESS_ENGINE_REF,
  buildJieqiAnalysisInitCommands,
  jieqiAnalysisEngine,
  jieqiAnalysisEngineAvailable,
} from './jieqi-engine.js';

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
  const net = join(fixtureDir, 'abjchess-20260911.nnue');
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
    assert.ok(id.includes('abjchess-20260911'), `${id} carries the net, so a new net re-keys`);
  }
  assert.equal(ABJCHESS_JIEQI_ANALYSIS_PROFILE.winK, ABJCHESS_WIN_PCT_K);
  assert.equal(PIKAFISH_JIEQI_ANALYSIS_PROFILE.winK, WIN_PCT_K);
});

test('an AB-JChess analysis session loads its net on a single-threaded fixed table', async () => {
  const net = join(fixtureDir, 'abjchess-20260911.nnue');
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

test('each decomposition re-key (#487 mover view, d5 capture pool) keeps the old rows served', async () => {
  // New computes file under the d5-capture ids, never under the d4 (captures graded on the
  // identity hit) or all-knowing d3 ones.
  assert.match(ABJCHESS_JIEQI_DECISIONS_ENGINE_ID, /^ab-jchess-jieqi-decisions@2\+.*\+d5-capture$/);
  assert.match(JIEQI_DECISIONS_ENGINE_ID, /^pikafish-jieqi-decisions@.*\+d5-capture$/);
  for (const legacy of JIEQI_LEGACY_DECISIONS_ENGINE_IDS) {
    assert.match(legacy, /\+(d3|d4-mover)$/);
    assert.notEqual(legacy, ABJCHESS_JIEQI_DECISIONS_ENGINE_ID);
    assert.notEqual(legacy, JIEQI_DECISIONS_ENGINE_ID);
  }
  const old: JieqiDecision[] = [
    { ply: 3, mover: 'red', bestWin: 55, playedWin: 50, realizedWin: 30, playedRank: 2 },
  ];
  for (const legacy of JIEQI_LEGACY_DECISIONS_ENGINE_IDS) {
    for (const profile of [ABJCHESS_JIEQI_ANALYSIS_PROFILE, PIKAFISH_JIEQI_ANALYSIS_PROFILE]) {
      const cache = keyedCache<JieqiDecision[]>();
      await cache.save('room-legacy', legacy, 16, old);
      let computes = 0;
      const result = await resolveJieqiDecisions(
        'room-legacy',
        [],
        STANDARD_JIEQI_DEAL,
        cache as JieqiDecisionsCache,
        async () => {
          computes += 1;
          return [];
        },
        true,
        profile,
      );
      assert.equal(result?.engineId, legacy);
      assert.deepEqual(result?.decisions, old);
      assert.equal(computes, 0);
    }
  }
  // A game with no stored row computes fresh under the new id.
  const cache = keyedCache<JieqiDecision[]>();
  const fresh = await resolveJieqiDecisions(
    'room-new',
    [],
    STANDARD_JIEQI_DEAL,
    cache as JieqiDecisionsCache,
    async () => old,
    true,
    ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  );
  assert.equal(fresh?.engineId, ABJCHESS_JIEQI_DECISIONS_ENGINE_ID);
  assert.deepEqual(cache.saved, [ABJCHESS_JIEQI_DECISIONS_ENGINE_ID]);
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
    assert.ok(Math.abs(d.playedWin - winPercent(-100, null, ABJCHESS_WIN_PCT_K)) < 1e-6);
  }
  for (const d of pika) assert.ok(Math.abs(d.playedWin - winPercent(-100, null)) < 1e-6);
});

// The re-search rule is a win% swing on the engine's own curve for AB-JChess: +100cp out of
// equality is ~23 points there (re-search) and ~9 on lila's (no re-search under 200cp).
test('the AB consistency rule triggers on a win% swing, not on 200cp', async () => {
  const moves = playGame(STANDARD_JIEQI_DEAL, 12);
  const target = jieqiDeterministicPlies(moves, STANDARD_JIEQI_DEAL)[0]!;
  const moverSign = target % 2 === 1 ? 1 : -1;
  const windows = jieqiAnalysisRepetitionWindows(moves, STANDARD_JIEQI_DEAL);
  const plyOf = new Map(windows.map((w, ply) => [`${w.fen}|${w.moves.join(',')}`, ply]));
  const run = async (profile: typeof ABJCHESS_JIEQI_ANALYSIS_PROFILE) => {
    const researched: Array<{ ply: number; nodes: number }> = [];
    await analyzeJieqiPostgame(
      moves,
      STANDARD_JIEQI_DEAL,
      async (_state, window, nodes) => {
        const ply = plyOf.get(`${window.fen}|${window.moves.join(',')}`)!;
        if (nodes !== undefined) researched.push({ ply, nodes });
        return { cp: ply >= target ? 100 * moverSign : 0, mate: null, best: null };
      },
      undefined,
      profile,
    );
    return researched;
  };
  assert.deepEqual(await run(ABJCHESS_JIEQI_ANALYSIS_PROFILE), [
    { ply: target - 1, nodes: ABJCHESS_JIEQI_ANALYSIS_PROFILE.researchNodes },
  ]);
  assert.deepEqual(await run(PIKAFISH_JIEQI_ANALYSIS_PROFILE), []);
});

// ── Decisions reuse one session ──────────────────────────────────────────────

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
