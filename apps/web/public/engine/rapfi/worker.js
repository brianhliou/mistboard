/* Classic worker for the unmodified Rapfi single-thread SIMD build.
 * init -> ready; commands -> searching, line*, done {elapsedMs}; errors -> error.
 * sendCommand() is synchronous: the owner must terminate this worker to stop
 * an active search. The generated terminate() calls a missing runtime export.
 */
let engine = null;
let initializing = false;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      if (engine || initializing) throw new Error('Rapfi already initialized');
      initializing = true;
      const asset = (file) => {
        const url = new URL(file, self.location.href);
        url.search = self.location.search;
        return url.href;
      };
      importScripts(asset('rapfi-single-simd128.js'));
      engine = await Rapfi({
        locateFile: asset,
        onReceiveStdout: (line) => self.postMessage({ type: 'line', line }),
        onReceiveStderr: (line) => self.postMessage({ type: 'error', error: line }),
        onAbort: (reason) => self.postMessage({ type: 'error', error: String(reason) }),
      });
      initializing = false;
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'commands') {
      if (!engine) throw new Error('Rapfi is not ready');
      const started = performance.now();
      self.postMessage({ type: 'searching' });
      for (const command of data.commands) engine.sendCommand(command);
      self.postMessage({ type: 'done', elapsedMs: performance.now() - started });
    } else {
      throw new Error('Unknown Rapfi worker message');
    }
  } catch (error) {
    initializing = false;
    self.postMessage({ type: 'error', error: String(error) });
  }
};
