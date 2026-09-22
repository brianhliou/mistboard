/* Pikafish browser UCI worker. The generated Emscripten module reuses this
 * script URL for its pthread workers through mainScriptUrlOrBlob.
 *
 * init: { type: 'init', jsUrl, wasmUrl, netUrl }
 *   Fetches the NNUE net first (progress messages carry loaded/total bytes),
 *   writes it into the module's in-memory filesystem as /pikafish.nnue, then
 *   builds the engine, whose default EvalFile resolves to that path.
 * command: { type: 'command', command } — one UCI line. */

let command = null;

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
      const netPromise = fetchNet(message.netUrl);
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
      module.FS.writeFile('/pikafish.nnue', net);
      self.postMessage({ type: 'net-written', bytes: net.byteLength });
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
