// Unit tests for the video miner. Offline: what breaks silently here is the
// parsing and the judgement calls, not the fetching.

import assert from 'node:assert/strict';
import test from 'node:test';

import * as miner from './videos-mine.mjs';
import {
  extractSearchResults,
  isXiangqi,
  parseAgeDays,
  parseLength,
  parseViews,
  score,
} from './videos-mine.mjs';

test('parseLength handles both YouTube shapes and never rounds to zero', () => {
  assert.equal(parseLength('5:36'), 6);
  assert.equal(parseLength('1:02:33'), 63);
  assert.equal(parseLength('0:41'), 1);
  assert.equal(parseLength(undefined), null);
});

test('parseViews reads a count, and refuses a live-viewer gauge', () => {
  assert.equal(parseViews('178,996 views'), 178996);
  assert.equal(parseViews('1 view'), 1);
  // "12 watching" is concurrent viewers, not a view count. Treating it as one
  // would rank a livestream on a number that means something else entirely.
  assert.equal(parseViews('12 watching'), null);
  assert.equal(parseViews('No views'), null);
});

test('parseAgeDays reads relative timestamps', () => {
  assert.equal(parseAgeDays('5 years ago'), 5 * 365);
  assert.equal(parseAgeDays('3 weeks ago'), 21);
  assert.equal(Math.round(parseAgeDays('6 months ago')), 182);
  assert.equal(parseAgeDays('just now'), null);
});

// 国际象棋 (Western chess) contains 象棋. Half the English query set contains the
// word "chess". Both make search hand back things this library is not about, and
// a chess channel's reach dwarfs the whole xiangqi niche, so ranking promotes
// them rather than burying them.
test('isXiangqi rejects chess and keeps xiangqi', () => {
  assert.equal(
    isXiangqi({ title: 'Basic Chess Openings Explained', author: 'GothamChess' }),
    false,
  );
  assert.equal(
    isXiangqi({ title: 'Understanding the Accelerated Dragon!!', author: 'Daniel Naroditsky' }),
    false,
  );
  assert.equal(isXiangqi({ title: '国际象棋入门第1集 | 如何走棋', author: 'VIPChess' }), false);

  assert.equal(isXiangqi({ title: 'Chess Player Tries Xianqi', author: 'iwantcheckmate' }), true);
  assert.equal(isXiangqi({ title: 'How to play Chinese Chess', author: 'Triple S Games' }), true);
  assert.equal(isXiangqi({ title: '象棋残局教学', author: '四郎讲棋' }), true);
  // Stripping the compound must not take the whole title with it.
  assert.equal(
    isXiangqi({ title: '中國象棋VS國際象棋：誰才是棋盤王者？', author: 'MrYang' }),
    true,
  );
});

test('score damps a fresh upload instead of crowning it', () => {
  const fresh = { views: 1530, ageDays: 1, durationMinutes: 35 };
  const classic = { views: 246708, ageDays: 1460, durationMinutes: 14 };
  // Undamped this is 1530 vs 169, which is how the first sweep ranked them.
  assert.ok(score(fresh) < score(classic), 'a one-day-old upload must not outrank a classic');

  // Damping is not suppression: a genuinely hot video still leads.
  const hot = { views: 70386, ageDays: 25, durationMinutes: 28 };
  assert.ok(score(hot) > score(classic));
});

test('score halves a short clip, matching how the catalogue is ordered', () => {
  const clip = { views: 42136, ageDays: 1200, durationMinutes: 1 };
  const lesson = { views: 42136, ageDays: 1200, durationMinutes: 11 };
  assert.equal(score(clip) * 2, score(lesson));
});

test('score is zero when there is nothing to score on', () => {
  assert.equal(score({ views: null, ageDays: 100, durationMinutes: 10 }), 0);
  assert.equal(score({ views: 1000, ageDays: null, durationMinutes: 10 }), 0);
});

