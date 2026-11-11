# Production releases require a green candidate

After assembling and committing a batch and passing its local gates, run hosted
CI before the scheduled release:

```sh
npm run batch:ci -- /path/to/batch-worktree
```

The command requires a clean target worktree, pushes its HEAD to
`release/<full commit SHA>`, and waits up to 35 minutes for a completed successful
`ci.yml` push run on that exact branch and SHA. A failed run prints its failing
jobs and exits nonzero. Missing, cancelled, skipped and timed-out runs cannot
pass. This command never advances `main` or starts a production drain.
After adding fixes or merging another branch, rerun the local gates and
`batch:ci` on the new committed batch HEAD.

`npm run release:prod -- --push` normally publishes `release/<full commit SHA>` first.
Railway continues to deploy from `main`; publishing the candidate cannot deploy
it. Hosted `ci.yml` runs on every candidate, including docs-only commits.

The release reuses a completed green candidate run for the same HEAD, or for its
direct parent when the complete trees differ only in `CHANGELOG.md` (the
changelog commit added by the release). Reuse skips the candidate push and fresh
CI wait; it still checks main, accounts for branches, and drains games before
promotion. Any other tree change, a merge commit needing the parent exception,
an unreadable comparison or a non-green run takes the normal fresh-candidate
path. The release log records the tested revision and run URL separately from
the promoted revision.

Before a dry run or push can proceed, every local `agent/*` branch with commits
outside both the release HEAD and local `origin/main` must be merged into the
batch or explicitly parked. A branch whose entire tip is contained in another
local `agent/ship-*` branch is automatically counted as parked and printed as
`in batch agent/ship-...`, without changing local config. New commits after that
batch was assembled still need accounting. `agent/ship-*` branches themselves
are exempt. Update the local
remote-tracking ref when assembling the batch. An unmarked branch stops either
mode with exit 1 and its exact park command, before taking a lock or writing a
changelog commit.

```sh
npm run branch:park -- agent/example "Waiting for review"
npm run branch:parked
npm run branch:unpark -- agent/example
```

Parking stores `<YYYY-MM-DD> <reason>` in local git config at
`branch.<name>.mistboardParked`, shared across worktrees and never tracked.
The gate rechecks after catching up with main, before publishing the candidate,
and before promotion, so work committed during a release also needs accounting.

After publishing the candidate, the release starts a pending drain if live
games need one. Games finish while hosted CI runs. The restart-now notification
waits until CI is complete and successful for that exact SHA on that exact
candidate branch, or the changelog exception above has verified an assembled
batch. Cancelled, failed, skipped and timed-out runs cannot promote
the candidate. `--skip-ci-wait` is forbidden with `--push`.

Once CI passes, the script checks that `main` has not moved, rechecks live games
when no drain was needed initially, drains to zero, announces the restart, and
pushes the tested SHA to `main` with a normal fast-forward push. No merge or new
commit is allowed between candidate CI and promotion. The revision wait and
production smokes follow promotion as before. The pre-push hook remains enabled
and recognizes the exact SHA the release verified, avoiding another local gate
while production is drained.

If candidate CI fails or times out, promotion fails, or the process receives
SIGINT/SIGTERM, the release cancels its own pending drain. A successful candidate
push alone does not count as a production push in the release log or ship
window. The log records `candidateBranch`; `pushedAt` is set only after `main`
advances. Candidate refs remain available for inspection.

If another release moves `main` during CI, re-run the release. Catch-up and the
local gate run before publishing a new candidate, so CI verifies the resulting
tree. A drain window that expires during a long CI run is re-established by the
final drain step. An empty game pool remains token-free.

Offline regression checks:

```sh
node --test scripts/batch-ci.test.mjs scripts/release-agent-branches.test.mjs scripts/release-green.test.mjs scripts/release-prod-structure.test.mjs scripts/release-drain.test.mjs scripts/release-lock.test.mjs
```

These execute the release orchestration with external effects replaced, test
CI verdicts and candidate lookup, exercise the pre-push hook, and check drain
cleanup. They do not publish refs or contact production.

## Parked build verification (2026-10-26)

- Branch: `agent/burn-658-releases-deploy-only-green-com`.
- Worktree: `/Users/brianliou/projects/mistboard-burn-658-releases-deploy-only-green-com`.
- Before implementation: all eight initial `release-green.test.mjs` regressions
  failed (exit 1), including the assertion that red CI must leave `main` alone.
- After implementation: 109 related release, CI verdict, drain, locking,
  pre-push, ship-window and planner checks passed (exit 0). Workspace
  `npm run typecheck` and Biome on the changed supported files passed.
- Sandbox limit: the three existing `safe-deploy.test.mjs` HTTP integration
  tests failed at `listen(127.0.0.1)` with `EPERM`. Pending-drain startup, final
  restart commit, expired-window handling and ownership are also covered by
  the passing offline mocks. Hosted GitHub CI and Railway were not exercised.

Every gate was preceded by the requested capacity wait. No push, release,
merge, issue update or worktree removal was performed. The standing Mistboard
session owns review and inclusion in a later approved release. Suggested
changelog line: `Technical: Production releases wait for successful hosted CI before advancing main`.
