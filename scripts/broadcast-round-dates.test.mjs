import assert from 'node:assert/strict';
import test from 'node:test';
import { roundDateFindings } from './broadcast-round-dates.mjs';

test('a round with games and no date is caught; dated and empty rounds pass', () => {
  const findings = roundDateFindings('2026-xiangqi-league', [
    // Planted: the league's round 12 before the poller read 比赛时间.
    { id: 'r12', boardCount: 16, startsAt: null, startedAt: null },
    { id: 'r06', boardCount: 16, startedAt: '2026-09-22T13:00:00+08:00' },
    // Seeded and unplayed: nothing to show yet, nothing wrong.
    { id: 'r18', boardCount: 0, startsAt: null },
    // A seed alone still fills the menu.
    { id: 'r01', boardCount: 16, startsAt: '2026-09-13T14:30:00+08:00' },
  ]);
  assert.deepEqual(findings, [
    { kind: 'undated', tourSlug: '2026-xiangqi-league', roundId: 'r12', boards: 16 },
  ]);
});

test('a seed on another day than the games is reported, compared in their own offsets', () => {
  const findings = roundDateFindings('t', [
    // Planted: the league's round 2, seeded a day after it was played.
    {
      id: 'r02',
      boardCount: 16,
      startsAt: '2026-09-14T14:30:00+08:00',
      startedAt: '2026-09-13T19:00:00+08:00',
    },
    // Same calendar day in two offsets (the North American championship's
    // midnight seeds against China-midnight records) is not a finding.
    { id: 'r03', boardCount: 8, startsAt: '2026-04-03T00:00:00-05:00', startedAt: '2026-04-03' },
  ]);
  assert.deepEqual(
    findings.map((f) => [f.kind, f.roundId]),
    [['seed-day', 'r02']],
  );
});
