import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyAuditOutput } from './audit-prod-deps.mjs';

const counts = (over = {}) => ({
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...over },
  },
});

test('a clean audit is clean', () => {
  const verdict = classifyAuditOutput(JSON.stringify(counts()));
  assert.equal(verdict.kind, 'clean');
});

test('a real finding fails, and info alone does not', () => {
  assert.equal(classifyAuditOutput(JSON.stringify(counts({ low: 1 }))).kind, 'vulnerable');
  assert.equal(classifyAuditOutput(JSON.stringify(counts({ critical: 2 }))).total, 2);
  // npm's own default audit level is `low`, so an info-only report is a pass
  // there too. Failing on it here would make this script a stricter gate than
  // the command it replaced, which is its own kind of false alarm.
  assert.equal(classifyAuditOutput(JSON.stringify(counts({ info: 3 }))).kind, 'clean');
});

test('the registry error that red-mained 2026-09-04 is transient, not a finding', () => {
  // Shape of what npm printed that day: the quick endpoint answering 400 while
  // announcing its own retirement. Classifying this as `vulnerable` is the bug
  // this script exists to prevent.
  const verdict = classifyAuditOutput(
    JSON.stringify({
      error: {
        code: 'E400',
        summary: 'Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick',
        detail: 'Invalid package tree, run npm install to rebuild your package-lock.json',
      },
    }),
  );
  assert.equal(verdict.kind, 'unavailable');
  assert.match(verdict.detail, /E400/);
  assert.match(verdict.detail, /Invalid package tree/);
});

test('output that is not JSON at all is transient, not a finding', () => {
  // A proxy's HTML error page says nothing about this lockfile. Treating an
  // unparseable body as a vulnerability would fail the build on a bad gateway.
  const verdict = classifyAuditOutput('<html><body>502 Bad Gateway</body></html>');
  assert.equal(verdict.kind, 'unavailable');
  assert.equal(verdict.detail, '<html><body>502 Bad Gateway</body></html>');
});

test('empty output is transient', () => {
  assert.equal(classifyAuditOutput('').kind, 'unavailable');
  assert.equal(classifyAuditOutput('').detail, 'audit produced no JSON');
});

test('JSON with neither error nor metadata is transient', () => {
  const verdict = classifyAuditOutput(JSON.stringify({ auditReportVersion: 2 }));
  assert.equal(verdict.kind, 'unavailable');
  assert.match(verdict.detail, /neither error nor metadata/);
});

test('a registry error always carries a description, whatever shape npm sent', () => {
  // The first CI run of this script logged a bare "audit:" line: npm returned an
  // error object none of whose expected fields were present, and the retry told
  // nobody what had gone wrong.
  const empty = classifyAuditOutput(JSON.stringify({ error: {} }));
  assert.equal(empty.kind, 'unavailable');
  assert.equal(empty.detail, 'npm reported an audit error with no description');

  const stringError = classifyAuditOutput(JSON.stringify({ error: 'ETIMEDOUT' }));
  assert.equal(stringError.kind, 'unavailable');
  assert.equal(stringError.detail, 'ETIMEDOUT');

  const oddShape = classifyAuditOutput(JSON.stringify({ error: { statusCode: 400 } }));
  assert.equal(oddShape.kind, 'unavailable');
  assert.match(oddShape.detail, /statusCode/);
});

// The report npm gave on 2026-10-31: minimatch's advisory, inherited by
// serve-handler, counted once per package.
const advisory = (ghsa, severity = 'moderate') => ({
  name: 'minimatch',
  url: `https://github.com/advisories/${ghsa}`,
  severity,
});
const minimatchReport = (minimatchVia = [advisory('GHSA-g3hv-75wg-m249')]) => ({
  vulnerabilities: {
    minimatch: { name: 'minimatch', severity: 'moderate', via: minimatchVia },
    'serve-handler': { name: 'serve-handler', severity: 'moderate', via: ['minimatch'] },
  },
  ...counts({ moderate: 2, total: 2 }),
});
const ACCEPT = { 'GHSA-g3hv-75wg-m249': { until: '2027-01-31' } };

test('an advisory nobody accepted still fails, inherited package included', () => {
  // The planted failure: the same report with no acceptances must stay red.
  const verdict = classifyAuditOutput(JSON.stringify(minimatchReport()), { accepted: {} });
  assert.equal(verdict.kind, 'vulnerable');
  assert.equal(verdict.total, 2);
});

test('an accepted advisory passes, for its package and the one that inherits it', () => {
  const verdict = classifyAuditOutput(JSON.stringify(minimatchReport()), {
    accepted: ACCEPT,
    today: '2026-10-31',
  });
  assert.equal(verdict.kind, 'clean');
  assert.deepEqual(verdict.accepted, ['GHSA-g3hv-75wg-m249']);
});

test('an acceptance lapses on its date', () => {
  const verdict = classifyAuditOutput(JSON.stringify(minimatchReport()), {
    accepted: ACCEPT,
    today: '2027-02-01',
  });
  assert.equal(verdict.kind, 'vulnerable');
});

test('an accepted advisory never covers a second one on the same package', () => {
  const report = minimatchReport([
    advisory('GHSA-g3hv-75wg-m249'),
    advisory('GHSA-xxxx-new0-0001', 'high'),
  ]);
  const verdict = classifyAuditOutput(JSON.stringify(report), {
    accepted: ACCEPT,
    today: '2026-10-31',
  });
  assert.equal(verdict.kind, 'vulnerable');
  assert.equal(verdict.total, 2);
});

test('the shipped acceptance list covers the 10-31 report', () => {
  // Without options the script's own list applies; a typo in its id would
  // leave the audit red, and this says so before CI does.
  const verdict = classifyAuditOutput(JSON.stringify(minimatchReport()), { today: '2026-10-31' });
  assert.equal(verdict.kind, 'clean');
});
