import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isArticleTranslationPublished, translateArticle } from './article-i18n.js';
import { articles } from './articles-data.js';
import { articlesIndexPrerenderHead, rulesIndexPrerenderHead } from './pages-static.js';
import {
  SEO_DESCRIPTION_MIN,
  SEO_TITLE_MIN,
  seoMetaLengthProblems,
  seoTextLength,
} from './seo-meta-length.js';

const appsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('seoTextLength', () => {
  it('counts a CJK character as two and everything else as one', () => {
    expect(seoTextLength('Rules | Mistboard')).toBe(17);
    expect(seoTextLength('规则 | Mistboard')).toBe(16);
    expect(seoTextLength('象棋，规则。')).toBe(12);
    expect(seoTextLength('Lại Lý Huynh')).toBe(12);
  });

  // The server checks its own route tables with a copy of this module (it
  // cannot import web code); the two must measure the same way.
  it('matches its server twin below the header comment', () => {
    const code = (path: string) => readFileSync(path, 'utf-8').replace(/^(\/\/.*\n)+/, '');
    expect(code(resolve(appsDir, 'server/src/seo-meta-length.ts'))).toBe(
      code(resolve(appsDir, 'web/src/seo-meta-length.ts')),
    );
  });
});

// Every title and description the prerender bakes from these sources. Bing
// Webmaster Tools flagged 35 descriptions and 13 titles as too short on
// 2026-10-15, most of them zh pages whose summary was a third shorter than the
// English it translates; a raw character count calls those fine, so the floor
// is measured in seoTextLength. The server's own routes (SPA_ROUTE_META and the
// index shells) are checked by apps/server/src/seo-meta-length.test.ts.
describe('prerendered page meta is long enough to describe the page', () => {
  const pages: Array<{ page: string; title: string; description: string }> = [];
  for (const article of articles) {
    if (article.status !== 'published') continue;
    const base = article.kind === 'rules' ? 'rules' : 'blog';
    const langs =
      !article.sourceLang && isArticleTranslationPublished(article.slug)
        ? ([null, 'zh-Hans', 'zh-Hant'] as const)
        : ([null] as const);
    for (const lang of langs) {
      const localized = lang ? translateArticle(article, lang) : article;
      pages.push({
        page: `${lang ? `/${lang.toLowerCase()}` : ''}/${base}/${article.slug}`,
        // Same expressions as the article loop in scripts/prerender-articles.mjs.
        title: `${localized.seoTitle ?? localized.title} | Mistboard`,
        description: localized.summary,
      });
    }
  }
  for (const lang of [null, 'zh-Hans', 'zh-Hant'] as const) {
    for (const head of [
      articlesIndexPrerenderHead('https://mistboard.com', lang),
      rulesIndexPrerenderHead('https://mistboard.com', lang),
    ]) {
      pages.push({ page: head.url.replace('https://mistboard.com', ''), ...head });
    }
  }
  // Pages whose meta the prerender script spells out as literals (the zh
  // homepages, /player, /feed, /changelog, /learn/xiangqi, /puzzles, /patron).
  const prerender = readFileSync(resolve(appsDir, 'web/scripts/prerender-articles.mjs'), 'utf-8');
  const unquote = (s: string) => s.replace(/\\(.)/g, '$1');
  const literal = [
    ...prerender.matchAll(/title: '((?:[^'\\]|\\.)*)',\s*description:\s*'((?:[^'\\]|\\.)*)'/g),
  ];
  for (const [, title, description] of literal) {
    pages.push({
      page: `prerender-articles.mjs "${unquote(title)}"`,
      title: unquote(title),
      description: unquote(description),
    });
  }

  it('finds the literal meta in the prerender script', () => {
    expect(literal.length).toBeGreaterThanOrEqual(8);
  });

  // The server's ARTICLES_INDEX_META and RULES_INDEX_META serve the same three
  // indexes when the baked file is missing; a copy edit has to land in both.
  it('the index meta matches the server shell fallback', () => {
    const server = readFileSync(resolve(appsDir, 'server/src/server-static-pages.ts'), 'utf-8');
    for (const p of pages.filter((p) => /\/(blog|rules)$/.test(p.page))) {
      expect(server, `${p.page} title`).toContain(`title: '${p.title}'`);
      expect(server, `${p.page} description`).toContain(`'${p.description}'`);
    }
  });

  it(`titles reach ${SEO_TITLE_MIN} and descriptions ${SEO_DESCRIPTION_MIN} (CJK counts double)`, () => {
    const problems = pages.flatMap((p) => seoMetaLengthProblems(p.page, p));
    if (process.env.SEO_DUMP) console.log(problems.join('\n'));
    expect(problems).toEqual([]);
  });
});
