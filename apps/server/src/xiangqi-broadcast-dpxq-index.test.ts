import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
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
  ]) {
    assert.equal(isTopDpxqEvent(name), true, name);
  }
  for (const name of [
    '2026年第六届世界青少年锦标赛',
    '2026年“山海杯”全国业余象棋棋王争霸赛',
    '2026年全国大学生象棋锦标赛',
    '2026年大竹林街道凤栖沱社区“银龄杯”象棋比赛 公开组',
    '2026年全国象棋公开赛高密站',
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
