import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { crawlerFixtureSources } from './crawler-content-fixtures.js';
import { CRAWLER_CONTENT_MANIFEST } from './crawler-content-manifest.js';
import {
  coachesPageBody,
  dataPageBody,
  dataRouteBody,
  forumPageBody,
  ratingStatsPageBody,
  statsPageBody,
} from './data-page-body.js';
import { DATA_PAGE_COPY } from './data-page-copy.js';
import {
  crawlerDataPageSources,
  DATA_COACH_FIXTURE,
  DATA_DOWNLOAD_FIXTURE,
  DATA_FORUM_FIXTURE,
  DATA_RANKING_FIXTURE,
  DATA_STATS_FIXTURE,
} from './data-page-fixtures.js';
import { isPlayerTitle } from './persistence-titles.js';
import { serveSpaShellWithRoutePreloads } from './server-static-pages.js';
import { renderStudyIndexBody } from './study-page-body.js';

test('crawler coach fixture uses an API title value rather than its display label', () => {
  assert.ok(isPlayerTitle(DATA_COACH_FIXTURE.title));
  assert.equal(isPlayerTitle(DATA_COACH_FIXTURE.title.toUpperCase()), false);
});

test('stats tables contain the chart totals and weeks, excluding the partial point and engine matches', () => {
  const body = statsPageBody(DATA_STATS_FIXTURE);
  assert.match(body, /<table>/);
  assert.match(body, /<th scope="row">Xiangqi<\/th><td>800<\/td>/);
  assert.match(body, /<th scope="row">2026-08-17<\/th><td>10<\/td>/);
  assert.match(body, /21 so far this week/);
  assert.doesNotMatch(body, /<th scope="row">2026-11-02/);
  assert.doesNotMatch(body, /5,000|5000/);
  assert.match(statsPageBody({ ...DATA_STATS_FIXTURE, weeklyCompletedGames: [] }), /Games played/);
  assert.doesNotMatch(
    statsPageBody({
      ...DATA_STATS_FIXTURE,
      variantTotals: [{ variant: 'UNSHOWN_VARIANT_SENTINEL', count: 99 }],
    }),
    /UNSHOWN_VARIANT_SENTINEL/,
  );
});

