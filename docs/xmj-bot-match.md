# Xiangqi Mahjong bot measurement (#675)

Stage 1 adds an offline challenger and a reproducible measurement harness. The
production bot is unchanged. Start review with `xiangqi-mahjong-danger.ts`, then
`xiangqi-mahjong-bot-match.ts` and its exhaustive-enumeration tests.

## Run

From a checkout with the existing npm dependencies installed:

```sh
node scripts/xmj-bot-match.mjs --seed 10001 --pairs 10 --danger-weight 4
```

This is a smoke of **20 matches**, each six hands. The command emits one JSON
record per seed pair (both matches' kernel hand results), followed by a summary.
No server, database, engine service, credentials, or network is needed.
`--help` describes the arguments. Invalid seeds, pair counts, weights, or bot
moves fail the run rather than being counted as draws.

## Frozen comparison and challenger

`packages/game/src/xiangqi-mahjong-bot-baseline.ts` is a byte-for-byte snapshot of
the bot at commit `8df42ac05`, taken on 2026-10-25. A SHA-256 regression test pins
its contents. Do not retune this file: future bots must remain comparable to the
same baseline. These modules are imported directly by the offline runner and
are not added to the production package barrel or bot registration.

The challenger preserves that bot's distance, summed live-outs heuristic,
claims, immediate wins, and deterministic tie ordering. Distance still ranks
first. Among equal distances, it ranks `outs - dangerWeight * dealInProbability`.
The provisional weight is **4 baseline-out units**, configured independently
with `--danger-weight`; zero reproduces the baseline exactly. This stage does
not replace summed outs with draw probability or add opponent-strategy inference.
Use separate tuning seeds to choose a different weight, then freeze it before
the promotion measurement.

For a candidate discard, `xmjUnseen` excludes our entire current hand, public
ponds, and exposed melds. It includes the opponent's concealed tiles and wall.
The candidate is already known, so it must not be added to that pool. Enumerate
each distinct opponent concealed multiset that wins with the candidate according
to `xmjWinShape`, using the public concealed-hand size and exposed meld. Its
hypergeometric weight is:

```text
product over tile kinds of choose(unseen copies, concealed copies)
----------------------------------------------------------------
          choose(total unseen, opponent concealed size)
```

Sum those weights once per multiset, including when several winning shapes
exist. The denominator includes non-waiting hands. This is the exact unconditional
deal-in probability under a neutral dealt-hand prior; actual opponent choices
can change the posterior. No opponent hand or wall is passed to either policy.

A concrete regression fixture, seed 49, starts with `rA rA rP bC bP`. Both candidate
hands have distance 2 and 8 summed outs. The baseline discards `rP` (0.9744% neutral
deal-in risk); the challenger discards `bC` (0.5470%).

## Match protocol and promotion

Each uint32 seed uses the frozen Mulberry32 generator and Fisher-Yates shuffle
to make six walls. East deals first; the kernel alternates dealers for all six
hands, including exhausted walls. A seed pair plays these identical walls twice,
with challenger/baseline policies exchanging east and west seats. Legal actions,
claim-window runtime passes, hand scoring, and match winners come from the
existing rules/room kernel. Missing or illegal actions throw.

The summary separates:

- Match wins, draws, losses, and score `(wins + draws / 2) / matches`.
- Total challenger-minus-baseline tai difference across both seats.
- Discard losses (deal-ins) for each policy, excluding self-draw losses.
- Exhausted walls, independent of tied six-hand matches.

The paired 95% interval is a conservative, two-sided Hoeffding interval on
**seed-pair mean scores**, not on supposedly independent seat games. For N pairs
its radius is `sqrt(log(40) / (2*N))`, clipped to [0,1]; fewer than two pairs
reports no interval. It remains nondegenerate even when all sampled matches
are wins. Promotion requires match score at least 0.55 and paired lower bound
strictly above 0.50. At 2,000 pairs the radius is about 0.0304.

After merge, the owner can launch the requested detached **4,000-match / 2,000-pair**
measurement on fresh, non-tuning seeds:

```sh
nohup node scripts/xmj-bot-match.mjs --seed 20001 --pairs 2000 --danger-weight 4 \
  > /tmp/xmj-675-measurement.jsonl 2>&1 &
```

The parked build does not launch that measurement or promote the challenger.
A future promotion needs the full measurement; this smoke cannot justify it.

## Parked-build evidence

Burn `2026-10-25-0146`, branch `agent/burn-675-xmj-bot-1-3-match`.
Eight changed files, with no production behavior or payload changes.

The new test suite was run before implementation and exited 1 because the new
danger module did not exist. A further regression caught a stale room turn after
new deals (exit 1 before correction); using the room runtime transition fixed it.
After implementation, the matching kernel, room,
and bot-measurement tests passed (54 tests), including physical-subset exhaustive
probability checks, byte-pinned baseline, deterministic matches, seat swaps,
kernel tai/deal-in/exhaustion accounting, redacted policy inputs, and rejection
of invalid models/actions, plus half-point draws and both promotion thresholds.
Full-workspace typecheck and named-file Biome checks passed; the unmodified
pre-commit hook also checks the staged code and all workspace types. Capacity
waits precede the manual gates and each npm gate launched by that hook.

The measurement smoke sample uses seeds 10001 through 10010, weight 4:

| Measure | Result |
| --- | --- |
| Seed pairs / matches / hands | 10 / 20 / 120 |
| Challenger wins / draws / losses | 11 / 1 / 8 |
| Challenger match score | 57.5% |
| Tai difference | +17 |
| Deal-ins, challenger / baseline | 28 / 26 |
| Exhausted walls | 2 |
| Paired 95% interval | [14.55%, 100%] |
| Promotion gate | false |

The final runner reproduced the same smoke JSON byte-for-byte.
The smoke verifies the runner; it does not establish strength or a reduction in
deal-ins. The weight is provisional and untuned by a large measurement. Regression
fixtures and existing unit-test playouts are separate from this 20-match smoke.

The issue was supplied inline because this sandbox has no network. No `gh`,
production stats/variant probes, installs, pushes, merges, releases, or issue
updates were attempted. The weekly headline and live variant status could not
be fetched offline. No network-dependent gate is required for these offline
modules. No UI review sheet is needed for an offline-only build.

## Stage 2: sampled action search (#676)

`packages/game/src/xiangqi-mahjong-sampled-bot.ts` adds an offline challenger;
the production policy and frozen baseline are unchanged. Review
`xmjSampledDecision` first, then its hidden-state, claim and scoring tests.

For every legal discard, and every set claim versus pass, the challenger uses
**64 common physical-copy samples** of the opponent's concealed hand and the
remaining wall. The pool excludes our whole hand, both public ponds and both
exposed melds. The open discard is already in its pond. Every action uses the
same sampled partition and wall order. Immediate self-draws and win claims
bypass sampling; no-action live claim windows still use the room runtime pass.

Each candidate runs to the end of the current hand under two equally weighted
continuations: both seats use the frozen current policy, then both use stage
1's defensive policy. Every policy call goes through `xmjViewFor`, so a simulated
seat sees its own tiles, public information and legal actions. Kernel transitions
own claims, draw sequencing, empty walls, wins and tai. Draw counts are recovered
by tile conservation, including claimed tiles removed from ponds, to preserve
heavenly and earthly scoring.

The objective is the **projected six-hand match point**, including the current
score and sampled outcomes of every remaining hand. A bounded tai term
`0.001 * finalGap / (1 + abs(finalGap))` breaks finite-sample match-point ties.
Thus an action's mean tai gain does not erase the risk of losing a banked lead.
Future deals are independent fresh full walls. Their rollout margins can be
cached across decisions because both frozen continuation policies ignore the
match score; neither policy ever receives the canonical future match walls.
This is a neutral unseen-tile prior, not inference from opponent choices. The
future bank and 64-sample budget remain provisional until promotion results.

Samples use the deterministic search seed `108404774`, salted only by the
seat's decision information. Room IDs, clocks, move counters and canonical hidden
tiles cannot affect them. The test permutes actual concealed opponent tiles and
wall positions, serializes the resulting view, and compares the entire search
result. Other tests inspect serialized rollout inputs for both seats, conserve
all 32 physical tiles, check reconstructed draw counts across complete legal
matches, check claim/discard sequencing, exhausted walls, immediate wins and
score-race risk. Invalid models, budgets and rollout actions throw.

### Commands and promotion

```sh
node scripts/xmj-bot-match.mjs --challenger sampled --opponent baseline --samples 64 --seed 30001 --pairs 1
node scripts/xmj-bot-match.mjs --challenger sampled --opponent defensive --samples 64 --seed 30002 --pairs 1
```

Each command is a two-match smoke. `--samples` and `--search-seed` support
reproducible experiments; do not tune on the promotion seeds below. Runner
defaults still reproduce stage 1. `baseline` means the frozen current bot;
`defensive` means the unchanged stage-1 policy at danger weight 4.

Stage 2 requires **4,000 fresh matches per opponent**, at least **60%** match
score against baseline and **55%** against defensive, and each paired 95% lower
bound above 50%. The runner enforces the appropriate threshold and minimum
match count. Both separate summaries must pass before promotion. A passing
summary does not change production registration.

From this worktree, the detached commands are:

```sh
nohup node scripts/xmj-bot-match.mjs --challenger sampled --opponent baseline --samples 64 --seed 67600001 --pairs 2000 > /tmp/burn-scratch/mistboard-burn-676-xmj-bot-2-3-sampled/promotion-baseline.jsonl 2>&1 < /dev/null &
nohup node scripts/xmj-bot-match.mjs --challenger sampled --opponent defensive --samples 64 --seed 67610001 --pairs 2000 > /tmp/burn-scratch/mistboard-burn-676-xmj-bot-2-3-sampled/promotion-defensive.jsonl 2>&1 < /dev/null &
```

Each JSONL file gets a record after every completed swapped-seat seed pair,
followed by its final summary. The commands need installed dependencies only.
Capacity waits precede their launch. Do not remove this parked worktree while
the measurements run.

### Parked stage-2 evidence

Burn `2026-10-25-0212-retry`, branch `agent/burn-676-xmj-bot-2-3-sampled`,
stacked on reviewed stage-1 head `94fdcff10` (not yet merged). Seven changed
files, with no production behavior, UI or payload change. The issue and comments
were supplied inline; this sandbox has no network. No issue update, push,
release, merge, worktree removal, install or production probe was attempted.

The new tests failed before implementation (exit 1: missing sampled-search
module). `tsx --test` cannot open its IPC pipe in this sandbox, so tests use
the equivalent `node --import tsx --test` entrypoint. The matching rules,
room, harness and sampled-search tests pass: **65 tests**. Detailed logs and
measurement output are in the scratch directory shown above.
Full-workspace typecheck and named-file Biome checks pass. Capacity waits
precede every final gate and each npm gate invoked by the unmodified commit
hook; the waits and npm wrapper live only in scratch. One intermediate test
run began while its capacity wait was still pending; it was repeated after
admission, and all subsequent runs use a sequential wait-and-exec wrapper.

The baseline smoke at seed 30001 uses 64 samples: **1 win, 0 draws, 1 loss**,
50% match score, tai difference **−7**, deal-ins **4 / 2**, one exhausted wall.
Its promotion gate is false; one pair has no paired interval. This smoke is a
runner check, not evidence that the challenger is stronger.
