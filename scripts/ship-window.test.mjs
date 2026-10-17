import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  describeShipWindow,
  evaluateShipWindow,
  lastProdPush,
  parkedBranches,
  parseBranchRefs,
  parseExtraShipReason,
  parseReleaseLog,
  pushTimeOf,
  restartedProd,
} from './lib/ship-window.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-17T00:10:00.000Z');

// A release record shaped like releases.jsonl's, pushed at `pushAt` unless
// `pushed` is false (the push stage then failed or never ran).
function record({
  startedAt = '2026-10-16T23:52:45.834Z',
  pushAt = '2026-10-16T23:59:29.880Z',
  pushed = true,
  outcome = 'ok',
  deployRequired = true,
  head = 'd58620fd0d76b45d667fe6235da591f4b49a6bf3',
  targetRevision = 'b3e9f4c3f3005cc24cc9283fdabf3390a41ff137',
  cwd = '/Users/brianliou/projects/mistboard-ship-1016-late',
  extra = {},
} = {}) {
  const stages = [{ label: 'local ci:quick', startedAt, ms: 158135, ok: true }];
  if (pushed !== null) {
    stages.push({ label: 'git push release head', startedAt: pushAt, ms: 2949, ok: pushed });
  }
  return {
    v: 1,
    source: 'release',
    startedAt,
    outcome,
    head,
    targetRevision,
    productionRevisionBefore: targetRevision,
    deployRequired,
    push: true,
    stages,
    cwd,
    ...extra,
  };
}

test('a push inside the window refuses', () => {
  const last = lastProdPush({ records: [record()] });
  const verdict = evaluateShipWindow({ now: NOW, last, windowHours: 4 });
  assert.equal(verdict.decision, 'refuse');
  assert.equal(verdict.open, false);
  // Anchored on the end of the push stage, not on the run's start.
  assert.equal(last.at, Date.parse('2026-10-16T23:59:29.880Z') + 2949);
  assert.equal(verdict.opensAt, last.at + 4 * HOUR);
});

test('a push older than the window allows', () => {
  const last = lastProdPush({
    records: [record({ pushAt: new Date(NOW - 5 * HOUR).toISOString() })],
  });
  assert.equal(evaluateShipWindow({ now: NOW, last, windowHours: 4 }).decision, 'allow');
  assert.equal(evaluateShipWindow({ now: NOW, last: null }).decision, 'allow');
  // The window length is the knob.
  assert.equal(evaluateShipWindow({ now: NOW, last, windowHours: 6 }).decision, 'refuse');
});

test('a release that failed after its push still counts as a push', () => {
  const failed = record({ outcome: 'failed', extra: { error: 'hosted CI has a failed job' } });
  assert.notEqual(pushTimeOf(failed), null);
  assert.equal(
    evaluateShipWindow({ now: NOW, last: lastProdPush({ records: [failed] }) }).decision,
    'refuse',
  );
});

test('a release that never pushed, or pushed nothing deployable, does not count', () => {
  const failedPush = record({ pushed: false, outcome: 'failed' });
  const gateFailure = record({ pushed: null, outcome: 'failed' });
  const docsOnly = record({ deployRequired: false });
  const alreadyOnMain = record({ head: 'abc', targetRevision: 'abc' });
  for (const entry of [failedPush, gateFailure, docsOnly, alreadyOnMain]) {
    assert.equal(restartedProd(entry), false, JSON.stringify(entry.stages));
  }
  assert.equal(lastProdPush({ records: [failedPush, gateFailure, docsOnly] }), null);
});

test('pushedAt wins over the stage, and legacy stage-less lines fall back to startedAt', () => {
  assert.equal(
    pushTimeOf(record({ extra: { pushedAt: '2026-10-17T00:00:00.000Z' } })),
    Date.parse('2026-10-17T00:00:00.000Z'),
  );
  const legacy = {
    startedAt: '2026-10-16T20:00:00.000Z',
    push: true,
    head: 'aaa',
    productionRevisionBefore: 'bbb',
    deployRequired: true,
  };
  assert.equal(pushTimeOf(legacy), Date.parse('2026-10-16T20:00:00.000Z'));
  assert.equal(pushTimeOf({ ...legacy, productionRevisionBefore: 'aaa' }), null);
  assert.equal(pushTimeOf({ ...legacy, push: false }), null);
});

test('the latest push wins, and bad log lines are skipped', () => {
  const text = [
    JSON.stringify(record({ pushAt: '2026-10-16T15:33:00.000Z', cwd: '/a' })),
    '{not json',
    JSON.stringify(record({ pushAt: '2026-10-16T23:00:00.000Z', cwd: '/b' })),
    JSON.stringify(record({ pushAt: '2026-10-16T21:00:00.000Z', cwd: '/c' })),
    '',
  ].join('\n');
  const records = parseReleaseLog(text);
  assert.equal(records.length, 3);
  assert.equal(lastProdPush({ records }).cwd, '/b');
});

