import assert from 'node:assert/strict';
import test from 'node:test';
import { listedTestFailures, retryKnownFlake, waitForExactCi } from './lib/ci-flake-retry.mjs';

const file = 'apps/server/src/banqi-analysis-runner.test.ts';
const tap = (name = file) =>
  `not ok 1 - cold analysis cache\n  location: '/home/runner/work/mistboard/mistboard/${name}:15:1'\n  error: 'timed out'`;
const failed = {
  databaseId: 123,
  headSha: 'a'.repeat(40),
  attempt: 1,
  status: 'completed',
  conclusion: 'failure',
};
const jobs = [
  {
    databaseId: 456,
    conclusion: 'failure',
    steps: [{ name: 'Unit tests (server, shard 1 of 2)', conclusion: 'failure' }],
  },
];

function fixture({ logs = tap(), states = [], jobList = jobs } = {}) {
  const reruns = [],
    records = [],
    messages = [];
  let time = 0;
  const retry = (run) =>
    retryKnownFlake({
      run,
      readJobs: () => jobList,
      readLog: () => logs,
      rerun: (candidate) => reruns.push(candidate.databaseId),
      record: (entry) => records.push(entry),
      log: (message) => messages.push(message),
    });
  const wait = () =>
    waitForExactCi({
      readRun: () => states.shift(),
      retry,
      timeoutMs: 10,
      pollMs: 1,
      now: () => time,
      wait: async () => {
        time++;
      },
      log: (line) => messages.push(line),
    });
  return { retry, wait, reruns, records, messages };
}

test('listed flaky failure re-runs only failed jobs once and records the attempt', async () => {
  const green = { ...failed, attempt: 2, conclusion: 'success' };
  const f = fixture({
    states: [failed, failed, { ...failed, attempt: 2, status: 'in_progress' }, green],
  });
  assert.equal(await f.wait(), green);
  assert.deepEqual(f.reruns, [123]);
  assert.deepEqual(f.records[0].files, [file]);
  assert.equal(f.records[0].attempt, 2);
  assert.match(f.messages.join('\n'), /re-running failed jobs once/);
});

test('an unlisted or mixed test failure never re-runs', async () => {
  for (const logs of [
    tap('apps/server/src/other.test.ts'),
    `${tap()}\n${tap('apps/server/src/other.test.ts')}`,
  ]) {
    const f = fixture({ logs, states: [failed] });
    await assert.rejects(f.wait(), /hosted CI failed/);
    assert.deepEqual(f.reruns, []);
  }
});

test('a second listed failure fails, including across separate release invocations', async () => {
  const second = { ...failed, attempt: 2 };
  const f = fixture({ states: [failed, second] });
  await assert.rejects(f.wait(), /hosted CI failed/);
  assert.deepEqual(f.reruns, [123]);
  const later = fixture({ states: [second] });
  await assert.rejects(later.wait(), /hosted CI failed/);
  assert.deepEqual(later.reruns, []);
});

test('incomplete evidence, build failures and cancellations fail closed', async () => {
  for (const options of [
    { logs: 'uncategorized infrastructure error' },
    { logs: `${tap()}\nerror TS2322: incompatible` },
    { logs: `${tap()}\nnot ok 2 - unlocated failure` },
    {
      jobList: [
        ...jobs,
        {
          conclusion: 'failure',
          steps: [{ name: 'Build workspace dependencies', conclusion: 'failure' }],
        },
      ],
    },
    { jobList: [...jobs, { conclusion: 'cancelled' }] },
    { jobList: [{ conclusion: 'failure' }] },
  ]) {
    const f = fixture({ ...options, states: [failed] });
    await assert.rejects(f.wait(), /hosted CI failed/);
    assert.deepEqual(f.reruns, []);
  }
});

test('Vitest paths, ANSI and GitHub log prefixes retain exact file identity', () => {
  assert.deepEqual(
    listedTestFailures(
      `Unit\tTests\t2026-11-11T00:00:00Z \u001b[31mFAIL\u001b[0m ${file} > cold analysis`,
    ),
    [file],
  );
  assert.equal(
    listedTestFailures('FAIL apps/web/src/banqi-analysis-runner.test.ts > same basename'),
    null,
  );
});

test('stale rerun result never passes and missing runs time out', async () => {
  for (const states of [[failed, failed, ...Array(12).fill(failed)], Array(12).fill(null)]) {
    const f = fixture({ states });
    await assert.rejects(f.wait(), /timed out/);
  }
});

test('Node spec reporter failure locations identify the same allowlisted file', () => {
  assert.deepEqual(
    listedTestFailures(
      `✖ cold analysis cache (55ms)\ntest at /home/runner/work/mistboard/mistboard/${file}:15:1\n✖ cold analysis cache (55ms)`,
    ),
    [file],
  );
});

test('the required-jobs aggregator is retried with its listed failing test job', async () => {
  const f = fixture({
    jobList: [
      ...jobs,
      {
        name: 'node',
        conclusion: 'failure',
        steps: [{ name: 'Check required jobs', conclusion: 'failure' }],
      },
    ],
  });
  assert.equal(await f.retry(failed), true);
  assert.deepEqual(f.reruns, [123]);
  assert.equal(
    await fixture({ jobList: [{ name: 'node', conclusion: 'failure' }] }).retry(failed),
    false,
  );
});
