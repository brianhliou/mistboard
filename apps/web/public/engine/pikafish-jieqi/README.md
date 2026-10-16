# PikaJieQi WebAssembly

Browser build of Pikafish's classical-evaluation `jieqi_old` branch for Reveal
Xiangqi review analysis.

- Upstream source: `official-pikafish/Pikafish`
- Upstream base commit: `23b9466c981f0f3a1133f92de1a6f86406c4eccc`
- Distributed commit: `bcc83f88ee18760e60903d1a3aaa61ef6f70f2c9`
  (`brianhliou/pikafish-jieqi-wasm`, branch `jieqi_old-mistboard`)
- Build toolchain: `emscripten/emsdk:3.1.74`
- License: GPL-3.0-or-later (`COPYING.txt`)
- Network: none; this build uses the branch's handcrafted evaluation

Since 2026-08-31 this is not a stock upstream build. `source.patch` carries the
WASM entry points **and** our engine changes. The server binary carries both:
the analysis board and the bot are deliberately the same engine, and moving one
without the other breaks that.

`src/misc.h` (2026-08-31): `ScoreCalc` no longer lets a forced loss be averaged
away at dark-piece flip nodes. A mate was clamped to ±`DARKVALRATE` (2862) and
then diluted by the other revealed identities, so the engine could report a
comfortable advantage in a position where it was being mated.

`src/search.cpp` (2026-09-03): `qsearch()` checks `Threads.stop`, and the main
thread calls `check_time()`, at its entry. It had neither, and the dark-piece
recursion re-enters qsearch at depth 0 without reducing depth, so a thread
inside one of those tails could not be stopped by `go movetime` and `bestmove`
waited on the slowest helper. Server-side that was the tail of the #335
timeouts; in the browser it is a search that overruns the depth the user asked
for.

`src/misc.h`, `src/search.cpp` (2026-10-02, #497): reveals are scored honestly.
`ScoreCalc` flipped each revealed identity's score for one colour, keyed on a field
nothing assigns, so Black's reveals took the best identity instead of the worst.
And an identity whose PV search failed low returned the window edge, which the
average took as an exact score; fail-lows at the root are now re-searched.

The build exposes a persistent `pikajieqi_command(const char*)` UCI entry point.
`worker.js` hosts the module and forwards streaming UCI output to the web client.
The generated module uses pthreads and therefore requires a cross-origin-isolated
document.

## Rebuild

`pikajieqi-source-bcc83f8.tar.gz` is the complete corresponding source used for
the distributed binary. Extract it and run:

```sh
docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:3.1.74 \
  bash wasm/build.sh
```

For a smaller audit trail, the same source is reproducible from the exact
upstream commit plus the adjacent `source.patch`:

```sh
git clone https://github.com/official-pikafish/Pikafish.git
cd Pikafish
git checkout 23b9466c981f0f3a1133f92de1a6f86406c4eccc
git apply /path/to/source.patch   # WASM entry points + the misc.h and search.cpp engine fixes
mkdir -p wasm
cp /path/to/build.sh wasm/build.sh
docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:3.1.74 \
  bash wasm/build.sh
```

Keep this README, the source archive, `source.patch`, `build.sh`, and
`COPYING.txt` alongside any distributed binary build.
