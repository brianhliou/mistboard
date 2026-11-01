# Rapfi level calibration — 2026-11-01

The first 100-game run does **not** establish a beginner-friendly, evenly spaced
ladder. Gomoku stays hidden and unrated. **Keep `RAPFI_LEVELS` unchanged:** the
single proposed rerun also fails the spacing criteria.

| Pairing | Original nodes, weaker / stronger | Stronger wins | Draws |
| --- | --- | --- | --- |
| Random tactical baseline / L1 | baseline / 100 | 20/20 (100%) | 0 |
| L1 / L2 | 100 / 1,000 | 9/20 (45%) | 0 |
| L2 / L3 | 1,000 / 5,000 | 10/20 (50%) | 0 |
| L3 / L4 | 5,000 / 20,000 | 8/20 (40%) | 0 |
| L4 / L5 | 20,000 / 100,000 | 10/20 (50%) | 0 |

Initial wall time: 100.6 seconds, including initialization, serial play and
checkpoint writes. Each pairing uses ten distinct screened openings with both
colour assignments: 20 games per pairing. These paired games are correlated;
this is a small diagnostic sample, not an Elo estimate or proof of human skill.

All four adjacent steps fell below the card's 60% threshold, against a target
near 75%. The one proposed rerun uses **1 / 1,000 / 20,000 / 100,000 / 500,000
nodes**. This tests the minimum positive budget for L1, widens the early gaps
and raises the upper budgets while keeping the browser's 1 / 1.5 / 2 / 3 / 5
second ceilings. It reruns every affected pair, including the baseline, on the
same openings and seed.

| Pairing | Proposed nodes, weaker / stronger | Stronger wins | Draws |
| --- | --- | --- | --- |
| Random tactical baseline / L1 | baseline / 1 | 18/20 (90%) | 0 |
| L1 / L2 | 1 / 1,000 | 20/20 (100%) | 0 |
| L2 / L3 | 1,000 / 20,000 | 12/20 (60%) | 0 |
| L3 / L4 | 20,000 / 100,000 | 10/20 (50%) | 0 |
| L4 / L5 | 100,000 / 500,000 | 8/20 (40%) | 0 |

Rerun wall time: 392.7 seconds. Total: **200 games in 493.3 seconds (8.2
minutes)**, 20 per pairing per attempt. There were no draws. The recorded
`ceilingHits` counts worker wall times at or above the configured ceiling;
all were zero. The proposal's slowest move took 4,973 ms against a 5,000 ms
ceiling, so this does not rule out the engine's internal time-management
reserve stopping a search early. Node limits remain the strength dial and
time limits remain ceilings; the proposal's upper tier needs particular care
on slower machines.

At one node L1 is beatable by the baseline in this sample, but L2 then wins
every game against it. The proposed L3/L4 step still fails the lower threshold.
These measurements support neither a fair five-level replacement nor a claim
that the current L1 is suitable for beginners. No node budget or time ceiling
has been changed. A follow-up should narrow the L1/L2 gap and use more paired
openings before considering launch; actual beginner play remains unmeasured.

The machine-readable record is [data/gomoku-level-ladder.json](data/gomoku-level-ladder.json).
It retains every game, opening, colour assignment, result, node/time budget,
engine/network checksums, search timing and ceiling-hit count for both attempts.

The runner loads the exact browser WASM, data pin and unchanged `worker.js` in
two independent Node worker threads, with filesystem asset reads replacing
browser fetches. It verifies the network checksum and active `mix9svq`
evaluator. Browser and runner share `rapfiCommands`, including `START 15`,
`INFO rule 0`, `INFO max_node`, `INFO timeout_turn` and the side-relative
`BOARD` encoding. Each side has its own WASM heap; `YXHASHCLEAR` between games
prevents prior games' search tables leaking into later games. Searches remain
serial. The browser's timeout plus 250 ms watchdog terminates a stalled worker;
illegal replies and engine errors abort the run instead of becoming results.

Opening selection reuses `GOMOKU_OPENINGS` from the game package, the same
uniform screened pool the live tenant deals, sampled without replacement with
seed `20261101`. The package's freestyle 15×15 kernel owns every placement,
five/overline win and full-board draw. There are no artificial move-limit draws
or resignations. The baseline chooses a random legal move except that it first
completes its own immediate five or blocks an opponent's immediate five,
including open fours. It has no search, positional scoring or opening policy.

Reproduce from the repo root (existing records are appended):

```sh
node scripts/gomoku-level-ladder.mjs --output /tmp/gomoku-ladder-original.json
node scripts/gomoku-level-ladder.mjs --budgets 1,1000,20000,100000,500000 --label proposed-rerun --output /tmp/gomoku-ladder-proposal.json
node --test scripts/gomoku-level-ladder.test.mjs
```

For a quick real-WASM check, add `--games 2 --pairs 1-2`. `--seed`, `--pairs`,
`--games`, `--budgets`, `--label` and `--output` are the complete CLI. Assets must
already be staged under `apps/web/public/engine/rapfi/`; this script never fetches
anything. Game-loop tests use stub engines; the record test replays every stored
game through the kernel and fails if recorded published budgets drift from
`RAPFI_LEVELS` or lack matching measured games.

Verification for the parked branch:

- Before implementation, the new runner test failed because the module did not
  exist. After implementation, all seven runner tests pass, including forced
  five, illegal reply, tactical baseline, paired openings, budget agreement and
  full replay of the stored games.
  A scratch copy with L1's recorded budget changed from 100 to 101 fails the
  budget-agreement test as intended (`budget-drift.log`).
- Existing web engine tests: `npx vitest run src/engine/rapfi.test.ts
  src/engine/rapfi-net-pin.test.ts` — two files, 16 tests passed.
- Root `npm run typecheck` passed, including the e2e typecheck. Biome and
  `git diff --check` passed. A two-game CLI smoke using the final code and
  atomic checkpoint writer also passed (`final-cli-smoke.log`).
- The exact requested Mistboard suite built game, board-render, mahjong and
  server successfully, then stopped at tooling: 427 passed, seven failed.
  All seven failures are `listen EPERM` from localhost fixtures in
  `scripts/prod-smoke-lib.test.mjs` and `scripts/safe-deploy.test.mjs`. The
  chained workspace tests were not reached. The sandbox also refused `nice`'s
  priority change, although the command continued. This is a suite-only sandbox
  blocker; no commit, push, merge, release or gate changes were made.

Review the results and budget decision first, then the shared command builder,
Node worker transport and game-loop tests. The Mistboard session owns review
and merge after the burn runner completes the required suite outside this
sandbox and commits these seven paths: `INDEX.md`, this summary,
`docs/data/gomoku-level-ladder.json`, `apps/web/src/engine/rapfi.ts`,
`scripts/gomoku-level-ladder.mjs`, `scripts/gomoku-level-ladder.test.mjs` and
`scripts/rapfi-node-worker.mjs`. Branch:
`agent/burn-s-dfae-mistboard-calibrate-rapfi-leve`.

Local evidence logs are under
`/tmp/burn-scratch/mistboard-burn-s-dfae-mistboard-calibrate-rapfi-leve/`:
`ladder-before.log`, `ladder-tests-after.log`, `ladder-isolated.log`,
`ladder-rerun.log`, `typecheck.log` and `mistboard-suite.log`.
