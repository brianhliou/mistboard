# MistyBanqi client engine (vendored wasm)

The in-browser Banqi engine for the review/analysis panel's "Engine on"
toggle — single-threaded WebAssembly, no cross-origin isolation needed (unlike the
Fairy-Stockfish build). Driven from `apps/web/src/review/engine/misty-ceval.ts` via
`worker.js` (a module worker). See that file for the ceval contract.

## Files

- `banqi_wasm.js`, `banqi_wasm_bg.wasm` (+ `.d.ts`) — the wasm-bindgen `--target web`
  output, generated (do not hand-edit).
- `worker.js` — hand-written module worker: loads the wasm, owns stateful analysis
  sessions, and runs bounded `step` slices off the main thread. Edit this by hand.

## Regenerating the wasm

Source lives in the private **misty-banqi** repo (`~/projects/misty-banqi`), crate
`banqi-wasm` (a cdylib that `#[path]`-includes the shared engine core). It exposes both
one-shot `analyze(fen, nodes, multipv)` and `AnalysisSession.step(nodes)`. Continuous
analysis retains the TT, killer/history ordering, and completed iterative-deepening state
between bounded worker slices. Since banqi-wasm 0.2.5 (2026-10-17) both take the game's
no-progress draw limit: `analyze_with_limit(fen, nodes, multipv, limit)` and
`AnalysisSession.set_no_progress_limit(limit)`; the plain calls keep the engine's 40. The
worker uses them when a request carries `noProgressLimit` (60, or 40 for a game created
before 2026-10-17). To rebuild after an engine change:

```sh
cd ~/projects/misty-banqi
wasm-pack build banqi-wasm --target web --release --out-dir pkg
cp banqi-wasm/pkg/banqi_wasm.js \
   banqi-wasm/pkg/banqi_wasm_bg.wasm \
   banqi-wasm/pkg/banqi_wasm.d.ts \
   banqi-wasm/pkg/banqi_wasm_bg.wasm.d.ts \
   <mistboard>/apps/web/public/engine/misty-banqi/
```

Then bump `MISTY_ASSET_VERSION` in `misty-ceval.ts` to bust the edge cache.

## Redaction

The engine is fed the REDACTED Banqi FEN (`banqiStateToEngineFen` in `@mistboard/game`) —
face-down tiles as `X`, pool as public per-(ink,role) counts — identical to the server
analysis path. The client engine never sees a hidden tile's identity.
