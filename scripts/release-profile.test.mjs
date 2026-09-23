import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deployMs,
  failureClass,
  importTranscripts,
  parseDuration,
  parseTranscriptRelease,
  parseWindow,
  quantiles,
  readRecords,
  renderChart,
  summarize,
} from './release-profile.mjs';

// The console text of a release, as release-prod.mjs and time-command.mjs
// print it and as a transcript stores it. Trimmed to the lines the importer
// reads, in the order they appear.
const RELEASE_TEXT = `# production release
head: c1c509492c223d4fb21ed1b7ce9c2624257ac5d2
target: origin/main
smoke: full
prod-smoke-plan: deploy_required=true
local gate: broad (repo tooling, package, workflow, deploy, or shared package files changed)
# local ci:quick
started_at: 2026-09-23T02:39:33.000Z
$ npm run ci:quick
local ci:quick: ok in 1m 34s
# git push release head
started_at: 2026-09-23T02:41:07.000Z
git push release head: ok in 2.0s
# hosted CI wait
attempt 1: waiting for the run to appear
hosted CI passed: https://github.com/brianhliou/mistboard/actions/runs/1
# production revision wait
started_at: 2026-09-23T02:44:58.000Z
production revision wait: ok in 10.7s
# prod lite smoke
started_at: 2026-09-23T02:45:08.000Z
prod lite smoke: ok in 827ms
# engine-family smokes (10 in parallel)
== prod DXQ smoke: ok in 9.8s
release: ok in 6m 12s
`;

test('parseDuration reads the time-command formats', () => {
  assert.equal(parseDuration('827ms'), 827);
  assert.equal(parseDuration('2.0s'), 2000);
  assert.equal(parseDuration('1m 34s'), 94_000);
  assert.equal(parseDuration('1h 2m 3s'), 3_723_000);
});

test('parseWindow reads 7d, 36h, 2w', () => {
  assert.equal(parseWindow('7d'), 7 * 86_400_000);
  assert.equal(parseWindow('36h'), 36 * 3_600_000);
  assert.equal(parseWindow('2w'), 14 * 86_400_000);
  assert.throws(() => parseWindow('soon'));
});

test('a transcript release parses into a record with timed stages', () => {
  const record = parseTranscriptRelease(RELEASE_TEXT, '2026-09-23T02:39:00.000Z');

  assert.equal(record.outcome, 'ok');
  assert.equal(record.elapsedMs, 372_000);
  assert.equal(record.startedAt, '2026-09-23T02:39:33.000Z');
  assert.equal(record.head, 'c1c509492c223d4fb21ed1b7ce9c2624257ac5d2');
  assert.equal(record.deployRequired, true);
  assert.deepEqual(record.gate, {
    kind: 'broad',
    reason: 'repo tooling, package, workflow, deploy, or shared package files changed',
  });
  assert.equal(record.smokeTier, 'full');
  assert.deepEqual(
    record.stages.map((s) => [s.label, s.ms, s.ok, s.startedAt ?? null]),
    [
      ['local ci:quick', 94_000, true, '2026-09-23T02:39:33.000Z'],
      ['git push release head', 2000, true, '2026-09-23T02:41:07.000Z'],
      ['production revision wait', 10_700, true, '2026-09-23T02:44:58.000Z'],
      ['prod lite smoke', 827, true, '2026-09-23T02:45:08.000Z'],
      ['prod DXQ smoke', 9800, true, null],
    ],
  );
  // Push ended 02:41:09, production served the commit at 02:45:08.7.
  assert.equal(deployMs(record), 239_700);
});

test('a failed transcript release keeps the error line and the failed stage', () => {
  const text = `# production release
head: aaaaaaaabbbbbbbbccccccccdddddddd11111111
# local ci:quick
started_at: 2026-09-23T03:00:00.000Z
local ci:quick: failed in 5m 47s
release: failed after 5m 50s
node exited with 1
`;
  const record = parseTranscriptRelease(text, null);

  assert.equal(record.outcome, 'failed');
  assert.equal(record.error, 'node exited with 1');
  assert.equal(record.failedStage, 'local ci:quick');
  assert.equal(failureClass(record), 'local gate: local ci:quick');
  assert.equal(parseTranscriptRelease('no release here', null), null);
});

