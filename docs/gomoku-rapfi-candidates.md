# Rapfi candidates — s-fcf2

The adapter now supports opt-in multi-PV search and reusable seeded choice.
The existing five-level `RAPFI_LEVELS` table and all normal callers stay active.
This card supplies the parser/selection seam for s-82ca; eight-level integration,
registry changes, calibration and analysis UI belong to later cards. Gomoku's
hidden and unrated gates are untouched.

## Review first

Read `apps/web/src/engine/rapfi-candidates.ts`, then its test. All public consumer
imports remain available through `apps/web/src/engine/rapfi.ts`:

```ts
import { Rapfi, parseRapfiOutput, selectRapfiMove } from '../engine/rapfi.js';

const engine = new Rapfi();
const result = await engine.chooseMove(position, 3, {
  candidateCount: 4,
  evalMargin: 200,
  seed: 42,
});
// result.move is selected; result.candidates retains Rapfi's parsed PVs.
engine.stop();
```

The example parameters demonstrate the API; they are not calibrated tiers.
The offline ladder can pass `candidateCount` to `rapfiCommands(position, tier)`,
parse the resulting transcript with `parseRapfiOutput`, then call
`selectRapfiMove(position, candidates, options)` without creating another worker.

## Protocol and selection contract

- A candidate request sets `INFO show_detail 2`, loads a nonempty position with
  `YXBOARD … DONE` (which does not search), then sends `YXNBEST N`. An empty
  board goes directly to `YXNBEST N`. Both commands were exercised against the
  vendored `1387d11312` WASM. Using ordinary `BOARD` first would spend a separate
  search and return an extra move before the requested candidates.
- `parseRapfiOutput` accepts a whole string or stdout-line array. It reads
  structured `INFO` only, committing each valid block at `INFO PV DONE`. It
  keeps the last complete block per zero-based PV index, including across an
  incomplete final iteration. `MESSAGE` summaries can disagree with the last
  completed block and never supply scores or PVs. The card's earlier request
  for a MESSAGE parser is superseded by its supplied pinned-source correction.
- Coordinates stay in the raw reply's orientation. `eval` stays from the side
  to move, including White. `forcedFive` is null below `abs(eval) = 29775`;
  otherwise it contains `result: 'win' | 'loss'` and `plies = 30000 - abs(eval)`.
  All block fields are required; malformed scores, coordinates, metadata or
  truncated blocks cannot replace a previous valid block.
- Selection sorts legal candidates by descending evaluation, deduplicates root
  moves, caps the list, then retains those within the inclusive evaluation
  margin of the best legal candidate. Weights are
  `exp((eval - best) / max(1, evalMargin))`; one Mulberry32 sample from an
  unsigned 32-bit seed chooses the move. The same position, candidates, options
  and seed give the same move even if input candidate order changes. The caller
  should vary the seed by game/ply. Nothing calls global `Math.random`.
- The kernel's `winsInOne` takes priority, then `mustBlock`. These protections
  override the candidate cap and eval margin, even if no candidate contains the
  tactical point. A two-ended open four is already a forced loss; the selector
  still occupies one endpoint. An empty legal candidate set otherwise rejects.
  The adapter still requires a valid final move reply, copies request inputs,
  clears output between searches and retains its existing watchdog/stop logic.

Rapfi can re-rank PVs partway through an iteration, leaving the same root move
at different indices/depths. The parser intentionally retains those blocks per
the protocol contract; the selector counts each distinct legal root only once.

## Validation and handoff

Branch: `agent/burn-s-fcf2-gomoku-rapfi-multi-pv`; base: `6a7c0cf78`.
Six changed paths: this document, `INDEX.md`, and
`apps/web/src/engine/{rapfi.ts,rapfi-candidates.ts,rapfi.test.ts,rapfi-candidates.test.ts}`.

Before implementation, the new regression file exited 1: **33 failed, 5 passed**.
Its command-generation assertion showed the original adapter using `BOARD`
instead of `YXBOARD` / `YXNBEST`; parser/selector calls were absent.
After implementation:

- The candidate regression file passes, including recorded single/multi-PV
  blocks, signed forced-five boundary scores, interrupted iterations, seeded
  reproducibility, evaluation weights/margins, illegal/duplicate candidates,
  tactical guards for both sides and all four directions, and adapter lifecycle.
- Eight existing request-lifecycle tests pass. The new bounded real-WASM test
  passes with one and three candidates, plus a win in one. No heavy ladder run
  was performed. Recorded final blocks are embedded in the regression file;
  complete recordings and a reproducer remain in scratch.
- Focused strict TypeScript checking of all four changed TypeScript files and
  Biome pass.

Evidence is in `/tmp/burn-scratch/mistboard-burn-s-fcf2-gomoku-rapfi-multi-pv/`:
`regression-before.log`, `regression-after.log`, `lifecycle-after.log`,
`wasm-candidates.log`, `focused-typecheck.log`, `recorded-pv-{1,3}.txt`,
and `record-rapfi.mjs`.

The required full repository suite and root `npm run typecheck` are deferred:
the session's load guard reported **saturated** (47% free versus the 50%
reserve; load1 12.58 on 14 CPUs, OS pressure unavailable). Only bounded focused
checks ran. No load polling, commit, push, merge or release was performed.
The burn engine owns waiting for capacity, running its configured full suite
and committing the six named paths. The Mistboard session then reviews/merges
the parked branch and owns the later eight-level integration and calibration.

To rerun the focused checks from `apps/web`:

```sh
../../node_modules/.bin/vitest run src/engine/rapfi-candidates.test.ts --maxWorkers=1
../../node_modules/.bin/vitest run src/engine/rapfi.test.ts --maxWorkers=1 -t 'records structured|Rapfi request lifecycle'
```
