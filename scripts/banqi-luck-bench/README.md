# Banqi luck grading benchmark (#1073)

Observed speedup: **1.41×** across 96 flips. The one-minute game target
was **not reached**: the new method takes 10.1–12.2 minutes per game here.
Ranking consumes 99.3% of runtime because the 200k identity floor dominates.

Measured 2026-11-12 on an Apple M3 Max (14 logical CPUs), Darwin 27.2.0,
Node 26.11.1. This shared host had timing variation; these are single runs,
with short validation checks overlapping part of the original run.
Production CPU performance was not measured.

| Game (plies) | Before s/game | After s/game | Before s/flip | After s/flip |
| --- | ---: | ---: | ---: | ---: |
| Game 1 (66) | 771.0 | 608.0 | 24.09 | 19.00 |
| Game 4 (120) | 1025.6 | 612.4 | 32.05 | 19.14 |
| Game 19 (222) | 959.8 | 733.5 | 29.99 | 22.92 |

| Aggregate | Before | After |
| --- | ---: | ---: |
| Mean s/flip | 28.71 | 20.35 |
| Physical searches | 18,427 | 18,496 |
| Requested nodes | 4,557,399,634 | 3,643,850,000 |

Savings come from lower search budgets. No timing-cap hits were reported.

The old best move is in the new cheap top three on **91/96 flips
(94.8% agreement)**, and outside on 5/96, using the old method's
stable best-move tie-break. [comparison.json](comparison.json) preserves every
flip's decision loss and luck in both versions.

| Absolute change, percentage points | Mean | P95 | Maximum |
| --- | ---: | ---: | ---: |
| Decision loss | 0.0816 | 0.7000 | 1.5027 |
| Luck | 0.0172 | 0.0457 | 1.1388 |

[Before](before.json) and [after](after.json) cover complete self-play games
1, 4 and 19 in `scripts/data/banqi-study.json` (seeds 320, 339, 331), each
with 32 flips. Last flips are at plies 65, 79, 144. The pinned corpus is
replayed through terminal states under its stored legacy rules.

Both versions use the same engine, net, cache and harness, with two analysis
slots and an empty exact-query cache per game; reuse within games is retained.
Original code is pinned to `a90cc8a20`. Per-flip times, search/node counts and
asset hashes are in the data; counts exclude cache hits and terminal positions.
This sample does not establish calibration against player outcomes.

The port ranks quiet moves at 50k nodes and shares 50k over a flip's distinct
hidden identities with a 200k floor. Only the top three plus played receive
baselines, sharing 200k across candidates and identities with the same floor.
Played is always included. Identical ranking queries are reused for baselines;
quiet baselines use 200k. The decisions cache identity is bumped to d6.

## Load test

[load.json](load.json) runs a memory-only app server with real Banqi WebSockets
and NNUE bots. Three fixture accounts submit reviews through an HTTP adapter
to the production route factory, queue and resolver. Basic-analysis readiness
is stubbed as a cache hit. The 60 s queued test admits one active review;
a 30 s direct test bypasses the queue with three reviews, skipping their first
flip to avoid opening-query coalescing. Jobs are cancelled after observation.

| Phase | P95 WS RTT ms | P95 bot reply s | P95 fixed L8 search s |
| --- | ---: | ---: | ---: |
| unloaded | 0.398 | 2.421 | 1.896 |
| three queued reviews | 0.353 | 2.365 | 1.937 |
| three direct concurrent reviews | 0.346 | 2.110 | 1.939 |

Analysis peak: **2 active, 4 waiting**, with **0 queue timeouts**.
All 30 bot replies completed without fallback or failure. Each of 24 paired
fixed-position searches reported 2,000,001 nodes for its 2M budget. Database,
authentication, basic-sweep compute, browser rendering, WAN latency and production
CPU were not load-tested. Full-game completion is covered by the benchmarks.

## Reproduce and validate

From this worktree, with dependencies installed:

```sh
export MISTBOARD_BANQI_ENGINE_PATH=/Users/brianliou/projects/misty-banqi-wt-v030/target/release/banqi-engine
export MISTBOARD_BANQI_NET=/Users/brianliou/projects/misty-banqi-wt-net/nets/misty-banqi-0.3.0.bqnn
export MISTBOARD_BANQI_ANALYSIS_MAX_PROCESSES=2
node scripts/ensure-packages-built.mjs
node --import tsx scripts/banqi-luck-bench/bench.mjs before a90cc8a20
node --import tsx scripts/banqi-luck-bench/bench.mjs after
node scripts/banqi-luck-bench/compare.mjs
node --import tsx scripts/banqi-luck-bench/load.mjs
```

Run sequentially; rerunning a label replaces its data. Benchmarks checkpoint
each flip, but valid reports require `finishedAt` and three complete games.
The load probe clears persistence configuration and binds loopback ports.

Validation: 84 targeted analysis/engine/routes tests passed, including all eight
real-engine levels; one existing #999 TODO remains. Server/integration/loadtest
typechecks passed. The unchanged runner test passed 10/10 consecutive runs under
benchmark load (#1068). Full repository tests and browser tests were not run.
