import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  addDays,
  aggregate,
  bucketWindows,
  buildModel,
  byWindow,
  countryShifts,
  dailyWindows,
  movers,
  newKeys,
  opportunities,
  parseTsv,
  renderMarkdown,
  shortPage,
  termsDelta,
  worthALook,
} from './seo-weekly-triage.mjs';

const tsv = (rows) => `${rows.map((r) => r.join('\t')).join('\n')}\n`;

/** 70 days of daily rows ending 2026-10-08: 10 impressions/day at position 8
 * before the last week, 30/day at position 6 in it; 1 click/day, 3 in it. */
function dailyFixture() {
  const rows = [['date', 'clicks', 'impressions', 'ctr', 'position']];
  for (let i = 69; i >= 0; i--) {
    const d = addDays('2026-10-08', -i);
    const recent = i < 7;
    rows.push([d, recent ? 3 : 1, recent ? 30 : 10, '0', recent ? '6.0' : '8.0']);
  }
  return tsv(rows);
}

const WIN_HEAD = ['window', 'start', 'end'];
const windowsFixture = (keyCol, rows) =>
  tsv([
    [...WIN_HEAD, keyCol, 'clicks', 'impressions', 'ctr', 'position'],
    ...rows.map(([w, k, c, i, p]) => [w, 'x', 'y', k, c, i, '0', p]),
  ]);

const QUERY_ROWS = [
  ['last7', 'banqi', 2, 80, '6.0'],
  ['prior7', 'banqi', 1, 20, '9.0'],
  ['before7', 'banqi', 3, 200, '9.0'],
  ['last7', 'jieqi', 0, 5, '12.0'],
  ['prior7', 'jieqi', 2, 50, '7.0'],
  ['before7', 'jieqi', 4, 300, '7.0'],
  ['last7', '皮卡魚', 1, 70, '6.3'],
  ['last28', '皮卡魚', 1, 60, '6.3'],
  ['last28', 'banqi', 4, 150, '7.0'],
  ['last28', 'jieqi', 3, 25, '30.0'],
  ['last28', 'mistboard', 9, 11, '1.5'],
];

test('parseTsv keys rows by header and skips comments and blanks', () => {
  const rows = parseTsv('# note\na\tb\n1\t2\n\n3\t\n');
  assert.deepEqual(rows, [
    { a: '1', b: '2' },
    { a: '3', b: '' },
  ]);
});

test('shortPage keeps the path, decoded', () => {
  assert.equal(shortPage('https://mistboard.com/zh-hant/rules/banqi'), '/zh-hant/rules/banqi');
  assert.equal(shortPage('https://mistboard.com/%E6%8F%AD'), '/揭');
  assert.equal(shortPage('not a url'), 'not a url');
});

test('aggregate weights position by impressions and ignores Bing -1', () => {
  const t = aggregate([
    { clicks: 1, impressions: 10, position: 2 },
    { clicks: 0, impressions: 30, position: 6 },
    { clicks: 0, impressions: 5, position: -1 },
  ]);
  assert.equal(t.clicks, 1);
  assert.equal(t.impressions, 45);
  assert.equal(t.position, 5);
  assert.equal(
    aggregate([{ clicks: 4 }]).impressions,
    null,
    'clicks-only rows have no impressions',
  );
});

test('dailyWindows anchors on the newest day and refuses a partial prior window', () => {
  const w = dailyWindows(parseTsv(dailyFixture()));
  assert.equal(w.end, '2026-10-08');
  assert.deepEqual(
    { c: w.last7.clicks, i: w.last7.impressions, p: w.last7.position },
    { c: 21, i: 210, p: 6 },
  );
  assert.deepEqual({ c: w.prior7.clicks, i: w.prior7.impressions }, { c: 7, i: 70 });
  assert.equal(w.last28.clicks, 21 + 21);
  assert.equal(w.prior28.clicks, 28);

  const short = dailyWindows(parseTsv(dailyFixture()).slice(-20));
  assert.ok(short.last7 && short.prior7);
  assert.equal(short.last28, null);
  assert.equal(short.prior28, null);
});

test('movers ranks gains and losses by impressions, clicks weighted 10x', () => {
  const q = byWindow(parseTsv(windowsFixture('query', QUERY_ROWS)), 'query');
  const { gainers, losers } = movers(q.get('last7'), q.get('prior7'));
  assert.deepEqual(
    gainers.map((r) => [r.key, r.dImpr, r.dClicks]),
    [
      ['皮卡魚', 70, 1],
      ['banqi', 60, 1],
    ],
  );
  assert.deepEqual(
    losers.map((r) => [r.key, r.dImpr, r.dClicks]),
    [['jieqi', -45, -2]],
  );
  assert.equal(gainers.find((r) => r.key === '皮卡魚').prev.position, null);
});

