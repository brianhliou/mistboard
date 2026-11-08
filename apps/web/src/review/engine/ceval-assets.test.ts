import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_BASE = '/engine/fairy-stockfish/';
const DEFAULT_VERSION = '1.1.12-atomic1-fortress2-crazyhouse1';
const DEFAULT_INIS = ['fortress-xiangqi.ini', 'atomic-xiangqi.ini', 'crazyhouse-xiangqi.ini'];
const CUSTOM_ASSETS = {
  baseUrl: '/engine/fsf-test',
  version: 'test build+1',
  variantInis: ['test.ini'],
};

class FakeEngine {
  readonly commands: string[] = [];
  readonly FS = { writeFile: vi.fn() };
  private listeners = new Set<(line: string) => void>();

  addMessageListener(listener: (line: string) => void): void {
    this.listeners.add(listener);
  }

  postMessage(command: string): void {
    this.commands.push(command);
    queueMicrotask(() => {
      if (command === 'uci') this.emit('uciok');
      if (command === 'isready') this.emit('readyok');
      if (command.startsWith('go depth')) {
        this.emit('info depth 4 seldepth 6 multipv 1 score cp 31 nodes 900 nps 45000 pv a1a2');
        this.emit('bestmove a1a2');
      }
    });
  }

  private emit(line: string): void {
    for (const listener of this.listeners) listener(line);
  }
}

