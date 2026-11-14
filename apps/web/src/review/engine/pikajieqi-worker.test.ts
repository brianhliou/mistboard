import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const assets = resolve(__dirname, '../../../public/engine/pikafish-jieqi');
const read = (file: string) => readFileSync(resolve(assets, file));

describe('pinned jieqi NNUE worker', () => {
  it('uses the versioned generated JS as its pthread entry point', async () => {
    let receive: (event: { data: unknown }) => Promise<void> = async () => {};
    const initialize = vi.fn();
    const command = vi.fn();
    const cwrap = vi.fn((name: string) => (name === 'pikajieqi_initialize' ? initialize : command));
    const moduleFactory = vi.fn(async (_options: unknown) => ({ cwrap }));
    const postMessage = vi.fn();
    const importScripts = vi.fn();
    runInNewContext(read('worker.js').toString(), {
      self: {
        PikaJieQi: moduleFactory,
        postMessage,
        addEventListener: (_: string, fn: typeof receive) => {
          receive = fn;
        },
      },
      importScripts,
    });
    const jsUrl = 'http://localhost/engine/pikafish-jieqi/pikajieqi.js?v=fd1a6f82-emsdk3174-nnue1';
    const wasmUrl =
      'http://localhost/engine/pikafish-jieqi/pikajieqi.wasm?v=fd1a6f82-emsdk3174-nnue1';
    await receive({ data: { type: 'init', jsUrl, wasmUrl } });
    expect(importScripts).toHaveBeenCalledWith(jsUrl);
    const config = moduleFactory.mock.calls[0]?.[0] as unknown as {
      mainScriptUrlOrBlob: string;
      locateFile: (file: string) => string;
    };
    expect(config.mainScriptUrlOrBlob).toBe(jsUrl);
    expect(config.locateFile('pikajieqi.wasm')).toBe(wasmUrl);
    expect(initialize).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
    await receive({ data: { type: 'command', command: 'go depth 4' } });
    expect(command).toHaveBeenCalledWith('go depth 4');
  });

  it('ships the supplied NNUE artifacts and both engine and net licenses', () => {
    // Pinned bytes, not a source-code assertion: catches stale/mixed build copies.
    const hashes: Record<string, string> = {
      'pikajieqi.js': '070d4de390bb2fd35cb6c955ce8011fea49272fb842a1c92aa1d51c05e380e8e',
      'pikajieqi.wasm': '1af057339c17986a71476db8e5de42b7ed30d4fdb89b22f8b51396e164f0821b',
    };
    for (const [file, hash] of Object.entries(hashes)) {
      expect(createHash('sha256').update(read(file)).digest('hex')).toBe(hash);
    }
    expect(read('COPYING.txt').toString()).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(read('jieqi-net-LICENSE').toString()).toContain('MIT License');
  });
});
