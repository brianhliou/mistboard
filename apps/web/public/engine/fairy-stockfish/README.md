# Fairy-Stockfish (WASM) — vendored engine assets

These files are the client-side analysis engine that powers the review board's
"local engine" (ceval). They run entirely in the browser, in a Web Worker, and
require a cross-origin-isolated context (`SharedArrayBuffer`).

- `stockfish.js` / `stockfish.wasm` / `stockfish.worker.js` — the multi-threaded
  Fairy-Stockfish WASM build, **patched** (see Provenance).
- `fortress-xiangqi.ini`, `atomic-xiangqi.ini` — our custom-variant definitions.
  Both are concatenated into one `variants.ini` in the engine's in-memory FS at
  load time (`VariantPath` names one file), then selected per evaluation with
  `UCI_Variant=fortressxiangqi` / `atomicxiangqi`. Each is a hand-mirrored copy
  of the server's (`apps/server/src/*.ini`); nothing keeps them in sync but a
  diff. Standard xiangqi uses Fairy-Stockfish's built-in `xiangqi` variant.
- `xiangqi-c07e94a5c7cb.nnue` — Fairy-Stockfish's official standard-xiangqi NNUE
  net, the same one the server's Level 8 bot runs. Fetched lazily on the first
  xiangqi evaluation and written to the engine's in-memory FS.

## Provenance

Since 2026-09-17 this is not the stock npm package. It is built from the same
source tree plus `fairy-stockfish-atomic-xiangqi.patch` (repo root), the patch
the PvE bot's native binary carries: four options stock Fairy-Stockfish cannot
parse (`blastShape`, `blastImmuneTypes`, `cannonShotBlasts`, `lethalCheck`),
each guarded so a variant with a real KING is untouched. Stock 1.1.12 loads
`atomic-xiangqi.ini` without complaint and plays a different game (perft 19
and 20 where the kernel says 3 and 4), which is why the gate below exists.

- source: https://github.com/fairy-stockfish/fairy-stockfish.wasm at
  `db432abaf83a1e7c265ff9c8554f83977d3441f5` (branch `nnue`, package version
  1.1.12; upstream engine merge `226c7f18`), plus the patch
- toolchain: `emscripten/emsdk:2.0.26` through the repo's docker-compose,
  `make emscripten_build ARCH=wasm embedded_nnue=no` (the publish job's flags)
- recipe: `scripts/engine-wasm/build-fairy-stockfish-wasm.sh`; gate:
  `scripts/engine-wasm/fairy-stockfish-wasm-gate.cjs` (perft 44 / 3 / 4 on the
  atomic positions railpack asserts for the native binary, 44 for xiangqi)
- `stockfish.wasm` sha256: `752903df94583f658a17150f08be689f65f5fa835e1b46948ef98801f632d894`
- previous, stock npm `fairy-stockfish-nnue.wasm@1.1.12`:
  `7cea742b8ca1a324fbc500f89112f168134cf68eb49475df23be6c42336255c6`

Moving `fairy-stockfish-atomic-xiangqi.ref`/`.patch` moves the bot; this build
does not follow, so rebuild it in the same change or the analysis board and the
bot become different engines (the pikafish-jieqi README records the same rule).

- `xiangqi-c07e94a5c7cb.nnue` sha256: `c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11`
  (same net as `XIANGQI_FSF_NNUE_NET` in `apps/server/src/xiangqi-fsf-engine.ts`,
  which railpack pins and sha256-verifies for the server binary)

## The net is not optional

Fairy-Stockfish loads no net unless told to, and its CLASSICAL evaluation has no
xiangqi endgame knowledge: against the 32-position basic-endgame corpus at depth
16 it agreed with the book verdict 17 times out of 32, calling won positions 0cp
draws and one book draw a +523cp win. With this net it is 32/32. Running without
it is not "leaner", it is an analysis board that cannot read an endgame (#363).

`loadXiangqiNet` in `ceval.ts` falls back to classical when the fetch fails, so
that a CDN miss degrades analysis instead of taking the engine panel down. That
fallback is invisible from the outside, which is why `prod:smoke:ceval` gates a
release on the ACTUAL evaluation of a known drawn endgame rather than on the
asset returning 200.

Only standard xiangqi gets the net. Fortress and atomic xiangqi share this engine
core but are custom `.ini` variants the net does not apply to, so `Use NNUE` is
set per evaluation (`EvalFile` is a global option on a core that outlives any
one board). Bump `ENGINE_ASSET_VERSION` in `ceval.ts` on any change to the files
here.

## License

Fairy-Stockfish is licensed under the **GNU General Public License v3.0**. These
vendored binaries are distributed under GPL-3.0; the corresponding source is the
pinned upstream repository above. Full license text:
https://www.gnu.org/licenses/gpl-3.0.txt

To rebuild: `sh scripts/engine-wasm/build-fairy-stockfish-wasm.sh`, then copy
the three artifacts here and update the sha256 above.
