import { describe, expect, it } from 'vitest';
import {
  ARTICLE_LANGS,
  hasTranslation,
  TRANSLATED_ARTICLE_SLUGS,
  translateArticle,
  translateArticleText,
  translationKeys,
} from './article-i18n.js';
import { articleProse, articleTranslationSourceStrings } from './article-prose.js';
import { articleCardLabels, articleDiagramLabels } from './articles/svg-labels.js';
import { type Article, articles } from './articles-data.js';

// Slugs whose English copy is editorially frozen AND fully translated into
// every zh script. Add a slug here only after (1) its copy is final and
// (2) every prose string it contributes resolves in zh-Hans and zh-Hant.
//
// Once a slug is listed, any later English edit that orphans a dictionary key
// fails this test instead of silently rendering English on the zh pages. That
// failure is the point: it forces the dictionary update to ride along with the
// copy change. This is the durability guarantee for the translations.
function truncate(text: string): string {
  return text.length > 64 ? `${text.slice(0, 61)}...` : text;
}

const published = articles.filter((a) => a.status === 'published');

describe('article translation coverage', () => {
  for (const slug of TRANSLATED_ARTICLE_SLUGS) {
    it(`${slug}: every prose string resolves in all zh scripts`, () => {
      const article = published.find((a) => a.slug === slug);
      expect(article, `locked slug "${slug}" is not a published article`).toBeTruthy();
      const missing: string[] = [];
      for (const { path, text } of articleProse(article as Article)) {
        for (const lang of ARTICLE_LANGS) {
          if (!hasTranslation(lang, text)) missing.push(`[${lang}] ${path}: ${truncate(text)}`);
        }
      }
      expect(missing, `untranslated strings:\n${missing.join('\n')}`).toEqual([]);
    });
  }

  // Diagram labels live inside generated SVG, where articleProse cannot see
  // them, so until 2026-10-01 this file read every rules page as covered while
  // the zh jieqi page showed SHUFFLED START, BEFORE: HORSE POINT and CAPTURE in
  // English (68 labels across eight locked pages). localizeSvgMarkup looks each
  // <text> node up by its trimmed text; this checks the same key.
  it('every locked article translates its diagram labels in all zh scripts', () => {
    const missing: string[] = [];
    for (const slug of TRANSLATED_ARTICLE_SLUGS) {
      const article = published.find((a) => a.slug === slug);
      if (!article) continue;
      for (const { path, text } of articleDiagramLabels(article)) {
        for (const lang of ARTICLE_LANGS) {
          if (!hasTranslation(lang, text)) missing.push(`[${lang}] ${slug} ${path}: ${text}`);
        }
      }
    }
    expect(missing, `untranslated diagram labels:\n${missing.join('\n')}`).toEqual([]);
  });

  // The index card is the same gap one step earlier: a zh reader met "GAMES
  // PLAYED" and "SINCE 1956" before opening the article. Read as each script
  // renders it, so a card that sets its own zh lead (cardMark) is checked as such.
  it('every locked article translates its index card in all zh scripts', () => {
    const missing: string[] = [];
    for (const slug of TRANSLATED_ARTICLE_SLUGS) {
      const article = published.find((a) => a.slug === slug);
      if (!article) continue;
      for (const lang of ARTICLE_LANGS) {
        for (const text of articleCardLabels(article, lang)) {
          if (!hasTranslation(lang, text)) missing.push(`[${lang}] ${slug} card: ${text}`);
        }
      }
    }
    expect(missing, `untranslated card words:\n${missing.join('\n')}`).toEqual([]);
  });

  // seoTitle drives the document <title> and og:title but is NOT prose, so the
  // loop above cannot see it missing. A locked article without an entry ships a
  // Chinese page under an English title, which is what the champions article did
  // on 2026-08-29: the body, the html lang and the JSON-LD headline localized,
  // and the one string a searcher actually reads in the results did not.
  it('every locked article translates its seoTitle too', () => {
    const missing: string[] = [];
    for (const slug of TRANSLATED_ARTICLE_SLUGS) {
      const seoTitle = published.find((a) => a.slug === slug)?.seoTitle;
      if (!seoTitle) continue;
      for (const lang of ARTICLE_LANGS) {
        if (!hasTranslation(lang, seoTitle))
          missing.push(`[${lang}] ${slug}: ${truncate(seoTitle)}`);
      }
    }
    expect(missing, `untranslated seoTitle:\n${missing.join('\n')}`).toEqual([]);
  });

  // ZH_HANT spreads ...ZH_HANS as its base and overrides below it, so Traditional
  // entries authored ABOVE that spread are silently replaced by the Simplified
  // ones. Every other check here passes when that happens: the keys resolve, and
  // the parallel-values guard compares a value against itself, so length and
  // ASCII match perfectly. On 2026-09-01 all 51 entries for the puzzle-mining
  // article were being discarded while the whole file was green, and it was only
  // caught by reading the built page. A locked article that renders identically
  // in both scripts is that bug.
  it('a locked article does not render identically in both zh scripts', () => {
    const identical: string[] = [];
    for (const slug of TRANSLATED_ARTICLE_SLUGS) {
      const article = published.find((a) => a.slug === slug);
      if (!article) continue;
      const render = (lang: (typeof ARTICLE_LANGS)[number]) =>
        [...articleProse(translateArticle(article, lang))].map((p) => p.text).join('\n');
      if (render('zh-Hans') === render('zh-Hant')) identical.push(slug);
    }
    expect(
      identical,
      `zh-Hant is byte-identical to zh-Hans for these slugs, which means their\nTraditional entries sit above the ...ZH_HANS spread in article-i18n.ts:\n${identical.join('\n')}`,
    ).toEqual([]);
  });

  it('locked slugs are real published articles', () => {
    const slugs = new Set(published.map((a) => a.slug));
    const unknown = TRANSLATED_ARTICLE_SLUGS.filter((s) => !slugs.has(s));
    expect(unknown, `locked but not published: ${unknown.join(', ')}`).toEqual([]);
  });

  // zh-Hant values are derived from zh-Hans by script conversion, which is
  // near length-preserving and never rewrites ASCII (names, numbers, links).
  // A value that blows past its sibling's length, or whose ASCII token stream
  // drifts, means the derivation tooling corrupted it (this shipped once:
  // 2026-08-22, ASCII-token placeholders were restored as whole sentences and
  // one zh-Hant paragraph rendered 42 copies of itself). Keys whose values are
  // per-locale resources (locale-suffixed URLs/paths) are exempt from the
  // ASCII comparison by design.
  it('zh-Hant values stay parallel to their zh-Hans siblings', () => {
    const asciiTokens = (s: string) => (s.match(/[A-Za-z0-9]+/g) ?? []).join('|');
    const problems: string[] = [];
    for (const key of translationKeys('zh-Hant')) {
      if (!hasTranslation('zh-Hans', key)) continue;
      const hans = translateArticleText('zh-Hans', key);
      const hant = translateArticleText('zh-Hant', key);
      const perLocaleResource = /zh-han/i.test(hans) || /zh-han/i.test(hant);
      const slack = (n: number) => Math.max(n * 1.25, n + 8);
      if (hant.length > slack(hans.length) || hans.length > slack(hant.length)) {
        problems.push(`length ${hans.length} vs ${hant.length}: ${truncate(key)}`);
      }
      if (!perLocaleResource && asciiTokens(hans) !== asciiTokens(hant)) {
        problems.push(`ascii drift: ${truncate(key)}`);
      }
    }
    expect(problems, `corrupted zh values:\n${problems.join('\n')}`).toEqual([]);
  });

  it('dictionaries contain only strings used by current articles', () => {
    const liveStrings = articleTranslationSourceStrings(articles);

    const orphans = ARTICLE_LANGS.flatMap((lang) =>
      translationKeys(lang)
        .filter((key) => !liveStrings.has(key))
        .map((key) => `[${lang}] ${truncate(key)}`),
    );
    expect(orphans, `orphaned translation keys:\n${orphans.join('\n')}`).toEqual([]);
  });
});
