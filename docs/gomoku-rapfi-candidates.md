# Rapfi candidate API

The browser adapter and offline ladder share the command builder, structured
output parser and seeded move selector exported by
`apps/web/src/engine/rapfi.ts`. The contract is independent of the number of
levels: a candidate policy supplies `candidateCount`, `evalMargin` and a
per-ply seed; a best-move request uses the engine's final move directly.
Tier budgets and calibration evidence belong in
[the level ladder documentation](gomoku-level-ladder.md). This API does not
change Gomoku's hidden or unrated gates.

## Browser requests

```ts
import {
  Rapfi,
  rapfiGameSeed,
  rapfiPlySeed,
} from '../engine/rapfi.js';

const engine = new Rapfi();
const gameSeed = rapfiGameSeed(roomId);
try {
  const result = await engine.chooseMove(position, 5, {
    candidateCount: 4,
    evalMargin: 200,
    seed: rapfiPlySeed(gameSeed, absolutePly),
  });
  // result.move is selected; result.candidates retains the parsed PVs.
} finally {
  engine.stop();
}
```

These parameters demonstrate an explicit selection policy, not calibrated tier
values. Use `RAPFI_LEVELS` and the caller's policy for live tier settings.
For plain-request lifecycle checks, use a best-move tier explicitly (L5), so
making lower levels use candidate selection does not change what is tested.
A plain best-move result has `move` and `elapsedMs`, without `candidates`.

`candidateCount` is an integer from 1 through 225, `evalMargin` is finite and
nonnegative, and `seed` is an unsigned 32-bit integer. Invalid choice options
reject before a worker is allocated. `chooseMove` copies the position and
choice options, permits one outstanding request and reuses its worker after a
successful search. The adapter requires a legal final coordinate reply even
for candidate searches; the final reply alone cannot supply missing PV detail.

`stop()` terminates the worker and rejects pending initialization or search
with `AbortError`. The next request creates a new worker. Output is cleared
between requests, and late messages from a stopped worker cannot resolve or
fail its replacement. Initialization and search remain bounded by the
adapter's watchdogs and worker-time validation.

## Protocol and parser

A candidate request sets `INFO show_detail 2`, loads a nonempty position with
`YXBOARD … DONE` (which does not search), then sends `YXNBEST N`. An empty
board goes directly to `YXNBEST N`. Both commands were exercised against the
vendored `1387d11312` WASM. Ordinary `BOARD` would spend a separate search and
return an extra move before the requested candidates. Without a candidate
count, `rapfiCommands` emits ordinary `BOARD … DONE` or empty-board `BEGIN`.

`parseRapfiOutput` accepts a whole string or stdout-line array. It reads
structured `INFO` only, committing each valid block at `INFO PV DONE`:

- It keeps the last complete block per zero-based PV index, including across
  an incomplete final iteration. `MESSAGE` summaries can disagree with the
  last completed block and never supply scores or PVs.
- Each candidate contains `pvIndex`, `numPv`, `depth`, `seldepth`, `nodes`,
  `totalNodes`, `timeMs`, `speed`, `eval`, `winrate`, `move`, `pv` and
  `forcedFive`. All protocol fields are required; malformed scores,
  coordinates, metadata or truncated blocks cannot replace a valid block.
- Coordinates stay in the raw reply's orientation. `move` is the first point
  of `pv`; no display-coordinate conversion occurs. `eval` stays from the
  side to move, including White.
- `forcedFive` is null below `abs(eval) = 29775`; otherwise it contains
  `result: 'win' | 'loss'` and `plies = 30000 - abs(eval)`. This is a signed
  distance in plies, not full moves; `abs(eval) > 30000` is invalid.

Rapfi can re-rank PVs partway through an iteration, leaving the same root move
at different indices/depths. The parser retains those blocks per the protocol
contract; the selector counts each distinct legal root only once.
`result.candidates` retains the parser output, before selection filtering.

## Selection and seed contract

`selectRapfiMove(position, candidates, options)` sorts legal candidates by
descending side-to-move evaluation, deduplicates root moves, caps the list,
then retains those within the inclusive evaluation margin of the best legal
candidate. Weights are `exp((eval - best) / max(1, evalMargin))`; one Mulberry32
sample from `options.seed` chooses the move. The same position, candidates,
options and seed give the same move even if candidate input order changes.
No global random state is read or advanced.

The kernel's `winsInOne` takes priority, then `mustBlock`. These protections
override the candidate cap and evaluation margin, even if no candidate
contains the tactical point. An open four with two winning endpoints is
already a forced loss; the selector still occupies one endpoint. An empty
legal candidate set otherwise rejects. Forced-five score metadata does not
replace these board-based tactical checks.

Because each call draws one sample, reusing a seed repeats the same random
sample. Derive a stable game seed with `rapfiGameSeed(gameId, runSeed = 0)`,
then call `rapfiPlySeed(gameSeed, absolutePly)` for each position. Absolute ply
includes the dealt opening; use the kernel's ply, not callback order. Distinct
plies of one game must use distinct seeds, while retries of the same position
can reuse their seed. The helpers use domain-separated FNV-1a over UTF-16 code
units so browser and Node callers derive identical seeds. Ladder records
retain the game seed for replay.

The offline ladder uses the same contract without creating another browser
adapter: pass the tier budget and candidate count to
`rapfiCommands(position, tier)`, parse the transcript with `parseRapfiOutput`,
then call `selectRapfiMove` with the same policy and per-ply seed. Best-move
searches consume the final coordinate reply instead.

## Regression checks

`apps/web/src/engine/rapfi-candidates.test.ts` covers recorded single/multi-PV
blocks, signed forced-five boundaries, interrupted iterations, seeded
reproducibility, evaluation weights and margins, illegal/duplicate candidates,
tactical protection for both sides in all four directions, copied request
options, output reset, plain best-move requests and cancellation/restart.
Its command and lifecycle checks do not pin the level-table length.
`rapfi.test.ts` covers seed derivation, the real WASM and general request
lifecycle; `scripts/gomoku-level-ladder.test.mjs` covers the ladder policy and
seed isolation.

Run the candidate and request-lifecycle checks from the repository root:

```sh
npm run test:unit --workspace @mistboard/web -- src/engine/rapfi-candidates.test.ts --maxWorkers=1
npm run test:unit --workspace @mistboard/web -- src/engine/rapfi.test.ts --maxWorkers=1 -t 'Rapfi request lifecycle|Rapfi seeds'
```