test('failureClass names the release-level failures', () => {
  assert.equal(
    failureClass({ error: 'superseded: abc was pushed to main, but main is now def' }),
    'superseded by a later push',
  );
  assert.equal(
    failureClass({ error: 'A drain token is required for this deploy' }),
    'drain token unusable',
  );
  assert.equal(
    failureClass({ error: 'hosted CI failed with conclusion failure' }),
    'hosted CI red',
  );
  assert.equal(
    failureClass({ error: '2/10 engine-family smokes failed: prod DXQ smoke' }),
    'prod smoke failed',
  );
  assert.equal(
    failureClass({ error: 'release requires a clean worktree; commit or stash first.' }),
    'dirty worktree',
  );
  assert.equal(
    failureClass({
      error: 'git exited with 1',
      stages: [{ label: 'git push release head', ms: 1200, ok: false }],
    }),
    'push rejected (main moved)',
  );
});

test('quantiles and summarize', () => {
  assert.deepEqual(quantiles([5, 1, 3]), { n: 3, p50: 3, p90: 5, max: 5 });
  assert.deepEqual(quantiles([]), { n: 0, p50: null, p90: null, max: null });
  const s = summarize([
    { outcome: 'ok', elapsedMs: 300_000, stages: [{ label: 'a', ms: 10 }] },
    { outcome: 'ok', elapsedMs: 400_000, stages: [{ label: 'a', ms: 30 }] },
    { outcome: 'failed', elapsedMs: 5_000, error: 'superseded: x', stages: [] },
  ]);
  assert.equal(s.ok, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.total.p50, 400_000);
  assert.deepEqual(s.stages, [{ label: 'a', n: 2, p50: 30, p90: 30, max: 30 }]);
  assert.deepEqual(s.failures, [['superseded by a later push', 1]]);
});

test('import dedupes by text hash and prefers the fuller copy of one release', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-profile-'));
  const transcriptDir = path.join(dir, 'transcripts');
  const results = path.join(transcriptDir, 'session', 'tool-results');
  const logPath = path.join(dir, 'releases.jsonl');
  mkdirSync(results, { recursive: true });
  // The transcript holds a preview (fewer stages); the persisted file holds all of it.
  const preview = RELEASE_TEXT.split('\n')
    .filter((l) => !l.includes('DXQ'))
    .join('\n');
  const line = JSON.stringify({
    timestamp: '2026-09-23T02:46:00.000Z',
    message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: preview }] }] },
  });
  writeFileSync(path.join(transcriptDir, 'session.jsonl'), `${line}\n${line}\n`);
  writeFileSync(path.join(results, 'full.txt'), RELEASE_TEXT);

  assert.equal(importTranscripts({ logPath, transcriptDir }), 1);
  assert.equal(importTranscripts({ logPath, transcriptDir }), 0, 'a second import adds nothing');
  const records = readRecords(logPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].source, 'transcript');
  assert.equal(records[0].stages.length, 5, 'the fuller copy won');
  assert.match(readFileSync(logPath, 'utf8'), /"hash":"[0-9a-f]{16}"/);
});

test('the chart is one HTML page with a mark per release', () => {
  const html = renderChart([
    {
      startedAt: '2026-09-01T10:00:00Z',
      outcome: 'ok',
      elapsedMs: 330_000,
      head: 'abc',
      stages: [],
    },
    {
      startedAt: '2026-09-02T10:00:00Z',
      outcome: 'failed',
      elapsedMs: 5_000,
      head: 'def',
      stages: [],
    },
  ]);

  assert.match(html, /<svg/);
  assert.equal((html.match(/<circle/g) ?? []).length, 1);
  assert.equal((html.match(/stroke="#b8443a"/g) ?? []).length, 1);
  assert.match(renderChart([]), /No records yet/);
});
