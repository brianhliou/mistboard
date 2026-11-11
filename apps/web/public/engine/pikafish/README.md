# Pikafish (WASM) — vendored engine assets

Patched Pikafish with the CC0 Fairy-Stockfish xiangqi NNUE network: the local
analysis engine for standard xiangqi on `/analysis/xiangqi` and the roomless
whole-game sweep (`review/engine/pikafish-ceval.ts`). Runs in a dedicated Web
Worker with pthreads, so the document must be cross-origin isolated.

- Upstream: `official-pikafish/Pikafish`, commit
  `6a59ee2f7b105bff64d9efc2692591107787e2b1` (2026-09-19)
- Source changes: `source.patch` (browser entry points) and
  `pikafish-cc0-net.patch` (SF14 HalfKAv2_xq evaluation, default `NNUEScale=79`)
- Build toolchain: `emscripten/emsdk:3.1.74`
- Net: `xiangqi-c07e94a5c7cb.nnue` from Fairy-Stockfish-NNUE commit
  `0f4dce21530775b1dc862b7c84aa707548183097`; source, size and sha256 in `net.json`
- Engine license: GPL-3.0-or-later (`COPYING.txt`); network: CC0 (`NNUE-License.md`)

| file | |
|---|---|
| `pikafish.js`, `pikafish.wasm` | the Emscripten module (tracked) |
| `xiangqi-c07e94a5c7cb.nnue` | about 11 MB, **not tracked**; `scripts/fetch-pikafish-net.mjs` at the repo root fetches the public source pinned in `net.json` and verifies its size and sha256 (`predev` and `build` run it) |
| `worker.js` | fetches the net with byte progress, writes it to MEMFS at `/xiangqi-c07e94a5c7cb.nnue`, builds the engine, forwards UCI |
| `source.patch`, `pikafish-cc0-net.patch` | complete engine source changes against the upstream commit; the CC0 patch is identical to the repo-root copy |
| `build.sh` | the `em++` invocation |
| `COPYING.txt` | engine GPL license |

## Source patches

Upstream `main()` builds a `UCIEngine` and blocks in `loop()` on stdin, which
a worker cannot feed. `source.patch` splits `loop()` into `loop()` +
`execute(cmd)` (one command line, returns false after `quit`) and exports
`pikafish_initialize()` / `pikafish_command(const char*)`; `main()` is a no-op
under Emscripten. `go` returns as soon as the search threads start, so the
worker stays responsive to `stop`.

`pikafish-cc0-net.patch` replaces evaluation with the SF14 HalfKAv2_xq
architecture needed by the CC0 net and changes the default `EvalFile` to its
filename. Both patches are required; either application order works.

## Net loading

The worker fetches the net before initializing the engine and writes it to
`/xiangqi-c07e94a5c7cb.nnue`; `pikafish_initialize()` then runs with
`argv[0] = "/pikafish"`, so the default `EvalFile` resolves to that path and
loads at construction. The first search prints:

```text
info string NNUE evaluation using xiangqi-c07e94a5c7cb.nnue (10MiB, (10530, 1024, 16, 32, 1))
```

There is no classical fallback: a missing or mismatched net terminates the
engine, and the panel shows the error. The network filename and asset version
change together, so the worker fetches the CC0 network and evicts the previous
Cache Storage entry after storing it. No credentials are needed to fetch it.

## Threads

`PTHREAD_POOL_SIZE=8`: eight pthreads are created at module load, so
`setoption name Threads value N` for N ≤ 8 never waits on the browser. A
larger N would block the worker on a thread that can only be created once
the worker yields, which it is not going to do mid-`setoption`.

## Rebuild

Run from the Mistboard repo root. This recipe names the upstream commit and
applies both served patches. It copies only the module, source changes and
engine license back; the network is downloaded and verified separately.

```sh
assets="$PWD/apps/web/public/engine/pikafish"
git clone https://github.com/official-pikafish/Pikafish.git tmp/pikafish-988
cd tmp/pikafish-988
git checkout 6a59ee2f7b105bff64d9efc2692591107787e2b1
mkdir -p wasm
cp "$assets/build.sh" "$assets/source.patch" "$assets/pikafish-cc0-net.patch" wasm/
git apply wasm/source.patch
git apply wasm/pikafish-cc0-net.patch
docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:3.1.74 bash wasm/build.sh
cp dist/wasm/pikafish.js dist/wasm/pikafish.wasm dist/wasm/COPYING.txt \
  dist/wasm/source.patch dist/wasm/pikafish-cc0-net.patch "$assets/"
cd ../..
node scripts/fetch-pikafish-net.mjs
```

Bump `PIKAFISH_ASSET_VERSION` in `pikafish-ceval.ts` on any vendored-asset
change (the CDN keys these un-hashed files on the query string). Verify a real
search on local `/analysis/xiangqi` reports the info line above. Re-measure
the drawn-endgame probe in `scripts/prod-ceval-smoke.mjs` on the rebuilt wasm
before shipping; its evaluation bound must come from that measurement.
