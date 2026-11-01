# Rapfi level calibration — 2026-11-01

Eight browser levels are active for hidden, unrated, admin-only playtesting. L1-4 use seeded
eval-weighted selection; L5-8 take the best move under increasing node budgets.
Existing `rapfi-level-1` through `rapfi-level-5` ids remain valid, the new ids are
`rapfi-level-6` through `rapfi-level-8`, and the default remains L1. These small
measurements do **not** establish an evenly spaced ladder or beginner suitability.

The s-6c06 table below is **attempt 1, measured with the BOARD-order bug**.
Rapfi searches for whoever follows the last listed stone; board-index order
therefore searched for the opponent on about half of moves. Commit
`ebb6b3637` (2026-11-01) makes the last listed stone belong to the opponent
of the requested side to move. The original
`gomoku-level-ladder.json` is preserved
byte for byte. Its results are historical diagnostics, not evidence of the
fixed engine's strength. The second attempt has its own record, `gomoku-level-ladder-fixed.json`.

## Active policy

| Level | Nodes | Search ceiling (ms) | Candidates | Inclusive eval margin |
| --- | ---: | ---: | ---: | ---: |
| L1 | 5,000 | 1,000 | 128 | 60,000 |
| L2 | 10,000 | 1,000 | 16 | 2,000 |
| L3 | 20,000 | 1,500 | 8 | 750 |
| L4 | 40,000 | 1,500 | 4 | 300 |
| L5 | 80,000 | 2,000 | best | n/a |
| L6 | 150,000 | 2,500 | best | n/a |
| L7 | 250,000 | 3,500 | best | n/a |
| L8 | 400,000 | 4,750 | best | n/a |

Time limits are ceilings, with nodes as the search-strength dial. L8 reserves
250 ms for the transport/watchdog inside its 5,000 ms limit: the engine receives
4,750 ms, and both the browser and ladder reject worker times over 5,000 ms.
Module loading has a separate 30-second watchdog. The move ceiling covers the
worker command request, including any lazy neural-network initialization on
the first move; it does not promise a five-second asset download.

For ordinary tier play, pass the per-ply seed as the third argument:

```ts
const gameSeed = rapfiGameSeed(roomId);
const result = await engine.chooseMove(position, level, rapfiPlySeed(gameSeed, absolutePly));
```

The adapter takes candidate count and margin from `RAPFI_LEVELS`. Explicit
`{ candidateCount, evalMargin, seed }` overrides retain the
[candidate API](gomoku-rapfi-candidates.md) for analysis and tests. An omitted
seed defaults to zero; live games always supply a room/absolute-ply seed.
Retries of one frame reuse its seed, and different plies use different seeds,
including the dealt opening stones. The ladder records each game seed and
derives each ply seed with the same helpers.

The kernel protects a win in one and an opponent four before weighted choice,
even when Rapfi omits that point from its candidates. There is no unscored
fallback for a missing candidate stream on a nonempty, nontactical board.
An empty board is a special protocol case: Rapfi returns center without PV
detail, so both live tier play and calibration send plain `BEGIN` there.
Explicit candidate requests keep their existing fail-closed parsing contract.
The exported parser normalizes structured `INFO EVAL +M3` / `-M4` to 29997 /
-29996 before the shared PV-block validator; human `MESSAGE` text is never
used as evaluation or PV evidence.

## Attempt 2: fixed BOARD order (s-94a1)

Same policy, openings, run seed `20261101` and per-game/per-ply seeds as
attempt 1, on the engine after `ebb6b3637`. The full 14-pairing ladder ran at
20 games per pairing; the two top pairings, the only attempt-1 misses above
L4, were then rerun at 60 games each (30 openings, both colours). No policy
was changed. Record: `gomoku-level-ladder-fixed.json`.

| Pairing (weaker / stronger) | Stronger wins | Weaker wins | Draws | Stronger score |
| --- | ---: | ---: | ---: | ---: |
| baseline-1 … baseline-8 | 20/20 each | 0 | 0 | 100% |
| 1-3, 2-4, 3-5, 4-6 | 20/20 each | 0 | 0 | 100% |
| 5-7 (20 games) | 12 | 1 | 7 | 77.5% |
| 6-8 (20 games) | 7 | 2 | 11 | 62.5% |
| **5-7 (60 games)** | 29 | 6 | 25 | **69.2%** |
| **6-8 (60 games)** | 20 | 6 | 34 | **61.7%** |

