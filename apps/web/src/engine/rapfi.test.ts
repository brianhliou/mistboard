// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  parseRapfiOutput,
  RAPFI_LEVELS,
  Rapfi,
  type RapfiPosition,
  type RapfiTransport,
  rapfiGameSeed,
  rapfiPlySeed,
  selectRapfiMove,
} from './rapfi.js';

const engineDir = resolve(__dirname, '../../public/engine/rapfi');
const clients: Rapfi[] = [];
const threads: Worker[] = [];

beforeAll(() => {
  // Fresh worktrees do not track the 40 MB data file. Exercise the same verified
  // setup as predev (staged locally, release URL when one has been configured).
  execFileSync(process.execPath, [resolve(__dirname, '../../scripts/fetch-rapfi-net.mjs')]);
});

// Run the actual classic browser worker and unmodified Emscripten loader in a
// Node thread. Only browser I/O is adapted; protocol, WASM and nets are real.
function nodeTransport(): RapfiTransport {
  const thread = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads');
     const fs = require('node:fs');
     const vm = require('node:vm');
     const path = require('node:path');
     const { fileURLToPath } = require('node:url');
     const context = vm.createContext({ require, process, console, performance,
       TextDecoder, TextEncoder, setTimeout, clearTimeout, URL,
       __dirname: workerData, __filename: path.join(workerData, 'rapfi-single-simd128.js') });
     context.self = context;
     context.location = new URL('file://' + workerData + '/worker.js');
     context.postMessage = message => parentPort.postMessage(message);
     // Node's Emscripten branch reads filesystem paths, rather than file: URLs.
     context.importScripts = url => {
       vm.runInContext(fs.readFileSync(new URL(url), 'utf8'), context);
       const factory = context.Rapfi;
       context.Rapfi = options => factory({ ...options,
         locateFile: file => fileURLToPath(options.locateFile(file)) });
     };
     vm.runInContext(fs.readFileSync(path.join(workerData, 'worker.js'), 'utf8'), context);
     parentPort.on('message', data => context.onmessage({ data }));`,
    { eval: true, workerData: engineDir },
  );
  threads.push(thread);
  let onExit: ((code: number) => void) | undefined;
  return {
    listen(onMessage, onError) {
      thread.on('message', onMessage);
      thread.on('error', onError);
      onExit = (code) => onError(new Error(`Rapfi thread exited (${code})`));
      thread.on('exit', onExit);
    },
    postMessage(message) {
      thread.postMessage(message);
    },
    terminate() {
      thread.removeAllListeners('message');
      thread.removeAllListeners('error');
      if (onExit) thread.off('exit', onExit);
      void thread.terminate();
    },
  };
}

function client(): Rapfi {
  const engine = new Rapfi(nodeTransport);
  clients.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of clients.splice(0)) engine.stop();
  await Promise.all(threads.splice(0).map((thread) => thread.terminate()));
  vi.useRealTimers();
});

function position(own: [number, number][], opponent: [number, number][]): RapfiPosition {
  return {
    turn: 1,
    stones: [
      ...own.map(([x, y]) => ({ x, y, player: 1 as const })),
      ...opponent.map(([x, y]) => ({ x, y, player: 2 as const })),
    ],
  };
}

function hasFive(stones: RapfiPosition['stones']): boolean {
  return stones.some((stone) =>
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ].some(([dx, dy]) =>
      Array.from({ length: 5 }, (_, i) => i).every((i) =>
        stones.some(
          (other) =>
            other.player === stone.player &&
            other.x === stone.x + dx * i &&
            other.y === stone.y + dy * i,
        ),
      ),
    ),
  );
}

describe('Rapfi seeds', () => {
  it('reproduces a game and every ply without depending on call order', () => {
    const gameSeed = rapfiGameSeed('room-17', 20261101);
    expect(rapfiGameSeed('room-17', 20261101)).toBe(gameSeed);
    expect(rapfiGameSeed('room-17')).toBe(rapfiGameSeed('room-17', 0));
    const seeds = Array.from({ length: 225 }, (_, ply) => rapfiPlySeed(gameSeed, ply));
    expect(new Set(seeds).size).toBe(225);
    for (let ply = 224; ply >= 0; ply--) {
      expect(rapfiPlySeed(gameSeed, ply)).toBe(seeds[ply]);
      expect(seeds[ply]).toBeGreaterThanOrEqual(0);
      expect(seeds[ply]).toBeLessThanOrEqual(0xffffffff);
    }
    expect(rapfiGameSeed('room-18', 20261101)).not.toBe(gameSeed);
    expect(rapfiGameSeed('room-17', 20261102)).not.toBe(gameSeed);
    expect(rapfiPlySeed(rapfiGameSeed('room-18', 20261101), 8)).not.toBe(seeds[8]);
    // Pin browser/Node seed compatibility, including non-ASCII room identities.
    expect([gameSeed, seeds[8], rapfiGameSeed('五子棋', 0xffffffff)]).toEqual([
      2735149948, 2854282940, 2440546783,
    ]);
  });

  it('rejects seed identities or plies that would silently wrap or alias', () => {
    for (const seed of [-1, 0x100000000, 1.5, Number.NaN]) {
      expect(() => rapfiGameSeed('room', seed)).toThrow('seed');
      expect(() => rapfiPlySeed(seed, 0)).toThrow('seed');
    }
    expect(() => rapfiGameSeed('')).toThrow('identity');
    for (const ply of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => rapfiPlySeed(0, ply)).toThrow('ply');
  });
});

describe('Rapfi SIMD WASM (#762)', () => {
  it('records structured single/multi-PV output from the pinned binary via YXNBEST', async () => {
    const output: string[] = [];
    const engine = new Rapfi(() => {
      const transport = nodeTransport();
      return {
        ...transport,
        listen(onMessage, onError) {
          transport.listen((message) => {
            const event = message as { type: string; line?: string };
            if (event.type === 'line' && event.line) output.push(event.line);
            onMessage(message);
          }, onError);
        },
      };
    });
    clients.push(engine);
    const pos = position(
      [
        [7, 7],
        [8, 8],
        [6, 8],
      ],
      [
        [7, 8],
        [8, 7],
        [6, 7],
      ],
    );
    for (const candidateCount of [1, 3]) {
      output.length = 0;
      const result = await engine.chooseMove(pos, 5, { candidateCount, evalMargin: 0, seed: 42 });
      expect(result.candidates).toEqual(parseRapfiOutput(output));
      expect(result.candidates).toHaveLength(candidateCount);
      expect(result.candidates?.map(({ pvIndex }) => pvIndex)).toEqual(
        Array.from({ length: candidateCount }, (_, i) => i),
      );
      for (const candidate of result.candidates ?? []) {
        expect(candidate.move).toEqual(candidate.pv[0]);
        expect(
          pos.stones.some(({ x, y }) => x === candidate.move.x && y === candidate.move.y),
        ).toBe(false);
      }
    }
    const forced = await engine.chooseMove(
      position(
        [
          [4, 7],
          [5, 7],
          [6, 7],
          [7, 7],
        ],
        [
          [3, 7],
          [5, 8],
          [6, 8],
          [8, 9],
        ],
      ),
      1,
      { candidateCount: 3, evalMargin: 100, seed: 0 },
    );
    expect(forced.move).toEqual({ x: 8, y: 7 });
    // Rapfi may short-circuit trivial wins before emitting a structured PV.
    for (const candidate of forced.candidates ?? []) {
      if (candidate.eval >= 29775)
        expect(candidate.forcedFive).toEqual({ result: 'win', plies: 30000 - candidate.eval });
    }
  });

  it.each([1, 2, 3, 4] as const)('L%i takes a win in one with the pinned WASM', async (level) => {
    expect(readFileSync(resolve(engineDir, 'rapfi-single-simd128.wasm')).length).toBe(1_263_368);
    const pin = JSON.parse(readFileSync(resolve(engineDir, 'net.json'), 'utf8'));
    const data = readFileSync(resolve(engineDir, pin.file));
    expect(data.length).toBe(pin.bytes);
    expect(createHash('sha256').update(data).digest('hex')).toBe(pin.sha256);
    const result = await client().chooseMove(
      position(
        [
          [4, 7],
          [5, 7],
          [6, 7],
          [7, 7],
        ],
        [
          [3, 7],
          [5, 8],
          [6, 8],
          [8, 9],
        ],
      ),
      level,
    );
    expect(result.move).toEqual({ x: 8, y: 7 });
  });

  it.each([1, 2, 3, 4] as const)(
    'L%i blocks an open four (already a forced loss)',
    async (level) => {
      const result = await client().chooseMove(
        position(
          [
            [5, 8],
            [6, 9],
            [9, 9],
            [8, 10],
          ],
          [
            [4, 7],
            [5, 7],
            [6, 7],
            [7, 7],
          ],
        ),
        level,
      );
      expect([
        { x: 3, y: 7 },
        { x: 8, y: 7 },
      ]).toContainEqual(result.move);
    },
  );

  it.each(RAPFI_LEVELS)(
    'returns legal moves for 20 fixed positions at L$level',
    async (tier) => {
      const moves: [number, number][] = [
        [7, 7],
        [7, 8],
        [8, 8],
        [8, 7],
        [6, 8],
        [6, 7],
        [9, 7],
        [5, 9],
        [7, 6],
        [9, 6],
        [8, 9],
        [6, 6],
        [9, 9],
        [7, 10],
        [5, 7],
        [4, 7],
        [10, 8],
        [10, 9],
        [8, 5],
        [6, 10],
        [4, 9],
        [3, 8],
        [11, 7],
        [11, 6],
        [5, 5],
        [4, 5],
        [10, 11],
        [9, 11],
        [3, 10],
        [2, 9],
        [12, 8],
        [12, 9],
        [6, 4],
        [7, 3],
        [11, 11],
        [12, 12],
        [2, 6],
        [3, 5],
      ];
      const counts = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 30, 34, 38];
      const engine = client();
      const times: number[] = [];
      for (const count of counts) {
        const stones = moves.slice(0, count).map(([x, y], ply) => ({
          x,
          y,
          player: ((ply % 2) + 1) as 1 | 2,
        }));
        expect(hasFive(stones), `fixture at ply ${count} must be playable`).toBe(false);
        const result = await engine
          .chooseMove(
            { stones, turn: ((count % 2) + 1) as 1 | 2 },
            tier.level,
            rapfiPlySeed(rapfiGameSeed(`fixture-L${tier.level}`), count),
          )
          .catch((error: Error) => {
            throw new Error(`L${tier.level} at ply ${count}: ${error.message}`, { cause: error });
          });
        expect(result.move.x).toBeGreaterThanOrEqual(0);
        expect(result.move.x).toBeLessThan(15);
        expect(result.move.y).toBeGreaterThanOrEqual(0);
        expect(result.move.y).toBeLessThan(15);
        expect(stones.some((stone) => stone.x === result.move.x && stone.y === result.move.y)).toBe(
          false,
        );
        expect(result.elapsedMs).toBeLessThan(tier.timeMs);
        times.push(result.elapsedMs);
      }
      process.stdout.write(
        `Rapfi L${tier.level}: nodes=${tier.nodes}, mean=${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms, max=${Math.max(...times).toFixed(1)}ms\n`,
      );
    },
    60_000,
  );

  it('stop rejects pending work, terminates the worker and allows a fresh session', async () => {
    const engine = client();
    const pending = engine.chooseMove({ stones: [], turn: 1 }, 5);
    const stopped = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const exited = new Promise<void>((resolve) => threads[0].once('exit', () => resolve()));
    engine.stop();
    await stopped;
    await exited;
    expect(threads[0].threadId).toBe(-1);
    expect((await engine.chooseMove({ stones: [], turn: 1 }, 1)).move).toEqual({ x: 7, y: 7 });
    engine.stop();
    engine.stop();
  });

  it('terminates a worker with an active search and rejects its pending result', async () => {
    let searching: () => void = () => {};
    let announceSearch = false;
    const started = new Promise<void>((resolve) => {
      searching = resolve;
    });
    const engine = new Rapfi(() => {
      const transport = nodeTransport();
      return {
        ...transport,
        listen(onMessage, onError) {
          transport.listen((message) => {
            const event = message as { type: string };
            if (announceSearch && event.type === 'searching') searching();
            onMessage(message);
          }, onError);
        },
      };
    });
    clients.push(engine);
    await engine.chooseMove({ stones: [], turn: 1 }, 1);
    announceSearch = true;
    const pending = engine.chooseMove(
      position(
        [
          [7, 7],
          [8, 8],
          [6, 8],
        ],
        [
          [7, 8],
          [8, 7],
          [6, 7],
        ],
      ),
      5,
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    const exited = new Promise<void>((resolve) => threads[0].once('exit', () => resolve()));
    engine.stop();
    await rejected;
    await exited;
    expect(threads[0].threadId).toBe(-1);
  });
});

function controlled() {
  let receive: (message: unknown) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const postMessage = vi.fn();
  const terminate = vi.fn();
  const receivers: ((message: unknown) => void)[] = [];
  const create = vi.fn(() => ({
    listen(onMessage: typeof receive, onError: typeof fail) {
      receivers.push(onMessage);
      receive = onMessage;
      fail = onError;
    },
    postMessage,
    terminate,
  }));
  const engine = new Rapfi(create);
  clients.push(engine);
  return {
    engine,
    create,
    postMessage,
    terminate,
    receivers,
    receive: (data: unknown) => receive(data),
    fail: (error: Error) => fail(error),
  };
}

const tierOutput = [100, 80, 0].flatMap((ev, pvIndex) => [
  `INFO PV ${pvIndex}`,
  'INFO NUMPV 3',
  'INFO DEPTH 2',
  'INFO SELDEPTH 2',
  'INFO NODES 10',
  'INFO TOTALNODES 30',
  'INFO TOTALTIME 1',
  'INFO SPEED 30000',
  `INFO EVAL ${ev}`,
  'INFO WINRATE 0.5',
  `INFO BESTLINE ${pvIndex},0`,
  'INFO PV DONE',
]);

describe('eight Rapfi levels', () => {
  it('parses the symbolic forced-five scores emitted by real structured Rapfi output', () => {
    // Recorded from pinned 1387d11312 at the 24-stone position above.
    const recorded = [
      'INFO PV 0',
      'INFO NUMPV 1',
      'INFO DEPTH 2',
      'INFO SELDEPTH 2',
      'INFO NODES 1',
      'INFO TOTALNODES 2',
      'INFO TOTALTIME 2',
      'INFO SPEED 1000',
      'INFO EVAL +M3',
      'INFO WINRATE 1',
      'INFO BESTLINE 8,10',
      'INFO PV DONE',
    ];
    for (const [text, score] of [
      ['+M3', 29997],
      ['-M4', -29996],
    ] as const) {
      const output = recorded.map((line) =>
        line.startsWith('INFO EVAL') ? `INFO EVAL ${text}` : line,
      );
      expect(parseRapfiOutput(output)[0]).toMatchObject({
        eval: score,
        forcedFive: { result: score > 0 ? 'win' : 'loss', plies: 30000 - Math.abs(score) },
      });
      expect(parseRapfiOutput(output.join('\n'))).toEqual(parseRapfiOutput(output));
    }
    expect(
      parseRapfiOutput(
        recorded.map((line) => (line.startsWith('INFO EVAL') ? 'INFO EVAL +M226' : line)),
      ),
    ).toEqual([]);
  });

  it('uses four seeded choice tiers then four increasing best-move budgets within five seconds', async () => {
    expect(RAPFI_LEVELS.map(({ level }) => level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const candidates = parseRapfiOutput(tierOutput);
    for (const [index, tier] of RAPFI_LEVELS.entries()) {
      expect(tier.nodes).toBeGreaterThan(index ? RAPFI_LEVELS[index - 1].nodes : 0);
      expect(tier.timeMs + 250).toBeLessThanOrEqual(5000);
      const transport = controlled();
      const pos: RapfiPosition = { turn: 2, stones: [{ x: 7, y: 7, player: 1 }] };
      const seed = rapfiPlySeed(rapfiGameSeed('test-room'), 1);
      const pending = transport.engine.chooseMove(pos, tier.level, seed);
      transport.receive({ type: 'ready' });
      const commands = transport.postMessage.mock.lastCall?.[0].commands;
      const choice = tier.level <= 4;
      expect(commands.includes('INFO show_detail 2')).toBe(choice);
      if (choice) {
        expect(tier.candidateCount).toBeGreaterThan(1);
        expect(tier.evalMargin).toBeGreaterThan(0);
        expect(commands).toContain('YXBOARD\n7,7,2\nDONE');
        expect(commands.at(-1)).toBe(`YXNBEST ${tier.candidateCount}`);
        for (const line of tierOutput) transport.receive({ type: 'line', line });
      } else {
        expect(tier.candidateCount).toBeUndefined();
        expect(tier.evalMargin).toBeUndefined();
        expect(commands.at(-1)).toBe('BOARD\n7,7,2\nDONE');
      }
      transport.receive({ type: 'line', line: '2,0' });
      transport.receive({ type: 'done', elapsedMs: 1 });
      expect((await pending).move).toEqual(
        choice
          ? selectRapfiMove(pos, candidates, {
              candidateCount: tier.candidateCount!,
              evalMargin: tier.evalMargin!,
              seed,
            })
          : { x: 2, y: 0 },
      );
    }
  });
});

describe('Rapfi request lifecycle', () => {
  it('maps the side to move, sends a complete BOARD command and uses the level table', async () => {
    const transport = controlled();
    const pending = transport.engine.chooseMove(
      { turn: 2, stones: [{ x: 3, y: 8, player: 1 }] },
      5,
    );
    await expect(transport.engine.chooseMove({ turn: 1, stones: [] }, 5)).rejects.toThrow(
      'already searching',
    );
    transport.receive({ type: 'ready' });
    const tier = RAPFI_LEVELS.find((entry) => entry.level === 5)!;
    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'commands',
      commands: [
        'START 15',
        'INFO rule 0',
        `INFO max_node ${tier.nodes}`,
        `INFO timeout_turn ${tier.timeMs}`,
        'BOARD\n3,8,2\nDONE',
      ],
    });
    transport.receive({ type: 'line', line: 'MESSAGE REALTIME BEST 3,8' });
    transport.receive({ type: 'line', line: '7,7' });
    transport.receive({ type: 'done', elapsedMs: 10 });
    await expect(pending).resolves.toEqual({ move: { x: 7, y: 7 }, elapsedMs: 10 });
    expect(transport.terminate).not.toHaveBeenCalled();
  });

  it('rejects malformed positions, levels and seeds without allocating a worker', async () => {
    const { engine, create } = controlled();
    await expect(engine.chooseMove(position([[15, 0]], []), 5)).rejects.toThrow(
      'Invalid Rapfi stone',
    );
    await expect(engine.chooseMove(position([[7, 7]], [[7, 7]]), 5)).rejects.toThrow('Duplicate');
    await expect(engine.chooseMove({ turn: 1, stones: [] }, 9 as 1)).rejects.toThrow(
      'Unknown Rapfi level',
    );
    for (const level of [1, 8] as const)
      for (const seed of [-1, 0x100000000, 0.5, Number.NaN])
        await expect(engine.chooseMove({ turn: 1, stones: [] }, level, seed)).rejects.toThrow(
          'seed',
        );
    const full = Array.from({ length: 225 }, (_, i) => ({
      x: i % 15,
      y: Math.floor(i / 15),
      player: 1 as const,
    }));
    await expect(engine.chooseMove({ turn: 1, stones: full }, 5)).rejects.toThrow('full');
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores stale worker replies after stop and clears timers on completion', async () => {
    vi.useFakeTimers();
    const transport = controlled();
    const first = expect(
      transport.engine.chooseMove({ turn: 1, stones: [] }, 5),
    ).rejects.toMatchObject({ name: 'AbortError' });
    transport.engine.stop();
    await first;
    const next = transport.engine.chooseMove({ turn: 1, stones: [] }, 5);
    transport.receivers[0]({ type: 'ready' });
    expect(transport.postMessage).toHaveBeenLastCalledWith({ type: 'init' });
    transport.receive({ type: 'ready' });
    transport.receive({ type: 'line', line: '7,7' });
    transport.receive({ type: 'done', elapsedMs: 1 });
    await expect(next).resolves.toMatchObject({ move: { x: 7, y: 7 } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['15,0', '7,7', 'MESSAGE no move'])(
    'rejects illegal or missing engine output: %s',
    async (line) => {
      const transport = controlled();
      const pending = transport.engine.chooseMove(position([[7, 7]], []), 5);
      transport.receive({ type: 'ready' });
      transport.receive({ type: 'line', line });
      transport.receive({ type: 'done', elapsedMs: 1 });
      await expect(pending).rejects.toThrow('invalid move');
      expect(transport.terminate).toHaveBeenCalledOnce();
    },
  );

  it('cleans up initialization failure and protocol errors', async () => {
    const transport = controlled();
    const first = transport.engine.chooseMove({ turn: 1, stones: [] }, 5);
    transport.fail(new Error('WASM SIMD unavailable'));
    await expect(first).rejects.toThrow('WASM SIMD unavailable');
    const next = transport.engine.chooseMove({ turn: 1, stones: [] }, 5);
    transport.receive({ type: 'ready' });
    transport.receive({ type: 'line', line: 'ERROR invalid position' });
    await expect(next).rejects.toThrow('ERROR invalid position');
    expect(transport.terminate).toHaveBeenCalledTimes(2);
  });

  it('times out initialization and search, terminating the worker in both cases', async () => {
    vi.useFakeTimers();
    const transport = controlled();
    const init = expect(transport.engine.chooseMove({ turn: 1, stones: [] }, 5)).rejects.toThrow(
      'initialization timed out',
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await init;
    const move = expect(transport.engine.chooseMove({ turn: 1, stones: [] }, 5)).rejects.toThrow(
      'move timed out',
    );
    transport.receive({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(RAPFI_LEVELS[4].timeMs + 250);
    await move;
    expect(transport.terminate).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
