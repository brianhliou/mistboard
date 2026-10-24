# Offline blunder ranking

Issue #653 is the fixture-only slice of #600. It consumes supplied evaluations,
ranks blunders and prints JSON. It does not load games from a database, reconstruct
positions, run an engine, publish artifacts or change any player-facing surface.
Those integrations remain in #600.

From the repository root, with the existing dependencies installed:

```sh
node --import tsx scripts/rank-blunders.mjs scripts/data/offline-blunders.json
node --import tsx scripts/rank-blunders.mjs scripts/data/offline-blunders.json --limit 1
```

The committed fixture is synthetic: Black loses about 35 win-chance points at
ply 2, then Red about 27 at ply 1. A third game drops 1000cp in an already lost
position and does not qualify. The moves are labels, not replay-validated games.

## Input contract

The JSON root is `{ "version": 1, "scorePov": "red", "games": [...] }`.
Each game has:

- `gameId` (unique, nonempty), `engineId` (nonempty), `firstMover` (`red` or `black`).
- `moves`: move strings in order; entry 0 lands on ply 1. Move labels and `best`
  must use the same engine dialect for best-played suppression to work.
- `plies`: evaluations of positions AFTER the indicated `ply` (0 is the initial
  position). Each row has `ply`, `cp` and `mate`; one score is null, or both are
  null when unknown. Scores must already be normalized to Red POV, including
  signed mate distance. `best` is an optional move string or null; `unstable`
  is an optional boolean, with the same meaning as the analysis sweep.
- `chancePlies`: optional one-based plies of chance moves, such as reveals.
  A future adapter must supply them; realized luck is not decision quality.

Rows may be unordered or missing. Only exact adjacent ply numbers are paired;
the ranker never bridges a gap or treats a missing score as equality. Invalid
scores, duplicate games/plies, out-of-range plies, wrong POV and unsupported
fixture versions fail the entire run with a nonzero exit and no partial JSON.
Unknown fields are ignored and are never copied into the report.

## Scoring and output

The ranker uses `winPercent`, `winPercentK(engineId)` and `moveJudgment` from
`@mistboard/game`, matching review's engine-specific curves and 15-point blunder
threshold. Both before and after scores are converted to the mover's POV.
Only blunders qualify, sorted by descending unrounded win-chance loss, then
game id (code-unit order), then ply. The default limit is 20, applied after sorting.
This is an ordering of supplied engine estimates, not proof of a tactical error.

Output has `version`, `totalBlunders` (before limiting), `blunders`, and `skipped`.
Each blunder retains its game, engine, move, ply, mover, suggested best move and
before/after/lost winning chances. Missing evaluations, unstable evaluations
(both adjacent moves), chance moves and played engine best moves are explicitly
listed in `skipped`; ordinary non-blunders are omitted. Empty input yields empty
arrays. Changing mate distance while a win stays forced usually will not qualify.

This command is for trusted local fixtures containing permitted information only.
It accepts no canonical game states, hidden deals, credentials or recipient data;
it establishes no policy for exporting hidden-information games.

## Verification and parked handoff

```sh
node --import tsx --test apps/server/src/offline-blunder-ranker.test.ts
```

The initial regression ran against an empty implementation and failed with
`[]` instead of the two expected Red/Black blunders (exit 1). Review the ranking
test and fixture first, then the scoring guards. Final verification passed:
13 new tests, 25 tests including the existing sweep and analysis math tests,
full workspace `npm run typecheck`, and Biome on the four changed TypeScript,
JavaScript and JSON files. The Markdown files are outside Biome's scope.

Parked branch: `agent/burn-653-fixture-driven-offline-blunder`, in worktree
`/Users/brianliou/projects/mistboard-burn-653-fixture-driven-offline-blunder`.
The six changed files are the ranker, its test, the command, the sample fixture,
this contract and `INDEX.md`. Next owner: Brian reviews the fixture command and
diff before selecting it for a later batch. No push, release or issue update
was performed. #600 remains open for persistence, replay, engine scoring and
artifact integration. The synthetic fixture validates ranking, not move legality
or the accuracy of a real engine's evaluations.
