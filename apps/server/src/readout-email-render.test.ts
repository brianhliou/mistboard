import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_CAVEATS } from './content-readout.js';
import { escapeHtml } from './email-layout.js';
import { buildMistboardReadout, type MistboardReadoutFacts } from './mistboard-readout.js';
import { buildReadoutSummary, readoutDelta, renderReadoutEmail } from './readout-email-render.js';

const product = {
  accountsCreated: 4,
  previousAccountsCreated: 5,
  completedGames: 100,
  previousCompletedGames: 50,
  completedGamesByMode: { pve: 100 },
  completedGamesByVariant: [{ variant: 'jieqi', count: 100 }],
  abortedGames: 0,
  humanPlayers: 20,
  previousHumanPlayers: 10,
  returningPlayers: 6,
  signedInPlayers: 8,
  activeAccounts28d: 40,
};
function report(extra: Partial<MistboardReadoutFacts> = {}) {
  return buildMistboardReadout({
    snapshotId: 'readout_email',
    trigger: 'weekly',
    now: new Date('2026-11-02T18:00:00Z'),
    runtime: {
      revision: 'test',
      activeGames: 0,
      databaseRequired: true,
      persistence: 'enabled',
      persistenceErrors: { count1m: 0, lastAt: null },
    },
    facts: { product, puzzles: null, mining: null, engines: null, ...extra },
  });
}
const comparison = {
  periodStart: '2026-10-19T00:00:00.000Z',
  periodEnd: '2026-10-26T00:00:00.000Z',
  product: {
    ...product,
    completedGames: 50,
    humanPlayers: 10,
    returningPlayers: 5,
    activeAccounts28d: 30,
    completedGamesByVariant: [{ variant: 'jieqi', count: 50 }],
  },
  broadcastBoards: 100,
  engineFailedTasks: 5,
  actionKeys: [],
};

test('weekly metrics use the exact prior weekly snapshot and label rolling windows', () => {
  const rendered = renderReadoutEmail(report({ comparison }));
  assert.match(rendered.text, /Returning players: 6 · \+1 \(\+20%\) vs 5/);
  assert.match(rendered.text, /40 vs 30.*overlapping rolling windows/);
  assert.match(rendered.text, /2026-10-26 to 2026-11-01/);
  assert.doesNotMatch(rendered.text, /Mining:|356 published|Production revision:/);
});

test('missing, stale, or redefined baselines show unavailable rather than zero', () => {
  for (const value of [
    undefined,
    { ...comparison, periodEnd: '2026-10-25T00:00:00.000Z' },
    { ...comparison, product: { ...comparison.product, completedGames: 49 } },
  ]) {
    const { text } = renderReadoutEmail(report({ comparison: value }));
    assert.match(text, /Returning players: 6 · Comparison unavailable/);
    assert.match(text, /Completed human games: 100 · \+50 \(\+100%\) vs 50/);
  }
});

test('zero baselines and absent data do not manufacture percentages or a healthy result', () => {
  assert.equal(readoutDelta(3, 0), '+3 (new)');
  assert.equal(readoutDelta(0, 0), '0 (flat)');
  const { html, text } = renderReadoutEmail(
    report({ product: null, collectorErrors: [{ section: 'product', code: 'collector_failed' }] }),
  );
  assert.match(html, /Some data is unavailable/);
  assert.match(text, /Missing data is not a healthy result/);
  assert.doesNotMatch(text, /No action needed/);
  assert.doesNotMatch(html, /Infinity|NaN/);
});

test('action content is escaped in HTML and daily mail stays concise', () => {
  const value = report();
  value.actions = [
    {
      code: 'test',
      severity: 'action',
      dedupeKey: 'test',
      ownerIssue: null,
      text: '<img src=x onerror=alert(1)>',
    },
  ];
  value.trigger = 'daily';
  const { html, text } = renderReadoutEmail(value);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(text, /Completed human games|Variant games/);
});

test('identical action keys are ongoing, while new keys are labelled new', () => {
  const value = report({ comparison: { ...comparison, actionKeys: ['old'] } });
  value.actions = [
    { code: 'one', severity: 'action', dedupeKey: 'old', ownerIssue: null, text: 'One' },
    { code: 'two', severity: 'action', dedupeKey: 'new', ownerIssue: null, text: 'Two' },
  ];
  const { text } = renderReadoutEmail(value);
  assert.match(text, /Ongoing review: One/);
  assert.match(text, /New: Two/);
});

