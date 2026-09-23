// Decide what a hosted CI run means for the release waiting on it.
//
// Extracted from release-prod.mjs so it can be tested: that script runs a
// release at module scope, so importing it is not an option.
//
// The subtle case is a CANCELLED run. ci.yml sets
// `concurrency: cancel-in-progress: true` on `refs/heads/main`, so a second
// push to main cancels the first push's run. The first release then reads a run
// whose test jobs are all `cancelled`, and the pre-existing rule ("cancelled and
// skipped are forgiven") called that a pass. In the 14 hours to 2026-08-28 five
// runs on main were cancelled that way, and two of the last three would have
// been reported to a waiting release as green with five test jobs unfinished.
//
// So forgiveness now depends on WHY jobs were cancelled. Cancelled housekeeping
// inside a run nobody superseded is still forgiven, because that is the case the
// rule was written for. Cancelled anything in a run that a newer commit
// superseded is not: the release has no verdict of its own.
//
// A superseded run has a second reading (2026-09-22). Eleven September releases
// died on "superseded" and each was re-run from the new main, five minutes
// apiece, although the newer run already covered them: the pushed commit was an
// ancestor of the new tip, so the tip's run tests a tree that contains it, and
// Railway deploys the tip, which contains it too. So when the caller has
// confirmed that ancestry AND the tip has a run of its own, the verdict is
// 'adopt': the release follows the tip's run, whatever state our own run is in
// (cancelled, still running, or even passed: production will serve the tip, so
// a revision wait pinned to our commit would sit until it timed out). The one
// exception is a job of our own that really failed; following the tip would
// paper over it. A tip that does NOT contain the pushed commit (history
// rewritten) fails unless our run already passed, since nothing covers what was
// pushed. A tip with no run yet is not adopted: ci.yml's path filter skips a
// docs-only push, and a wait for a run that never starts is the timeout this
// rule exists to avoid, so our own run is left to finish and speak for both.

/**
 * Split a run's jobs into ones that genuinely failed and ones that merely did
 * not succeed. Only `failure` and `timed_out` block a release.
 *
 * @param {Array<{name?: string, conclusion?: string|null}>} jobs
 */
export function classifyJobs(jobs) {
  const blocking = [];
  const forgiven = [];
  let succeeded = 0;
  for (const job of jobs) {
    if (job.conclusion === 'success') succeeded += 1;
    else if (job.conclusion === 'failure' || job.conclusion === 'timed_out') {
      blocking.push(job.name);
    } else forgiven.push(`${job.name}:${job.conclusion ?? 'none'}`);
  }
  return { blocking, forgiven, succeeded };
}

const short = (revision) =>
  typeof revision === 'string' ? revision.slice(0, 12) : String(revision);

/**
 * @param {object} params
 * @param {{status?: string, conclusion?: string|null, url?: string|null}|null} params.run
 *   the CI run for this release's revision, or null if none exists yet
 * @param {{blocking: string[], forgiven: string[], succeeded: number}|null} params.verdict
 *   job classification; null when the run has not completed
 * @param {string} params.headRevision the revision being released
 * @param {string|null} params.superseded the branch tip, when it is no longer
 *   headRevision; null when this release still owns the tip
 * @param {boolean|null} [params.isAncestor] whether headRevision is an ancestor
 *   of `superseded`, as the caller read it against the fetched tip. `true`
 *   lets the release adopt the tip; `false` (or omitted) means the tip does not
 *   contain the pushed commit; `null` means the caller could not tell on this
 *   poll (fetch failed, or main moved again before the tip was fetched), so the
 *   release polls again rather than deciding.
 * @param {{status?: string, conclusion?: string|null, url?: string|null}|null} [params.tipRun]
 *   the CI run for `superseded`, or null when GitHub lists none (not created
 *   yet, or the tip's push matched no ci.yml path)
 * @returns {{outcome: 'wait'|'pass'|'fail', message: string}
 *   | {outcome: 'adopt', adoptRevision: string, message: string}}
 */
