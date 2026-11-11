import assert from 'node:assert/strict';
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { main, parsePosthogRows, weeklyCrossBorder } from './db-read-cross-border.mjs';

const NOW = '2026-11-05T12:00:00Z';
const game = (gameId = 'room', endedAt = '2026-11-03T12:00:00Z') => ({ gameId, endedAt });
const row = (people, gameId = 'room') => ({ gameId, people });
const count = (people) => weeklyCrossBorder([game()], [row(people)], { weeks: 1, now: NOW })[0];
const expected = (both, crossed) => ({
  weekStart: '2026-11-02',
  gamesBetweenPeople: 1,
  gamesWithBothSidesSeen: both,
  gamesAcrossBorders: crossed,
});

test('two distinct people in different countries cross a border', () => {
  assert.deepEqual(
    count([
      ['a', 'Taiwan'],
      ['b', 'Vietnam'],
    ]),
    expected(1, 1),
  );
});

test('two distinct people in the same country do not cross a border', () => {
  assert.deepEqual(
    count([
      ['a', 'Taiwan'],
      ['b', 'Taiwan'],
    ]),
    expected(1, 0),
  );
});

test('one unseen side is excluded from both the coverage and crossed counts', () => {
  for (const people of [
    [],
    [['a', 'Taiwan']],
    [
      ['a', 'Taiwan'],
      ['b', null],
    ],
    [
      ['a', 'Taiwan'],
      ['b', ' '],
    ],
  ]) {
    assert.deepEqual(count(people), expected(0, 0));
  }
  assert.deepEqual(weeklyCrossBorder([game()], [], { weeks: 1, now: NOW })[0], expected(0, 0));
});

test('one person on two devices with two countries is still only one person', () => {
  assert.deepEqual(
    count([
      ['same-person', 'Taiwan'],
      ['same-person', 'Vietnam'],
    ]),
    expected(0, 0),
  );
});

test('repeat observations do not add people; more than two distinct people is ambiguous', () => {
  assert.deepEqual(
    count([
      ['a', 'Taiwan'],
      ['a', 'Taiwan'],
      ['b', 'Vietnam'],
    ]),
    expected(1, 1),
  );
  assert.deepEqual(
    count([
      ['a', 'Taiwan'],
      ['b', 'Vietnam'],
      ['c', 'Japan'],
    ]),
    expected(0, 0),
  );
  assert.deepEqual(
    count([
      [null, 'Taiwan'],
      ['b', 'Vietnam'],
    ]),
    expected(0, 0),
  );
});

test('finish time buckets change exactly at Monday 00:00 UTC, regardless of timezone offset', () => {
  const games = [
    game('sunday', '2026-11-01T23:59:59.999Z'),
    game('monday', '2026-11-02T00:00:00.000Z'),
    game('offset', '2026-11-01T16:00:00-08:00'),
    game('too-old', '2026-10-25T23:59:59.999Z'),
    game('not-finished-yet', NOW),
  ];
  const rows = games.map(({ gameId }) =>
    row(
      [
        ['a', 'Taiwan'],
        ['b', 'Vietnam'],
      ],
      gameId,
    ),
  );
  assert.deepEqual(weeklyCrossBorder(games, rows, { weeks: 2, now: NOW }), [
    {
      weekStart: '2026-10-26',
      gamesBetweenPeople: 1,
      gamesWithBothSidesSeen: 1,
      gamesAcrossBorders: 1,
    },
    {
      weekStart: '2026-11-02',
      gamesBetweenPeople: 2,
      gamesWithBothSidesSeen: 2,
      gamesAcrossBorders: 2,
    },
  ]);
});

