# Rapfi browser worker — phase 1b (#762)

Vendored, unmodified single-thread SIMD128 WebAssembly from
[dhbloo/rapfi at `1387d11312`](https://github.com/dhbloo/rapfi/tree/1387d11312)
(2026-10-23), licensed under GPL-3.0. The full license is [GPL-3.0.txt](GPL-3.0.txt).
Source for this build: [pinned source archive](https://github.com/dhbloo/rapfi/archive/1387d11312.tar.gz).
The staged compiler version and flags are recorded verbatim in [BUILD.txt](BUILD.txt):
Emscripten 6.0.13, `NO_MULTI_THREADING NO_COMMAND_MODULES USE_WASM_SIMD`.
No compilation or fetching of engine source was performed for this integration.

The preloaded networks are pinned to `7eeb19b` in [net.json](net.json), with the
complete data package SHA-256 and byte count. Their CC0 license is included as
[NETWORKS-CC0.txt](NETWORKS-CC0.txt). The package includes the upstream config,
three classical models, and freestyle/standard/renju mix9svq weights; the wrapper
sets freestyle (`INFO rule 0`) and only loads the freestyle weights for play.

## Assets and setup

| File | Bytes | Tracked |
| --- | ---: | --- |
| `rapfi-single-simd128.wasm` | 1,263,368 | yes |
| `rapfi-single-simd128.js` | 39,154 | yes |
| `rapfi-single-simd128.data` | 40,382,079 | no |

Run `node apps/web/scripts/fetch-rapfi-net.mjs` from the repo root; web `predev`
and `build` both run it. It keeps a local file that matches the pin, or downloads
the [v0.1.0 release asset](https://github.com/brianhliou/rapfi-wasm/releases/tag/v0.1.0)
named in `net.json` and checks its size and SHA-256 before writing. That repo's
`build.sh` rebuilds all three files byte for byte from the pinned sources.

## API and protocol

Import `Rapfi` and `RAPFI_LEVELS` from `apps/web/src/engine/rapfi.ts`.
`chooseMove({ stones: [{x, y, player}], turn }, level)` accepts zero-based
15x15 coordinates and players `1 | 2`, returning `{ move: {x, y}, elapsedMs }`.
The caller supplies a playable, non-terminal freestyle position. The adapter
checks coordinates, colors, duplicates, a full board, and the returned move.
It maps `turn` to BOARD's player 1 (engine), and the other color to player 2.

The staged loader exports an async `Rapfi(options)` factory, `sendCommand(line)`
and `_gomocupLoopOnce`. It already speaks Piskvork/Gomocup. `NO_COMMAND_MODULES`
does not remove that protocol. Each request sends `START 15`, `INFO rule 0`,
`INFO max_node N`, `INFO timeout_turn T`, and `BOARD … DONE` (one complete
multiline command) or `BEGIN` for the empty board. A standalone `x,y` stdout line
is the move. Engine errors reject the request and discard the worker.

Search runs synchronously inside `sendCommand`. A queued protocol stop cannot
interrupt it. `stop()` therefore terminates the dedicated worker, clears the
watchdog and rejects outstanding work with `AbortError`; it is safe to repeat.
The next request creates a new session. We do not call the generated
`terminate()`, which refers to an unavailable `_emscripten_force_exit` export.
One request may be outstanding per adapter; parallel requests reject as busy.
No SharedArrayBuffer or cross-origin isolation is needed for this single-thread
build. WebAssembly SIMD support is required.

## Verification / PR description

Run `npm run test:unit --workspace @mistboard/web -- src/engine/rapfi.test.ts`.
The Node test executes the actual browser worker, loader, WASM and networks in
a Node worker thread. Its only engine adaptation converts file URLs to local
paths. No Gomoku kernel or protocol mock substitutes for tactical tests.

It checks a win in one, a block at either end of an opponent open four (which
is already a forced loss), 20 fixed positions at each of five levels, and stop
cleanup/restart. The single level table holds node budgets and time safeguards.
Rapfi checks node limits in batches and can slightly exceed the requested node
budget; `timeout_turn` and an owner watchdog bound time as well. Timing is
worker command time, including lazy weight loading on the first move, excluding
module/worker startup. It is a performance sample, not a strength calibration.

Measured 2026-10-31 on Apple M3 Max, arm64, Node v26.11.1; 20 positions per tier
in one persistent worker, retaining the transposition table across requests and
tiers. The first L1 move includes lazy weight loading; subsequent tiers use
already loaded weights. These numbers are local samples, not browser/device
performance guarantees.

| Level | Node budget | Time safeguard (ms) | Mean ms/move | Max ms/move |
| --- | ---: | ---: | ---: | ---: |
| 1 | 100 | 1,000 | 5.1 | 76.0 |
| 2 | 1,000 | 1,500 | 5.7 | 14.7 |
| 3 | 5,000 | 2,000 | 19.1 | 44.0 |
| 4 | 20,000 | 3,000 | 68.5 | 145.3 |
| 5 | 100,000 | 5,000 | 298.8 | 714.6 |

Regression evidence: the new Node test failed before implementation (exit 1,
missing `./rapfi.js`); the completed test passed (exit 0, 13 tests, 8.90 s).
All 100 position/tier combinations returned unoccupied on-board moves before
their time safeguard. Other checks cover invalid input/output, side mapping,
busy rejection, startup failure, protocol failure, watchdogs, stale replies,
and worker exit both during initialization and during an active search.

Validation: repository typecheck, Biome on changed source/scripts/package JSON,
and Biome on the handwritten public worker via stdin (vendored engine files
are intentionally ignored by the repository formatter). No existing registry,
tenant table or route list changes, so no full package suite is required for
this standalone module. No browser surface is part of this phase. The release
URL remains unset as requested; this branch needs locally staged data to run
its WASM tests and web predev until that asset is hosted.
