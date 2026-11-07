import assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';
import { GOMOKU_OPENINGS, type GomokuMove } from '@mistboard/game';
import type { SweepPlyEval } from './game-analysis-sweep.js';
import { VacuousAnalysisError } from './game-analysis-sweep.js';

// Final complete block recorded from pinned 1387d11 WASM, 5,000 nodes.
// The following human MESSAGE disagrees and must never replace the INFO score.
const recorded = `INFO PV 0
INFO NUMPV 1
INFO DEPTH 11
INFO SELDEPTH 10
INFO NODES 2470
INFO TOTALNODES 4370
INFO TOTALTIME 48
INFO SPEED 91041
INFO EVAL 414
INFO WINRATE 0.887953
INFO BESTLINE 5,6 5,9 6,9 6,6 6,5 4,7 9,5 4,8 7,5
INFO PV DONE
MESSAGE Depth 11-13 | Eval 446 | Time 54ms | F9
5,6`;

function fakeEngine(
  outputs: readonly string[],
  options: { hang?: boolean; failAt?: number; splitFailure?: boolean } = {},
) {
  const commands: string[] = [];
  const kills: string[] = [];
  let spawned = 0;
  let closed = 0;
  let active = 0;
  let peak = 0;
  const spawnProcess = (_bin: string, _cwd: string) => {
    spawned++;
    peak = Math.max(peak, ++active);
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let finished = false;
    let search = 0;
    let pending = '';
    const close = () => {
      if (finished) return;
      finished = true;
      closed++;
      active--;
      stdout.end();
      stderr.end();
      child.emit('close', 0, null);
    };
    const stdin = new Writable({
      write(chunk, _encoding, done) {
        pending += chunk.toString();
        const lines = pending.split('\n');
        pending = lines.pop()!;
        for (const line of lines) {
          commands.push(line);
          if (line === 'START 15') queueMicrotask(() => stdout.write('OK\n'));
          if (line === 'YXNBEST 1') {
            const index = search++;
            if (options.hang) continue;
            queueMicrotask(() => {
              if (options.failAt === index && options.splitFailure) {
                stderr.write('ER');
                stderr.write('ROR unable to ');
                stderr.write('open network\n');
                stdout.write(`${outputs[index % outputs.length]}\n`);
              } else if (options.failAt === index) stderr.write('ERROR unable to open network\n');
              else {
                // Deliberately split an INFO line across stream chunks.
                const text = `${outputs[index % outputs.length]}\n`;
                stdout.write(text.slice(0, 17));
                stdout.write(text.slice(17));
              }
            });
          }
          if (line === 'END') queueMicrotask(close);
        }
        done();
      },
    });
    Object.assign(child, {
      stdin,
      stdout,
      stderr,
      kill(signal: string) {
        kills.push(signal);
        queueMicrotask(close);
        return true;
      },
    });
    return child as ChildProcessWithoutNullStreams;
  };
  return { spawnProcess, commands, kills, counts: () => ({ spawned, closed, active, peak }) };
}

const moves: GomokuMove[] = [{ to: 'a1' }, { to: 'b1' }];
const api = () => import('./gomoku-analysis.js');

test('Gomoku sweep returns sequential N+1 recorded scores in Black POV', async () => {
  const { analyzeGomokuPostgame } = await api();
  const engine = fakeEngine([recorded]);
  const result = await analyzeGomokuPostgame(moves, undefined, engine);
  assert.deepEqual(
    result.plies.map((p) => [p.ply, p.cp, p.mate, p.best]),
    [
      [0, 414, null, 'f7'],
      [1, -414, null, 'f7'],
      [2, 414, null, 'f7'],
    ],
  );
  assert.equal(result.plies[0]!.pv?.[1], 'f10');
  assert.deepEqual(engine.counts(), { spawned: 1, closed: 1, active: 0, peak: 1 });
  assert.ok(engine.commands.includes('INFO show_detail 2'));
  assert.ok(engine.commands.includes('INFO thread_num 1'));
  const memory = Number(
    engine.commands.find((s) => s.startsWith('INFO max_memory '))?.split(' ')[2],
  );
  assert.ok(memory > 0 && memory <= 64 * 1024 * 1024);
  assert.equal(engine.commands.filter((s) => s.startsWith('INFO max_node ')).length, 1);
  assert.equal(engine.commands.filter((s) => s === 'YXNBEST 1').length, 3);
  assert.equal(engine.commands.filter((s) => s === 'YXBOARD').length, 3);
  // At White's turn, the black stone is the opponent (2), then Black is us (1).
  assert.ok(engine.commands.includes('0,0,2'));
  assert.ok(engine.commands.includes('0,0,1'));
  assert.ok(engine.commands.includes('1,0,2'));
  assert.equal(engine.commands.at(-1), 'END');
});

