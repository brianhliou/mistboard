# Engine-worker deployment checks

Issue [#580](https://github.com/brianhliou/mistboard/issues/580).
Use `node scripts/deploy-engine-worker.mjs` for a check-only preview.
`--deploy` is still a separate, authorized operation.

## What is checked

- Both `engine.ref` and the Railpack cachebust must identify engine `main`.
  `--bump` prepares those two files only; commit and push them separately.
  A floating branch name does not pass the deployment pin check.
- The full engine SHA must have a completed, successful `ci.yml` push run on
  `main`. A missing, pending, cancelled, skipped or failed run stops deployment.
  A newer failed run cannot be hidden by an older successful run. Lookup
  errors also stop deployment.
- The preview lists the engine commits and changed files, distinguishing
  lab files from runtime/build files. Unknown paths are runtime/build.
  Renames out of runtime code keep that classification. GitHub's 300-file
  comparison cap, incomplete pagination and divergent history stop the check
  rather than presenting an incomplete list.
- Mistboard commits included since the running worker revision are listed
  using the union of the old and new worker build watch patterns. This covers
  the registry, shared game rules, engine pins, Railpack, dependency changes
  and the release-asset fetch recipe. Tests excluded in both revisions stay
  excluded. The deployment tooling itself is always listed.
- Deployments require a clean working tree at the checked HEAD, an existing
  production Railway link, and verified baseline revisions. Commands target
  the production project/environment explicitly. No web UI or engine pin is
  changed by this improvement.

## First deployment and baseline recovery

The script keeps an append-only journal at
`<git-common-dir>/engine-worker-deployments.jsonl`, shared by all worktrees
and retained when a task worktree is removed. A deployment lock beside it
prevents concurrent scripted worker deploys. The journal records the full
engine and Mistboard SHAs, CI result, any override reason, attempt status,
timestamps and the new Railway deployment ID.

For the first deployment, obtain the **currently running** engine SHA from
the deployed checkout/build's `engine-ref-deployed` evidence, resolving a
short pin to its full SHA. Obtain the Mistboard SHA from that deployment's
metadata or the recorded source checkout used for its upload. An arbitrary
current checkout or `main` is not evidence of what is running. Supply both:

```sh
node scripts/deploy-engine-worker.mjs \
  --baseline-engine <verified-running-engine-full-sha> \
  --baseline-mistboard <verified-running-mistboard-full-sha>
```

Review the preview, then add `--deploy` only when that deployment is approved.
If either SHA is unknown, stop and establish it; the script will not invent
a baseline or claim there are no changes.

After a healthy scripted deployment, the next check uses its journal entry
only when the latest Railway deployment ID still matches and is successful.
A later manual deployment, an in-flight or failed attempt, an interrupted
process, or a missing/corrupt journal requires an explicit verified baseline
again. A stale lock is never automatically removed: first establish whether
its owner is still deploying, and resolve it only when safe.

Success requires a warmup-complete marker from the **new deployment ID** and
Railway `SUCCESS`. Log reads are bounded and scoped to that deployment and
the attempt time; older workers cannot certify a new upload.

## Urgent CI exception

An explicitly approved urgent recovery may pass
`--override-engine-ci "<reason>"`. The reason is printed and persisted before
the upload, including when the lookup is unavailable. This bypasses only the
engine CI gate; pin, baseline, diff, clean-tree, link, lock and health checks
remain. An upload or boot failure stays a failed/uncertain attempt and never
becomes the next automatic baseline.

## Verification

```sh
node --test scripts/deploy-engine-worker.test.mjs scripts/railway-deploy-config.test.mjs
```

Fixtures run the real CLI against local fake GitHub/Railway executables and
real temporary Git history. They plant failed CI, runtime and binary-asset
changes, an unknown baseline, dirty files, an urgent override, upload failure
and a successful deployment. No test deploys or restarts a real service.