export function ciOutcome({
  run,
  verdict,
  headRevision,
  superseded,
  isAncestor = false,
  tipRun = null,
}) {
  const where = run?.url ?? short(headRevision);

  // A newer commit owns main. GitHub cancels our run when the tip's run starts,
  // and Railway deploys the tip: the question is whether the tip can stand in
  // for our commit, and that is ancestry plus a run of its own.
  if (superseded) {
    const completed = run?.status === 'completed';
    const succeeded = completed && run.conclusion === 'success';
    const cancelled = completed && run.conclusion === 'cancelled';
    const ownFailure = (verdict?.blocking.length ?? 0) > 0;

    if (isAncestor === true && tipRun && !ownFailure) {
      const ours = succeeded
        ? 'this run passed, but production will serve the tip'
        : cancelled
          ? 'this run was cancelled for it'
          : `this run is ${run?.status ?? 'not listed'} and GitHub cancels it`;
      return {
        outcome: 'adopt',
        adoptRevision: superseded,
        message:
          `superseded: ${short(headRevision)} was pushed to main, but main is now ` +
          `${short(superseded)}, which contains ${short(headRevision)}; ${ours}, so ` +
          `following ${short(superseded)}'s run: ${tipRun.url ?? short(superseded)}`,
      };
    }
    if (succeeded) {
      // Earned before the tip moved. With no tip run to follow (yet), this is
      // the verdict for both trees; the caller decides which one production
      // will serve.
      const contains =
        isAncestor === true
          ? `contains ${short(headRevision)} but has no run of its own`
          : isAncestor === false
            ? `does not contain ${short(headRevision)}`
            : `may or may not contain ${short(headRevision)}`;
      return {
        outcome: 'pass',
        message:
          `hosted CI passed: ${where} (main has since moved to ${short(superseded)}, which ` +
          `${contains}; this run still verified ${short(headRevision)})`,
      };
    }
    if (!ownFailure && isAncestor !== false && (cancelled || !completed)) {
      // Not decided yet. Either the tip's run is about to be listed (adopt on
      // the next poll), or the tip's push matched no ci.yml path and this run
      // finishes with a verdict of its own.
      const state = cancelled ? 'was cancelled' : `is ${run?.status ?? 'not listed yet'}`;
      const contains =
        isAncestor === true
          ? `contains ${short(headRevision)}`
          : `may contain ${short(headRevision)} (ancestry not readable yet)`;
      return {
        outcome: 'wait',
        message:
          `main moved to ${short(superseded)}, which ${contains}; this run ${state}; ` +
          `waiting for ${short(superseded)}'s run to be listed` +
          (cancelled ? '' : ', or for this one to finish'),
      };
    }

    const fate = cancelled
      ? 'this run was cancelled rather than finished'
      : completed
        ? `this run finished ${run.conclusion ?? 'unknown'}`
        : `this run is ${run?.status ?? 'not listed'} and will be cancelled`;
    const coverage = ownFailure
      ? `the failure (${verdict.blocking.join(', ')}) is this run's own, whatever ` +
        `${short(superseded)} contains`
      : isAncestor === true
        ? `${short(superseded)} contains ${short(headRevision)} but has no run to follow, ` +
          "so this run's conclusion stands"
        : isAncestor === false
          ? `${short(superseded)} does not contain ${short(headRevision)} (history was ` +
            'rewritten), so no run covers the pushed commit'
          : `whether ${short(superseded)} contains ${short(headRevision)} could not be read, ` +
            'so no run is known to cover the pushed commit';
    return {
      outcome: 'fail',
      message:
        `superseded: ${short(headRevision)} was pushed to main, but main is now ` +
        `${short(superseded)}; ${fate}. ${coverage}. ` +
        `Re-run from the current main if you need a verdict: ${where}`,
    };
  }

  if (!run) return { outcome: 'wait', message: 'waiting for the run to appear' };
  if (run.status !== 'completed') {
    return { outcome: 'wait', message: `${run.status} ${run.url ?? ''}`.trim() };
  }
  if (run.conclusion === 'success') {
    return { outcome: 'pass', message: `hosted CI passed: ${where}` };
  }

  // Not superseded, so a cancelled or skipped job is housekeeping noise rather
  // than an unfinished test. Forgive it, and name what was forgiven.
  if (verdict && verdict.blocking.length === 0 && verdict.succeeded > 0) {
    return {
      outcome: 'pass',
      message:
        `hosted CI conclusion is ${run.conclusion ?? 'unknown'}, but no job failed: ` +
        `${verdict.succeeded} passed, forgiving [${verdict.forgiven.join(', ')}]\n` +
        `hosted CI passed: ${where}`,
    };
  }
  return {
    outcome: 'fail',
    message:
      `hosted CI failed with conclusion ${run.conclusion ?? 'unknown'}` +
      (verdict?.blocking.length ? `; failing jobs: ${verdict.blocking.join(', ')}` : '') +
      `: ${where}`,
  };
}
