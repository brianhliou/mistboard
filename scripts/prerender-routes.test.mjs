import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readPrerenderRoutes } from '../apps/server/src/prerender-routes.ts';
import { crawlerCopyProblems } from '../apps/web/scripts/prerender-copy-check.mjs';
import {
  expandPrerenderRoutes,
  prerenderAlternateLinks,
  prerenderAlternateProblems,
  prerenderRouteManifest,
} from '../apps/web/scripts/prerender-routes.mjs';

const table = JSON.parse(
  await readFile(new URL('../config/prerender-routes.json', import.meta.url), 'utf8'),
);
const rows = expandPrerenderRoutes(table, { analysis: ['xiangqi', 'banqi'], editor: ['xiangqi'] });

test('every table route has exactly one server lookup and the reverse', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prerender-routes-'));
  assert.equal(readPrerenderRoutes(dir).size, 0, 'old builds retain shell fallback');
  const manifest = prerenderRouteManifest(rows);
  await writeFile(join(dir, 'prerender-routes.json'), JSON.stringify(manifest));
  const server = readPrerenderRoutes(dir);
  assert.deepEqual([...server.keys()].sort(), rows.map(({ route }) => route).sort());
  for (const row of rows) assert.equal(server.get(row.route).file, row.file);
  assert.equal(server.get('/zh-hans/analysis/xiangqi').file, 'zh-hans/analysis-xiangqi.html');
  assert.equal(server.has('/zh-hans/analysis/banqi'), false, 'only existing locale board URLs');
  assert.equal(server.has('/about/deep-link'), false);
  // Planted failures: route collisions and escaping dist must fail closed.
  assert.throws(() => prerenderRouteManifest([...rows, rows[0]]), /Duplicate/);
  await writeFile(
    join(dir, 'prerender-routes.json'),
    JSON.stringify({ version: 1, routes: [{ route: '/about', file: '../outside.html' }] }),
  );
  assert.throws(() => readPrerenderRoutes(dir), /Invalid/);
});

test('new crawler text must belong to the protected wrapper', () => {
  assert.deepEqual(
    crawlerCopyProblems('<div class="crawler-copy"><h1>About</h1><p>Copy</p></div>'),
    [],
  );
  for (const fragment of [
    '<main class="styled"><h1>About</h1></main>',
    '<p class="stray">Flash</p><div class="crawler-copy"><h1>About</h1></div>',
    '<div class="crawler-copy"><h1>About</h1></div>Flash',
  ])
    assert.ok(crawlerCopyProblems(fragment).length > 0, fragment);
});

test('static pages and course expand to three files with the same complete hreflang group', async () => {
  for (const path of [
    '/about',
    '/faq',
    '/terms',
    '/privacy',
    '/source',
    '/contribute',
    '/creators',
    '/data/about',
    '/learn/xiangqi',
  ]) {
    const group = rows.filter((row) => row.route.replace(/^\/zh-han[st]/, '') === path);
    assert.equal(group.length, 3, path);
    const links = prerenderAlternateLinks(group[0], 'https://mistboard.test');
    for (const row of group) {
      assert.equal(prerenderAlternateLinks(row, 'https://mistboard.test'), links);
      for (const locale of ['en', 'zh-Hans', 'zh-Hant', 'x-default'])
        assert.ok(links.includes(`hreflang="${locale}"`));
    }
  }
});

test('every hreflang target must have a file emitted by the build, including article groups', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prerender-alternates-'));
  const group = rows.filter((row) => row.route.endsWith('/learn/xiangqi'));
  for (const row of group) {
    const file = join(dir, row.file);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(
      file,
      `<link rel="canonical" href="https://mistboard.test${row.route}">${prerenderAlternateLinks(row, 'https://mistboard.test')}`,
    );
  }
  assert.deepEqual(await prerenderAlternateProblems(dir, 'https://mistboard.test'), []);
  // Planted regression: the old English course advertised an unbuilt zh page.
  await writeFile(join(dir, group[1].file), '<div id="app"></div>');
  assert.equal((await prerenderAlternateProblems(dir, 'https://mistboard.test')).length, 2);
  // Article translation groups bypass the route table; inspect their output too.
  await writeFile(
    join(dir, 'article.html'),
    '<link rel="alternate" href="https://mistboard.test/zh-hant/blog/missing-article" hreflang="zh-Hant">',
  );
  assert.match(
    (await prerenderAlternateProblems(dir, 'https://mistboard.test')).join('\n'),
    /missing-article/,
  );
});
