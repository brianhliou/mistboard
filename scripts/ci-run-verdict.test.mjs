import assert from 'node:assert/strict';
import test from 'node:test';
import { ciOutcome, classifyJobs } from './lib/ci-run-verdict.mjs';

const HEAD = 'aaaaaaaabbbbbbbbccccccccdddddddd11111111';
const NEWER = 'ffffffffeeeeeeeeddddddddcccccccc22222222';

const completed = (conclusion) => ({ status: 'completed', conclusion, url: 'https://run' });
const TIP_RUN = { status: 'in_progress', conclusion: null, url: 'https://tip-run' };
const decide = (params) =>
  ciOutcome({ headRevision: HEAD, superseded: null, verdict: null, run: null, ...params });

// The real job counts from run 33140761199 on main (2026-08-28), which a newer
// push cancelled: six housekeeping jobs green, five test jobs cancelled.
const cancelledByNewerPush = () =>
  classifyJobs([
    ...Array.from({ length: 6 }, (_, i) => ({ name: `ok${i}`, conclusion: 'success' })),
    ...Array.from({ length: 5 }, (_, i) => ({ name: `test${i}`, conclusion: 'cancelled' })),
    { name: 'notify', conclusion: 'skipped' },
  ]);

test('classifyJobs blocks only on failure and timed_out', () => {
  const verdict = classifyJobs([
    { name: 'a', conclusion: 'success' },
    { name: 'b', conclusion: 'failure' },
    { name: 'c', conclusion: 'timed_out' },
    { name: 'd', conclusion: 'cancelled' },
    { name: 'e', conclusion: 'skipped' },
    { name: 'f', conclusion: null },
  ]);

  assert.deepEqual(verdict.blocking, ['b', 'c']);
  assert.equal(verdict.succeeded, 1);
  assert.deepEqual(verdict.forgiven, ['d:cancelled', 'e:skipped', 'f:none']);
});

test('a green run passes', () => {
  const decision = decide({ run: completed('success') });

  assert.equal(decision.outcome, 'pass');
});

// The rule this file exists to protect: a cancelled run is never read as green.
// Without confirmed ancestry the release has no verdict and must say so.
test('a cancelled run is NOT forgiven when a newer commit superseded it', () => {
  const verdict = cancelledByNewerPush();
  assert.deepEqual(
    verdict.blocking,
    [],
    'no job actually failed, which is what made this forgivable',
  );

  const decision = decide({ run: completed('cancelled'), verdict, superseded: NEWER });

  assert.equal(decision.outcome, 'fail');
  assert.match(decision.message, /superseded/);
  assert.match(decision.message, /ffffffffeeee/, 'names the commit that took main');
});

// The adoption rule (2026-09-22): the tip's run tests a tree containing our
// commit and production will serve the tip, so follow the tip instead of
// re-running the whole release from it.
test('a cancelled run whose commit the new tip contains adopts the tip', () => {
  const decision = decide({
    run: completed('cancelled'),
    verdict: cancelledByNewerPush(),
    superseded: NEWER,
    isAncestor: true,
    tipRun: TIP_RUN,
  });

  assert.equal(decision.outcome, 'adopt');
  assert.equal(decision.adoptRevision, NEWER);
  assert.match(decision.message, /superseded/);
  assert.match(decision.message, /aaaaaaaabbbb/, 'names the pushed commit');
  assert.match(decision.message, /ffffffffeeee/, 'names the tip being followed');
  assert.match(decision.message, /contains/);
});

// Our own run's state does not matter once the tip has a run: Railway deploys
// the tip, so a revision wait pinned to our commit would sit until it timed
// out (the 2026-09-22 hazard). A passed run, a running run and no run at all
// all adopt.
test('a descendant tip with a run of its own is adopted whatever our run is doing', () => {
  for (const run of [
    completed('success'),
    { status: 'in_progress', url: 'https://run' },
    { status: 'queued' },
    null,
  ]) {
    const decision = decide({ run, superseded: NEWER, isAncestor: true, tipRun: TIP_RUN });
    assert.equal(decision.outcome, 'adopt', `run=${JSON.stringify(run)}`);
    assert.equal(decision.adoptRevision, NEWER);
  }
});

// History was rewritten under us: nothing on main covers what was pushed.
test('a cancelled run whose commit the new tip does NOT contain fails', () => {
  const decision = decide({
    run: completed('cancelled'),
    verdict: cancelledByNewerPush(),
    superseded: NEWER,
    isAncestor: false,
    tipRun: TIP_RUN,
  });

  assert.equal(decision.outcome, 'fail');
  assert.match(decision.message, /superseded/);
  assert.match(decision.message, /does not contain/);
  assert.match(decision.message, /ffffffffeeee/);
});