test('extractSearchResults reads a results page and drops incomplete rows', () => {
  const html =
    '{"videoRenderer":{"videoId":"aaaaaaaaaaa","title":{"runs":[{"text":"Xiangqi Endgames"}]},' +
    '"ownerText":{"runs":[{"text":"Some Channel"}]},"lengthText":{"simpleText":"12:30"},' +
    '"viewCountText":{"simpleText":"4,200 views"},"publishedTimeText":{"simpleText":"2 years ago"}}}' +
    // A promoted/placeholder row with no owner: real pages carry these.
    '{"videoRenderer":{"videoId":"bbbbbbbbbbb","title":{"runs":[{"text":"No owner"}]}}}';
  const rows = extractSearchResults(html);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: 'aaaaaaaaaaa',
    title: 'Xiangqi Endgames',
    author: 'Some Channel',
    durationMinutes: 13,
    views: 4200,
    ageDays: 730,
  });
});

test('extractSearchResults survives a page with no results at all', () => {
  assert.deepEqual(extractSearchResults('<html>consent wall</html>'), []);
});

const BVID = 'BV1xx411c7mD';
const NOW = Date.UTC(2026, 10, 5);
const searchRow = (bvid = BVID, extra = {}) => ({
  bvid,
  title: '<em class="keyword">揭棋</em>教学 &amp; 实战',
  author: '揭棋老师',
  play: 4200,
  duration: '12:30',
  pubdate: NOW / 1000 - 100 * 86400,
  pic: '//i0.hdslb.com/lesson.jpg',
  ...extra,
});
const viewRow = (bvid = BVID, extra = {}) => ({
  bvid,
  title: '揭棋教学 & 实战',
  owner: { name: '揭棋老师' },
  copyright: 1,
  stat: { view: 4200 },
  duration: 750,
  pubdate: NOW / 1000 - 100 * 86400,
  pic: 'https://i0.hdslb.com/lesson.jpg',
  ...extra,
});
const apiResponse = (data) => Response.json({ code: 0, data });

// Every fetch and every wait is recorded. A surprise request fails the test;
// no test has permission to fall through to the real network.
function bilibiliHarness(responses) {
  const events = [];
  return {
    events,
    options: {
      catalogueSource: 'const BILIBILI_VIDEOS: readonly BilibiliVideo[] = [];',
      declined: {},
      queries: ['揭棋教学', '象棋残局教学'],
      now: () => NOW,
      sleep: async (ms) => events.push({ wait: ms }),
      fetchImpl: async (url, options) => {
        events.push({ url: String(url), ...options });
        assert.ok(responses.length, `unexpected request: ${url}`);
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      },
    },
  };
}

const homepage = () =>
  new Response('<html>homepage</html>', {
    headers: { 'set-cookie': 'buvid3=offline-fixture; Path=/; HttpOnly' },
  });

test('Bilibili discovery warms cookies, paces every API call, dedupes and proposes metadata', async () => {
  const h = bilibiliHarness([
    homepage(),
    apiResponse({ result: [searchRow()] }),
    apiResponse(viewRow()),
    apiResponse({ result: [searchRow()] }),
  ]);
  const result = await miner.mineBilibili(h.options);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.source, 'bilibili');
  assert.equal(candidate.bvid, BVID);
  assert.equal(candidate.title, '揭棋教学 & 实战');
  assert.equal(candidate.author, '揭棋老师');
  assert.equal(candidate.durationMinutes, 13);
  assert.equal(candidate.views, 4200);
  assert.equal(candidate.ageDays, 100);
  assert.equal(candidate.score, 42);
  assert.equal(candidate.thumbnailUrl, 'https://i0.hdslb.com/lesson.jpg');
  assert.equal(candidate.url, `https://www.bilibili.com/video/${BVID}`);
  assert.deepEqual(candidate.queries, h.options.queries);

  assert.equal(h.events[0].url, 'https://www.bilibili.com/');
  assert.equal(h.events.length, 7);
  for (const index of [1, 3, 5]) assert.ok(h.events[index].wait >= 1800);
  const requests = h.events.filter((event) => event.url);
  for (const request of requests) {
    assert.equal(request.method, 'GET');
    assert.match(request.headers['user-agent'], /Mozilla\/5\.0.*Chrome/);
    assert.notEqual(request.headers.cookie?.includes('SOCS'), true);
  }
  for (const request of requests.slice(1)) {
    assert.equal(request.headers.cookie, 'buvid3=offline-fixture');
    assert.equal(request.headers.referer, 'https://search.bilibili.com/');
  }
  const searchUrl = new URL(requests[1].url);
  assert.equal(
    searchUrl.origin + searchUrl.pathname,
    'https://api.bilibili.com/x/web-interface/search/type',
  );
  assert.equal(searchUrl.searchParams.get('search_type'), 'video');
  assert.equal(searchUrl.searchParams.get('keyword'), '揭棋教学');
  assert.equal(new URL(requests[2].url).pathname, '/x/web-interface/view');
  assert.equal(new URL(requests[2].url).searchParams.get('bvid'), BVID);
});

