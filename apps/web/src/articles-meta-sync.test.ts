import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The server cannot import the web article modules, so it reads
// apps/server/src/article-meta.generated.json, rendered from articles-data by
// article-server-meta.ts. This test is what keeps that file current: adding,
// renaming, publishing or re-describing an article without regenerating fails
// here instead of shipping a wrong-direction 301 (kind falls back to 'article',
// so /rules/<slug> redirects away from its own prerendered page), a generic
// share card, or an indexable shell for an unpublished draft.
// `npm run articles:meta` runs this file with UPDATE_ARTICLE_META=1 to rewrite it.
import {
  ARTICLE_META,
  articleIsIndexable,
  articleIsUnpublished,
} from '../../server/src/article-meta.js';
import { isArticleTranslationPublished } from './article-i18n.js';
import {
  renderServerArticleMeta,
  SERVER_ARTICLE_META_COMMAND,
  SERVER_ARTICLE_META_FILE,
} from './article-server-meta.js';
import { articles } from './articles-data.js';
import { SUPPORTED_LOCALES } from './i18n/locale.js';
import { rulesSlugPublicSurfaceEnabled } from './variant-public-surfaces.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const generatedPath = resolve(repoRoot, SERVER_ARTICLE_META_FILE);

describe('articles-data -> server article-meta.generated.json', () => {
  it('the committed generated file matches articles-data', () => {
    const expected = renderServerArticleMeta(articles);
    if (process.env.UPDATE_ARTICLE_META === '1') {
      writeFileSync(generatedPath, expected);
    }
    const actual = existsSync(generatedPath) ? readFileSync(generatedPath, 'utf-8') : '';
    expect(
      actual === expected,
      `${SERVER_ARTICLE_META_FILE} is stale: run \`${SERVER_ARTICLE_META_COMMAND}\` and commit the result`,
    ).toBe(true);
  });

  // Belt and braces over the file comparison: what the server actually loads.
  it('every article has a server ARTICLE_META entry with matching title and kind', () => {
    for (const article of articles) {
      const meta = ARTICLE_META[article.slug];
      expect(meta, `'${article.slug}' is missing from ARTICLE_META`).toBeDefined();
      expect(meta?.title, `ARTICLE_META title drifted for '${article.slug}'`).toBe(article.title);
      expect(meta?.kind, `ARTICLE_META kind drifted for '${article.slug}'`).toBe(article.kind);
      expect(
        meta?.description.length,
        `ARTICLE_META description is empty for '${article.slug}'`,
      ).toBeGreaterThan(0);
    }
  });

  // The server answers /blog/<slug> with a 200 shell + real title/description
  // even for an article the web build hides, so it has to know which are drafts.
  it('unpublished articles are marked unpublished on the server', () => {
    for (const article of articles) {
      expect(
        articleIsUnpublished(article.slug),
        `'${article.slug}' is status '${article.status}' but the server disagrees`,
      ).toBe(article.status !== 'published');
    }
  });

  it('every ARTICLE_META slug still exists in articles-data', () => {
    const slugs = new Set(articles.map((article) => article.slug));
    for (const slug of Object.keys(ARTICLE_META)) {
      expect(slugs.has(slug), `ARTICLE_META has stale slug '${slug}'`).toBe(true);
    }
  });
});

// The prerenderer stamps `noindex, follow` on any rules page whose variant is
// retired from public surfaces, but the sitemap is built server-side and cannot
// import that table, so it advertised those same pages. The site was telling
// Google to index pages the pages themselves declined. This keeps the two ends
// in agreement rather than trusting a second hand-written copy of the list,
// which is how the archive content digest drifted earlier the same week.
describe('sitemap indexability <-> public surface sync', () => {
  it('a rules page is sitemapped exactly when its variant is publicly surfaced', () => {
    const mismatched = articles
      .filter((article) => article.kind === 'rules' && !articleIsUnpublished(article.slug))
      .filter(
        (article) =>
          articleIsIndexable(article.slug) !== rulesSlugPublicSurfaceEnabled(article.slug),
      )
      .map(
        (article) =>
          `${article.slug}: sitemap=${articleIsIndexable(article.slug)} ` +
          `publicSurface=${rulesSlugPublicSurfaceEnabled(article.slug)}`,
      );
    expect(mismatched, `sitemap and public surface disagree:\n${mismatched.join('\n')}`).toEqual(
      [],
    );
  });
});

// A page written in its own language is not a translation of an English
// original, so it must never enter the zh translation pipeline: the coverage
// gate would then demand Chinese renderings of Vietnamese prose, and the
// prerenderer would emit zh variants of a document that has none.
describe('non-English source articles', () => {
  it('are never treated as translation targets', () => {
    for (const article of articles) {
      if (!article.sourceLang) continue;
      expect(
        isArticleTranslationPublished(article.slug),
        `'${article.slug}' is written in ${article.sourceLang} but is queued for zh translation`,
      ).toBe(false);
    }
  });

  it('declare a language the interface does not have to speak', () => {
    // The guard against someone "fixing" sourceLang by adding a locale: the
    // interface locale set is settled and closed, and this field exists
    // precisely so content can run ahead of it.
    const vietnamese = articles.filter((article) => article.sourceLang === 'vi');
    expect(vietnamese.length).toBeGreaterThan(0);
    expect(SUPPORTED_LOCALES).not.toContain('vi');
  });
});
