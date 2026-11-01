# Gomoku browser ceval — s-a31d

Rapfi now implements the shared `CevalHandle` and engine panel. This is a
capability addition on `game/gomoku`: no analysis catalog, offering, route,
review-page entry, rating or access gate changes are included. The Mistboard
session owns review and integration; subsequent cards own the gated board and
route presentation, move navigation, numbered PV stones, toggle persistence,
server sweep and evaluation graph.

## Consumer contract

```ts
const panel = createEnginePanel({
  variant: 'gomoku',
  multiPv: 3,
  evalBar,
  onLines, // Canonical a1-o15 placements; null clears the board's engine ink.
  onToggle, // The review owner remembers this viewer's preference.
});
panel.setPosition(
  ['a1', 'b1'],
  JSON.stringify({
    turn: 1, // Black=1, White=2, at the root before the moves above.
    stones: [
      { x: 7, y: 7, player: 1 },
      { x: 7, y: 8, player: 2 },
    ],
  }),
  true, // Pass false at terminal positions.
);
// Starts off. The owner can restore a saved preference with panel.setOn(true).
// Direct consumers use createCeval('gomoku') and the same request fields.
```

`initialFen` is the engine-specific position string: JSON of `RapfiPosition`
for this backend. It is not the game export envelope. Omit it for an empty,
Black-to-move root. `rapfiCevalPosition()` validates the root through the shared
Rapfi boundary and applies the move history through the Gomoku kernel. Invalid
coordinates, duplicate/occupied placements and malformed roots reject before
allocating a worker. Coordinates remain in the live adapter's orientation:
raw `(0, 0)` is `a1`, `(14, 14)` is `o15`; nothing flips them.

The panel starts off, names Rapfi, offers three lines by default, displays
depth/nodes, and sends `onLines(null)` immediately on position changes/off.
It scopes itself and its optional gauge to the central Gomoku ink family:
Black is the first slot, White the second. The later board owner can reuse
`data-seat-ink-family="gomoku"` for the rest of its chrome.

## Search and score behavior

- The existing `/engine/rapfi/worker.js?v=1387d11312` runs single-threaded;
  cross-origin isolation is unnecessary. Initialization is lazy and reusable.
  Active search is synchronous inside the worker, so stop/dispose terminate it;
  a replacement owns a fresh worker. Generation checks protect both the backend
  and panel, including the debounce and initialization windows. Cancelled
  evaluations remain unresolved, following the shared contract.
- Commands come from `rapfiCommands(position, { candidateCount, nodes, timeMs })`.
  Structured output comes exclusively from `parseRapfiOutput()`. The adapter
  requests `YXNBEST`, keeps complete legal, distinct alternatives, orders them
  by evaluation, and assigns the shared one-based ranks. A partial rerank that
  duplicates a root move retains the preceding complete set. A final short set
  (for example a forced five) is allowed when no full set was produced.
- Effort is bounded: Quick 5,000 nodes/1 s; Standard 20,000/2 s;
  Deep 100,000/3 s; Max 500,000/5 s. These are analysis budgets, separate from
  the bot ladder. The panel has no infinite endpoint; a programmatic infinite
  request is capped at Max. `maxDepth` maps the shared 14/18/22/26 bands to
  these budgets rather than promising a native Rapfi depth limit. Initialization
  has a 30 s watchdog; search has the requested time limit plus 250 ms grace.
- The parser's `eval` and `winrate` are side-to-move values. Finite evaluations
  enter the existing gauge scale as `round(320 * log(p / (1-p)))`, using Rapfi's
  reported winrate with finite endpoint clamps. This preserves the gauge's
  `sigmoid(cp/320)` probability; the displayed units are a heuristic scale.
  The panel normalizes to Black's perspective, including a White-to-move root
  and odd-length histories. Positive therefore always favors Black.
- The parser's forced-five plies become signed full-move distances with
  `ceil(plies/2)`. The common mate field carries the distance, never raw
  `29990`. Zero-distance terminal scores use the existing decisive cp sentinel.
  The panel renders translated “Black/White wins in N” wording in English,
  Simplified Chinese and Traditional Chinese. Shared loading/status/error and
  effort labels used here are translated too.

## Verification and parked handoff

Branch: `agent/burn-s-a31d-gomoku-analysis-rapfi-ceval`.
Base SHA: `e88b27094`. Implementation is complete but **uncommitted**: the
required repository suite cannot pass inside this sandbox. No push or merge.

Review `apps/web/src/review/engine/rapfi-ceval.ts` and its recorded-output test
first, then the panel's score normalization and stale-callback guards.

- Before implementation: all 21 initial new regression cases failed.
- After: 29 Rapfi regressions pass; the final focused run has 116 passing tests
  across seven files, including the existing panel/parser and seat-ink tests.
- Whole web package: 594 files passed, one skipped; 6,998 tests passed, one
  skipped, exit 0. This covers registration of the new ceval union member.
- Root `npm run typecheck`: exit 0, including all workspaces and e2e types.
  Biome on the named TypeScript/CSS paths passes; whitespace validation passes.
- The exact requested reduced-priority suite built game, board-render, mahjong
  and server, then tooling reported 427 passing and seven failing tests. All
  seven failures are `listen EPERM` in the existing `prod-http` and `safe-deploy`
  listener fixtures. The sandbox also refused `nice`'s priority reduction.
  Consequently the chained server/game/board-render/mahjong tests did not run.

Evidence: `/tmp/burn-scratch/mistboard-burn-s-a31d-gomoku-analysis-rapfi-ceval/`
contains `regression-before.log`, `focused-after.log`, `web-suite.log`,
`typecheck.log` and `suite.log`. The burn engine owns the full suite outside the
sandbox and the single path-specific commit; the Mistboard session then reviews
and merges the parked branch.

Eleven changed paths: this document, `INDEX.md`,
`apps/web/src/seat-disc-ink.css`,
`apps/web/src/i18n/catalogs/review{,.zh-hans,.zh-hant}.ts`, and
`apps/web/src/review/engine/{ceval-types.ts,ceval.ts,engine-panel.ts,rapfi-ceval.ts,rapfi-ceval.test.ts}`.

Focused reproduction, from `apps/web`:

```sh
../../node_modules/.bin/vitest run src/review/engine/rapfi-ceval.test.ts --maxWorkers=1
```
