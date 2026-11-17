# Native Rapfi strongest policy (#1175)

`rapfi-strongest` is a separate native serving policy. Its fixed search ceiling
is **5,000 ms**, reduced by the existing live clock allocator. It sends
`INFO timeout_turn <allocated-ms>` and **no `INFO max_node` command**. It uses
Rapfi's final legal move directly, without candidate sampling, tactical
replacement or other weak-move selection. Levels 1–8 retain every calibrated
node, time and choice setting.

Serving retains one thread, the pinned mix9svq freestyle network, 32 MiB hash,
a fresh process per move, the shared four-process live pool and server-wide
physical process cap, 30-second queue timeout, child reaping, stale-turn checks,
clock budgeting and engine-failure handling. No public bot roster or level
selector is changed in this slice.

## Measurement admission and hardware

Measured locally on 2026-11-16, after the machine load guard reported `ready`:
Apple M3 Max, 14 logical CPUs, 36 GiB RAM, macOS/Darwin arm64. The supplied
executable is Mach-O arm64, built from `rapfi.ref`
`1387d11312190ec66665d361ff07a7c70221b78a`. Production uses the pinned x86-64
Haswell build; these are local latency observations, not production timings
or a strength comparison between machines.

`node scripts/rapfi-assets.mjs search tmp/rapfi-native` exited 0. The measurement
also verified every config/network/license digest with the same asset checker,
required the mix9svq freestyle network-load diagnostics, rejected engine errors,
and checked that each move landed on an empty point. Every observation used a
fresh process, one thread, 32 MiB hash, freestyle rule 0, no node command and no
candidate request. `INFO show_detail 2` was enabled only for the comparison's
timing/depth diagnostics. Each process received `START 15`, waited for `OK`,
then received the limits and an ordered `BOARD`/`DONE`; `END` reaped it.

Times below run from immediately before process spawn to the final move line,
so they include executable startup, config load and lazy neural-network load.
They exclude queue wait. Reaping added 1.0–1.4 ms.

## Positions

Point names use the kernel's a1–o15 coordinates. B/W identify actual stone
colours; `rapfiBoardLines` converts them to mover-relative fields and orders
the board for the requested turn.

| Position | Black stones | White stones | Turn |
| --- | --- | --- | --- |
| gmk-001 (3 stones) | h8 f6 | i9 | White |
| gmk-002 (4 stones) | h8 f6 | i9 i10 | Black |
| gmk-003 (5 stones) | h8 i9 f6 | h9 f8 | White |
| Six-stone middlegame | h8 i9 g9 | h9 i8 g8 | Black |
| gmk-051 (current dealt pool) | g6 g7 | g8 h8 j10 | Black |

## Comparison and chosen ceiling

| Position | 3,500 ms cap: wall ms | 5,000 ms cap: wall ms | Last reported depth: 3.5 s → 5 s |
| --- | ---: | ---: | ---: |
| gmk-001 | 3523.9 | 3845.2 | 24 → 25 |
| gmk-002 | 2659.1 | 4318.3 | 25 → 27 |
| gmk-003 | 3196.3 | 4841.4 | 23 → 24 |
| Six-stone middlegame | 2830.8 | 4125.6 | 26 → 29 |

Handshake took 22.9–24.5 ms; the network was loaded by 52.0–53.8 ms from spawn.
With 5,000 ms, every measured move, including startup and net load, fit inside
the ceiling (maximum 4841.4 ms). The shorter cap produced one 3523.9 ms total
and shallower last-reported searches. Five seconds gives the distinct top
policy more search time while retaining a bounded per-turn CPU/latency budget;
it is a latency choice, not a demonstrated playing-strength gain.

The actual `gomokuLiveEngineMove` serving path, without the comparison's detail
override, was then exercised on gmk-051 with `RAPFI_BIN` pointing to the staged
native binary:

