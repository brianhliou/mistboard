import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CRAWLER_CONTENT_MANIFEST } from './crawler-content-manifest.js';
import { isClientRoute } from './server-policy.js';
import { SPA_ROUTE_META } from './server-static-pages.js';
import { SITEMAP_STATIC_ROUTES } from './sitemap-content.js';

test('the Banqi developer reference has exact public routing and matching prerender metadata', async () => {
  const route = '/developers/banqi';
  assert.equal(isClientRoute(route), true);
  assert.equal(isClientRoute(`${route}/`), true);
  for (const invalid of ['/developers/unknown', `${route}/upload`, `/zh-hans${route}`])
    assert.equal(isClientRoute(invalid), false);
  assert.ok(SITEMAP_STATIC_ROUTES.includes(route));
  const table = JSON.parse(
    await readFile(new URL('../../../config/prerender-routes.json', import.meta.url), 'utf8'),
  ) as Array<{
    route: string;
    module: string;
    export: string;
    file: string;
    locales: string[];
    metaByLocale: Record<string, { title: string; description: string }>;
  }>;
  const row = table.find((entry) => entry.route === route);
  assert.ok(row);
  assert.equal(row.module, 'src/banqi-developer-page.ts');
  assert.equal(row.export, 'renderBanqiDeveloperShellForPrerender');
  assert.equal(row.file, 'developers/banqi.html');
  assert.deepEqual(row.locales, ['en']);
  assert.equal(row.metaByLocale.en.title, SPA_ROUTE_META[route]?.title);
  assert.equal(row.metaByLocale.en.description, SPA_ROUTE_META[route]?.description);
  assert.ok(row.metaByLocale.en.description.length >= 100);
  const contract = CRAWLER_CONTENT_MANIFEST.find((entry) => entry.path === route);
  assert.equal(contract?.source, 'prerender');
  assert.equal(contract?.canonical, true);
});
