import { describe, expect, it } from 'vitest';
import { ARTICLE_LANGS, hasTranslation, TRANSLATED_ARTICLE_SLUGS } from './article-i18n.js';
import { buildHomeArticleCards, type HomeArticleRow } from './articles.js';
import { articles } from './articles-data.js';
import type { Locale } from './i18n/locale.js';

// Every homepage card title fits on one line (Brian, 2026-10-03): a wrapped
// title makes its row taller than the other, a two-line box wastes a line on
// nearly every card, and an ellipsis cuts the title. A title that does not fit
// gets a shorter `cardTitle` on its article.
//
// The budget is the title's width on a wide desktop, where the strip shares the
// band with the side rails: 186px, measured on the dev pair at 1440-1920px.
// Narrower layouts (phones, 1280-1400px) may still wrap; that is accepted.
const TITLE_BUDGET_PX = 186;

// Advance widths of printable ASCII (32-126) in 12.5px Roboto, the card title's
// font, measured with canvas measureText in Chrome on 2026-10-03. Summing them
// matched the rendered width of a sample title to 0.2px.
const ROBOTO_12_5 = [
  3.1, 3.22, 4, 7.7, 7.03, 9.16, 7.78, 2.19, 4.28, 4.35, 5.38, 7.09, 2.46, 3.45, 3.3, 5.16, 7.03,
  7.03, 7.03, 7.03, 7.03, 7.03, 7.03, 7.03, 7.03, 7.03, 3.03, 2.64, 6.35, 6.86, 6.54, 5.91, 11.22,
  8.15, 7.79, 8.14, 8.2, 7.1, 6.91, 8.51, 8.92, 3.4, 6.9, 7.84, 6.73, 10.91, 8.92, 8.6, 7.89, 8.6,
  7.7, 7.42, 7.46, 8.11, 7.96, 11.09, 7.84, 7.51, 7.49, 3.31, 5.13, 3.31, 5.22, 5.64, 3.86, 6.8,
  7.02, 6.54, 7.05, 6.63, 4.35, 7.02, 6.88, 3.04, 2.99, 6.34, 3.04, 10.96, 6.9, 7.13, 7.02, 7.1,
  4.24, 6.45, 4.09, 6.89, 6.05, 9.39, 6.2, 5.91, 6.2, 4.23, 3.05, 4.23, 8.5,
];
const CJK_PX = 12.5; // one em: CJK falls back to the system font, full-width
const OTHER_PX = 10; // any other glyph: deliberately wide

function titleWidth(text: string): number {
  // Accents ride on their base letter (Lại Lý Huynh measures as Lai Ly Huynh).
  const bare = text.normalize('NFD').replace(/\p{M}/gu, '');
  let width = 0;
  for (const ch of bare) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code < 127) width += ROBOTO_12_5[code - 32]!;
    else if (code >= 0x2e80) width += CJK_PX;
    else width += OTHER_PX;
  }
  return width;
}

describe('homepage card titles', () => {
  it('measures a known title the way Chrome renders it', () => {
    // 191.3px in Chrome; it wrapped on the card, which is why it has a cardTitle.
    expect(titleWidth('Fourteen wins against our jieqi bot')).toBeCloseTo(191.1, 0);
  });

  const locales: Locale[] = ['en', 'zh-Hans', 'zh-Hant'];
  const rows: HomeArticleRow[] = ['latest', 'deep-dives'];
  for (const locale of locales) {
    for (const row of rows) {
      it(`fit on one line: ${locale}, ${row} row`, () => {
        const section = buildHomeArticleCards(500, locale, {
          row,
          maxAgeDays: Number.POSITIVE_INFINITY,
        });
        const overruns = [...(section?.querySelectorAll('.landing-article-card') ?? [])]
          .map((card) => ({
            href: card.getAttribute('href'),
            title: card.querySelector('.landing-article-card-title')?.textContent ?? '',
          }))
          .filter(({ title }) => titleWidth(title) > TITLE_BUDGET_PX)
          .map(({ href, title }) => `${href}: "${title}" (${Math.round(titleWidth(title))}px)`);
        // Fix: give the article a shorter `cardTitle` (and its zh translations).
        expect(overruns).toEqual([]);
      });
    }
  }

  it('translates every card title of a translated article in both scripts', () => {
    const translated = new Set<string>(TRANSLATED_ARTICLE_SLUGS);
    const missing = articles
      .filter((article) => article.cardTitle && translated.has(article.slug))
      .flatMap((article) =>
        ARTICLE_LANGS.filter((lang) => !hasTranslation(lang, article.cardTitle!)).map(
          (lang) => `${article.slug} (${lang}): "${article.cardTitle}"`,
        ),
      );
    expect(missing).toEqual([]);
  });
});