| Allocated timeout_turn | Move | Spawn to reply | Whole call including reaping |
| ---: | --- | ---: | ---: |
| 5,000 ms | f8 | 4103 ms | 4105.2 ms |
| 125 ms (clock-pressure probe) | f8 | 148 ms | 149.6 ms |

Both serving calls confirmed the pinned neural network load and returned legal
moves. `timeout_turn` caps engine search time, not total call time: startup and
network load sit outside Rapfi's search timer, as the 125 ms probe shows. The
existing initialization watchdog and search watchdog (search budget + 2 s)
remain unchanged. This sample establishes that cold startup fits the selected
5 s ceiling locally; it does not promise every move or every host finishes
within 5 s wall time. Using a time cap rather than a node anchor lets hardware
speed change searched depth without scaling the configured search latency.

## Verification scope

Regression coverage checks time-only strongest commands, native final-move
selection for both colours, legacy empty boards, clock pressure and fixed-cap
clamping, strict identity/version validation, HTTP creation/replay recognition,
pool sharing, child reaping and stale turns. Existing tests pin the exact eight
level configurations and exercise all eight levels for both colours.

Only the touched server test files and the touched Vitest Rapfi policy file
are run in this branch, followed by workspace typecheck and named-file Biome,
per the slice's targeted-test instructions. The registration module, roster,
database and browser serving implementation are unchanged. The sequential
chain's final branch owns the merged full gate and release.


## Paired native calibration (#1177)

On 2026-11-16, the same local M3 Max arm64 binary played **40 complete games**
against unchanged Level 8, using 20 dealt openings sampled without replacement
from the live pool (seed `20261116`), with colors exchanged for every opening.
Every game ended in kernel five or full-board adjudication; none was truncated.
Six games were active at most, with searches held to the live four-process pool.
The run took 1,995.737 seconds (33 minutes 16 seconds).

Strongest finished **28 wins, 11 draws, 1 loss**, scoring **83.75%** with draws
worth half a point. Its **95% paired-bootstrap score interval is 77.5%–90.0%**
(100,000 resamples of whole opening pairs). This demonstrates a score above
Level 8 on this local sample, without estimating a full random-floor Elo rating.
Strongest scored 14/6/0 as Black and 14/5/1 as White (W/D/L).

| Policy | Observed moves | Median move time | Maximum move time |
| --- | ---: | ---: | ---: |
| Rapfi Strongest, time-only 5,000 ms | 1,992 | 4,290.5 ms | 5,042 ms |
| Level 8, 80,000 nodes / 3,500 ms | 1,979 | 342 ms | 653 ms |

Move times run from spawn through the final move, including cold startup and
network loading; they exclude pool queue wait and child reaping. The 5,042 ms
maximum illustrates why a search ceiling is not a whole-call wall-time limit.
The native search/selection policy is unchanged, including no node command or
candidate weakening for strongest. Levels 1–8 retain their original settings.

All 40 histories (3,971 recorded placements) replayed legally to their claimed
results through both the game kernel and tenant event runtime. Every placement
also matched its recorded seed, color and per-move telemetry. The evidence pins
the actual executable/network SHA256 and the catalogue's full source, network,
search configuration and policy signature for every native tier. Historical
records were not changed; new evidence remains in local scratch under
`tmp/1177-ladder/`. Production uses x86-64 rather than this arm64 build, so these
move timings are local observations, not production latency guarantees.

Reproduce with an installed pinned native binary (output appends a new run):

```sh
RAPFI_BIN=/path/to/rapfi node scripts/gomoku-level-ladder.mjs --engine native --games 40 --seed 20261116 --pairs 8-rapfi-strongest --parallel 6 --label strongest-v-level8-1177 --output tmp/1177-ladder/native40.json
node scripts/gomoku-level-ladder.mjs --summary tmp/1177-ladder/native40.json
```

`--parallel` accepts 1–6 only on native; the historical default pairing plan
and serial WASM behavior remain unchanged. Native policy overrides are refused.
