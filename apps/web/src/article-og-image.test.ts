import { describe, expect, it } from 'vitest';
import { articleOgImageUrl, articleStructuredDataImage } from './article-og-image';

const HOST = 'https://mistboard.com';

describe('article card URLs', () => {
  it('og:image stays the wide card, with its ?v=', () => {
    expect(articleOgImageUrl(HOST, 'banqi')).toBe('https://mistboard.com/og/article/banqi.png?v=5');
  });

  it('a rules page offers 16:9, 4:3 and 1:1 in its JSON-LD, widest first', () => {
    expect(articleStructuredDataImage(HOST, 'banqi')).toEqual([
      'https://mistboard.com/og/article/banqi.png?v=5&aspect=16x9',
      'https://mistboard.com/og/article/banqi.png?v=5&aspect=4x3',
      'https://mistboard.com/og/article/banqi.png?v=5&aspect=1x1',
    ]);
  });

  it('a blog page with no card of its own offers the site card in the same three shapes', () => {
    expect(articleStructuredDataImage(HOST, 'jieqi-platform')).toEqual([
      'https://mistboard.com/og/article/jieqi-platform.png?v=5&aspect=16x9',
      'https://mistboard.com/og/article/jieqi-platform.png?v=5&aspect=4x3',
      'https://mistboard.com/og/article/jieqi-platform.png?v=5&aspect=1x1',
    ]);
  });

  it('a hand-drawn card has no aspect versions, so the JSON-LD keeps the one wide card', () => {
    expect(articleStructuredDataImage(HOST, 'yin-sheng')).toBe(
      'https://mistboard.com/og/article/yin-sheng.png?v=5',
    );
  });

  it("a zh page of a xiangqi-family board names its own script's card, in every shape", () => {
    for (const [lang, prefix] of [
      ['zh-Hans', 'zh-hans'],
      ['zh-Hant', 'zh-hant'],
      ['zh-hant', 'zh-hant'],
    ] as const) {
      for (const slug of ['banqi', 'pikafish']) {
        const wide = `https://mistboard.com/og/article/${slug}.png?v=5&lang=${prefix}`;
        expect(articleOgImageUrl(HOST, slug, lang)).toBe(wide);
        expect(articleStructuredDataImage(HOST, slug, lang)).toEqual([
          `${wide}&aspect=16x9`,
          `${wide}&aspect=4x3`,
          `${wide}&aspect=1x1`,
        ]);
      }
    }
  });

  it('pikafish has a board card: aspect versions in English too', () => {
    expect(articleStructuredDataImage(HOST, 'pikafish')).toEqual([
      'https://mistboard.com/og/article/pikafish.png?v=5&aspect=16x9',
      'https://mistboard.com/og/article/pikafish.png?v=5&aspect=4x3',
      'https://mistboard.com/og/article/pikafish.png?v=5&aspect=1x1',
    ]);
  });

  it('the English page, other languages and non-xiangqi boards keep the international card', () => {
    // A bare 'zh' names no script, so it gets no zh card rather than a guess.
    for (const lang of [null, undefined, 'en', 'vi', 'zh', 'zh-TW']) {
      expect(articleOgImageUrl(HOST, 'banqi', lang)).toBe(
        'https://mistboard.com/og/article/banqi.png?v=5',
      );
    }
    expect(articleOgImageUrl(HOST, 'jungle', 'zh-Hant')).toBe(
      'https://mistboard.com/og/article/jungle.png?v=5',
    );
    expect(articleStructuredDataImage(HOST, 'jieqi-platform', 'zh-Hant')).toEqual([
      'https://mistboard.com/og/article/jieqi-platform.png?v=5&aspect=16x9',
      'https://mistboard.com/og/article/jieqi-platform.png?v=5&aspect=4x3',
      'https://mistboard.com/og/article/jieqi-platform.png?v=5&aspect=1x1',
    ]);
    expect(articleStructuredDataImage(HOST, 'yin-sheng', 'zh-Hant')).toBe(
      'https://mistboard.com/og/article/yin-sheng.png?v=5',
    );
  });
});
