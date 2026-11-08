import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  CLIENT_ONLY_NOINDEX,
  CRAWLER_CONTENT_MANIFEST,
  type CrawlerContentEntry,
} from './crawler-content-manifest.js';
import { CLIENT_ROUTE_PATTERNS, isClientRoute, isNoindexRoute } from './server-policy.js';
import { SITEMAP_STATIC_ROUTES } from './server-static-pages.js';

// Presence, not fidelity: crawler copy can drift from rendered copy. There is
// one fixture per DB-backed template, no JS, and minChars is only a floor;
// the catalog phrase is the only protection against boilerplate.
function coverageProblems(sitemap: readonly string[], routeIds: readonly string[]) {
  const paths = new Set(CRAWLER_CONTENT_MANIFEST.map((entry) => entry.path));
  const ids = new Set(
    [...CRAWLER_CONTENT_MANIFEST, ...CLIENT_ONLY_NOINDEX].map((entry) => entry.routeId),
  );
  return [
    ...sitemap.filter((path) => !paths.has(path)).map((path) => `sitemap: ${path}`),
    ...routeIds.filter((id) => !ids.has(id)).map((id) => `route: ${id}`),
  ];
}

test('every sitemap URL and every admitted route pattern has a crawler contract', () => {
  assert.deepEqual(
    coverageProblems(
      SITEMAP_STATIC_ROUTES,
      CLIENT_ROUTE_PATTERNS.map((row) => row.id),
    ),
    [],
  );
  assert.deepEqual(coverageProblems(['/new-unclassified-page'], ['new-unclassified-pattern']), [
    'sitemap: /new-unclassified-page',
    'route: new-unclassified-pattern',
  ]);
  assert.equal(
    new Set(CLIENT_ROUTE_PATTERNS.map((row) => row.id)).size,
    CLIENT_ROUTE_PATTERNS.length,
  );
  for (const entry of [...CRAWLER_CONTENT_MANIFEST, ...CLIENT_ONLY_NOINDEX]) {
    if (entry.routeId === 'root') continue;
    const pattern = CLIENT_ROUTE_PATTERNS.find((row) => row.id === entry.routeId);
    assert.ok(pattern?.test(entry.path), `${entry.path} does not exercise ${entry.routeId}`);
    assert.ok(isClientRoute(entry.path), entry.path);
  }
});

test('every client-only contract is noindex, including dynamic-route samples', () => {
  const problems = (policy: (path: string) => boolean) =>
    CLIENT_ONLY_NOINDEX.filter((entry) => !policy(entry.path)).map((entry) => entry.path);
  assert.deepEqual(problems(isNoindexRoute), []);
  // Planted regression: dropping one admin branch must fail this contract.
  assert.deepEqual(
    problems((path) => path !== '/database' && isNoindexRoute(path)),
    ['/database'],
  );
});

test('floors are nontrivial and phrases match page copy in the URL locale', async () => {
  const floor = resolve(import.meta.dirname, '../../../scripts/crawler-floor.mjs');
  const { crawlerMinimumChars } = await import(pathToFileURL(floor).href);
  const catalogs: Record<string, Record<string, string>> = {};
  for (const locale of ['en', 'zh-hans', 'zh-hant']) {
    const values: Record<string, string> = {};
    for (const domain of ['shell', 'content', 'community', 'play', 'review', 'editor', 'account']) {
      // Computed imports keep server production code independent of web source.
      const file = resolve(
        import.meta.dirname,
        '../../web/src/i18n/catalogs',
        `${domain}${locale === 'en' ? '' : `.${locale}`}.ts`,
      );
      const module = await import(pathToFileURL(file).href);
      const name = `${locale === 'en' ? 'EN' : locale === 'zh-hans' ? 'ZH_HANS' : 'ZH_HANT'}_${domain.toUpperCase()}`;
      Object.assign(values, module[name]);
    }
    catalogs[locale] = values;
  }
  for (const entry of CRAWLER_CONTENT_MANIFEST) {
    const minimum = 150;
    assert.ok(entry.minChars >= minimum, entry.path);
    assert.equal(
      crawlerMinimumChars(entry),
      Math.max(entry.minChars, minimum, Math.floor(entry.baselineChars * 0.6)),
      entry.path,
    );
    if (entry.phraseKey.startsWith('apps/')) {
      // Several page-local copy tables and seeded record titles are not in
      // the shared catalogs. Keep a source/body-key pointer, not a nav fallback.
      const [file, key] = entry.phraseKey.split('#');
      assert.ok(key, entry.path);
      const source = await readFile(resolve(import.meta.dirname, '../../..', file!), 'utf8');
      assert.ok(source.includes(entry.phrase), `${entry.path}: missing page copy in ${file}`);
    } else {
      assert.equal(entry.phrase, catalogs[entry.locale]![entry.phraseKey], entry.path);
    }
    assert.ok(entry.phrase.length > 0, entry.path);
    if (entry.path.startsWith('/zh-')) {
      assert.equal(entry.locale, entry.path.split('/')[1], entry.path);
      assert.match(entry.phrase, /\p{Script=Han}/u, entry.path);
    }
    if (entry.knownGap) assert.match(entry.knownGap, /^#\d+(?:: \S.*)?$/);
  }
});

test('gap reasons retain an issue reference and reject untracked or empty explanations', () => {
  const format = /^#\d+(?:: \S.*)?$/;
  for (const value of ['#956', '#960: empty directory has too little text'])
    assert.match(value, format);
  for (const planted of ['empty directory', '#960:', '#960: ', '#: reason'])
    assert.doesNotMatch(planted, format);
});

test('no manifest phrase is supplied by the real shell menu in any locale', async () => {
  const lib = resolve(import.meta.dirname, '../../../scripts/lib/crawler-text.mjs');
  const fixture = resolve(import.meta.dirname, '../../../scripts/fixtures/crawler-shell.mjs');
  const { crawlerText, crawlerContentText } = await import(pathToFileURL(lib).href);
  const { crawlerShells } = await import(pathToFileURL(fixture).href);
  const normalize = (text: string) => text.replace(/\s+/gu, '').toLowerCase();
  const menus: { locale: string; source: string; html: string }[] = crawlerShells();
  function menuPhraseProblems(entries: readonly Pick<CrawlerContentEntry, 'path' | 'phrase'>[]) {
    return entries.flatMap((entry) =>
      menus
        .filter((menu) => normalize(crawlerText(menu.html)).includes(normalize(entry.phrase)))
        .map((menu) => `${entry.path}: ${menu.locale} ${menu.source} contains ${entry.phrase}`),
    );
  }
  assert.deepEqual(
    new Set(menus.map((menu) => menu.locale)),
    new Set(['en', 'zh-hans', 'zh-hant']),
  );
  for (const menu of menus) {
    assert.ok(crawlerText(menu.html).length > 0, `${menu.locale}: ${menu.source}`);
    assert.equal(crawlerContentText(menu.html), '', `${menu.locale}: ${menu.source}`);
  }
  assert.deepEqual(menuPhraseProblems(CRAWLER_CONTENT_MANIFEST), []);
  // Planted regression: catalog-valid labels that the shell alone supplied.
  for (const phrase of ['Play', '规则', '規則']) {
    assert.ok(menuPhraseProblems([{ path: '/planted-menu-phrase', phrase }]).length > 0, phrase);
  }
});