test('newKeys keeps last-week keys absent from the rest of the window', () => {
  const q = byWindow(parseTsv(windowsFixture('query', QUERY_ROWS)), 'query');
  assert.deepEqual(
    newKeys(q.get('last7'), q.get('before7')).map((r) => r.key),
    ['皮卡魚'],
  );
});

test('opportunities: position 5-15 with impressions, or high impressions at low CTR', () => {
  const q = byWindow(parseTsv(windowsFixture('query', QUERY_ROWS)), 'query');
  const ops = opportunities(q.get('last28'));
  assert.deepEqual(
    ops.map((r) => [r.key, r.why]),
    [
      ['banqi', 'pos 5-15'],
      ['皮卡魚', 'pos 5-15'],
    ],
  );
  const low = opportunities(q.get('last28'), { highImpr: 50 });
  assert.equal(low.find((r) => r.key === 'banqi').why, 'pos 5-15', 'banqi CTR 2.7% is not low');
  assert.equal(low.find((r) => r.key === '皮卡魚').why, 'pos 5-15, low CTR');
  assert.ok(!ops.some((r) => r.key === 'mistboard'), 'position 1.5 is not an opportunity');
  assert.ok(!ops.some((r) => r.key === 'jieqi'), 'position 30 is not an opportunity');
});

test('countryShifts always lists the zh markets, then the biggest other movers', () => {
  const c = byWindow(
    parseTsv(
      windowsFixture('country', [
        ['last7', 'twn', 5, 400, '6.0'],
        ['prior7', 'twn', 2, 200, '7.0'],
        ['last28', 'usa', 3, 300, '11.0'],
        ['prior28', 'usa', 1, 100, '12.0'],
        ['last28', 'vnm', 1, 50, '13.0'],
        ['prior28', 'vnm', 1, 45, '13.0'],
      ]),
    ),
    'country',
  );
  const { zh, others } = countryShifts(c);
  assert.deepEqual(
    zh.map((r) => r.key),
    ['twn', 'hkg', 'chn', 'sgp', 'mys'],
  );
  assert.equal(zh[0].cur.impressions, 400);
  assert.equal(zh[1].cur.impressions, 0, 'a market with no rows reads as zero, not missing');
  assert.deepEqual(
    others.map((r) => r.key),
    ['usa', 'vnm'],
  );
});

test('termsDelta pairs the newest pull with the one before', () => {
  const t = termsDelta(
    parseTsv(
      tsv([
        ['pulled_on', 'term', 'impressions', 'clicks', 'position', 'top_page'],
        ['2026-09-21', 'xiangqi', '80', '0', '17.0', '/a'],
        ['2026-09-25', 'xiangqi', '90', '0', '16.7', '/a'],
        ['2026-09-25', 'pikafish', '0', '0', '', ''],
        ['2026-10-11', 'xiangqi', '170', '1', '11.8', '/b'],
        ['2026-10-11', 'pikafish', '138', '1', '8.2', '/blog/pikafish'],
      ]),
    ),
  );
  assert.equal(t.latest, '2026-10-11');
  assert.equal(t.before, '2026-09-25');
  assert.deepEqual(
    t.terms.map((r) => [r.term, r.position, r.prevPosition]),
    [
      ['xiangqi', 11.8, 16.7],
      ['pikafish', 8.2, null],
    ],
  );
});

test('bucketWindows reads weekly Bing buckets into last7 and prior7', () => {
  const rows = parseTsv(
    tsv([
      ['date', 'query', 'clicks', 'impressions', 'avg_click_position', 'avg_impression_position'],
      ['2026-09-24', '象棋在线', '10', '500', '6.00', '7.00'],
      ['2026-10-01', '象棋在线', '20', '600', '6.00', '6.50'],
      ['2026-10-08', '象棋在线', '26', '700', '5.00', '6.00'],
      ['2026-10-08', '揭棋', '5', '40', '-1.00', '-1.00'],
    ]),
  );
  const w = bucketWindows(rows, 'query', 'avg_impression_position');
  assert.equal(w.end, '2026-10-08');
  assert.equal(w.get('last7').get('象棋在线').impressions, 700);
  assert.equal(w.get('prior7').get('象棋在线').impressions, 600);
  assert.equal(w.get('last7').get('揭棋').position, null);
});