test('an unlogged remote tip counts by its committer date; a logged one does not', () => {
  const records = [record({ pushAt: new Date(NOW - 6 * HOUR).toISOString() })];
  const unlogged = { revision: 'f00d', committedAt: NOW - HOUR };
  const last = lastProdPush({ records, tip: unlogged });
  assert.equal(last.at, NOW - HOUR);
  assert.match(last.source, /unlogged/);
  assert.equal(evaluateShipWindow({ now: NOW, last }).decision, 'refuse');

  const logged = { revision: records[0].head, committedAt: NOW - HOUR };
  assert.equal(lastProdPush({ records, tip: logged }).source, 'release log');
  assert.equal(
    evaluateShipWindow({ now: NOW, last: lastProdPush({ records, tip: logged }) }).decision,
    'allow',
  );
});

test('--extra-ship needs a reason; with one the window is bypassed', () => {
  for (const blank of [undefined, '', '   ', '--push']) {
    assert.throws(() => parseExtraShipReason(blank), /needs a reason/);
  }
  assert.equal(
    parseExtraShipReason('  prod bug: jieqi reveal crash '),
    'prod bug: jieqi reveal crash',
  );
  const last = lastProdPush({ records: [record()] });
  const verdict = evaluateShipWindow({ now: NOW, last, extraShip: 'prod bug: jieqi reveal crash' });
  assert.equal(verdict.decision, 'bypass');
  // Outside the window the reason changes nothing.
  assert.equal(evaluateShipWindow({ now: NOW + 5 * HOUR, last, extraShip: 'x' }).decision, 'allow');
});

test('release-prod rejects --extra-ship without a reason before doing anything', () => {
  const script = path.join(HERE, 'release-prod.mjs');
  for (const args of [
    ['--push', '--extra-ship', ''],
    ['--push', '--extra-ship', '   '],
    ['--push', '--extra-ship'],
    ['--extra-ship', '--push'],
    ['--extra-ship', 'prod bug'],
    ['--push', '--ship-window-hours', '0'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /^release-prod: /);
  }
});

test('release-prod logs the bypass reason and the push time in its record', () => {
  const source = readFileSync(path.join(HERE, 'release-prod.mjs'), 'utf8');
  const writer = source.slice(source.indexOf('function writeReleaseRecord'));
  assert.match(writer, /extraShip: options\.extraShip/);
  assert.match(writer, /pushedAt: release\.pushedAt/);
  // pushedAt is stamped right after the push succeeds.
  assert.match(
    source,
    /runTimed\('git push release head', pushCommand\(release\.headRevision\)\);\n\s+release\.pushCompleted = true;\n\s+release\.pushedAt = new Date\(\)\.toISOString\(\);/,
  );
});

// A refusal must leave the branch, CHANGELOG.md and the lock untouched, so the
// guard runs before the lock, and again after it, both ahead of the catch-up
// merge and the --changelog commit.
test('release-prod checks the ship window before the lock, the merge and the changelog commit', () => {
  const source = readFileSync(path.join(HERE, 'release-prod.mjs'), 'utf8');
  const run = source.slice(source.indexOf('\ntry {'));
  const before = run.indexOf("enforceShipWindow('before the release lock')");
  const lock = run.indexOf('await takeReleaseLock()');
  const after = run.indexOf("enforceShipWindow('after taking the release lock')");
  const merge = run.indexOf('catchUpBeforeGate();');
  const changelog = run.indexOf('commitChangelog();');
  const push = run.indexOf("runTimed('git push release head'");
  assert.ok(before > 0 && before < lock, 'guard before the lock');
  assert.ok(lock < after && after < merge, 'guard again after the lock, before the merge');
  assert.ok(merge < changelog && changelog < push, 'changelog commit and push come after');
});

test('parked work is the agent branches ahead of main, with worktrees', () => {
  const refs = parseBranchRefs(
    [
      'agent/xmj-64\t/Users/brianliou/projects/mistboard-xmj-64',
      'agent/banqi-post\t',
      'agent/release-guard\t/Users/brianliou/projects/mistboard-release-guard',
      'agent/merged\t/Users/brianliou/projects/mistboard-merged',
    ].join('\n'),
  );
  const ahead = {
    'agent/xmj-64': 1,
    'agent/banqi-post': 3,
    'agent/release-guard': 1,
    'agent/merged': 0,
  };
  const parked = parkedBranches(
    refs.map((ref) => ({ ...ref, ahead: ahead[ref.branch] })),
    { current: 'agent/release-guard' },
  );
  assert.deepEqual(
    parked.map((entry) => [entry.branch, entry.worktree, entry.ahead, entry.current]),
    [
      ['agent/banqi-post', null, 3, false],
      ['agent/release-guard', '/Users/brianliou/projects/mistboard-release-guard', 1, true],
      ['agent/xmj-64', '/Users/brianliou/projects/mistboard-xmj-64', 1, false],
    ],
  );
  const lines = describeShipWindow(
    evaluateShipWindow({ now: NOW, last: lastProdPush({ records: [record()] }) }),
    { now: NOW, parked, timeZone: 'America/Los_Angeles' },
  );
  assert.match(
    lines[0],
    /last production push 2026-10-16 16:59 PDT \(10m ago\) from \/Users\/brianliou\/projects\/mistboard-ship-1016-late/,
  );
  assert.match(lines[1], /closed until 2026-10-16 20:59 PDT \(3h 50m from now; window is 4h\)/);
  assert.ok(lines.some((line) => /agent\/banqi-post \(\+3\) \(no worktree\)/.test(line)));
  assert.ok(lines.some((line) => /agent\/release-guard .*<- this release/.test(line)));
});
