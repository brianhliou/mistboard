# Banqi luck grading benchmark (#1073)

Pass 2 selects **200k nodes per legal root move**: **4.59×** faster than
the original, with **90.625%** agreement. The under-two-minute target was
**not reached**. Pass 1's results and the full pass 2 comparison are below.

## Pass 1

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

## Pass 2

The **200k** budget is the lowest measured budget that clears the 90% agreement
requirement. The requested 20k, 50k and 100k trials all miss it. The 20k trial
meets the time target, but retains only 83.3% of the old best moves. None of the
measured budgets clears both thresholds. All four trials grade all 96 flips in
the same three complete games, against the original `before.json`.

| Root ranking budget | Game 1 s/game | Game 4 s/game | Game 19 s/game | Old best in cheap top three |
| --- | ---: | ---: | ---: | ---: |
| [20k](pass2-20k.json) | 103.7 | 91.5 | 117.2 | 80/96 (83.333%) |
| [50k](pass2-50k.json) | 111.7 | 103.6 | 137.8 | 84/96 (87.500%) |
| [100k](pass2-100k.json) | 125.2 | 121.5 | 146.5 | 83/96 (86.458%) |
| [200k](pass2-200k.json) | 172.2 | 232.0 | 195.9 | 87/96 (90.625%) |

The [200k ranking probe](ranking-probe-200k.json) first checked the shortlist
without running baselines. Its 96 top-three lists exactly match the subsequent
full [selected run](pass2-200k.json). [The selected comparison](comparison-pass2-200k.json)
preserves every flip's deltas against the original, including all nine missed
old best moves. The other `comparison-pass2-*` files retain the rejected trials.

| Aggregate | Original | Pass 1 | Pass 2 (200k) |
| --- | ---: | ---: | ---: |
| Mean s/flip | 28.71 | 20.35 | 6.25 |
| Physical searches | 18,427 | 18,496 | 4,660 |
| Requested nodes | 4,557,399,634 | 3,643,850,000 | 932,000,000 |

| Absolute change vs original, percentage points | Mean | P95 | Maximum |
| --- | ---: | ---: | ---: |
| Decision loss | 0.1212 | 1.0349 | 1.5027 |
| Luck | 0.0172 | 0.0457 | 1.1388 |

Ranking queries fall from **18,427 to 1,953**. The selected run also makes
**2,707 baseline queries**, for **4,660 physical searches** total.

Ranking now consumes **40.5%** of runtime; the retained full baselines consume
the remainder. No cap hits, missing node
reports or pool timeouts occurred. The final production source hash matches
the selected report's implementation hash.

These are sequential single trials on the same shared Mac, with the same
engine/net hashes and cold exact-query cache per game. Host timing varied
across trials; production CPU and repeated timing distributions were not measured.

Ranking now makes **one search per legal move**, including flips. The v0.3.0
engine supports `go ... searchmoves <move>` on the public pre-move position.
In the supplied engine source, `best_at_depth` restricts the root, `move_value`
dispatches flips to `flip_value`, and `flip_value` weights each identity by its
count in `st.bag`. The engine returns the root mover's score. Ranking preserves
that sign for both seats and retains the pre-move repetition window for quiet
moves and flips alike. The engine worktree was only read.

These root estimates select candidates only. The top three plus played still
receive the same per-identity, multiset-preserving pool-mean baselines, with a
shared 200k budget and 200k floor per term. The played reveal remains one term
of its own mean. Averaging engine values at the root differs from averaging
converted win percentages; the published baseline calculation is unchanged.
Decisions and checkpoints use cache identity **d7**.

The opening ranking regression pins 32 queries instead of pass 1's 448.
Another regression covers mixed quiet/flip roots with a real repetition window
and both score perspectives. Each review launches at most two ranking queries,
matching the existing baseline identity concurrency and analysis pool bound.

## Pass 1 load test

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
node --import tsx scripts/banqi-luck-bench/bench.mjs after 89bd91888
node scripts/banqi-luck-bench/compare.mjs
# Pass 2, sequential full-game budget trials; preserve the pass 1 artifacts.
node --import tsx scripts/banqi-luck-bench/bench.mjs pass2-50k
node scripts/banqi-luck-bench/compare.mjs pass2-50k
node --import tsx scripts/banqi-luck-bench/bench.mjs pass2-20k
node scripts/banqi-luck-bench/compare.mjs pass2-20k
node --import tsx scripts/banqi-luck-bench/bench.mjs pass2-100k
node scripts/banqi-luck-bench/compare.mjs pass2-100k
# The smaller budgets missed 90%; probe 200k, then measure full baselines.
node --import tsx scripts/banqi-luck-bench/rank-probe.mjs 200000
node --import tsx scripts/banqi-luck-bench/bench.mjs pass2-200k
node scripts/banqi-luck-bench/compare.mjs pass2-200k
# The pass 1 load probe is intentionally not rerun for pass 2.
```

The `pass2-*` labels override only the ranking query node budget through the
injected evaluator; baseline budgets and selection logic use production code.
Reports record that budget and the corresponding engine identity. An optional
source revision freezes an older implementation, as in the pass 1 `after` run.

Run sequentially; rerunning a label replaces its data. Benchmarks checkpoint
each flip, but valid reports require `finishedAt` and three complete games.
The load probe clears persistence configuration and binds loopback ports.

Pass 1 validation: 84 targeted analysis/engine/routes tests passed, including all eight
real-engine levels; one existing #999 TODO remains. Server/integration/loadtest
typechecks passed. The unchanged runner test passed 10/10 consecutive runs under
benchmark load (#1068). Full repository tests and browser tests were not run.

Pass 2 validation: **86 targeted tests passed**, including all eight real-engine
levels and both added regressions; the existing #999 TODO remains. No tests
were skipped. Server, integration and loadtest typechecks passed. Biome passed
from the worktree root on the six changed source files and nine new JSON reports,
using named paths only. The opening count regression was also checked against
pass 1: 448 calls instead of the required 32, so it rejects that implementation.

The targeted validation uses the same files as pass 1:

```sh
node --import tsx --test --test-concurrency=1 \
  apps/server/src/banqi-analysis.test.ts \
  apps/server/src/banqi-analysis-grading.test.ts \
  apps/server/src/banqi-analysis-query-cache.test.ts \
  apps/server/src/banqi-analysis-runner.test.ts \
  apps/server/src/banqi-analysis-parallel.test.ts \
  apps/server/src/banqi-engine.test.ts \
  apps/server/src/server-banqi-engine-decisions.test.ts \
  apps/server/src/routes/banqi-games.test.ts
npm run typecheck --workspace @mistboard/server
```

Pass 2 skips the load probe: queue admission and the two-query bound per review
are unchanged. No dev server or Postgres was started. The pass 1 ten-repeat
runner soak under load was not repeated. Production CPU, browser/WAN, real
DB/auth review endpoints, basic-sweep load and the full repository test suite
remain unchecked.