test('worthALook caps at five, carries numbers, and names a query once', () => {
  const q = byWindow(parseTsv(windowsFixture('query', QUERY_ROWS)), 'query');
  const google = dailyWindows(parseTsv(dailyFixture()));
  const m = {
    google,
    bing: dailyWindows([
      ...Array.from({ length: 7 }, (_, i) => ({ date: addDays('2026-10-08', -i), clicks: 20 })),
      ...Array.from({ length: 7 }, (_, i) => ({ date: addDays('2026-10-01', -i), clicks: 10 })),
    ]),
    queryMovers: movers(q.get('last7'), q.get('prior7')),
    newQueries: newKeys(q.get('last7'), q.get('before7')),
    queryOpportunities: opportunities(q.get('last28')),
    countries: {
      zh: [
        {
          key: 'twn',
          cur: { clicks: 5, impressions: 400 },
          prev: { clicks: 2, impressions: 200 },
        },
      ],
    },
  };
  const lines = worthALook(m);
  assert.ok(lines.length <= 5);
  assert.match(
    lines[0],
    /^Google clicks 21 in the last 7 days vs 7 the 7 before \(\+200%\); impressions 210 vs 70/,
  );
  assert.match(lines[1], /^Bing clicks 140 in the last 7 days vs 70 the 7 before \(\+100%\)\.$/);
  assert.match(lines[2], /^Taiwan \(Google\) impressions 400 vs 200/);
  const pika = lines.filter((l) => l.includes('皮卡魚'));
  assert.equal(
    pika.length,
    1,
    '皮卡魚 is the top gainer, new, and an opportunity; it is said once',
  );
  assert.match(pika[0], /new this week/);
  assert.match(pika[0], /1 click,/);
  for (const l of lines) assert.match(l, /\d/, 'every bullet carries a number');
});

test('end to end: synthetic pull dir -> page with every section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seo-triage-'));
  writeFileSync(join(dir, 'gsc-daily.tsv'), dailyFixture());
  writeFileSync(join(dir, 'gsc-windows-query.tsv'), windowsFixture('query', QUERY_ROWS));
  writeFileSync(
    join(dir, 'gsc-windows-page.tsv'),
    windowsFixture('page', [
      ['last7', 'https://mistboard.com/zh-hant/rules/banqi', 6, 650, '6.8'],
      ['prior7', 'https://mistboard.com/zh-hant/rules/banqi', 6, 430, '6.0'],
      ['before7', 'https://mistboard.com/zh-hant/rules/banqi', 9, 900, '7.0'],
      ['last28', 'https://mistboard.com/zh-hant/rules/banqi', 16, 1342, '6.7'],
    ]),
  );
  writeFileSync(
    join(dir, 'gsc-windows-country.tsv'),
    windowsFixture('country', [['last7', 'hkg', 8, 206, '7.2']]),
  );
  const cache = join(dir, 'numbers-bing.json');
  writeFileSync(
    cache,
    JSON.stringify({
      bing_mistboard_clicks: {
        rows: Object.fromEntries(
          Array.from({ length: 14 }, (_, i) => [addDays('2026-10-08', -i), i < 7 ? 20 : 15]),
        ),
      },
    }),
  );
  const md = renderMarkdown(buildModel({ dir, bingCache: cache, date: '2026-10-12' }));
  for (const h of [
    '# Search triage, 2026-10-12',
    '## Worth a look',
    '## Totals',
    '## Movers (Google, last 7 vs prior 7)',
    '## New this week (Google)',
    '## Opportunities (Google, last 28 days)',
    '## Countries (Google)',
    '## Bing (last 7 vs prior 7)',
    '## Tracked terms',
  ]) {
    assert.ok(md.includes(h), `missing ${h}`);
  }
  assert.match(md, /Bing to 2026-10-08 \(clicks only, life-os cache\)/);
  assert.match(md, /\| Bing 7d \| 140 \(\+33%\) \| - \|/);
  assert.match(md, /\| \*\*Hong Kong\*\* \| 206 \(was 0\) \| 8 \(was 0\)/);
  assert.match(md, /\| \/zh-hant\/rules\/banqi \| 650 \(\+220\)/);
  const worth = md.split('## Worth a look')[1].split('##')[0];
  assert.ok(worth.split('\n').filter((l) => l.startsWith('- ')).length <= 5);
});

test('a pull without window files says what is missing instead of guessing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seo-triage-'));
  writeFileSync(join(dir, 'gsc-daily.tsv'), dailyFixture());
  const md = renderMarkdown(
    buildModel({ dir, bingCache: join(dir, 'none.json'), date: '2026-10-12' }),
  );
  assert.match(md, /No gsc-windows-\*\.tsv in the pull/);
  assert.match(md, /\| Bing \| no data/);
  assert.ok(!md.includes('## Movers'));
});
