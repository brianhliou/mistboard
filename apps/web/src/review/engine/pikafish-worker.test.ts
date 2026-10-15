// The Pikafish worker (public/engine/pikafish/worker.js) is a plain script the
// browser loads as-is, so it runs here in a fresh vm context with a fake worker
// global: a net fetch, Cache Storage, and an Emscripten factory that records
// what was written to its filesystem (#537).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

const WORKER_SOURCE = readFileSync(
  resolve(__dirname, '../../../public/engine/pikafish/worker.js'),
  'utf8',
);
const ORIGIN = 'https://mistboard.test';
const NET = new Uint8Array([7, 1, 2, 3, 4, 5, 6, 9]);

type Message = { type: string; [key: string]: unknown };

function fakeCacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  const abs = (key: string | Request) =>
    new URL(typeof key === 'string' ? key : key.url, ORIGIN).href;
  return {
    stores,
    open: async (name: string) => {
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      const entries = store;
      return {
        match: async (key: string) => entries.get(abs(key))?.clone(),
        put: async (key: string, response: Response) => {
          entries.set(abs(key), response);
        },
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
        delete: async (key: Request) => entries.delete(abs(key)),
      };
    },
  };
}

async function runInit(netUrl: string, caches: ReturnType<typeof fakeCacheStorage> | undefined) {
  const messages: Message[] = [];
  const fetched: string[] = [];
  const written: Uint8Array[] = [];
  type Listener = (event: { data: unknown }) => Promise<void>;
  const registered: { listener?: Listener } = {};
  const self: Record<string, unknown> = {
    caches,
    location: { href: `${ORIGIN}/engine/pikafish/worker.js?v=a` },
    postMessage: (message: Message) => messages.push(message),
    addEventListener: (_type: string, fn: Listener) => {
      registered.listener = fn;
    },
    fetch: async (url: string) => {
      fetched.push(url);
      return new Response(NET.slice(), { headers: { 'content-length': String(NET.length) } });
    },
    importScripts: () => {
      self.Pikafish = async () => ({
        FS: { writeFile: (_path: string, bytes: Uint8Array) => written.push(bytes) },
        cwrap: () => () => {},
      });
    },
  };
  const context = vm.createContext({
    self,
    fetch: self.fetch,
    importScripts: self.importScripts,
    Response,
    Request,
    URL,
    Error,
  });
  vm.runInContext(WORKER_SOURCE, context);
  await registered.listener?.({
    data: { type: 'init', jsUrl: 'pikafish.js', wasmUrl: 'x.wasm', netUrl },
  });
  // The cache write runs in the background after `ready`.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { messages, fetched, written };
}

const netUrl = (version: string) => `/engine/pikafish/pikafish.nnue?v=${version}`;

describe('pikafish worker net cache (#537)', () => {
  let caches: ReturnType<typeof fakeCacheStorage>;
  beforeEach(() => {
    caches = fakeCacheStorage();
  });

  it('fetches the net once and loads it from Cache Storage on the next visit', async () => {
    const first = await runInit(netUrl('a'), caches);
    expect(first.fetched).toEqual([netUrl('a')]);
    expect(first.messages.some((m) => m.type === 'net-progress')).toBe(true);
    expect(first.messages.at(-1)?.type).toBe('ready');

    const second = await runInit(netUrl('a'), caches);
    expect(second.fetched).toEqual([]);
    // A cached read is not a download: no byte counter in the panel.
    expect(second.messages.some((m) => m.type === 'net-progress')).toBe(false);
    expect([...second.written[0]]).toEqual([...NET]);
    expect(second.messages.find((m) => m.type === 'net-written')?.source).toBe('cache');
    expect(second.messages.at(-1)?.type).toBe('ready');
  });

  it('treats a new asset version as a miss and drops the old net', async () => {
    await runInit(netUrl('a'), caches);
    const bumped = await runInit(netUrl('b'), caches);
    expect(bumped.fetched).toEqual([netUrl('b')]);
    const [store] = [...caches.stores.values()];
    expect([...store.keys()]).toEqual([`${ORIGIN}${netUrl('b')}`]);
  });

  it('falls back to the network when Cache Storage is unavailable', async () => {
    const run = await runInit(netUrl('a'), undefined);
    expect(run.fetched).toEqual([netUrl('a')]);
    expect([...run.written[0]]).toEqual([...NET]);
    expect(run.messages.at(-1)?.type).toBe('ready');
  });
});
