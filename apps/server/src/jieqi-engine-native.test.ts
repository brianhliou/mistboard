// Opt-in pinned-binary contract and timing proof. Run serially with
// MISTBOARD_TEST_JIEQI_NATIVE=1 node --import tsx --test src/jieqi-engine-native.test.ts
// from apps/server. No external net is required.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  applyJieqiMove,
  createInitialJieqiState,
  createJieqiDeal,
  getJieqiLegalMoves,
  type JieqiGameState,
  jieqiMoveToPikafishUci,
  jieqiStateToPikafishFen,
  parseJieqiFen,
} from '@mistboard/game';
import {
  buildJieqiAnalysisInitCommands,
  buildJieqiGoCommand,
  buildJieqiLiveInitCommands,
  buildJieqiPositionCommand,
  pikaJieqiPath,
} from './jieqi-engine.js';
import { UciEngineSession } from './uci-engine-harness.js';

type Position = { state: JieqiGameState; fen: string; moves: string[] };

function positions(): Position[] {
  let seed = 1104;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const result: Position[] = [];
  for (let game = 0; game < 4; game++) {
    let state = createInitialJieqiState(`native-${game}`, createJieqiDeal(random));
    let start = state;
    let moves: string[] = [];
    for (let ply = 0; ply < 100 && state.status.type === 'playing'; ply++) {
      const legal = getJieqiLegalMoves(state);
      if (!legal.length) break;
      if (ply % 3 === 0) {
        result.push({
          state,
          fen: jieqiStateToPikafishFen(start, { viewer: state.status.turn }),
          moves: [...moves],
        });
      }
      const quiet = legal.filter((m) => !state.board[m.from]?.faceDown && !state.board[m.to]);
      const candidates = ply % 3 !== 0 && quiet.length ? quiet : legal;
      const move = candidates[Math.floor(random() * candidates.length)]!;
      const irreversible = state.board[move.from]?.faceDown || state.board[move.to];
      state = applyJieqiMove(state, move);
      if (irreversible) {
        start = state;
        moves = [];
      } else moves.push(jieqiMoveToPikafishUci(move));
    }
  }
  // Public review pools can exceed the remaining dark pieces after a dark capture.
  const publicCase = result.find((p) => p.state.captures.some((c) => !c.revealedAtCapture));
  assert.ok(publicCase, 'the corpus must cover captured face-down pieces');
  result.push({
    state: publicCase.state,
    fen: jieqiStateToPikafishFen(publicCase.state, { public: true }),
    moves: [],
  });
  // Fully revealed, legal endgame ensures every zero count is sent to the parser.
  const parsed = parseJieqiFen('4k4/9/9/9/4P4/9/9/9/9/4K4 w R0A0C0P0N0B0r0a0c0p0n0b0 0 1');
  assert.ok(parsed.ok);
  result.push({
    state: parsed.state,
    fen: jieqiStateToPikafishFen(parsed.state, { public: true }),
    moves: [],
  });
  return result;
}

test('native proof corpus covers counted roles, zeros, public pools and quiet history', (t) => {
  const corpus = positions();
  t.diagnostic(
    JSON.stringify({
      positions: corpus.length,
      withQuietHistory: corpus.filter((p) => p.moves.length > 0).length,
      maxQuietPlies: Math.max(...corpus.map((p) => p.moves.length)),
    }),
  );
  assert.ok(corpus.length >= 100, `only ${corpus.length} positions`);
  assert.ok(new Set(corpus.map((p) => buildJieqiPositionCommand(p.fen, p.moves))).size >= 100);
  assert.ok(corpus.some((p) => p.moves.length >= 2));
  for (const { fen } of corpus) {
    assert.match(fen.split(' ')[2]!, /^R\d+A\d+C\d+P\d+N\d+B\d+r\d+a\d+c\d+p\d+n\d+b\d+$/);
    assert.equal(fen.split(' ').length, 5, 'no hidden identity field');
  }
  assert.ok(corpus.some((p) => p.fen.includes('R0A0C0P0N0B0r0a0c0p0n0b0')));
});