function installLoader(failScript?: 'error' | 'missing-global') {
  const scripts: string[] = [];
  const loads: Array<{
    script: string;
    locateFile: (file: string) => string;
    raw: FakeEngine;
  }> = [];
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
  vi.stubGlobal('Stockfish', undefined);
  const fetchMock = vi.fn(async (url: string) => ({ text: async () => `ini:${url}` }));
  vi.stubGlobal('fetch', fetchMock);
  // The script loader and UCI transport are fakes; no network or WASM is used.
  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    const script = node as HTMLScriptElement;
    const src = script.getAttribute('src')!;
    scripts.push(src);
    queueMicrotask(() => {
      if (!src.startsWith(DEFAULT_BASE) && failScript === 'error') {
        script.dispatchEvent(new Event('error'));
        return;
      }
      if (src.startsWith(DEFAULT_BASE) || failScript !== 'missing-global') {
        vi.stubGlobal('Stockfish', async (options: { locateFile: (file: string) => string }) => {
          const raw = new FakeEngine();
          loads.push({ script: src, locateFile: options.locateFile, raw });
          return raw;
        });
      }
      script.dispatchEvent(new Event('load'));
    });
    return node;
  });
  return { scripts, loads, fetchMock };
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Fairy-Stockfish asset selection', () => {
  it('keeps every existing FSF consumer on the versioned patched build and classical UCI path', async () => {
    const { scripts, loads, fetchMock } = installLoader();
    const { createCeval, preloadEngine } = await import('./ceval.js');
    const variants = ['fortressxiangqi', 'atomicxiangqi', 'crazyhousexiangqi', 'chess'] as const;
    const handles = variants.map((variant) => createCeval(variant));
    await Promise.all([preloadEngine(), ...handles.map((handle) => handle.preload())]);
    expect(scripts).toEqual([`${DEFAULT_BASE}stockfish.js?v=${DEFAULT_VERSION}`]);
    expect(loads).toHaveLength(1);
    const { raw, locateFile } = loads[0]!;
    for (const file of ['stockfish.wasm', 'stockfish.worker.js']) {
      expect(locateFile(file)).toBe(`${DEFAULT_BASE}${file}?v=${DEFAULT_VERSION}`);
    }
    const urls = DEFAULT_INIS.map((file) => `${DEFAULT_BASE}${file}?v=${DEFAULT_VERSION}`);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(urls);
    expect(raw.FS.writeFile).toHaveBeenCalledWith(
      'variants.ini',
      urls.map((url) => `ini:${url}`).join('\n\n'),
    );
    expect(raw.commands).toEqual([
      'uci',
      'setoption name Threads value 3',
      'setoption name Hash value 64',
      'setoption name VariantPath value variants.ini',
      'isready',
    ]);
    for (const handle of handles) {
      const result = await handle.evaluate({ movesUci: ['a1a2'], multiPv: 2, maxDepth: 4 });
      expect(raw.commands).toContain(`setoption name UCI_Variant value ${handle.variant}`);
      expect(raw.commands).toContain('setoption name Use NNUE value false');
      expect(raw.commands).toContain('setoption name MultiPV value 2');
      expect(raw.commands).toContain('position startpos moves a1a2');
      expect(raw.commands).toContain('go depth 4');
      expect(result.lines[0]).toMatchObject({ scoreCp: 31, pvUci: ['a1a2'] });
      handle.dispose();
    }
  });

  it('uses the selected directory, version and INIs for every asset and preload', async () => {
    const { scripts, loads, fetchMock } = installLoader();
    const { createCeval, preloadEngine } = await import('./ceval.js');
    const handle = createCeval('chess', CUSTOM_ASSETS);
    await Promise.all([preloadEngine(CUSTOM_ASSETS), handle.preload()]);
    expect(scripts).toEqual(['/engine/fsf-test/stockfish.js?v=test%20build%2B1']);
    expect(loads).toHaveLength(1);
    expect(loads[0]!.locateFile('stockfish.wasm')).toBe(
      '/engine/fsf-test/stockfish.wasm?v=test%20build%2B1',
    );
    expect(loads[0]!.locateFile('stockfish.worker.js')).toBe(
      '/engine/fsf-test/stockfish.worker.js?v=test%20build%2B1',
    );
    expect(fetchMock.mock.calls).toEqual([['/engine/fsf-test/test.ini?v=test%20build%2B1']]);
    expect(loads[0]!.raw.FS.writeFile).toHaveBeenCalledWith(
      'variants.ini',
      'ini:/engine/fsf-test/test.ini?v=test%20build%2B1',
    );
    handle.dispose();
  });

  it('isolates concurrently loaded builds and reuses only matching selections', async () => {
    const { scripts, loads } = installLoader();
    const { createCeval } = await import('./ceval.js');
    const original = createCeval('chess');
    const custom = createCeval('chess', CUSTOM_ASSETS);
    await Promise.all([original.preload(), custom.preload()]);
    expect(scripts).toHaveLength(2);
    expect(loads.map((load) => load.script)).toEqual(scripts);
    expect(loads[0]!.locateFile('stockfish.wasm')).toContain(DEFAULT_BASE);
    expect(loads[1]!.locateFile('stockfish.wasm')).toContain('/engine/fsf-test/');
    await original.evaluate({ movesUci: [], maxDepth: 4 });
    expect(loads[0]!.raw.commands).toContain('go depth 4');
    expect(loads[1]!.raw.commands).not.toContain('go depth 4');
    await custom.evaluate({ initialFen: 'custom fen', movesUci: [], maxDepth: 4 });
    expect(loads[1]!.raw.commands).toContain('position fen custom fen');
    expect(loads[0]!.raw.commands).not.toContain('position fen custom fen');
    await createCeval('atomicxiangqi').preload();
    await createCeval('chess', { ...CUSTOM_ASSETS, baseUrl: '/engine/fsf-test/' }).preload();
    expect(loads).toHaveLength(2);
    expect(scripts).toHaveLength(2);
    original.dispose();
    custom.dispose();
  });

  it('snapshots a handle selection before the caller can mutate its configuration', async () => {
    const { scripts, fetchMock } = installLoader();
    const { createCeval } = await import('./ceval.js');
    const assets = { ...CUSTOM_ASSETS, variantInis: [...CUSTOM_ASSETS.variantInis] };
    const handle = createCeval('chess', assets);
    assets.baseUrl = '/engine/another-build';
    assets.version = 'changed';
    assets.variantInis.push('another.ini');
    await handle.preload();
    expect(scripts).toEqual(['/engine/fsf-test/stockfish.js?v=test%20build%2B1']);
    expect(fetchMock.mock.calls).toEqual([['/engine/fsf-test/test.ini?v=test%20build%2B1']]);
    handle.dispose();
  });

  it('separates INI configurations on the same build and cache versions in the same directory', async () => {
    const { scripts, loads } = installLoader();
    const { createCeval } = await import('./ceval.js');
    await createCeval('chess', CUSTOM_ASSETS).preload();
    await createCeval('chess', { ...CUSTOM_ASSETS, variantInis: [] }).preload();
    await createCeval('chess', { ...CUSTOM_ASSETS, version: 'next' }).preload();
    expect(scripts).toHaveLength(2);
    expect(loads).toHaveLength(3);
    expect(loads[0]!.raw.FS.writeFile).toHaveBeenCalledWith('variants.ini', expect.any(String));
    expect(loads[1]!.raw.FS.writeFile).not.toHaveBeenCalled();
    expect(loads[1]!.raw.commands).not.toContain('setoption name VariantPath value variants.ini');
    expect(loads[2]!.locateFile('stockfish.wasm')).toBe('/engine/fsf-test/stockfish.wasm?v=next');
  });

  it.each(['error', 'missing-global'] as const)(
    'rejects a selected script with %s instead of borrowing a previously loaded factory',
    async (failure) => {
      const { loads } = installLoader(failure);
      const { createCeval } = await import('./ceval.js');
      const original = createCeval('chess');
      await original.preload();
      await expect(createCeval('chess', CUSTOM_ASSETS).preload()).rejects.toThrow('ceval:');
      expect((await original.evaluate({ movesUci: [], maxDepth: 4 })).lines[0]?.scoreCp).toBe(31);
      expect(loads).toHaveLength(1);
      original.dispose();
    },
  );

  it('loads nothing on a page without cross-origin isolation', async () => {
    const { scripts, fetchMock } = installLoader();
    vi.stubGlobal('crossOriginIsolated', false);
    const { createCeval } = await import('./ceval.js');
    await expect(createCeval('chess', CUSTOM_ASSETS).preload()).rejects.toThrow(
      'ceval_unsupported',
    );
    expect(scripts).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
