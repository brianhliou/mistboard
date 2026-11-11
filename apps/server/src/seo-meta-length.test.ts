import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { seoMetaLengthProblems, seoTextLength } from './seo-meta-length.js';
import { ARTICLES_INDEX_META, RULES_INDEX_META, SPA_ROUTE_META } from './server-static-pages.js';

test('seoTextLength counts a CJK character as two', () => {
  assert.equal(seoTextLength('规则 | Mistboard'), 16);
  assert.equal(seoTextLength('Rules | Mistboard'), 17);
});

// Bing Webmaster Tools flagged /streamer's description and the /api-docs,
// /zh-hant/videos and index titles as too short on 2026-10-15. Every route
// whose meta the server writes itself is held to the floors the prerendered
// pages are (apps/web/src/seo-meta-length.test.ts).
test('server route meta is long enough to describe the page', () => {
  const pages = [
    ...Object.entries(SPA_ROUTE_META).map(([page, meta]) => ({ page, meta })),
    ...Object.entries(ARTICLES_INDEX_META).map(([lang, meta]) => ({ page: `${lang} /blog`, meta })),
    ...Object.entries(RULES_INDEX_META).map(([lang, meta]) => ({ page: `${lang} /rules`, meta })),
  ];
  const problems = pages.flatMap(({ page, meta }) => seoMetaLengthProblems(page, meta));
  if (process.env.SEO_DUMP) console.log(problems.join('\n'));
  assert.deepEqual(problems, []);
});

test('explicit prerender metadata meets the same length floors as server route metadata', () => {
  const routes: Array<{
    route: string;
    metaByLocale?: Record<string, { title: string; description: string }>;
  }> = JSON.parse(
    readFileSync(new URL('../../../config/prerender-routes.json', import.meta.url), 'utf8'),
  );
  const problems = routes.flatMap(({ route, metaByLocale }) =>
    Object.entries(metaByLocale ?? {}).flatMap(([locale, meta]) =>
      seoMetaLengthProblems(`${locale} ${route}`, meta),
    ),
  );
  assert.deepEqual(problems, []);
});

test('metadata floors reject the former thin Chinese FAQ headings and opening questions', () => {
  // Planted regression: navigation labels and a single FAQ question were used
  // as the complete search snippet in both the server and prerender table.
  for (const [page, title, description] of [
    ['/zh-hans/faq', '常见问题 | Mistboard', '有网页版吗？需要下载吗？'],
    ['/zh-hant/faq', '常見問題 | Mistboard', '有網頁版嗎？需要下載嗎？'],
  ]) {
    assert.deepEqual(seoMetaLengthProblems(page!, { title: title!, description: description! }), [
      `${page}: title 20 < 25: ${title}`,
      `${page}: description 24 < 100: ${description}`,
    ]);
  }
});