test('Gomoku sweep lists each board so Rapfi searches for the side to move', async () => {
  // 11-01: Rapfi searches for whoever comes after the LAST listed stone (command/gomocup.cpp
  // getPosition). Board-index order put Black's o15 last at Black's turn: it searched for White.
  const { analyzeGomokuPostgame } = await api();
  const engine = fakeEngine([recorded]);
  await analyzeGomokuPostgame([{ to: 'o15' }, { to: 'a1' }], undefined, engine);
  const boards: string[][] = [];
  for (const line of engine.commands) {
    if (line === 'YXBOARD') boards.push([]);
    else if (line === 'DONE') boards.at(-1)?.push(line);
    else if (boards.length && boards.at(-1)!.at(-1) !== 'DONE') boards.at(-1)!.push(line);
  }
  assert.deepEqual(boards, [['DONE'], ['14,14,2', 'DONE'], ['14,14,1', '0,0,2', 'DONE']]);
});

test('Gomoku sweep uses the recorded opening turn, including odd dealt stones', async () => {
  const { analyzeGomokuPostgame } = await api();
  const opening = GOMOKU_OPENINGS.find((o) => o.stones.length === 3)!;
  const engine = fakeEngine([recorded]);
  const result = await analyzeGomokuPostgame([{ to: 'a1' }], opening, engine);
  assert.deepEqual(
    result.plies.map((p) => p.cp),
    [-414, 414],
  );
  assert.equal(engine.commands.filter((s) => s === 'DONE').length, 2);
});

test('Gomoku forced-five ply distances become signed full moves in Black POV', async () => {
  const { analyzeGomokuPostgame } = await api();
  for (const [score, expected] of [
    [29997, [2, -2, 2]],
    [-29996, [-2, 2, -2]],
  ] as const) {
    const engine = fakeEngine([recorded.replace('EVAL 414', `EVAL ${score}`)]);
    const result = await analyzeGomokuPostgame(moves, undefined, engine);
    assert.deepEqual(
      result.plies.map((p) => p.mate),
      expected,
    );
    assert.ok(result.plies.every((p) => p.cp === null));
  }
});

test('Gomoku kernel terminal positions do not search or invent extra plies', async () => {
  const { analyzeGomokuPostgame } = await api();
  const line = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2', 'e1'] as const;
  const engine = fakeEngine([recorded]);
  const result = await analyzeGomokuPostgame(
    line.map((to) => ({ to })),
    undefined,
    engine,
  );
  assert.equal(result.plies.length, 10);
  assert.deepEqual(result.plies.at(-1), { ply: 9, cp: 30000, mate: null, best: null });
  assert.equal(engine.commands.filter((s) => s === 'YXNBEST 1').length, 9);
  const invalid = fakeEngine([recorded]);
  await assert.rejects(
    analyzeGomokuPostgame([{ to: 'a1' }, { to: 'a1' }], undefined, invalid),
    /illegal/i,
  );
  assert.equal(invalid.counts().spawned, 0);
});

