import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// The study embeds of every served article version, for
// scripts/check-article-study-charts.mjs (`npm run articles:study-charts`),
// which runs this file with ARTICLE_STUDY_EMBEDS_OUT=<file> and judges the
// written list against the live studies. The article modules need the web test
// environment to load, so the test is the extractor, like articles:meta.
// Without the variable it still checks that every study embed path parses.
import { collectStudyEmbeds } from '../../../scripts/lib/article-study-charts.mjs';
import { ARTICLE_LANGS, isArticleTranslationPublished, translateArticle } from './article-i18n.js';
import { articles } from './articles-data.js';

/** Every version a reader can be served: the source, plus each published zh translation. */
function servedVersions() {
  return articles
    .filter((article) => article.status === 'published')
    .flatMap((article) => [
      { slug: article.slug, lang: article.sourceLang ?? 'en', article },
      ...(isArticleTranslationPublished(article.slug)
        ? ARTICLE_LANGS.map((lang) => ({
            slug: article.slug,
            lang,
            article: translateArticle(article, lang),
          }))
        : []),
    ]);
}

describe('article study embeds', () => {
  it('every study embed in a served article parses to a study and chapter', () => {
    const embeds = collectStudyEmbeds(servedVersions());
    const out = process.env.ARTICLE_STUDY_EMBEDS_OUT;
    if (out) writeFileSync(out, `${JSON.stringify(embeds, null, 1)}\n`);
    expect(embeds.length).toBeGreaterThan(0);
    const broken = embeds
      .filter((e) => !e.studyId || !e.chapterId)
      .map((e) => `${e.slug} [${e.lang}] ${e.path}`);
    expect(broken, 'study embeds without a study and chapter id').toEqual([]);
  });
});
