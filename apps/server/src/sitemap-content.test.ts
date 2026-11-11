import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CRAWLER_STUDY } from './crawler-content-fixtures.js';
import {
  pageSitemapEntries,
  serveSpaShellWithRoutePreloads,
  serveStudyPage,
} from './server-static-pages.js';
import {
  localeAlternates,
  SITEMAP_STATIC_ROUTES,
  sitemapPathIsTracked,
  sitemapXml,
} from './sitemap-content.js';

test('sitemap admission retains tracked gaps and rejects unknown paths, aliases and private routes', () => {
  for (const path of [
    '/',
    '/blog',
    '/rules/xiangqi',
    '/historical-xiangqi/game/example',
    '/puzzles/example',
    '/study/example',
    '/zh-hant/study/example',
    '/about',
    '/study',
    '/zh-hans/study',
    '/zh-hant/study',
    '/broadcast/xiangqi/about',
    '/players/teams/zhejiang',
  ])
    assert.ok(sitemapPathIsTracked(path), path);
  for (const path of ['/challenges', '/leaderboard', '/account', '/new-unclassified'])
    assert.equal(sitemapPathIsTracked(path), false, path);
});

test('canonical aliases and broadcast operations stay outside the public static sitemap', () => {
  for (const path of ['/leaderboard', '/broadcast/xiangqi/ops'])
    assert.equal(SITEMAP_STATIC_ROUTES.includes(path), false, path);
});

test('every static entry comes from the build, including tracked gaps and server bodies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sitemap-content-'));
  const group = [
    { lang: 'en', path: '/' },
    { lang: 'zh-Hans', path: '/zh-hans' },
    { lang: 'zh-Hant', path: '/zh-hant' },
    { lang: 'x-default', path: '/' },
  ];
  const records = ['/', '/zh-hans', '/zh-hant'].map((path) => ({
    path,
    lastmod: '2026-10-01',
    alternates: group,
  }));
  const practice = ['/practice', '/zh-hans/practice', '/zh-hant/practice'].map((path) => ({
    path,
    lastmod: '2026-10-02',
    alternates: localeAlternates('/practice'),
  }));
  await writeFile(
    join(dir, 'prerender-sitemap.json'),
    JSON.stringify([
      ...records,
      { path: '/about', lastmod: '2026-10-02', contentChars: 0 }, // Repaired page must meet its floor.
      // Planted thin shells: server bodies supply copy; build dates and alternates stay listed.
      ...practice.map((entry) => ({ ...entry, contentChars: 0 })),
      { path: '/new-unclassified', lastmod: '2026-10-02', contentChars: 10000 }, // No contract.
      { path: '/patron' }, // Built with no repository history: listed, never dated.
      {
        path: '/changelog',
        lastmod: '2026-10-01',
        alternates: [{ lang: 'en', path: '/blog/missing-body' }],
      }, // Planted missing alternate artifact.
      { path: '/player', lastmod: '2026-10-01', contentChars: 149 }, // Planted page below its own floor.
      {
        path: '/puzzles',
        lastmod: '2026-10-01',
        alternates: [{ lang: 'zh-Hans', path: '/zh-hans/practice' }],
      }, // Server-body alternate stays discoverable.
      { path: '/blog/skill-vs-luck', lastmod: '2026-10-03', alternates: [] },
    ]),
  );
  assert.deepEqual(await pageSitemapEntries(dir), [
    records[1],
    records[2],
    {
      path: '/puzzles',
      lastmod: '2026-10-01',
      alternates: [{ lang: 'zh-Hans', path: '/zh-hans/practice' }],
    },
    { path: '/patron', lastmod: undefined, alternates: undefined },
    ...practice,
    records[0],
    { path: '/blog/skill-vs-luck', lastmod: '2026-10-03', alternates: [] },
  ]);
  // Planted: with no build record and no server body date, nothing is listed.
  const empty = await mkdtemp(join(tmpdir(), 'sitemap-no-dates-'));
  assert.deepEqual(await pageSitemapEntries(empty), []);
});