test('Bilibili queries give jieqi more coverage than xiangqi teaching', () => {
  assert.ok(
    miner.BILIBILI_QUERIES.filter((q) => /揭棋|揭象棋/.test(q)).length >
      miner.BILIBILI_QUERIES.filter((q) => !/揭棋|揭象棋/.test(q)).length,
  );
  assert.ok(miner.BILIBILI_QUERIES.some((q) => /象棋.*教学/.test(q)));
});

test('Bilibili discovery rejects planted search filters before fetching views', async (t) => {
  const cases = [
    [
      'catalogued BVID',
      searchRow(),
      {
        catalogueSource: `const BILIBILI_VIDEOS: readonly BilibiliVideo[] = [{source: 'bilibili', bvid: '${BVID}'}];`,
      },
    ],
    ['declined BVID', searchRow(), { declined: { [BVID]: 'already reviewed' } }],
    ['namespaced declined BVID', searchRow(), { declined: { [`bb:${BVID}`]: 'declined' } }],
    ['banned title', searchRow(BVID, { title: '揭棋 王天一实战' }), {}],
    ['banned uploader', searchRow(BVID, { author: '郑惟桐教你揭棋' }), {}],
    ['banned traditional name', searchRow(BVID, { title: '揭棋 鄭惟桐實戰' }), {}],
    ['banned highlighted name', searchRow(BVID, { title: '揭棋 王<em>天</em>一' }), {}],
    ['banned encoded name', searchRow(BVID, { title: '揭棋 王&#x5929;一' }), {}],
    ['banned English name', searchRow(BVID, { author: 'Wang Tianyi' }), {}],
    ['engine download', searchRow(BVID, { title: '揭棋引擎下载教程' }), {}],
    ['engine install', searchRow(BVID, { title: 'Pikafish installation guide 揭棋' }), {}],
    ['off topic', searchRow(BVID, { title: '国际象棋教学', author: 'Chess' }), {}],
    ['too few views', searchRow(BVID, { play: 3 }), {}],
    ['invalid BVID', searchRow('not-a-bvid'), {}],
  ];
  for (const [name, row, options] of cases) {
    await t.test(name, async () => {
      const h = bilibiliHarness([homepage(), apiResponse({ result: [row] })]);
      const result = await miner.mineBilibili({ ...h.options, queries: ['揭棋教学'], ...options });
      assert.deepEqual(result.candidates, []);
      assert.equal(h.events.filter((event) => event.url).length, 2);
    });
  }
});

test('Bilibili rejections preserve the YouTube-only ledger consumed by catalogue tests', () => {
  const ledger = { declined: { aaaaaaaaaaa: 'old YouTube rejection' } };
  miner.declineVideos(ledger, [BVID, `bb:${BVID}`, 'bbbbbbbbbbb'], 'new rejection');
  assert.deepEqual(ledger.declined, {
    aaaaaaaaaaa: 'old YouTube rejection',
    bbbbbbbbbbb: 'new rejection',
  });
  assert.deepEqual(ledger.bilibiliDeclined, { [BVID]: 'new rejection' });
});

test('Bilibili discovery checks canonical view metadata for reposts and hidden bad names', async (t) => {
  for (const [name, view] of [
    ['copyright=2 repost', viewRow(BVID, { copyright: 2 })],
    ['banned view title', viewRow(BVID, { title: '揭棋 赵鑫鑫实战' })],
    ['banned view uploader', viewRow(BVID, { owner: { name: '王天一' } })],
    ['engine guide view title', viewRow(BVID, { title: '揭棋软件安装教程' })],
  ]) {
    await t.test(name, async () => {
      const h = bilibiliHarness([
        homepage(),
        apiResponse({ result: [searchRow()] }),
        apiResponse(view),
      ]);
      const result = await miner.mineBilibili({ ...h.options, queries: ['揭棋教学'] });
      assert.deepEqual(result.candidates, []);
    });
  }
});

