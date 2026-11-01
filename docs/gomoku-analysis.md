# Gomoku analysis

## Native Rapfi assets — s-06f7

This card supplies the native binary, config, networks and release gates for
the later admin-only whole-game analysis sweep. It adds no route, browser
surface or rating change. The sweep, shared parser, cache and 80-ply RSS
measurement belong to the following server card; the graph and long-game
acceptance test belong to s-da96. Gomoku stays hidden and unrated.

### Pins and licences

`rapfi.ref` pins Rapfi **1387d11312190ec66665d361ff07a7c70221b78a**
(2026-10-23), the same code as the browser build. Code and upstream config are
GPL-3.0. The Networks submodule is
**7eeb19b55219a48138756293f92211a1539bab4d**, CC0-1.0. Both licence texts
ship in the engines tarball; the release also carries `rapfi.ref` with its
source archive URL. No source or network is resolved through `latest`.

The browser's `net.json` names a **40,382,079-byte Emscripten filesystem
bundle**, SHA256
`f61d31b4d98fc53fb43a31a4f0b4357a8b64053bb5762a0967250b873cc9a57e`.
It is not a directly loadable native net. `scripts/rapfi-assets.mjs` checks
the entire bundle, extracts fixed byte ranges taken from the vendored JS
loader's filesystem table, then checks each native file independently before
writing anything. No downloaded JS executes. The bundle is available locally
or from the already pinned web release URL; production does not need the
Networks Git submodule or a second, floating source of weights.

Freestyle (`INFO rule 0`) uses `mix9svqfreestyle_bsmix.bin.lz4`, SHA256
`6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62`.
The unchanged `config-example/gomocalc-mix9svq/config.toml` also references
the standard and two Renju nets, plus `model210901.bin`. All eleven native
files in the web bundle are packaged, including the three classical configs
and three classical models. Each has an explicit SHA256 in `FILES`; the
two licence texts have their own pins in `LICENSES`. `MANIFEST` records all
these checksums and the Networks commit. `rapfi-assets.mjs manifest` prints
the complete list. The `.data` container does not enter the native tarball.

### Build, layout and verification

`scripts/engine-assets.sh` lists Rapfi in `BINARIES` and hashes `rapfi.ref`,
the complete extraction/verification helper and `RAPFI_CMAKE_FLAGS` into the
release tag. Recipe version 2 accounts for the added binary and native data.
The workflow and all three Railway configurations watch both new recipe
inputs. The workflow installs Node 22 for extraction and the search gate.

Production builds the `Rapfi/` source directory with CMake in Release mode,
`-march=haswell`, SSE/AVX2/BMI2 enabled, AVX512/VNNI disabled and
`-DCMAKE_EXE_LINKER_FLAGS=-static`. Command modules stay enabled. Other
upstream defaults stay in effect. This is a Linux x86-64 build for the
measured production EPYC ISA, like jqe; it is not a native Apple Silicon
build. The source archive has no submodules and this recipe needs none.

The binary is `<bin>/rapfi`. Its unchanged config, native weights, classical
models and licence texts live beside it. Launch it with `<bin>` as its working
directory and **no CLI arguments**, so it finds the intended config instead
of skipping neural initialization. Config defaults to one thread and a
32 MiB transposition table; the gate also sets both explicitly. The config
retains the browser's `X_flipY` coordinate setting; the server adapter must
use the same protocol/coordinate convention as the existing browser adapter.

Both the release workflow and Railpack's existing `verify` call run
`rapfi_search_ok`; `verify-rapfi` exposes that same gate independently. It
checks every extracted checksum again, then runs a nonempty, nonterminal
15x15 freestyle position through `YXBOARD ... DONE` and `YXNBEST 1`, with
`INFO show_detail 2`, 1,000 nodes, a 1 s turn limit, one thread and 32 MiB hash.
It requires the mix9svq evaluator announcement, the named freestyle net's
load message, successful weight loading, scored PV/node output and a legal
unoccupied move. Classical fallback, bad/missing nets, protocol errors and
nonzero exit fail. A 15 s owner watchdog kills and reaps a hung process.

Isolated offline source-path entry point, on a Linux x86-64 builder with
the local clone and bundle mounted at these paths:

```sh
sh scripts/engine-assets.sh build-rapfi /tmp/rapfi-bin \
  /Users/brianliou/projects/tools/rapfi \
  "$PWD/apps/web/public/engine/rapfi/rapfi-single-simd128.data"
sh scripts/engine-assets.sh verify-rapfi /tmp/rapfi-bin
```