// The caller could not fetch the tip on this poll (or main moved again first):
// keep polling inside the same deadline rather than fail or adopt blind.
test('a cancelled run with unreadable ancestry keeps waiting', () => {
  const decision = decide({
    run: completed('cancelled'),
    verdict: cancelledByNewerPush(),
    superseded: NEWER,
    isAncestor: null,
    tipRun: TIP_RUN,
  });

  assert.equal(decision.outcome, 'wait');
  assert.match(decision.message, /ancestry not readable yet/);
});

// GitHub lists the tip's run a few seconds after the push; until it does there
// is nothing to follow, and a tip whose push matched no ci.yml path (docs only)
// never gets one, in which case our own run finishes and speaks for both.
test('a descendant tip without a run yet is waited for, not adopted', () => {
  const cancelled = decide({
    run: completed('cancelled'),
    verdict: cancelledByNewerPush(),
    superseded: NEWER,
    isAncestor: true,
    tipRun: null,
  });
  assert.equal(cancelled.outcome, 'wait');
  assert.match(cancelled.message, /run to be listed/);

  const running = decide({
    run: { status: 'in_progress', url: 'https://run' },
    superseded: NEWER,
    isAncestor: true,
    tipRun: null,
  });
  assert.equal(running.outcome, 'wait');
  assert.match(running.message, /or for this one to finish/);
});

// Adoption is for runs GitHub cancelled, not for runs that failed on their own:
// following the tip would paper over a real red job in our commit.
test('a superseded run with a job of its own failed does not adopt', () => {
  const verdict = classifyJobs([
    { name: 'Unit tests (server)', conclusion: 'failure' },
    { name: 'Lint', conclusion: 'cancelled' },
  ]);

  const decision = decide({
    run: completed('cancelled'),
    verdict,
    superseded: NEWER,
    isAncestor: true,
    tipRun: TIP_RUN,
  });

  assert.equal(decision.outcome, 'fail');
  assert.match(decision.message, /Unit tests \(server\)/);
  assert.match(decision.message, /this run's own/);
});

// The case the forgiveness rule was written for, which must keep working:
// housekeeping jobs going cancelled/skipped in a run nobody superseded.
test('a cancelled housekeeping job is still forgiven when nothing superseded the run', () => {
  const verdict = classifyJobs([
    { name: 'Unit tests', conclusion: 'success' },
    { name: 'close-ci-failure', conclusion: 'cancelled' },
  ]);

  const decision = decide({ run: completed('failure'), verdict, superseded: null });

  assert.equal(decision.outcome, 'pass');
  assert.match(decision.message, /forgiving \[close-ci-failure:cancelled\]/);
});

test('a real job failure blocks whether or not the run was superseded', () => {
  const verdict = classifyJobs([
    { name: 'Unit tests (server)', conclusion: 'failure' },
    { name: 'Lint', conclusion: 'success' },
  ]);

  for (const superseded of [null, NEWER]) {
    for (const isAncestor of [false, true]) {
      for (const tipRun of [null, TIP_RUN]) {
        const decision = decide({
          run: completed('failure'),
          verdict,
          superseded,
          isAncestor,
          tipRun,
        });
        assert.equal(
          decision.outcome,
          'fail',
          `superseded=${superseded} isAncestor=${isAncestor} tipRun=${Boolean(tipRun)}`,
        );
      }
    }
  }
});

// A rewritten history dooms a run that is still in flight: waiting out the
// timeout would be pointless, since nothing on main will ever cover it.
test('supersession by an unrelated tip stops a run that is still in progress', () => {
  const decision = decide({
    run: { status: 'in_progress', url: 'https://run' },
    superseded: NEWER,
    isAncestor: false,
    tipRun: TIP_RUN,
  });

  assert.equal(decision.outcome, 'fail');
  assert.match(decision.message, /superseded/);
});

// A run that finished green before an UNRELATED tip took main did real work,
// and production may still serve our commit: keep the verdict it earned.
test('a run that passed before being superseded by an unrelated tip still passes', () => {
  for (const isAncestor of [false, null]) {
    const decision = decide({
      run: completed('success'),
      superseded: NEWER,
      isAncestor,
      tipRun: TIP_RUN,
    });

    assert.equal(decision.outcome, 'pass', `isAncestor=${isAncestor}`);
    assert.match(decision.message, /main has since moved/);
  }
});

// A green run under a descendant tip that has no run (docs-only push): the
// verdict covers both trees, and the caller decides which production serves.
test('a run that passed under a descendant tip without a run passes', () => {
  const decision = decide({
    run: completed('success'),
    superseded: NEWER,
    isAncestor: true,
    tipRun: null,
  });

  assert.equal(decision.outcome, 'pass');
  assert.match(decision.message, /has no run of its own/);
});

test('an absent run keeps waiting', () => {
  assert.equal(decide({ run: null }).outcome, 'wait');
  assert.equal(decide({ run: { status: 'queued' } }).outcome, 'wait');
});
