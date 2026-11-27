import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { ABJCHESS_ASSET_URLS, ABJCHESS_ENGINE_ASSET_VERSION } from './abjchess-ceval.js';

const assets = resolve(__dirname, '../../../public/engine/ab-jchess');
const read = (file: string) => readFileSync(resolve(assets, file));
const recipe = readFileSync(
  resolve(__dirname, '../../../../../scripts/engine-wasm/build-ab-jchess-wasm.sh'),
  'utf8',
);
const NET_SHA256 = 'fdb6245b868bb204cf2b64fc4f8440d7a1e22b73abdd2a13dce180b65b01619e';

/** Entry names of an uncompressed ustar archive. */
function tarEntries(tar: Buffer): string[] {
  const names: string[] = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const prefix = field(345, 155);
    const name = field(0, 100);
    names.push(prefix ? `${prefix}/${name}` : name);
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

describe('AB-JChess browser worker', () => {
  it('writes the fetched net into the module filesystem before reporting ready', async () => {
    let receive: (event: { data: unknown }) => Promise<void> = async () => {};
    const command = vi.fn();
    const writeFile = vi.fn();
    const cwrap = vi.fn(() => command);
    const moduleFactory = vi.fn(async (_options: unknown) => ({ cwrap, FS: { writeFile } }));
    const postMessage = vi.fn();
    const importScripts = vi.fn();
    const net = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => net.buffer }));
    runInNewContext(read('worker.js').toString(), {
      self: {
        ABJChess: moduleFactory,
        postMessage,
        addEventListener: (_: string, fn: typeof receive) => {
          receive = fn;
        },
      },
      importScripts,
      fetch: fetchMock,
      Uint8Array,
    });
    const v = `?v=${ABJCHESS_ENGINE_ASSET_VERSION}`;
    const jsUrl = `http://localhost/engine/ab-jchess/abjchess.js${v}`;
    const wasmUrl = `http://localhost/engine/ab-jchess/abjchess.wasm${v}`;
    const netUrl = `http://localhost/engine/ab-jchess/abjchess-20261030.nnue${v}`;
    await receive({ data: { type: 'init', jsUrl, wasmUrl, netUrl } });
    expect(fetchMock).toHaveBeenCalledWith(netUrl);
    expect(importScripts).toHaveBeenCalledWith(jsUrl);
    const config = moduleFactory.mock.calls[0]?.[0] as unknown as {
      mainScriptUrlOrBlob: string;
      locateFile: (file: string) => string;
    };
    expect(config.mainScriptUrlOrBlob).toBe(jsUrl);
    expect(config.locateFile('abjchess.wasm')).toBe(wasmUrl);
    expect(writeFile).toHaveBeenCalledWith('/abjchess-20261030.nnue', net);
    expect(cwrap).toHaveBeenCalledWith('abj_command', 'number', ['string']);
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
    for (const text of ['uci', 'position fen x w - 0 1', 'go depth 4']) {
      await receive({ data: { type: 'command', command: text } });
    }
    expect(command.mock.calls).toEqual([['uci'], ['position fen x w - 0 1'], ['go depth 4']]);
  });

  it('reports a failed net download as an error, never ready', async () => {
    let receive: (event: { data: unknown }) => Promise<void> = async () => {};
    const postMessage = vi.fn();
    runInNewContext(read('worker.js').toString(), {
      self: {
        ABJChess: async () => ({ cwrap: vi.fn(), FS: { writeFile: vi.fn() } }),
        postMessage,
        addEventListener: (_: string, fn: typeof receive) => {
          receive = fn;
        },
      },
      importScripts: vi.fn(),
      fetch: async () => ({ ok: false, status: 404 }),
      Uint8Array,
    });
    await receive({ data: { type: 'init', jsUrl: 'a.js', wasmUrl: 'a.wasm', netUrl: 'n' } });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'error',
      error: 'AB-JChess net fetch failed: HTTP 404',
    });
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'ready' });
  });

  it('serves every file the client loads from the pinned build', () => {
    for (const url of Object.values(ABJCHESS_ASSET_URLS)) {
      const file = url.replace('/engine/ab-jchess/', '').replace(/\?v=.*$/, '');
      expect(() => read(file), file).not.toThrow();
    }
  });

  it('ships the pinned build, its corresponding source, the GPL and the permitted net', () => {
    // Pinned bytes, not a source-code assertion: catches stale or mixed build copies.
    const hashes: Record<string, string> = {
      'abjchess.js': 'c57f12d21a449d9d072568b19edd4b41e23f988208c662a781a2777638d40aa6',
      'abjchess.wasm': 'a7661e99df3bf790a269b808812d0366be0024b9ab7b150559d872fe6ee5dbb5',
      'abjchess-source-efc83867.tar.gz':
        'f0c6d7a62d59f4e12f255f63afbcdb29bea0f90c80943ca58c011eef76f5c071',
      'abjchess-20261030.nnue': NET_SHA256,
    };
    for (const [file, hash] of Object.entries(hashes)) {
      expect(createHash('sha256').update(read(file)).digest('hex'), file).toBe(hash);
    }
    expect(read('COPYING.txt').toString()).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(read('COPYING.txt').toString()).toContain('Version 3');

    const entries = tarEntries(gunzipSync(read('abjchess-source-efc83867.tar.gz')));
    for (const entry of [
      'ab-jchess-efc83867/LICENSE',
      'ab-jchess-efc83867/abjchess/src/uci.cpp',
      'ab-jchess-efc83867/wasm/ab-jchess-wasm-entry.patch',
      'ab-jchess-efc83867/wasm/build.sh',
      'ab-jchess-efc83867/wasm/gate.cjs',
    ]) {
      expect(entries, entry).toContain(entry);
    }
    // The net is a separate file, not part of the source archive.
    expect(entries.filter((entry) => entry.endsWith('.nnue'))).toEqual([]);
  });

  it('keeps the README, the recipe and the asset version on one commit and net', () => {
    const readme = read('README.md').toString();
    expect(readme).toContain('AB-JChess by Huorongrong and Laoxu (Kouza)');
    expect(readme).toContain('efc83867230a26bbcd4a6c4cf644b69e154b452e');
    expect(readme).toContain(NET_SHA256);
    expect(readme).toContain('https://github.com/lxsgx23/AB-JChess/issues/1');
    expect(readme).toContain('abjchess-source-efc83867.tar.gz');
    expect(readme).not.toContain('—');
    expect(recipe).toContain('efc83867230a26bbcd4a6c4cf644b69e154b452e');
    expect(recipe).toContain('emscripten/emsdk:3.1.74');
    expect(recipe).toContain(NET_SHA256);
    expect(recipe).toContain('--platform linux/amd64');
    expect(ABJCHESS_ENGINE_ASSET_VERSION).toContain('efc83867');
    expect(ABJCHESS_ENGINE_ASSET_VERSION).toContain('emsdk3174');
  });
});
