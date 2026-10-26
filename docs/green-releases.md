# Production releases require a green candidate

`npm run release:prod -- --push` publishes `release/<full commit SHA>` first.
Railway continues to deploy from `main`; publishing the candidate cannot deploy
it. Hosted `ci.yml` runs on every candidate, including docs-only commits.

After publishing the candidate, the release starts a pending drain if live
games need one. Games finish while hosted CI runs. The restart-now notification
waits until CI is complete and successful for that exact SHA on that exact
candidate branch. Cancelled, failed, skipped and timed-out runs cannot promote
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
node --test scripts/release-green.test.mjs scripts/release-prod-structure.test.mjs scripts/release-drain.test.mjs scripts/release-lock.test.mjs
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
