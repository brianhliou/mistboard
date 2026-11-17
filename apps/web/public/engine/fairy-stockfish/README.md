# Fairy-Stockfish (WASM) — vendored engine assets

These files are the client-side analysis engine behind the review board's
"local engine" (ceval) for the xiangqi variants (fortress, atomic, crazyhouse)
and chess.
Standard xiangqi runs on Pikafish instead (`../pikafish/`, since
2026-09); jieqi on PikaJieQi (`../pikafish-jieqi/`). They run entirely in the
browser, in a Web Worker, and require a cross-origin-isolated context
(`SharedArrayBuffer`).

- `stockfish.js` / `stockfish.wasm` / `stockfish.worker.js` — the multi-threaded
  Fairy-Stockfish WASM build, **patched** (see Provenance).
- `fortress-xiangqi.ini`, `atomic-xiangqi.ini`, `crazyhouse-xiangqi.ini` — our
  custom-variant definitions. All are concatenated into one `variants.ini` in
  the engine's in-memory FS at load time (`VariantPath` names one file), then
  selected per evaluation with `UCI_Variant=fortressxiangqi` / `atomicxiangqi` /
  `crazyhousexiangqi`. Each is a hand-mirrored copy of the server's
  (`apps/server/src/*.ini`); for crazyhouse a test
  (`fsf-variant-ini-move-rule.test.ts`) fails if the stanza drifts, the others
  are kept in sync by a diff. Crazyhouse uses stock options only; on
  2026-10-02 this core matched the native engine's legal moves and perft(2) at
  all 449 positions of `packages/game/src/fixtures/crazyhouse-xiangqi-parity.json`
  (the hand-start rules: advisors and elephants in hand, drop check allowed).

Until 2026-09 this directory also carried `xiangqi-c07e94a5c7cb.nnue`, FSF's
official standard-xiangqi net (the one the server's Level 8 bot still runs),
fetched lazily for standard-xiangqi boards. That board moved to Pikafish, so
the net and its load path (`loadXiangqiNet` in ceval.ts) went with it; every
variant left on this core runs the classical evaluation.

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

## License and source

Fairy-Stockfish is licensed under the **GNU General Public License v3.0**, and
these binaries are distributed under it. The license text is
[COPYING.txt](COPYING.txt).

The corresponding source for `stockfish.js`, `stockfish.wasm` and
`stockfish.worker.js` is three things, all public:

1. [fairy-stockfish.wasm at `db432abaf83a1e7c265ff9c8554f83977d3441f5`](https://github.com/fairy-stockfish/fairy-stockfish.wasm/tree/db432abaf83a1e7c265ff9c8554f83977d3441f5)
   ([source archive](https://github.com/fairy-stockfish/fairy-stockfish.wasm/archive/db432abaf83a1e7c265ff9c8554f83977d3441f5.tar.gz)).
2. Our changes to it:
   [fairy-stockfish-atomic-xiangqi.patch](fairy-stockfish-atomic-xiangqi.patch),
   served here and identical to the copy at the root of the
   [Mistboard repository](https://github.com/brianhliou/mistboard).
3. The build recipe:
   [build-fairy-stockfish-wasm.sh](build-fairy-stockfish-wasm.sh), a copy of
   `scripts/engine-wasm/build-fairy-stockfish-wasm.sh` in the Mistboard
   repository. Run it from a checkout of that repository; it needs Docker and
   uses `emscripten/emsdk:2.0.26`.

The three `.ini` variant definitions beside this file are loaded at run time and
are not compiled in.

After a rebuild, copy the three artifacts here, update the sha256 above, and
copy the patch and recipe here again if either changed (a test fails when the
copies drift).
