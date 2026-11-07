import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Execute the real workflow script with offline transports. A text check alone
// would miss an early return suppressing fallback on a rejected email.
const workflow = readFileSync(new URL('../.github/workflows/readout.yml', import.meta.url), 'utf8');
const source = workflow
  .split('          script: |\n')[1]
  .split('\n      - name: Upload redacted readout')[0]
  .split('\n')
  .map((line) => line.slice(12))
  .join('\n');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const execute = new AsyncFunction(
  'core',
  'github',
  'context',
  'fetch',
  'require',
  'process',
  source,
);

function fixture(overrides = {}, dryRun = false) {
  const comments = [];
  const calls = [];
  const payload = {
    report: {
      kind: 'mistboard-readout',
      schemaVersion: 2,
      snapshotId: 'readout_test',
      snapshotKey: 'week:test',
      verdict: 'action',
      alertKey: 'test',
      trigger: 'weekly',
      actions: [],
    },
    markdown: 'Test weekly report',
    reused: false,
    ...overrides,
  };
  const github = {
    rest: {
      issues: {
        getLabel: async () => ({}),
        listForRepo: async () => ({ data: [{ title: 'Mistboard weekly readout', number: 260 }] }),
        update: async (value) => calls.push(['update', value]),
        listComments: () => {},
        createComment: async (value) => {
          calls.push(['comment', value]);
          comments.push({ body: value.body });
        },
      },
    },
    paginate: async () => comments,
  };
  const core = {
    getIDToken: async () => 'synthetic-test-token',
    setOutput: () => {},
    summary: { addRaw: () => ({ write: async () => {} }) },
  };
  const run = () =>
    execute(
      core,
      github,
      { repo: { owner: 'test', repo: 'test' } },
      async () => ({ ok: true, json: async () => payload }),
      () => ({ writeFileSync: () => {} }),
      { env: { DRY_RUN: String(dryRun), REQUESTED_TRIGGER: 'weekly' } },
    );
  return { run, calls };
}
test('accepted direct email creates no duplicate GitHub notification', async () => {
  const f = fixture({ emailDelivery: { accepted: true } });
  await f.run();
  assert.equal(f.calls.length, 0);
});
test('rejected or disabled mail falls back to one deduplicated weekly comment', async () => {
  const f = fixture({ emailDelivery: { accepted: false, reason: 'delivery-failed' } });
  await f.run();
  await f.run();
  assert.equal(f.calls.filter(([name]) => name === 'comment').length, 1);
});
test('old server emailed flag is not mistaken for provider acceptance', async () => {
  const f = fixture({ emailed: true });
  await f.run();
  assert.equal(f.calls.filter(([name]) => name === 'comment').length, 1);
});
test('reused snapshots and dry runs never create another notification', async () => {
  for (const f of [fixture({ reused: true }), fixture({}, true)]) {
    await f.run();
    assert.equal(f.calls.length, 0);
  }
});