Score counts a draw as half. For the 60-game pairings, 95% intervals from a
bootstrap over the 30 opening clusters (both colours resampled together):

- 5-7: score 60.0–77.5%; win rate 35.0–61.7% (Wilson 36.2–60.7%).
- 6-8: score 55.0–68.3%; win rate 23.3–43.3% (Wilson 22.7–45.9%).

Both score intervals exclude 50%, so L7 is measurably stronger than L5 and
L8 than L6. Neither reaches a 65% win rate: the top of the ladder separates
by fewer losses, not more wins. Every draw is a full board (25 of 60 at 5-7,
34 of 60 at 6-8; median game length 91 and 225 plies). There were no
move-limit draws, resignations or engine errors.

The attempt-1 top misses (50% and 35%) were mostly the BOARD-order bug: a
side that searched for its opponent on about half its moves. Below L5 the
fix turns every two-step pairing into a sweep, which says the low ladder is
steep rather than evenly spaced. baseline-1 stays 10 points above the 90%
upper target.

### The top levels are partly time-bound

`ceilingHits` is zero everywhere, but L8 runs at the edge of its ceiling:

| Level | Node budget | Ceiling (ms) | Slowest move (ms) | p95 (ms) | Moves stopped below 90% of budget |
| --- | ---: | ---: | ---: | ---: | ---: |
| L5 | 80,000 | 2,000 | 1,098 | 878 | 324 / 3,789 (9%) |
| L6 | 150,000 | 2,500 | 2,475 | 1,765 | 357 / 4,443 (8%) |
| L7 | 250,000 | 3,500 | 3,468 | 2,817 | 449 / 3,803 (12%) |
| L8 | 400,000 | 4,750 | 4,741 | 4,585 | 883 / 4,452 (20%) |

The 60-game runs shared a 14-core laptop, at most three searches at once.
Rapfi's own time management stops a search before the hard ceiling, so one L8
move in five ended short of its node budget even here. On a slower phone more
L8 and L7 searches stop on time and the two levels converge toward each
other; these numbers do not measure that.

### Recommendation

Keep `RAPFI_LEVELS` unchanged and Gomoku hidden. The fix removes the evidence
that the top levels fail to separate; it does not make the ladder even. Before
any launch claim of eight distinct levels: run L6-8 on a mid-range phone and
report the share of time-bound moves, and widen the L1-L4 spacing (they all
sweep the level two below). Beginner suitability remains unmeasured.

`fixed-board-full`: 9,071 s, 280 games. `fixed-board-top60-5-7`: 9,077 s, 60
games. `fixed-board-top60-6-8`: 18,940 s, 60 games.

## Attempt 1: bounded eight-level measurements (BOARD-order bug)

Both attempts use **20 games per pairing**, with ten screened openings and both color assignments. All eight levels play
the random-tactical baseline, then L3-8 play the level two below: **14 pairings,
280 games in the initial run**. Only L1 changes, so the single tuning rerun
repeats `baseline-1` and `1-3` (40 games); unchanged policies retain the initial
measurements. Both attempts use run seed `20261101`, the same sampled
openings and per-game/per-ply seed derivation. Every game reaches a kernel
five/overline or board-full result; there are no move-limit draws or resignations.

