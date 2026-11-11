// The in-browser MistyBanqi takes the game's no-progress draw limit: a 60-ply game's
// review must not score plies 40-60 as already drawn, and a pre-2026-10-17 game still
// draws at 40. Two halves: the ceval posts the limit to the worker, and the vendored
// wasm the worker runs actually searches under it.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type BanqiGameState, banqiStateToEngineFen } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MistyCeval, parseMistyUpdate } from './misty-ceval.js';

const PKG = `${resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/engine/misty-banqi')}/`;

type Posted = Record<string, unknown>;

// A Worker that answers init with ready and every search with an empty result,
// recording what the ceval posted.
function stubWorker(posted: Posted[]) {
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    private listeners: Array<(event: MessageEvent) => void> = [];
    addEventListener(_type: string, fn: (event: MessageEvent) => void) {
      this.listeners.push(fn);
    }
    removeEventListener(_type: string, fn: (event: MessageEvent) => void) {
      this.listeners = this.listeners.filter((l) => l !== fn);
    }
    postMessage(msg: Posted) {
      posted.push(msg);
      const reply =
        msg.type === 'init'
          ? { type: 'ready' }
          : { type: 'result', id: msg.id, json: '{"depth":1,"nodes":1,"lines":[]}' };
      queueMicrotask(() => {
        const event = { data: reply } as MessageEvent;
        for (const l of [...this.listeners]) l(event);
        this.onmessage?.(event);
      });
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', FakeWorker);
}

afterEach(() => vi.unstubAllGlobals());

describe('MistyCeval posts the no-progress limit', () => {
  it('sends the limit on a one-shot analyze when the request sets it', async () => {
    const posted: Posted[] = [];
    stubWorker(posted);
    const ceval = new MistyCeval('banqi');
    await ceval.evaluate({ movesUci: [], initialFen: 'x r - 0 1', noProgressLimit: 60 });
    const analyze = posted.find((m) => m.type === 'analyze');
    expect(analyze?.noProgressLimit).toBe(60);
  });

  it('sends no limit field when the request sets none (the engine keeps its default)', async () => {
    const posted: Posted[] = [];
    stubWorker(posted);
    const ceval = new MistyCeval('banqi');
    await ceval.evaluate({ movesUci: [], initialFen: 'x r - 0 1' });
    const analyze = posted.find((m) => m.type === 'analyze');
    expect(analyze).toBeDefined();
    expect('noProgressLimit' in (analyze ?? {})).toBe(false);
  });

  it('sends the limit on the first continuous-analysis step', async () => {
    const posted: Posted[] = [];
    stubWorker(posted);
    const ceval = new MistyCeval('banqi');
    const done = ceval.evaluate({
      movesUci: [],
      initialFen: 'x r - 0 1',
      effort: 'infinite',
      noProgressLimit: 40,
      onUpdate: () => ceval.stop(),
    });
    await done;
    const step = posted.find((m) => m.type === 'step');
    expect(step?.noProgressLimit).toBe(40);
  });
});

// Red: general and two chariots; Black: a lone soldier. Red is winning outright, so
// the score only reads as a draw when the clock (45) has already passed the limit.
function winningAtClock45(): BanqiGameState {
  return {
    id: 'limit',
    board: {
      a1: { color: 'red', role: 'general', faceDown: false },
      b1: { color: 'red', role: 'chariot', faceDown: false },
      a2: { color: 'red', role: 'chariot', faceDown: false },
      h4: { color: 'black', role: 'soldier', faceDown: false },
    },
    status: { type: 'playing', turn: 'red' },
    ply: 60,
    firstColor: 'red',
    moveNumber: 30,
    noProgressClock: 45,
    repCounts: {},
    captures: [],
  };
}

describe('the vendored MistyBanqi wasm searches under the limit', () => {
  it('scores clock 45 as a draw under 40 and as a win under 60', async () => {
    const glue = (await import(pathToFileURL(`${PKG}banqi_wasm.js`).href)) as {
      initSync: (arg: { module: BufferSource }) => unknown;
      analyze: (fen: string, nodes: number, multipv: number) => string;
      analyze_with_limit: (fen: string, nodes: number, multipv: number, limit: number) => string;
    };
    glue.initSync({ module: readFileSync(`${PKG}banqi_wasm_bg.wasm`) });
    const fen = banqiStateToEngineFen(winningAtClock45());
    const cp = (json: string) => parseMistyUpdate(json, 1).lines[0]?.scoreCp ?? null;

    const under40 = cp(glue.analyze_with_limit(fen, 20_000, 1, 40));
    const under60 = cp(glue.analyze_with_limit(fen, 20_000, 1, 60));
    const byDefault = cp(glue.analyze(fen, 20_000, 1));
    expect(under40).not.toBeNull();
    expect(under40!).toBeLessThanOrEqual(0); // drawn (minus contempt)
    expect(under60!).toBeGreaterThan(200);
    expect(byDefault).toBe(under40); // analyze() keeps the engine's 40
  });
});
