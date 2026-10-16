import { describe, expect, it } from 'vitest';
import { abJchessArticle } from './articles/content/ab-jchess.js';
import { katagoJungleArticle } from './articles/content/katago-jungle.js';
import { pikafishArticle } from './articles/content/pikafish.js';
import {
  CARD_TEXT_MAX_WIDTH,
  estimateLineWidth,
  type TextCardSpec,
  textCardLines,
} from './articles/text-card.js';
import { renderArticleThumbnail } from './articles.js';
import { type Article, articles } from './articles-data.js';
import type { Locale } from './i18n/locale.js';

const LOCALES: Locale[] = ['en', 'zh-Hans', 'zh-Hant'];
const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;

const cardSvg = (article: Article, locale: Locale): string | null => {
  const thumb = article.thumbnail;
  if (thumb?.kind !== 'svg') return null;
  return typeof thumb.svg === 'function' ? thumb.svg(locale) : thumb.svg;
};

const cardWords = (markup: string) =>
  [...markup.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map((m) => ({
    text: m[2].replace(/<[^>]+>/g, '').trim(),
    keep: /translate="no"/.test(m[1]),
  }));

// A thumbnail thunk is handed the locale of the page the card sits on, and a
// text card is set wholly in that language (2026-10-03): an English reader saw
// a hanzi eyebrow on every text card and read it as a bug.
describe('text cards are in the page language', () => {
  // The river inscription (楚河 漢界) is board art, drawn on every xiangqi board.
  const RIVER = /^[楚漢汉][\s\S]*[河界]$/u;

  it('no English index card carries hanzi', () => {
    const offenders: string[] = [];
    for (const article of articles) {
      const svg = cardSvg(article, 'en');
      if (!svg) continue;
      for (const { text } of cardWords(svg)) {
        if (HAN.test(text) && !RIVER.test(text)) offenders.push(`${article.slug}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a zh card keeps Latin only for a name marked as one', () => {
    for (const article of [pikafishArticle, abJchessArticle, katagoJungleArticle]) {
      for (const locale of ['zh-Hans', 'zh-Hant'] as Locale[]) {
        const stray = cardWords(cardSvg(article, locale) ?? '').filter(
          (w) => LATIN.test(w.text) && !w.keep,
        );
        expect(stray, `${article.slug} ${locale}`).toEqual([]);
      }
    }
  });

  it('names stay as written; translatable leads follow the script', () => {
    const lead = (article: Article, locale: Locale) => cardWords(cardSvg(article, locale) ?? '')[1];
    expect(lead(katagoJungleArticle, 'zh-Hans')).toEqual({ text: 'KATAGO', keep: true });
    expect(lead(abJchessArticle, 'zh-Hant')).toEqual({ text: 'AB-JCHESS', keep: true });
    expect(lead(pikafishArticle, 'en').text).toBe('PIKAFISH');
    expect(lead(pikafishArticle, 'zh-Hans').text).toBe('皮卡鱼');
    expect(lead(pikafishArticle, 'zh-Hant').text).toBe('皮卡魚');
  });

  it('renders the card the locale asks for, not the ambient one', () => {
    const hant = renderArticleThumbnail(
      pikafishArticle.thumbnail as { kind: 'svg'; svg: (locale: Locale) => string },
      'zh-Hant',
    );
    expect(hant.textContent).toContain('皮卡魚');
    expect(hant.textContent).not.toContain('PLAY IT IN YOUR BROWSER');
  });
});

describe('textCard fitting', () => {
  const spec: TextCardSpec = {
    palette: 'xiangqi',
    eyebrow: 'XIANGQI',
    lead: 'WORLD TITLE',
    tagline: 'AND WHY IT IS NOT THE HARDER ONE',
    footer: 'SINCE 1990',
    ariaLabel: 'test',
  };

  it('shrinks a line that would run off the card, in every locale', () => {
    for (const locale of LOCALES) {
      for (const line of textCardLines(spec, locale)) {
        expect(
          estimateLineWidth(line.text, line.style),
          `${locale} ${line.text}`,
        ).toBeLessThanOrEqual(CARD_TEXT_MAX_WIDTH);
      }
    }
    const tagline = textCardLines(spec, 'en').find((l) => l.role === 'tagline');
    expect(tagline?.style.size).toBeLessThan(15);
  });

  it('leaves a line that fits at its design size', () => {
    const eyebrow = textCardLines(spec, 'en').find((l) => l.role === 'eyebrow');
    expect(eyebrow?.style.size).toBe(20);
  });
});
