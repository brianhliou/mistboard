// MistyBanqi client-engine worker. Runs the vendored wasm-bindgen build off the main
// thread, so a bounded search slice never blocks the review UI. The
// wasm is single-threaded (no SharedArrayBuffer / cross-origin isolation needed), unlike
// the Fairy-Stockfish engine.
//
// The main thread (misty-ceval.ts) posts the versioned asset URLs in the `init` message,
// so cache-busting lives in one place there (ceval's asset-version constant) rather than
// in bare-path imports here. `noProgressLimit` is the game's no-progress draw limit
// (60, or 40 for a game created before 2026-10-17); absent keeps the engine's 40.
// Message protocol:
//   → { type: 'init', jsUrl, wasmUrl }        ← { type: 'ready' } | { type: 'error', error }
//   → { type: 'analyze', id, fen, nodes, multipv, noProgressLimit? } ← { type: 'result', id, json }
//   → { type: 'step', id, sessionId, fen?, nodes, multipv, noProgressLimit? }
//                                                ← { type: 'result', id, json }
//   → { type: 'cancel', sessionId }
let mod = null;
let readyPromise = null;
const sessions = new Map();

async function ensureReady(jsUrl, wasmUrl) {
  if (!readyPromise) {
    readyPromise = (async () => {
      mod = await import(jsUrl);
      await mod.default(wasmUrl); // default export = wasm-bindgen init(wasmUrl)
    })();
  }
  return readyPromise;
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      await ensureReady(msg.jsUrl, msg.wasmUrl);
      self.postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'analyze') {
      if (!mod) throw new Error('engine not initialized');
      const json =
        typeof msg.noProgressLimit === 'number'
          ? mod.analyze_with_limit(msg.fen, msg.nodes, msg.multipv, msg.noProgressLimit)
          : mod.analyze(msg.fen, msg.nodes, msg.multipv);
      self.postMessage({ type: 'result', id: msg.id, json });
      return;
    }
    if (msg.type === 'step') {
      if (!mod) throw new Error('engine not initialized');
      let session = sessions.get(msg.sessionId);
      if (!session) {
        if (typeof msg.fen !== 'string') throw new Error('analysis session requires a FEN');
        session = new mod.AnalysisSession(msg.fen, msg.multipv);
        if (typeof msg.noProgressLimit === 'number') session.set_no_progress_limit(msg.noProgressLimit);
        sessions.set(msg.sessionId, session);
      }
      const json = session.step(msg.nodes);
      self.postMessage({ type: 'result', id: msg.id, json });
      return;
    }
    if (msg.type === 'cancel') {
      sessions.get(msg.sessionId)?.free?.();
      sessions.delete(msg.sessionId);
    }
  } catch (err) {
    const error = String((err && err.message) || err);
    self.postMessage(msg && msg.id !== undefined ? { type: 'error', id: msg.id, error } : { type: 'error', error });
  }
};
