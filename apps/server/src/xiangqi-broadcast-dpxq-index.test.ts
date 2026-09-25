import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildBroadcastCalendar,
  dpxqTourIdFromSourceUrl,
  fetchDpxqTourIndex,
  isTopDpxqEvent,
  parseDpxqTourIndex,
  planDpxqIndexSync,
} from './xiangqi-broadcast-dpxq-index.js';
import { decodeSourceBody } from './xiangqi-broadcast-fetch.js';

// The real index as served on 2026-09-23 (gb2312), the day the 2026 women's
// league was found live on it while our calendar said it had no edition.
async function indexFixture(): Promise<string> {
  const bytes = await readFile(
    new URL('../fixtures/dpxq/hldcg-index-2026-09-23.html', import.meta.url),
  );
  return decodeSourceBody(new Uint8Array(bytes), null);
}

const NOW = Date.parse('2026-09-23T18:00:00Z');

test('the real index parses into sectioned rows with dates and sub-page flags', async () => {
  const rows = parseDpxqTourIndex(await indexFixture());
  assert.equal(rows.length, 111);
  assert.deepEqual(
    ['live', 'upcoming', 'ended'].map((s) => rows.filter((r) => r.section === s).length),
    [1, 10, 100],
  );
  const women = rows.find((row) => row.tourId === '12776');
  assert.deepEqual(women, {
    tourId: '12776',
    name: '2026年全国象棋女子甲级联赛',
    location: '绥芬河率宾国际大酒店',
    startsOn: '2026-09-23',
    endsOn: '2026-09-27',
    section: 'live',
    hasGameList: false,
    hasPairings: false,
  });
  const men = rows.find((row) => row.tourId === '12683');
  assert.equal(men?.section, 'ended');
  assert.equal(men?.hasGameList, true);
  assert.equal(men?.hasPairings, true);
});

test('top-event filter keeps the professional series and drops amateur, youth and community events', () => {
  for (const name of [
    '2026年全国象棋女子甲级联赛',
    '2026年全国象棋个人赛',
    '2026年第21届亚洲象棋个人锦标赛 男子组',
    '2026年第五届世界象棋公开赛',
    '2026年第六届“上海杯”象棋大师公开赛',
    '2026年润德健行杯第20届全国象棋等级赛',
  ]) {
    assert.equal(isTopDpxqEvent(name), true, name);
  }
  for (const name of [
    '2026年第六届世界青少年锦标赛',
    '2026年“山海杯”全国业余象棋棋王争霸赛',
    '2026年全国大学生象棋锦标赛',
    '2026年大竹林街道凤栖沱社区“银龄杯”象棋比赛 公开组',
    '2026年全国象棋公开赛高密站',
    // A city's rating event, not the national one.
    '2026年北京市秋季象棋等级赛',
  ]) {
    assert.equal(isTopDpxqEvent(name), false, name);
  }
});

test("the plan lists the untracked women's league and moves only later end dates", async () => {
  const rows = parseDpxqTourIndex(await indexFixture());
  const plan = planDpxqIndexSync({
    rows,
    now: NOW,
    tours: [
      {
        slug: '2026-xiangqi-league',
        sourceUrl: 'mistboard-discover://dpxq-tour?tour=12683&tourSlug=2026-xiangqi-league',
        endsAt: '2026-09-18T23:59:59+08:00',
      },
      {
        // Ours ends later than dpxq's row: never moved earlier.
        slug: '2026-shanghai-cup',
        sourceUrl: 'mistboard-discover://dpxq-tour?tour=12524&tourSlug=2026-shanghai-cup',
        endsAt: '2026-09-20T23:59:59+08:00',
      },
      { slug: 'hand-import', sourceUrl: null, endsAt: null },
    ],
  });
  assert.deepEqual(plan.endDateMoves, []);
  assert.deepEqual(
    plan.untracked.map((row) => row.tourId),
    ['12776', '12527', '12526', '12528', '12529', '12461'],
  );
});

test('a league row dpxq extends to its next stage moves our end date out', () => {
  const plan = planDpxqIndexSync({
    now: NOW,
    rows: [
      {
        tourId: '12683',
        name: '2026年全国象棋男子甲级联赛',
        location: '',
        startsOn: '2026-09-14',
        endsOn: '2026-11-30',
        section: 'live',
        hasGameList: true,
        hasPairings: true,
      },
    ],
    tours: [
      {
        slug: '2026-xiangqi-league',
        sourceUrl: 'mistboard-discover://dpxq-tour?tour=12683&tourSlug=2026-xiangqi-league',
        endsAt: '2026-09-18T23:59:59+08:00',
      },
    ],
  });
  assert.deepEqual(plan.endDateMoves, [
    {
      slug: '2026-xiangqi-league',
      tourId: '12683',
      from: '2026-09-18T23:59:59+08:00',
      to: '2026-11-30T23:59:59+08:00',
    },
  ]);
  assert.deepEqual(plan.untracked, []);
});

