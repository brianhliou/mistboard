// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RAPFI_LEVELS, Rapfi, type RapfiPosition, type RapfiTransport } from './rapfi.js';

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

describe('Rapfi SIMD WASM (#762)', () => {
  it('loads the pinned WASM and takes a win in one', async () => {
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
      1,
    );
    expect(result.move).toEqual({ x: 8, y: 7 });
  });

  it('blocks an opponent open four (either end; the position is a forced loss)', async () => {
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
      1,
    );
    expect([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
    ]).toContainEqual(result.move);
  });

  it('returns legal moves for 20 fixed positions at all five node limits', async () => {
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
    for (const tier of RAPFI_LEVELS) {
      const times: number[] = [];
      for (const count of counts) {
        const stones = moves.slice(0, count).map(([x, y], ply) => ({
          x,
          y,
          player: ((ply % 2) + 1) as 1 | 2,
        }));
        expect(hasFive(stones), `fixture at ply ${count} must be playable`).toBe(false);
        const result = await engine.chooseMove(
          { stones, turn: ((count % 2) + 1) as 1 | 2 },
          tier.level,
        );
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
    }
  }, 60_000);

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

describe('Rapfi request lifecycle', () => {
  it('maps the side to move, sends a complete BOARD command and uses the level table', async () => {
    const transport = controlled();
    const pending = transport.engine.chooseMove(
      { turn: 2, stones: [{ x: 3, y: 8, player: 1 }] },
      3,
    );
    await expect(transport.engine.chooseMove({ turn: 1, stones: [] }, 1)).rejects.toThrow(
      'already searching',
    );
    transport.receive({ type: 'ready' });
    const tier = RAPFI_LEVELS.find((entry) => entry.level === 3)!;
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

  it('rejects malformed positions without allocating a worker', async () => {
    const { engine, create } = controlled();
    await expect(engine.chooseMove(position([[15, 0]], []), 1)).rejects.toThrow(
      'Invalid Rapfi stone',
    );
    await expect(engine.chooseMove(position([[7, 7]], [[7, 7]]), 1)).rejects.toThrow('Duplicate');
    await expect(engine.chooseMove({ turn: 1, stones: [] }, 6 as 1)).rejects.toThrow(
      'Unknown Rapfi level',
    );
    const full = Array.from({ length: 225 }, (_, i) => ({
      x: i % 15,
      y: Math.floor(i / 15),
      player: 1 as const,
    }));
    await expect(engine.chooseMove({ turn: 1, stones: full }, 1)).rejects.toThrow('full');
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores stale worker replies after stop and clears timers on completion', async () => {
    vi.useFakeTimers();
    const transport = controlled();
    const first = expect(
      transport.engine.chooseMove({ turn: 1, stones: [] }, 1),
    ).rejects.toMatchObject({ name: 'AbortError' });
    transport.engine.stop();
    await first;
    const next = transport.engine.chooseMove({ turn: 1, stones: [] }, 1);
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
      const pending = transport.engine.chooseMove(position([[7, 7]], []), 1);
      transport.receive({ type: 'ready' });
      transport.receive({ type: 'line', line });
      transport.receive({ type: 'done', elapsedMs: 1 });
      await expect(pending).rejects.toThrow('invalid move');
      expect(transport.terminate).toHaveBeenCalledOnce();
    },
  );

  it('cleans up initialization failure and protocol errors', async () => {
    const transport = controlled();
    const first = transport.engine.chooseMove({ turn: 1, stones: [] }, 1);
    transport.fail(new Error('WASM SIMD unavailable'));
    await expect(first).rejects.toThrow('WASM SIMD unavailable');
    const next = transport.engine.chooseMove({ turn: 1, stones: [] }, 1);
    transport.receive({ type: 'ready' });
    transport.receive({ type: 'line', line: 'ERROR invalid position' });
    await expect(next).rejects.toThrow('ERROR invalid position');
    expect(transport.terminate).toHaveBeenCalledTimes(2);
  });

  it('times out initialization and search, terminating the worker in both cases', async () => {
    vi.useFakeTimers();
    const transport = controlled();
    const init = expect(transport.engine.chooseMove({ turn: 1, stones: [] }, 1)).rejects.toThrow(
      'initialization timed out',
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await init;
    const move = expect(transport.engine.chooseMove({ turn: 1, stones: [] }, 1)).rejects.toThrow(
      'move timed out',
    );
    transport.receive({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(RAPFI_LEVELS[0].timeMs + 250);
    await move;
    expect(transport.terminate).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