test('Bilibili discovery keeps jieqi and engine game teaching, with or without a pre-part-1 shelf', async () => {
  const h = bilibiliHarness([
    homepage(),
    apiResponse({ result: [searchRow()] }),
    apiResponse(viewRow(BVID, { title: '皮卡鱼象棋残局讲解' })),
  ]);
  const result = await miner.mineBilibili({
    ...h.options,
    catalogueSource: '',
    queries: ['揭棋教学'],
  });
  assert.equal(result.candidates.length, 1);
});

test('Bilibili discovery stops on non-JSON, rate limits, API errors and invalid shapes', async (t) => {
  const failures = [
    ['HTML bot wall', () => new Response('<html>blocked</html>'), /non-JSON/],
    [
      'invalid JSON',
      () => new Response('{', { headers: { 'content-type': 'application/json' } }),
      /non-JSON/,
    ],
    ['HTTP limit', () => new Response('', { status: 429 }), /HTTP 429/],
    [
      'API limit',
      () => Response.json({ code: -412, message: 'risk control' }),
      /-412.*risk control/,
    ],
    ['API error', () => Response.json({ code: -400, message: 'bad request' }), /-400.*bad request/],
    ['no code', () => Response.json({ data: {} }), /API/],
    ['missing data', () => Response.json({ code: 0 }), /data/],
    ['fetch failure', () => new Error('offline'), /offline/],
  ];
  for (const [name, response, pattern] of failures) {
    for (const stage of ['search', 'view']) {
      await t.test(`${stage}: ${name}`, async () => {
        const h = bilibiliHarness([
          homepage(),
          ...(stage === 'view' ? [apiResponse({ result: [searchRow()] })] : []),
          response(),
        ]);
        await assert.rejects(miner.mineBilibili(h.options), pattern);
        assert.equal(h.events.filter((event) => event.url).length, stage === 'view' ? 3 : 2);
      });
    }
  }
  for (const [stage, data] of [
    ['search', {}],
    ['view', { bvid: BVID }],
  ]) {
    await t.test(`${stage}: malformed success`, async () => {
      const h = bilibiliHarness([
        homepage(),
        ...(stage === 'view' ? [apiResponse({ result: [searchRow()] })] : []),
        apiResponse(data),
      ]);
      await assert.rejects(miner.mineBilibili(h.options), /malformed/);
    });
  }
});

test('Bilibili discovery stops before searches when the homepage fails or sets no cookies', async () => {
  for (const response of [new Response('', { status: 429 }), new Response('<html/>')]) {
    const h = bilibiliHarness([response]);
    await assert.rejects(miner.mineBilibili(h.options), /HTTP 429|cookie/i);
    assert.equal(h.events.length, 1);
  }
});

test('Bilibili discovery abandons a partial proposal and remaining rows on a view error', async () => {
  const second = 'BV1yy411c7mD';
  const h = bilibiliHarness([
    homepage(),
    apiResponse({ result: [searchRow(), searchRow(second), searchRow('BV1zz411c7mD')] }),
    apiResponse(viewRow()),
    Response.json({ code: -412, message: 'risk control' }),
  ]);
  await assert.rejects(miner.mineBilibili(h.options), /-412.*risk control/);
  assert.equal(h.events.filter((event) => event.url).length, 4);
});

test('Bilibili discovery allows a reprimanded teacher and real empty search results', async () => {
  const h = bilibiliHarness([
    homepage(),
    apiResponse({ result: [] }),
    apiResponse({ result: [searchRow(BVID, { author: '曹岩磊' })] }),
    apiResponse(viewRow(BVID, { owner: { name: '曹岩磊' } })),
  ]);
  const result = await miner.mineBilibili(h.options);
  assert.equal(result.candidates.length, 1);
});