test('downloads mirror the selected monthly files, sizes and checksums without unpublished collections or timestamps', () => {
  const listing = {
    ...DATA_DOWNLOAD_FIXTURE,
    collections: [
      {
        id: 'private-collection-sentinel',
        event: 'Study collection',
        credit: null,
        variant: 'xiangqi',
        games: 1,
        firstStartedAt: '2026-10-01T00:00:00Z',
        lastEndedAt: '2026-10-01T01:00:00Z',
        files: [],
      },
    ],
  };
  const body = dataPageBody(listing, 'en', '', new Date('2026-11-07'));
  assert.match(body, /download="2026-10-all.jsonl.gz">JSONL 2 kB<\/a>/);
  assert.match(body, /abcdef0 Copy/);
  assert.match(body, /Engine games/);
  assert.doesNotMatch(body, /2026-11-01T|private-collection-sentinel|download="2026-10-xiangqi/);
  const selected = dataPageBody(listing, 'en', '?variant=xiangqi');
  assert.match(selected, /download="2026-10-xiangqi.pgn.gz">PGN<\/a>/);
  assert.doesNotMatch(selected, /download="2026-10-all/);
  assert.match(
    dataPageBody({ ...listing, months: [], engineMonths: [] }),
    /No finished month has games yet/,
  );
});

test('coach and forum directories use public listing fields, localized categories and escaped names', () => {
  const body = coachesPageBody([DATA_COACH_FIXTURE]);
  assert.match(body, /Coach &lt;Lin&gt;/);
  assert.match(body, /Languages: English, Mandarin/);
  assert.match(body, /href="\/coach\/crawler-coach"/);
  assert.match(coachesPageBody([]), /No coaches are listed yet/);
  const forum = forumPageBody(DATA_FORUM_FIXTURE, 'zh-Hant');
  assert.match(forum, /綜合討論/);
  assert.match(forum, /<td>3<\/td><td>9<\/td>/);
  assert.match(forum, /href="\/forum\/t\/topic1\/endgame-study"/);
  assert.match(
    forumPageBody([{ ...DATA_FORUM_FIXTURE[0]!, name: '<script>bad</script>' }]),
    /&lt;script&gt;bad/,
  );
});

test('rating distributions use the chart bin boundaries and handle an empty pool', () => {
  const distribution = ratingStatsPageBody(DATA_RANKING_FIXTURE, 'xiangqi');
  assert.match(distribution, /2 rated Xiangqi players. Average rating is 1575/);
  assert.match(distribution, /1400-1499<\/th><td>1/);
  assert.match(distribution, /1500-1599<\/th><td>0/);
  assert.match(distribution, /1700-1799<\/th><td>1/);
  assert.doesNotMatch(ratingStatsPageBody([], 'xiangqi'), /<table>|NaN|Infinity/);
});

test('data routes call existing API loaders with the API limits and choose the most populated rating pace', async () => {
  const calls: unknown[] = [];
  const sources = {
    ...crawlerDataPageSources(),
    leaderboard: async (query: { timeClass: string }) => {
      calls.push(query);
      return query.timeClass === 'rapid' ? DATA_RANKING_FIXTURE : [];
    },
  };
  assert.match((await dataRouteBody('/player/rating-stats', 'en', '', sources))!, /2 rated/);
  assert.deepEqual(calls, [
    { variant: 'fog', timeClass: 'bullet', limit: 500 },
    { variant: 'fog', timeClass: 'blitz', limit: 500 },
    { variant: 'fog', timeClass: 'rapid', limit: 500 },
  ]);
  assert.equal(await dataRouteBody('/unrelated', 'en', '', sources), null);
});

test('study copy includes the full list and localized visible chapter previews, with no extra description', () => {
  const entry = {
    id: 'id',
    name: 'Study',
    i18n: {},
    chapterCount: 6,
    ownerDisplayName: 'Author',
    likeCount: 3,
    chapterPreview: Array.from({ length: 5 }, (_, i) => ({
      name: `Chapter ${i}`,
      i18n: { 'zh-Hant': { name: `章節 ${i}` } },
    })),
  };
  const body = renderStudyIndexBody(
    Array.from({ length: 51 }, (_, i) => ({ ...entry, id: `study${i}` })),
    { locale: 'zh-Hant', localePath: '/zh-hant' },
  );
  assert.match(body, /\/zh-hant\/study\/study50/);
  assert.match(body, /章節 3/);
  assert.doesNotMatch(body, /Chapter 0|章節 4|Public studies on|Mistboard 上的/);
  assert.match(body, /♥ 3 · Author/);
  assert.match(
    body,
    new RegExp(
      DATA_PAGE_COPY['zh-Hant']['study.chapterPreviewMore']
        .replace('{count}', '2')
        .replace('+', '\\+'),
    ),
  );
});

test('every mirrored data label matches its actual catalog in every supported locale', async () => {
  for (const [locale, copy] of Object.entries(DATA_PAGE_COPY)) {
    const catalog: Record<string, string> = {};
    for (const domain of ['content', 'community', 'play', 'review', 'shell', 'editor']) {
      const suffix = locale === 'en' ? '' : `.${locale.toLowerCase()}`;
      const module = await import(
        pathToFileURL(
          resolve(import.meta.dirname, '../../web/src/i18n/catalogs', `${domain}${suffix}.ts`),
        ).href
      );
      const prefix = locale === 'en' ? 'EN' : locale === 'zh-Hans' ? 'ZH_HANS' : 'ZH_HANT';
      Object.assign(catalog, module[`${prefix}_${domain.toUpperCase()}`]);
    }
    for (const [key, value] of Object.entries(copy))
      assert.equal(value, catalog[key], `${locale}: ${key}`);
    assert.match(
      statsPageBody(DATA_STATS_FIXTURE, locale as keyof typeof DATA_PAGE_COPY),
      new RegExp(copy['stats.heading']),
    );
  }
});

test('served data pages pass the floor and first-paint guard; removing the wrapper or body is caught', async () => {
  const { pageFailures } = await import(
    pathToFileURL(resolve(import.meta.dirname, '../../../scripts/crawler-floor.mjs')).href
  );
  const { serverBodyProblems } = await import(
    pathToFileURL(resolve(import.meta.dirname, '../../../scripts/server-body-check.mjs')).href
  );
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-data-body-'));
  const css = await readFile(resolve(import.meta.dirname, '../../web/src/app-base.css'), 'utf8');
  try {
    await writeFile(
      join(staticDir, 'index.html'),
      '<html lang="en"><head><title>Mistboard</title><meta name="description" content="Mistboard"></head><body><div id="app"></div></body></html>',
    );
    for (const pathname of [
      '/stats',
      '/data',
      '/coach',
      '/forum',
      '/player/rating-stats',
      ...['', '/zh-hans', '/zh-hant'].flatMap((prefix) =>
        ['/bots', '/study', '/practice'].map((path) => `${prefix}${path}`),
      ),
    ]) {
      let html = '';
      const response = {
        writeHead() {},
        end(body: string) {
          html = body;
        },
      } as unknown as ServerResponse;
      await serveSpaShellWithRoutePreloads({
        ...crawlerFixtureSources(),
        response,
        staticDir,
        pathname,
        publicHost: 'https://mistboard.test',
      });
      const entry = CRAWLER_CONTENT_MANIFEST.find((e) => e.path === pathname)!;
      assert.equal(entry.knownGap, undefined, pathname);
      assert.deepEqual(pageFailures(entry, { status: 200, html }).failures, [], pathname);
      assert.deepEqual(serverBodyProblems(html, css), [], pathname);
      assert.ok(
        serverBodyProblems(html.replace('class="crawler-copy"', 'class="planted"'), css).includes(
          'server body text outside .crawler-copy',
        ),
      );
      assert.ok(
        pageFailures(entry, { status: 200, html: html.replace(/<main>[\s\S]*<\/main>/, '') })
          .failures.length > 0,
        'a planted empty body fails',
      );
    }
  } finally {
    await rm(staticDir, { recursive: true, force: true });
  }
});
