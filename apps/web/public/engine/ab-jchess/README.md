# AB-JChess WebAssembly

AB-JChess by Huorongrong and Laoxu (Kouza), a jieqi engine, compiled to
WebAssembly for browser analysis. The site's server analysis runs the same
engine and net natively.

- Source: https://github.com/lxsgx23/AB-JChess
- Commit: `efc83867230a26bbcd4a6c4cf644b69e154b452e`, plus
  `ab-jchess-wasm-entry.patch` (a one-line-per-call `abj_command` entry point
  and an inline-search switch the shipped build does not use)
- Build: pthreads, SSE2 kernel through SIMD128 (`-msse2 -pthread`), one search
  thread
- Toolchain: `emscripten/emsdk:3.1.74`
- Recipe: `scripts/engine-wasm/build-ab-jchess-wasm.sh` in the Mistboard
  repository
- Engine license: GPL-3.0 (`COPYING.txt`). The tree also carries jqe code under
  the MIT license (`LICENSE-jqe-MIT.txt`, copied here from the archive)
- Net: `abjchess-20261030.nnue` from the AB-JChess-20261031 release, sha256
  `fdb6245b868bb204cf2b64fc4f8440d7a1e22b73abdd2a13dce180b65b01619e`, served
  with the authors' permission (granted 2026-11-24,
  https://github.com/lxsgx23/AB-JChess/issues/1). It is not kept in the
  Mistboard repository: each build downloads the release zip, checks both
  checksums in `net.json` and copies the net out
  (`scripts/fetch-abjchess-browser-net.mjs`)

The complete corresponding source is `abjchess-source-efc83867.tar.gz`: the
upstream tree at that commit with the patch applied, and under `wasm/` the
patch, the build script and the gate the recipe runs. The net is not compiled
into the engine and is not in the archive; it is the separate file beside it.

Extract the archive, then run from its root:

```sh
docker run --rm --platform linux/amd64 -v "$PWD:/work" -w /work \
  emscripten/emsdk:3.1.74 bash ./wasm/build.sh
```

The output is in `dist/wasm/`. Serve `abjchess.js`, `abjchess.wasm`,
`abjchess-20261030.nnue`, `worker.js` and `COPYING.txt` together.

`worker.js` creates one persistent UCI module in a dedicated worker, fetches the
net and writes it to `/abjchess-20261030.nnue` in the module filesystem before
the first command (the engine loads its default net on that command). The
generated `abjchess.js` is also its pthread entry point: `mainScriptUrlOrBlob`
must point to that generated JS URL, including the asset version. The document
requires cross-origin isolation (COOP `same-origin`, COEP `require-corp`).

Option values are integers or fixed combo words only: the build has no C++
exception handling, so a malformed number aborts the module.