| Pairing (weaker / stronger) | Initial stronger wins | After L1 tuning (still bugged) | Attempt-1 target result |
| --- | ---: | ---: | --- |
| baseline-1 | 20/20 (100%) | 20/20 (100%, rerun) | MISS: 10 pp above 90% |
| baseline-2 | 20/20 (100%) | 20/20 (100%, initial) | baseline measured; no upper-tier target |
| baseline-3 | 20/20 (100%) | 20/20 (100%, initial) | baseline measured; no upper-tier target |
| baseline-4 | 20/20 (100%) | 20/20 (100%, initial) | baseline measured; no upper-tier target |
| baseline-5 | 20/20 (100%) | 20/20 (100%, initial) | baseline measured; no upper-tier target |
| baseline-6 | 20/20 (100%) | 20/20 (100%, initial) | baseline measured; no upper-tier target |
| baseline-7 | 20/20 (100%) | 20/20 (100%, initial) | baseline measured; no upper-tier target |
| baseline-8 | 20/20 (100%) | 20/20 (100%, initial) | baseline measured; no upper-tier target |
| 1-3 | 18/20 (90%) | 20/20 (100%, rerun) | meets 65% |
| 2-4 | 13/20 (65%) | 13/20 (65%, initial) | meets 65% |
| 3-5 | 17/20 (85%) | 17/20 (85%, initial) | meets 65% |
| 4-6 | 14/20 (70%) | 14/20 (70%, initial) | meets 65% |
| 5-7 | 10/20 (50%) | 10/20 (50%, initial) | MISS: 15 pp below 65% |
| 6-8 | 7/20 (35%) | 7/20 (35%, initial) | MISS: 30 pp below 65% |

Every remaining target miss:

- L1 / baseline: **20/20 (100%)**, 10 percentage points above the 90% upper target.
- L7 / L5: **10/20 (50%)**, 15 percentage points below 65%.
- L8 / L6: **7/20 (35%)**, 30 percentage points below 65%.

The initial L1 result was **20/20 (100%)**, 10 percentage points above the upper target.
The one tuning rerun widens L1 from 32 candidates / 6,000 eval margin to 128
candidates / 60,000 margin; all node budgets, time ceilings and other policies
are unchanged. Tactical protection still applies before this wider choice.
No further tuning is permitted for this calibration. Initial two-level misses:

- L7 / L5: **10/20 (50%)**, 15 percentage points below 65%.
- L8 / L6: **7/20 (35%)**, 30 percentage points below 65%.

`eight-level-initial`: 755.7 seconds; 280 games.
Slowest L8 move 3924.9 ms; L8 search-ceiling hits 0.

`eight-level-tuning-rerun`: 11.1 seconds; 40 games.

All results are wins, with draws recorded separately in the JSON. Paired games
are correlated and 20 per matchup is a diagnostic sample, not an Elo estimate.
Node budgets can still stop early at the time ceiling on slower devices. The
headless Node transport uses the vendored single-thread browser WASM, unchanged
worker, pinned network and shared command/parser/selector; these are laptop
measurements, not a browser/device benchmark. Separate heaps per side and
`YXHASHCLEAR` before each game prevent cross-game search-table carryover.

Preflight requests at tiny budgets exposed incomplete structured PVs and were
aborted before a complete pairing; none were scored. Active candidate tiers
start at 5,000 nodes to allow a completed PV. Engine errors, illegal replies
and watchdog failures abort calibration rather than count as a loss or draw.

Record: `gomoku-level-ladder.json`. The two
budget-only historical runs below remain unchanged, followed by both new runs.
Each new run retains complete policies, engine/network checksums, openings,
game seeds, every move, terminal results, search timings and ceiling-hit counts.

Reproduce the active policy (appends a distinct run; use a scratch output while
reviewing so this bounded calibration keeps only its two completed attempts):

```sh
node scripts/gomoku-level-ladder.mjs --games 20 --seed 20261101 --label review --output /tmp/gomoku-review.json
node --test scripts/gomoku-level-ladder.test.mjs   # record pins skip unless GOMOKU_LADDER_DATA names the records
```

The CLI also accepts `--pairs` (for example `baseline-1,1-3`), `--budgets` (eight
increasing positive integers), `--games` (even), `--seed`, `--label` and
`--output`. Assets must already be staged; the runner never fetches them.
Pin tests require matching full policies across all 14 active pairings, game
seeds, historical results, at most one tuning rerun and legal terminal replay of every game.

## Historical five-level node-only calibration

The first 100-game run does **not** establish a beginner-friendly, evenly spaced
ladder. Gomoku stayed hidden and unrated. The recommendation at the time was
to keep `RAPFI_LEVELS` unchanged: the single proposed rerun also failed the
spacing criteria.

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
that the current L1 is suitable for beginners. No node budget or time ceiling was changed in those two historical attempts. A follow-up should narrow the L1/L2 gap and use more paired
openings before considering launch; actual beginner play remains unmeasured.

The machine-readable record is `gomoku-level-ladder.json`.
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