test('a finished top event is listed only once its records are up and within a month', () => {
  const row = {
    tourId: '12791',
    name: '2026年全国象棋女子甲级联赛“龙江体彩杯” 预选赛',
    location: '',
    startsOn: '2026-09-20',
    endsOn: '2026-09-22',
    section: 'ended' as const,
    hasGameList: false,
    hasPairings: true,
  };
  assert.deepEqual(planDpxqIndexSync({ rows: [row], tours: [], now: NOW }).untracked, []);
  const withRecords = { ...row, hasGameList: true };
  assert.equal(planDpxqIndexSync({ rows: [withRecords], tours: [], now: NOW }).untracked.length, 1);
  assert.deepEqual(
    planDpxqIndexSync({ rows: [withRecords], tours: [], now: NOW + 40 * 86_400_000 }).untracked,
    [],
  );
});

test('only dpxq-tour discovery URLs name a tracked dpxq tour', () => {
  assert.equal(
    dpxqTourIdFromSourceUrl('mistboard-discover://dpxq-tour?tour=12683&tourSlug=x'),
    '12683',
  );
  assert.equal(dpxqTourIdFromSourceUrl('mistboard-discover://dpxq-live?tourSlug=x'), null);
  assert.equal(dpxqTourIdFromSourceUrl('http://www.dpxq.com/hldcg/search/view_m_1.html'), null);
  assert.equal(dpxqTourIdFromSourceUrl(null), null);
});

test('an index that parses to no rows is a failure, not a quiet week', async () => {
  const result = await fetchDpxqTourIndex({
    timeoutMs: 1_000,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '<html>app download</html>',
    }),
  });
  assert.equal(result.ok, false);
});

test('the calendar lists top events live, upcoming and just finished, linked to our page when we relay one', async () => {
  const rows = parseDpxqTourIndex(await indexFixture());
  const events = buildBroadcastCalendar({
    rows,
    now: NOW,
    tours: [
      {
        slug: '2026-xiangqi-league',
        name: '2026年全国象棋男子甲级联赛',
        sourceUrl: 'mistboard-discover://dpxq-tour?tour=12683&tourSlug=2026-xiangqi-league',
      },
      // A spring event we relay stays on it for the year, though dpxq's index
      // no longer lists it; one from last year does not.
      {
        slug: '2026-wuyang-cup',
        name: '2026年第32届“五羊杯”全国象棋冠军赛',
        startsAt: '2026-01-29T00:00:00+08:00',
        endsAt: '2026-03-02T19:00:00+08:00',
      },
      {
        slug: '2025-wuyang-cup',
        name: '2025年第31届“五羊杯”全国象棋冠军赛',
        startsAt: '2025-02-20T00:00:00+08:00',
        endsAt: '2025-02-24T19:00:00+08:00',
      },
      // A hand import dpxq's index has no row for still makes the calendar.
      {
        slug: '2026-league-qualifier',
        name: '2026 China Xiangqi League Qualifier',
        startsAt: '2026-08-17T09:00:00+08:00',
        endsAt: '2026-08-19T18:00:00+08:00',
      },
    ],
    translate: (zh) => (zh === '2026年全国象棋女子甲级联赛' ? '2026 Women League' : undefined),
  });
  const byName = new Map(events.map((event) => [event.name, event]));
  const women = byName.get('2026年全国象棋女子甲级联赛');
  assert.equal(women?.status, 'live');
  assert.equal(women?.nameEn, '2026 Women League');
  assert.equal(women?.tourSlug, null);
  assert.equal(women?.sourceUrl, 'http://www.dpxq.com/hldcg/tour_12776.html');
  assert.equal(byName.get('2026年全国象棋男子甲级联赛')?.tourSlug, '2026-xiangqi-league');
  assert.equal(byName.get('2026年全国象棋男子甲级联赛')?.status, 'finished');
  // The hand-imported qualifier maps onto dpxq's own row (12656) rather than
  // appearing twice; the fixture index predates the qualifier's section, so
  // it comes in through the tours list.
  assert.equal(events.filter((event) => event.tourSlug === '2026-league-qualifier').length, 1);
  assert.equal(byName.get('2026年全国象棋个人赛')?.status, 'upcoming');
  assert.equal(events.find((event) => event.tourSlug === '2026-wuyang-cup')?.status, 'finished');
  assert.equal(
    events.some((event) => event.tourSlug === '2025-wuyang-cup'),
    false,
  );
  // Community and youth events stay off it.
  assert.equal(
    events.some((event) => event.name.includes('银龄')),
    false,
  );
  // Sorted by start.
  const starts = events.map((event) => event.startsOn);
  assert.deepEqual(starts, [...starts].sort());
});