test('keeps empty Monday weeks and ignores analytics for games outside the database selection', () => {
  const rows = [
    row(
      [
        ['a', 'Taiwan'],
        ['b', 'Vietnam'],
      ],
      'not-counted',
    ),
  ];
  const before = structuredClone(rows);
  assert.deepEqual(weeklyCrossBorder([game()], rows, { weeks: 2, now: NOW }), [
    {
      weekStart: '2026-10-26',
      gamesBetweenPeople: 0,
      gamesWithBothSidesSeen: 0,
      gamesAcrossBorders: 0,
    },
    expected(0, 0),
  ]);
  assert.deepEqual(rows, before);
});

test('reads both object rows and the PostHog tool columns/results envelope', () => {
  const rows = [
    row([
      ['a', 'Taiwan'],
      ['b', 'Vietnam'],
    ]),
  ];
  assert.deepEqual(parsePosthogRows(rows), rows);
  assert.deepEqual(
    parsePosthogRows({ columns: ['people', 'gameId'], results: [[rows[0].people, 'room']] }),
    rows,
  );
  assert.throws(
    () => parsePosthogRows({ columns: ['gameId', 'countries'], results: [] }),
    /Expected PostHog rows/,
  );
  assert.throws(
    () => parsePosthogRows({ columns: ['gameId', 'people'], results: [], hasMore: true }),
    /truncated/,
  );
});

test('bad weeks, invalid dates and duplicate game rows fail instead of producing misleading totals', () => {
  for (const weeks of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => weeklyCrossBorder([], [], { weeks, now: NOW }), /positive integer/);
  }
  assert.throws(
    () => weeklyCrossBorder([game('room', 'bad')], [], { now: NOW }),
    /Invalid game date/,
  );
  assert.throws(() => weeklyCrossBorder([game(), game()], [], { now: NOW }), /Duplicate database/);
  assert.throws(() => weeklyCrossBorder([], [row([]), row([])], { now: NOW }), /Duplicate PostHog/);
});

test('list mode emits a pasteable escaped ClickHouse IN list and selects the same UTC window', async () => {
  const logs = [];
  await main(['--list-games', '--weeks', '2'], {
    now: NOW,
    readGames: async ({ from, to }) => {
      assert.equal(from.toISOString(), '2026-10-26T00:00:00.000Z');
      assert.equal(to.toISOString(), '2026-11-05T12:00:00.000Z');
      return [game('room'), game("quote'and\\slash")];
    },
    log: (line) => logs.push(line),
  });
  assert.deepEqual(logs, ["('room','quote\\'and\\\\slash')"]);
  logs.length = 0;
  await main(['--list-games'], {
    now: NOW,
    readGames: async () => [],
    log: (line) => logs.push(line),
  });
  assert.deepEqual(logs, ['(NULL)']);
});

test('file mode prints all three weekly counts and ends with the distortion caveat', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cross-border-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'rows.json');
  writeFileSync(
    file,
    JSON.stringify([
      row([
        ['a', 'Taiwan'],
        ['b', 'Vietnam'],
      ]),
    ]),
  );
  const logs = [];
  await main(['--posthog-rows', file, '--weeks', '1'], {
    now: NOW,
    readGames: async () => [game(), game('unseen')],
    log: (line) => logs.push(line),
  });
  assert.deepEqual(logs, [
    'Monday week (UTC)\tGames between people\tGames with both sides seen\tGames across borders',
    '2026-11-02\t2\t1\t1',
    'A VPN or one person on two devices can distort this figure.',
  ]);
});

test('invalid CLI arguments fail before any database access', async () => {
  const readGames = async () => assert.fail('must not access the database');
  for (const args of [
    [],
    ['--list-games', '--posthog-rows', 'unused'],
    ['--list-games', '--weeks', '0'],
  ]) {
    await assert.rejects(main(args, { readGames }));
  }
});

test('the configured tooling runner discovers this test file', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const nodeCommand = pkg.scripts['test:tooling'].split('&&')[0].trim();
  assert.ok(nodeCommand.startsWith('node --test '));
  const listed = globSync(nodeCommand.slice('node --test '.length).split(/\s+/));
  assert.ok(listed.includes('scripts/db-read-cross-border.test.mjs'));
});