The source clone's HEAD must equal `rapfi.ref`. The recipe archives that
committed `Rapfi/` tree and builds in a separate temporary directory, so
dirty source files are ignored and the shared clone is never modified.
Omitting the source path uses the pinned GitHub code archive. Omitting the
bundle uses the verified local web file when present, otherwise downloads
the pinned web release asset. The main `build` command calls this same recipe.

### Evidence and remaining landing checks

The sandbox explicitly cannot read `/Users/brianliou/projects/tools/rapfi`
and has no network; the real clone was not probed. **Native compilation,
static-link/ISA confirmation and the real native `verify-rapfi` run remain
landing checks on a Linux x86-64 builder.** No production build or deployment
was attempted. The offline path was exercised with fixture source and local
Git/CMake/strip executables that check the pinned tree, source/build separation,
production flags, target/output paths, no downloads and wrong-pin rejection;
this is recipe orchestration evidence, not native compilation evidence.

The real local web bundle passed extraction and every native-file checksum.
A bounded real WASM search at the same code/network pins confirmed the
evaluator and weight-load messages and returned complete scored PVs plus
move `6,6` at 1,000 nodes on the gate's position. This records the message
contract; it does not certify the native build.

The asset regression initially failed **5 tests** (13 passed): Rapfi was absent
from the binary/input lists and the extractor/search gate did not exist.
After implementation, **19 asset tests pass**, including corrupt bundle/net
rejection, model corruption, fallback/error/timeout refusal, tarball contents,
per-file manifest pins, and offline source-path orchestration. Run:

```sh
node --test scripts/engine-assets.test.mjs
```

Session evidence lives in
`/tmp/burn-scratch/mistboard-burn-s-06f7-gomoku-pin-and-package/`.
Final validation:

- All 19 asset tests pass, exit 0; shell syntax, changed-file Biome and
  `git diff --check` pass. Baseline and final logs: `assets-before.log` and
  `assets-after.log`.
- The exact requested `nice -n 10 sh -c 'W="--changed main"; ...'` repository
  suite ran, exit 1 (`suite.log`). Game, board-render, mahjong and server
  builds passed. Tooling reported **432 passed, 7 failed**; every failure is
  a localhost `listen EPERM` in the unchanged `prod-smoke-lib.test.mjs` or
  `safe-deploy.test.mjs`. Its `&&` chain stopped there, before the tooling TS
  tests, package unit tests and changed-web run. Those remaining gates must
  run outside the sandbox before commit.
- The parent's separate `npm --prefix apps/server test` ran, exit 1:
  **3,138 passed, 53 failed, 79 skipped** (`server.log`). All 53 failures
  report `listen EPERM`; this card changes no server source.
- Root `npm run typecheck` passed, exit 0 (`typecheck.log`), including e2e.
  The deployment-safety document's two test files passed **15/15**, exit 0
  (`deploy-safety.log`), with fixture deployments only.

Implementation remains **uncommitted for sandbox-suite recovery**, on branch
`agent/burn-s-06f7-gomoku-pin-and-package`, based on `e88b27094` on
`game/gomoku`. Worktree:
`/Users/brianliou/projects/mistboard-burn-s-06f7-gomoku-pin-and-package`.
The ten intended paths are `rapfi.ref`, `scripts/rapfi-assets.mjs`,
`scripts/engine-assets.sh`, `scripts/engine-assets.test.mjs`,
`.github/workflows/build-engines.yml`, `railway.json`, `railway.web.json`,
`railway.engine-worker.json`, `INDEX.md` and this document. No other tracked
files changed. Review the helper's native-file pins and search gate first,
then the isolated CMake recipe and regression tests.

Next owner: the burn recovery engine runs the configured suite with normal
socket permissions and commits these paths; the Mistboard session reviews,
runs the real Linux native build/gate and merges into `game/gomoku`.
Suggested commit subject: `feat(gomoku): pin and package native Rapfi assets (s-06f7)`.
Suggested lesson trailer: `Lesson: Pin every native model extracted from a
browser data bundle and require neural weight loading plus a scored search
before accepting the server engine asset.`

### Deployment handoff

The Mistboard session reviews this parked branch on `game/gomoku`. Before
release, build and run the native gate above, then wait for the **new**
`engines-<recipe hash>` release to publish before any image build fetches it.
Railpack fetches, then verifies the same binary and native data; it compiles
no engines. This asset change also reaches engine-worker's watched inputs.

Follow [engine-worker deployment safety](engine-worker-deploy-safety.md):
use `node scripts/deploy-engine-worker.mjs` for the authorized check-only
preview, establish verified running revisions, and retain the exact engine
SHA/CI, clean-tree, baseline, lock/journal and new-deployment health checks.
Only an explicitly authorized later operation adds `--deploy`. Worker
auto-deploy stays off. This branch changes neither `engine.ref` nor Railpack's
private-engine cachebust; it deploys nothing.