test('Gomoku all-null, timeout and engine failures reap the process and release its slot', async () => {
  const { analyzeGomokuPostgame } = await api();
  const nulls = fakeEngine(['MESSAGE Eval 900\n5,6']);
  await assert.rejects(analyzeGomokuPostgame(moves, undefined, nulls), VacuousAnalysisError);
  assert.equal(nulls.counts().closed, 1);
  const error = fakeEngine([recorded], { failAt: 1 });
  await assert.rejects(analyzeGomokuPostgame(moves, undefined, error), /network/i);
  assert.equal(error.counts().closed, 1);
  assert.ok(error.kills.includes('SIGKILL'));
  const hung = fakeEngine([recorded], { hang: true });
  await assert.rejects(
    analyzeGomokuPostgame(moves, undefined, { ...hung, timeoutMs: 20 }),
    /timed out/i,
  );
  assert.equal(hung.counts().closed, 1);
  await assert.rejects(
    analyzeGomokuPostgame([], undefined, {
      spawnProcess() {
        throw new Error('spawn refused');
      },
    }),
    /spawn refused/,
  );
  const next = fakeEngine([recorded]);
  await analyzeGomokuPostgame([], undefined, next);
  assert.equal(next.counts().closed, 1);
});

test('Gomoku binary/cwd options support a shim without running a native process', async () => {
  const { analyzeGomokuPostgame } = await api();
  const engine = fakeEngine([recorded]);
  await analyzeGomokuPostgame([], undefined, {
    binaryPath: '/tmp/rapfi-docker-shim',
    cwd: '/tmp/rapfi-assets',
    spawnProcess(bin, cwd) {
      assert.equal(bin, '/tmp/rapfi-docker-shim');
      assert.equal(cwd, '/tmp/rapfi-assets');
      return engine.spawnProcess(bin, cwd);
    },
  });
  assert.equal(engine.counts().closed, 1);
});

test('Gomoku stderr failures remain fatal across stream chunk boundaries', async () => {
  const { analyzeGomokuPostgame } = await api();
  const engine = fakeEngine([recorded], { failAt: 0, splitFailure: true });
  await assert.rejects(analyzeGomokuPostgame([], undefined, engine), /network/i);
  assert.equal(engine.counts().closed, 1);
});

test('Gomoku concurrent sweeps share a bounded per-engine process pool', async () => {
  const { analyzeGomokuPostgame } = await api();
  const engine = fakeEngine([recorded]);
  await Promise.all([0, 1, 2].map(() => analyzeGomokuPostgame(moves, undefined, engine)));
  assert.deepEqual(engine.counts(), { spawned: 3, closed: 3, active: 0, peak: 1 });
});

test('Gomoku cache coalesces, keys engine/version/budget, and never saves all-null output', async () => {
  const { resolveGomokuAnalysis, GOMOKU_ANALYSIS_ENGINE_ID, GOMOKU_ANALYSIS_DEPTH } = await api();
  const entries = new Map<string, SweepPlyEval[]>();
  const keys: string[] = [];
  const cache = {
    async get(room: string, engine: string, budget: number) {
      return entries.get(`${room}/${engine}/${budget}`) ?? null;
    },
    async save(room: string, engine: string, budget: number, plies: SweepPlyEval[]) {
      const key = `${room}/${engine}/${budget}`;
      keys.push(key);
      entries.set(key, plies);
    },
  };
  let computed = 0;
  const analyze = async () => {
    computed++;
    await new Promise((resolve) => setImmediate(resolve));
    return {
      engineId: GOMOKU_ANALYSIS_ENGINE_ID,
      depth: GOMOKU_ANALYSIS_DEPTH,
      plies: [{ ply: 0, cp: 414, mate: null, best: 'f7' }],
    };
  };
  assert.equal(await resolveGomokuAnalysis('r', [], undefined, cache, analyze, false), null);
  const [a, b] = await Promise.all(
    [0, 1].map(() => resolveGomokuAnalysis('r', [], undefined, cache, analyze)),
  );
  assert.deepEqual(a, b);
  assert.equal(computed, 1);
  assert.equal(keys.length, 1);
  assert.match(keys[0]!, /rapfi.*@1.*1387d11.*n100000.*t5000/);
  assert.deepEqual(await resolveGomokuAnalysis('r', [], undefined, cache, analyze), a);
  assert.equal(computed, 1);
  const bad = async () => ({
    ...(await analyze()),
    plies: [{ ply: 0, cp: null, mate: null, best: 'f7' }],
  });
  await assert.rejects(
    resolveGomokuAnalysis('bad', [], undefined, cache, bad),
    VacuousAnalysisError,
  );
  assert.equal(keys.length, 1);
  assert.ok(await resolveGomokuAnalysis('bad', [], undefined, cache, analyze));
  assert.equal(keys.length, 2);
});