test('pinned NNUE binary advertises every site option', {
  skip: process.env.MISTBOARD_TEST_JIEQI_NATIVE !== '1',
  timeout: 90_000,
}, async (t) => {
  const bin = pikaJieqiPath();
  const uci = execFileSync(bin, [], { input: 'uci\nquit\n', encoding: 'utf8', timeout: 5_000 });
  assert.match(uci, /fd1a6f82/);
  assert.match(uci, /option name ChanceMix type check default true/);
  const options = new Set([...uci.matchAll(/^option name (.*?) type /gm)].map((m) => m[1]));
  const browser = readFileSync(
    new URL('../../web/src/review/engine/pikajieqi-ceval.ts', import.meta.url),
    'utf8',
  );
  const browserOptions = [...browser.matchAll(/setoption name (.*?) value /g)].map((m) => m[1]!);
  for (const command of [
    ...buildJieqiLiveInitCommands(),
    ...buildJieqiAnalysisInitCommands('pikafish-jieqi'),
    'setoption name MultiPV value 4',
    // Optional net override uses the same advertised option as the embedded net.
    'setoption name EvalFile value override.nnue',
    ...browserOptions.map((name) => `setoption name ${name} value 1`),
  ]) {
    const name = /^setoption name (.*?) value /.exec(command)?.[1];
    if (name) assert.ok(options.has(name), `unadvertised site option: ${name}`);
  }
  t.diagnostic(`uci options: ${[...options].join(', ')}`);
});

test('pinned NNUE binary obeys both search limits on masked positions', {
  skip: process.env.MISTBOARD_TEST_JIEQI_NATIVE !== '1',
  timeout: 90_000,
}, async (t) => {
  const bin = pikaJieqiPath();
  const session = new UciEngineSession({
    bin,
    initCommands: [
      'uci',
      'setoption name Hash value 256',
      'setoption name Threads value 4',
      'ucinewgame',
      'isready',
    ],
    name: 'jieqi-native-proof',
  });
  const search = async (position: Position, depth?: number, movetimeMs = 200, multiPv = 1) => {
    const before = performance.now();
    const evaluation = await session.evalPosition({
      positionCommand: `setoption name MultiPV value ${multiPv}\n${buildJieqiPositionCommand(position.fen, position.moves)}`,
      goCommand: buildJieqiGoCommand({ depth, movetimeMs }),
      timeoutMs: movetimeMs + 2_000,
      timeoutMessage: 'native search exceeded movetime safety bound',
    });
    const elapsed = performance.now() - before;
    assert.ok(
      getJieqiLegalMoves(position.state).some((m) => jieqiMoveToPikafishUci(m) === evaluation.best),
      `illegal bestmove ${evaluation.best} for ${position.fen} moves ${position.moves.join(' ')}`,
    );
    return { evaluation, elapsed };
  };
  try {
    await session.ready();
    const corpus = positions();
    const elapsed: number[] = [];
    // Warm the embedded evaluator before measuring search-only latency.
    await search(corpus[0]!, 1);
    for (const position of corpus) elapsed.push((await search(position)).elapsed);
    elapsed.sort((a, b) => a - b);
    const worst = elapsed.at(-1)!;
    t.diagnostic(
      JSON.stringify({
        positions: corpus.length,
        movetimeMs: 200,
        threads: 4,
        hashMb: 256,
        medianMs: elapsed[Math.floor(elapsed.length / 2)],
        worstMs: worst,
        worstOverrunMs: Math.max(0, worst - 200),
      }),
    );
    assert.ok(worst < 500, `go movetime 200 took ${worst.toFixed(1)}ms`);
    const shallow = await search(corpus[0]!, 1, 2_000);
    assert.equal(shallow.evaluation.depth, 1);
    assert.ok(shallow.elapsed < 1_000, `depth did not bind: ${shallow.elapsed}ms`);
    const timed = await search(corpus[0]!, 100, 200);
    assert.ok(timed.evaluation.depth < 100);
    assert.ok(timed.elapsed < 500, `movetime did not bind: ${timed.elapsed}ms`);
    // Level 1's MultiPV path must also complete with this binary.
    const level1 = await search(corpus[0]!, 5, 50, 4);
    t.diagnostic(JSON.stringify({ depthFirst: shallow, timeFirst: timed, level1 }));
  } finally {
    session.close();
  }
});

test('pinned NNUE binary matches the default bench signature', {
  skip: process.env.MISTBOARD_TEST_JIEQI_NATIVE !== '1',
  timeout: 20_000,
}, (t) => {
  const bin = pikaJieqiPath();
  const bench = spawnSync(bin, ['bench'], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(bench.status, 0, bench.error?.message);
  const signature = /Nodes searched\s*:\s*(\d+)/.exec(bench.stderr)?.[1];
  t.diagnostic(`default bench: ${signature} nodes`);
  assert.equal(signature, '469838');
});
