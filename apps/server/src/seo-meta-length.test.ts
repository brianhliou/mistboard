import assert from 'node:assert/strict';
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