test('urgent problems precede the three-item cap and cleared conditions are explicit', () => {
  const value = report();
  value.actions = [0, 1, 2].map((index) => ({
    code: `watch-${index}`,
    severity: 'watch' as const,
    dedupeKey: `watch-${index}`,
    ownerIssue: null,
    text: `Watch ${index}`,
  }));
  value.actions.push({
    code: 'engines-missing',
    severity: 'blocked',
    dedupeKey: 'missing',
    ownerIssue: null,
    text: 'Restore engine serving',
  });
  const result = renderReadoutEmail(value);
  assert.match(result.html, /URGENT/);
  assert.ok(result.text.indexOf('Restore engine serving') < result.text.indexOf('Watch 0'));
  assert.match(result.text, /1 more action in the full report/);
  value.actions = [
    {
      code: 'puzzle-outliers-resolved',
      severity: 'watch',
      dedupeKey: 'cleared',
      ownerIssue: null,
      text: 'The flag has cleared',
    },
  ];
  const cleared = renderReadoutEmail(value);
  assert.match(cleared.text, /Resolved: The flag has cleared/);
  assert.match(cleared.text, /No follow-up is needed/);
});

test('page summary and email share the same decisions and daily periods are explicit', () => {
  const value = report({ comparison });
  const summary = buildReadoutSummary(value);
  const email = renderReadoutEmail(value);
  assert.ok(email.text.includes(summary.summary));
  assert.equal(summary.metrics[2].previous, 5);
  value.trigger = 'daily';
  assert.match(buildReadoutSummary(value).period, /rolling 7 complete UTC days/);
  assert.doesNotMatch(buildReadoutSummary(value).title, /this week/);
});

test('weekly email renders every shared content caveat in HTML and text', () => {
  const value = report();
  const summary = buildReadoutSummary(value);
  const email = renderReadoutEmail(value);
  assert.deepEqual(summary.contentCaveats, [...CONTENT_CAVEATS]);
  for (const line of [...summary.content, ...summary.contentCaveats]) {
    assert.ok(email.text.includes(line), `Text includes: ${line}`);
    assert.ok(email.html.includes(escapeHtml(line)), `HTML includes: ${line}`);
  }
});

test('weekly email reads content only once through the shared summary', () => {
  const value = report();
  let reads = 0;
  Object.defineProperty(value, 'content', {
    get() {
      reads++;
      return undefined;
    },
  });
  renderReadoutEmail(value);
  assert.equal(reads, 1);
});

test('schema-v1 history without player fields stays readable rather than inventing counts', () => {
  const value = report();
  value.schemaVersion = 1;
  delete (value.product as Partial<NonNullable<typeof value.product>>).humanPlayers;
  delete (value.product as Partial<NonNullable<typeof value.product>>).previousHumanPlayers;
  delete (value.product as Partial<NonNullable<typeof value.product>>).returningPlayers;
  const summary = buildReadoutSummary(value);
  assert.equal(
    summary.metrics.some((metric) => metric.label === 'Players'),
    false,
  );
  assert.doesNotMatch(renderReadoutEmail(value).text, /NaN|undefined/);
});

test('email evidence and history links point into the consolidated Ops area', () => {
  const value = report();
  const rendered = renderReadoutEmail(value);
  assert.match(rendered.html, /\/ops/);
  assert.doesNotMatch(rendered.html, /\/readouts|\/metrics/);
});

test('readout includes guest conversion counts and labels open windows without browser identities', () => {
  const value = report();
  value.product!.guestSignInConversion = [
    { weekStart: '2026-10-12', guests: 4, signedInWithin7d: 1, complete: true },
    { weekStart: '2026-10-19', guests: 2, signedInWithin7d: 0, complete: false },
  ];
  const { text, html } = renderReadoutEmail(value);
  for (const body of [text, html]) {
    assert.match(body, /2026-10-12: 1\/4/);
    assert.match(body, /2026-10-19: 0\/2 \(window still open\)/);
    assert.match(body, /earlier sign-ins cannot be backfilled/);
  }
});
