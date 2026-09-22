# Pikafish (WASM) — vendored engine assets

Mainline Pikafish, built for the browser with its NNUE net: the local analysis
engine for standard xiangqi on `/analysis/xiangqi` and the roomless
whole-game sweep (`review/engine/pikafish-ceval.ts`). Runs in a dedicated Web
Worker with pthreads, so the document must be cross-origin isolated.

- Upstream: `official-pikafish/Pikafish`, commit
  `6a59ee2f7b105bff64d9efc2692591107787e2b1` (2026-09-19)
- Build toolchain: `emscripten/emsdk:3.1.74`
- Net: `pikafish.nnue`, the upstream `master-net` release as updated
  2026-09-06, arch `(62083, 1024, 32, 32, 1)`; sha256 and source in `net.json`
- License: GPL-3.0-or-later (`COPYING.txt`); the net under `NNUE-License.md`
  (legal use only, no commercial use without the Pikafish team's permission)
- Public mirror of this build, with the same files and the net as release
  assets: <https://github.com/brianhliou/pikafish-wasm>

| file | |
|---|---|
| `pikafish.js`, `pikafish.wasm` | the Emscripten module (tracked) |
| `pikafish.nnue` | 51 MB, **not tracked**; `scripts/fetch-pikafish-net.mjs` downloads it from `net.json`'s URL and checks the sha256 (`predev` and `build` run it) |
| `worker.js` | fetches the net with byte progress, writes it to the module FS as `/pikafish.nnue`, builds the engine, forwards UCI |
| `source.patch` | the WASM entry points against the upstream commit |
| `build.sh` | the `em++` invocation |

## What the patch does

Upstream `main()` builds a `UCIEngine` and blocks in `loop()` on stdin, which
a worker cannot feed. The patch splits `loop()` into `loop()` +
`execute(cmd)` (one command line, returns false after `quit`) and exports
`pikafish_initialize()` / `pikafish_command(const char*)`; `main()` is a no-op
under Emscripten. `go` returns as soon as the search threads start, so the
worker stays responsive to `stop`. Nothing in the engine changes.

## Net loading

The worker fetches the net before touching the module and writes it to
`/pikafish.nnue`; `pikafish_initialize()` then runs with `argv[0] =
"/pikafish"`, so the default `EvalFile` resolves to that path and loads at
construction. The first search prints
`info string NNUE evaluation using pikafish.nnue (64MiB, (62083, 1024, 32, 32, 1))`.
There is no classical fallback: a missing or mismatched net terminates the
engine, and the panel shows the error rather than a weaker number. The net
and the engine commit must be updated together; upstream's `master-net` tag
rolls without a version, which is why `net.json` pins the bytes.

## Threads

`PTHREAD_POOL_SIZE=8`: eight pthreads are created at module load, so
`setoption name Threads value N` for N ≤ 8 never waits on the browser. A
larger N would block the worker on a thread that can only be created once
the worker yields, which it is not going to do mid-`setoption`.

## Rebuild

```sh
git clone https://github.com/official-pikafish/Pikafish.git
cd Pikafish
git checkout 6a59ee2f7b105bff64d9efc2692591107787e2b1
git apply /path/to/source.patch
mkdir -p wasm && cp /path/to/build.sh wasm/build.sh
docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:3.1.74 bash wasm/build.sh
# dist/wasm/pikafish.js and pikafish.wasm
```

Bump `PIKAFISH_ASSET_VERSION` in `pikafish-ceval.ts` on any change here (the
CDN keys these un-hashed files on the query string), and re-pin `net.json` if
the net moved.
