/* Pikafish browser UCI worker. The generated Emscripten module reuses this
 * script URL for its pthread workers through mainScriptUrlOrBlob.
 *
 * init: { type: 'init', jsUrl, wasmUrl, netUrl }
 *   Loads the NNUE net first (from Cache Storage, else the network, with
 *   progress messages carrying loaded/total bytes), writes it into the
 *   module's in-memory filesystem as /pikafish.nnue, then builds the engine,
 *   whose default EvalFile resolves to that path.
 * command: { type: 'command', command } — one UCI line. */

let command = null;

// The net is 51 MB. Until #537 it came only through the HTTP cache, and the
// stream below reported byte progress either way, so a disk-cache read counted
// "6 / 51 … 51 / 51 MB" like a download on every open of a xiangqi board
// (measured 2026-10-14: ~700 ms of counting with the net already cached), and
// the HTTP cache is free to evict an entry that size. Cache Storage is kept
// until the site clears it (lichess keeps its nets the same way), and a hit
// reports no progress. The key is the full versioned URL (?v=…), so a new
// PIKAFISH_ASSET_VERSION is a miss, and every other entry is deleted once the
// new one is stored.
const NET_CACHE = 'mistboard-pikafish-net';

async function openNetCache() {
  try {
    return self.caches ? await self.caches.open(NET_CACHE) : null;
  } catch {
    // Opaque origins, private modes, or storage switched off: network only.
    return null;
  }
}

async function storeNet(cache, url, response) {
  try {
    await cache.put(url, response);
    const keep = new URL(url, self.location.href).href;
    for (const request of await cache.keys()) {
      if (request.url !== keep) await cache.delete(request);
    }
  } catch {
    // Quota or storage failure: the next load fetches again, as before.
  }
}

async function loadNet(url) {
  const cache = await openNetCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        return { bytes: new Uint8Array(await hit.arrayBuffer()), source: 'cache' };
      }
    } catch {
      // A broken entry reads as a miss.
    }
  }
  const bytes = await fetchNet(url);
  if (cache) {
    // A BufferSource body is copied when the Response is built, so the engine
    // may own `bytes` while the write finishes in the background.
    void storeNet(
      cache,
      url,
      new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }),
    );
  }
  return { bytes, source: 'network' };
}

async function fetchNet(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`net fetch failed: ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    self.postMessage({ type: 'net-progress', loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

self.addEventListener('message', async (event) => {
  const message = event.data;
  if (message?.type === 'init') {
    try {
      const netPromise = loadNet(message.netUrl);
      importScripts(message.jsUrl);
      const factory = self.Pikafish;
      if (typeof factory !== 'function') {
        throw new Error('Pikafish factory missing after script load');
      }
      const module = await factory({
        locateFile: (file) => (file.endsWith('.wasm') ? message.wasmUrl : file),
        mainScriptUrlOrBlob: message.jsUrl,
        print: (line) => self.postMessage({ type: 'line', line: String(line) }),
        printErr: (line) => self.postMessage({ type: 'stderr', line: String(line) }),
      });
      const net = await netPromise;
      module.FS.writeFile('/pikafish.nnue', net.bytes);
      self.postMessage({ type: 'net-written', bytes: net.bytes.byteLength, source: net.source });
      const initialize = module.cwrap('pikafish_initialize', null, []);
      command = module.cwrap('pikafish_command', null, ['string']);
      initialize();
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (message?.type === 'command' && typeof message.command === 'string') {
    if (!command) {
      self.postMessage({ type: 'error', error: 'Pikafish worker is not ready' });
      return;
    }
    command(message.command);
  }
});