test('a repaired prerender must clear 60 percent of its weighted baseline before sitemap admission', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sitemap-weighted-floor-'));
  const writeRecord = (contentChars: number) =>
    writeFile(
      join(dir, 'prerender-sitemap.json'),
      JSON.stringify([{ path: '/learn/xiangqi', lastmod: '2026-11-01', contentChars }]),
    );
  // Planted failure: above the recorded minimum, below 60% of the weighted baseline.
  await writeRecord(740);
  assert.deepEqual(await pageSitemapEntries(dir), []);
  await writeRecord(741);
  assert.deepEqual(await pageSitemapEntries(dir), [
    { path: '/learn/xiangqi', lastmod: '2026-11-01', alternates: undefined },
  ]);
});

test('sitemap XML escapes URL text and advertises the XHTML namespace', () => {
  const xml = sitemapXml(
    [
      {
        path: '/puzzles/a?x=1&y=2',
        lastmod: '2026-10-01',
        alternates: [{ lang: 'en', path: '/a?x="&y=2' }],
      },
    ],
    'https://mistboard.test',
  );
  assert.match(xml, /xmlns:xhtml="http:\/\/www.w3.org\/1999\/xhtml"/);
  assert.match(xml, /<lastmod>2026-10-01<\/lastmod>/);
  assert.match(xml, /x=1&amp;y=2/);
  assert.match(xml, /href="https:\/\/mistboard.test\/a\?x=&quot;&amp;y=2"/);
  assert.doesNotMatch(xml, /x=1&y=2/); // Planted unescaped URL must not survive.
});

function responseCapture() {
  let html = '';
  return {
    response: {
      writeHead() {},
      end(body: string) {
        html = body;
      },
    } as unknown as ServerResponse,
    html: () => html,
  };
}

test('study and SPA sitemap alternates match the links the server writes in the head', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sitemap-heads-'));
  await writeFile(
    join(dir, 'index.html'),
    '<html lang="en"><head><title>Mistboard</title></head><body><div id="app"></div></body></html>',
  );
  for (const base of ['/study/CrawlerStudy', '/washington-xiangqi']) {
    for (const alternate of localeAlternates(base).filter((a) => a.lang !== 'x-default')) {
      const capture = responseCapture();
      if (base.startsWith('/study/'))
        await serveStudyPage({
          response: capture.response,
          staticDir: dir,
          publicHost: 'https://mistboard.test',
          studyId: CRAWLER_STUDY.id,
          localeSlug:
            alternate.lang === 'en' ? 'en' : alternate.lang === 'zh-Hans' ? 'zh-hans' : 'zh-hant',
          getStudy: async () => CRAWLER_STUDY,
        });
      else
        await serveSpaShellWithRoutePreloads({
          response: capture.response,
          staticDir: dir,
          publicHost: 'https://mistboard.test',
          pathname: alternate.path,
        });
      const head = [
        ...capture
          .html()
          .matchAll(
            /<link rel="alternate" hreflang="([^"]+)" href="https:\/\/mistboard.test([^"]+)"/g,
          ),
      ].map((m) => ({ lang: m[1], path: m[2] }));
      assert.deepEqual(head, localeAlternates(base));
      const xml = sitemapXml(
        [{ path: alternate.path, alternates: localeAlternates(base) }],
        'https://mistboard.test',
      );
      for (const a of head)
        assert.ok(xml.includes(`hreflang="${a.lang}" href="https://mistboard.test${a.path}"`));
    }
  }
});

test('stale dated indexes leave the sitemap until a fresh prerender supplies their body', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sitemap-stale-'));
  await writeFile(
    join(dir, 'prerender-sitemap.json'),
    JSON.stringify([
      { path: '/blog', lastmod: '2000-01-01' },
      { path: '/zh-hans/blog', lastmod: '2000-01-01' },
      { path: '/feed', lastmod: '2000-01-01' },
      { path: '/', lastmod: '2000-01-01' },
    ]),
  );
  await writeFile(
    join(dir, 'article-schedule.json'),
    JSON.stringify({
      builtAt: '2000-01-01',
      scheduled: [{ slug: 'now-live', liveAt: '2000-01-02' }],
    }),
  );
  assert.deepEqual(
    (await pageSitemapEntries(dir)).map((entry) => entry.path),
    ['/'],
  );
});
