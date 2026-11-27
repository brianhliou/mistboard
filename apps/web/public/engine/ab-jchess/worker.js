/* AB-JChess browser UCI worker. The generated Emscripten module starts its
 * pthread workers from abjchess.js (mainScriptUrlOrBlob), not from this script. The net is not
 * compiled in: it is fetched here and written into the module filesystem, where
 * the engine looks for its default net on the first command. */

let command = null;
const NET_FILE = '/abjchess-20261030.nnue';

self.addEventListener('message', async (event) => {
  const message = event.data;
  if (message?.type === 'init') {
    try {
      // Started before the module loads; caught here so a failure while the
      // module is still loading is not an unhandled rejection, and rethrown below.
      const netResponse = fetch(message.netUrl).catch((error) => ({ fetchError: error }));
      importScripts(message.jsUrl);
      const factory = self.ABJChess;
      if (typeof factory !== 'function') {
        throw new Error('ABJChess factory missing after script load');
      }
      const module = await factory({
        locateFile: (file) => (file.endsWith('.wasm') ? message.wasmUrl : file),
        mainScriptUrlOrBlob: message.jsUrl,
        print: (line) => self.postMessage({ type: 'line', line: String(line) }),
        printErr: (line) => self.postMessage({ type: 'stderr', line: String(line) }),
      });
      const response = await netResponse;
      if ('fetchError' in response) throw response.fetchError;
      if (!response.ok) throw new Error(`AB-JChess net fetch failed: HTTP ${response.status}`);
      module.FS.writeFile(NET_FILE, new Uint8Array(await response.arrayBuffer()));
      command = module.cwrap('abj_command', 'number', ['string']);
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
      self.postMessage({ type: 'error', error: 'AB-JChess worker is not ready' });
      return;
    }
    command(message.command);
  }
});
