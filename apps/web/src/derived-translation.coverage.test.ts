// The completeness gate for content-language translations.
//
// derived-translation.ts lets an untranslated string fall through as English on
// purpose, so an English edit shows up as visible English rather than silently
// vanishing. That is only a safe default if something counts the fall-throughs:
// `untranslatedStrings` documents empty as the contract a finished translation
// has to meet, and until now nothing asserted it, so a page could ship half
// English and every suite stayed green.
import { describe, expect, it } from 'vitest';
import { CHOI_CO_TUONG_VOI_MAY_VI } from './articles/content/choi-co-tuong-voi-may.js';
import { CO_UP_VI } from './articles/content/co-up.js';
import { jieqiOpeningsArticle } from './articles/content/jieqi-openings.js';
import { jieqiPlatformArticle } from './articles/content/jieqi-platform.js';
import { KHAI_CUOC_CO_UP_VI } from './articles/content/khai-cuoc-co-up.js';
import { pikafishArticle } from './articles/content/pikafish.js';
import { untranslatedStrings } from './articles/derived-translation.js';
import { buildArticlePage } from './articles.js';
import { articles } from './articles-data.js';

const DERIVED = [
  { slug: 'co-up', source: jieqiPlatformArticle, dict: CO_UP_VI },
  { slug: 'khai-cuoc-co-up', source: jieqiOpeningsArticle, dict: KHAI_CUOC_CO_UP_VI },
  { slug: 'choi-co-tuong-voi-may', source: pikafishArticle, dict: CHOI_CO_TUONG_VOI_MAY_VI },
];

describe('derived translations', () => {
  for (const { slug, source, dict } of DERIVED) {
    it(`${slug} translates every readable string in ${source.slug}`, () => {
      const missing = untranslatedStrings(source, dict);
      expect(
        missing,
        `${slug} would render ${missing.length} English string(s):\n${missing.map((s) => `  - ${s.slice(0, 90)}`).join('\n')}`,
      ).toEqual([]);
    });
  }
});

// The footer ring is the only editorial exit a translated page has, because a
// page with `sourceLang` is out of the /blog index by design. Pointing it at
// English sends the reader who arrived in Vietnamese back out in English, and
// one of the three cards is this page's own English source.
describe('a translated page keeps its reader in its own language', () => {
  for (const { slug } of DERIVED) {
    it(`${slug} links only to same-language articles in Read next`, () => {
      const page = buildArticlePage(slug);
      const hrefs = [...page.querySelectorAll('.article-footer-list a')].map((a) =>
        a.getAttribute('href'),
      );
      expect(hrefs.length).toBeGreaterThan(0);
      const foreign = hrefs.filter((href) => {
        const target = articles.find((a) => href?.endsWith(`/blog/${a.slug}`));
        return target?.sourceLang !== 'vi';
      });
      expect(foreign, `${slug} sends its reader to ${foreign.join(', ')}`).toEqual([]);
    });
  }
});
