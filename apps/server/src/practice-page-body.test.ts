import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { practiceCatalogSlugs } from '@mistboard/game';
import { CRAWLER_PRACTICE_STUDIES } from './crawler-content-fixtures.js';
import { CRAWLER_CONTENT_MANIFEST } from './crawler-content-manifest.js';
import { practicePageBody, practiceRouteBody } from './practice-page-body.js';
import { servePrerenderedPage } from './server-static-pages.js';

test('practice mirrors the anonymous shelf, catalog order, counts and localized names without study descriptions', () => {
  const studies = CRAWLER_PRACTICE_STUDIES.map((study) => ({
    ...study,
    description: 'UNSHOWN_DESCRIPTION',
  })).reverse();
  const en = practicePageBody(studies, 'en');
  assert.ok(en.indexOf('Soldier endgames') < en.indexOf('Chariot endgames'));
  assert.match(en, /0 of 35 solved/);
  assert.match(en, /href="\/study\/CrawlerPractice0"/);
  assert.match(en, /It never moves back<\/p>Play!/);
  assert.match(en, /Wins on its own<\/p>0 \/ 6/);
  assert.doesNotMatch(en, /UNSHOWN_DESCRIPTION/);
  for (const locale of ['zh-Hans', 'zh-Hant'] as const) {
    const body = practicePageBody(studies, locale);
    assert.match(body, /基本殘局|基本残局/);
    assert.match(body, /兵不能后退|兵不能後退/);
    assert.doesNotMatch(body, /Soldier endgames|It never moves back/);
  }
  const missing = practicePageBody(
    studies.filter((s) => s.slug !== 'endgames-soldier'),
    'en',
  );
  assert.doesNotMatch(missing, /Soldier endgames/);
  assert.match(missing, /Wins on its own<\/p>Play!/);
  assert.match(practicePageBody([], 'en'), /No practice sets are published yet/);
  const escaped = practicePageBody([{ ...studies[0]!, name: '<script>name</script>' }], 'en');
  assert.match(escaped, /&lt;script&gt;name/);
});

test('practice uses exactly the API resolving query, never loading for another route', async () => {
  const calls: unknown[] = [];
  const load = async (slugs: readonly string[]) => {
    calls.push(slugs);
    return CRAWLER_PRACTICE_STUDIES;
  };
  assert.equal(await practiceRouteBody('/practice/position', load), null);
  assert.deepEqual(calls, []);
  assert.match((await practiceRouteBody('/zh-hant/practice', load))!, /與引擎對弈/);
  assert.deepEqual(calls, [practiceCatalogSlugs()]);
  assert.match((await practiceRouteBody('/practice/', load))!, /against the engine/);
  assert.equal(calls.length, 2, 'the API has no cache; each request sees the current shelf');
});

test('built practice shells receive the live hidden shelf in every locale and retain all stylesheet links', async () => {
  const { pageFailures } = await import(
    pathToFileURL(resolve(import.meta.dirname, '../../../scripts/crawler-floor.mjs')).href
  );
  const { serverBodyProblems } = await import(
    pathToFileURL(resolve(import.meta.dirname, '../../../scripts/server-body-check.mjs')).href
  );
  const css = await readFile(resolve(import.meta.dirname, '../../web/src/app-base.css'), 'utf8');
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-practice-'));
  const head =
    '<head><meta name="description" content="Practice"><link rel="stylesheet" href="/assets/base.css"><link rel="stylesheet" href="/assets/practice.css">';
  try {
    for (const prefix of ['', '/zh-hans', '/zh-hant']) {
      const pathname = `${prefix}/practice`;
      const file = 'practice.html';
      const links = `<link rel="canonical" href="https://mistboard.test${pathname}">${['en', 'zh-Hans', 'zh-Hant'].map((lang) => `<link rel="alternate" hreflang="${lang}" href="https://mistboard.test/practice">`).join('')}</head>`;
      const shell = `<html>${head}${links}<body><div id="app" class="landing-page"><div class="crawler-copy"><div><aside>BAKED_SIDEBAR</aside></div></div></div><script type="module" src="/assets/index.js"></script></body></html>`;
      await writeFile(join(staticDir, file), shell);
      let html = '';
      const response = {
        writeHead() {},
        end(body: string) {
          html = body;
        },
      } as unknown as ServerResponse;
      await servePrerenderedPage({
        response,
        staticDir,
        file,
        pathname,
        practiceStudies: async () => CRAWLER_PRACTICE_STUDIES,
      });
      assert.equal(html.slice(0, html.indexOf('<body>')), shell.slice(0, shell.indexOf('<body>')));
      assert.match(html, /<script type="module" src="\/assets\/index.js">/);
      assert.doesNotMatch(html, /BAKED_SIDEBAR/);
      const entry = CRAWLER_CONTENT_MANIFEST.find((e) => e.path === pathname)!;
      assert.deepEqual(pageFailures(entry, { status: 200, html }).failures, [], pathname);
      assert.deepEqual(serverBodyProblems(html, css), []);
      assert.ok(serverBodyProblems(html.replace('class="crawler-copy"', ''), css).length > 0);
      assert.ok(pageFailures(entry, { status: 200, html: shell }).failures.length > 0);
      await servePrerenderedPage({
        response,
        staticDir,
        file,
        pathname,
        practiceStudies: async () => {
          throw new Error('offline');
        },
      });
      assert.equal(html, shell, 'a failed read retains the built shell');
    }
  } finally {
    await rm(staticDir, { recursive: true, force: true });
  }
});
