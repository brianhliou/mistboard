import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readPrerenderRoutes } from '../apps/server/src/prerender-routes.ts';
import { crawlerCopyProblems } from '../apps/web/scripts/prerender-copy-check.mjs';
import {
  expandPrerenderRoutes,
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
