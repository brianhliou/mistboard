import { describe, expect, it } from 'vitest';
import { buildArticlePage, renderArticleThumbnail } from '../articles.js';
import { articles } from '../articles-data.js';
import { coUpArticle } from './content/co-up.js';
import { isLanguageNeutralLabel, substituteSvgText, svgTextLabels } from './svg-labels.js';

describe('svg diagram labels', () => {
  it('reads and swaps text nodes by their trimmed, decoded text', () => {
    const svg = '<svg><text x="1"> RED&#39;S VIEW </text><text>A &amp; B</text><title>keep</title></svg>';
    expect(svgTextLabels(svg)).toEqual(["RED'S VIEW", 'A & B', 'keep']);
    expect(substituteSvgText(svg, { "RED'S VIEW": '红方视野', 'A & B': 'x < y' })).toBe(
      '<svg><text x="1">红方视野</text><text>x &lt; y</text><title>keep</title></svg>',
    );
  });

  it('looks a node carrying data-i18n-key up by that key, not its text', () => {
    const svg = '<svg><text data-i18n-key="red General">General</text><text>General</text></svg>';
    expect(svgTextLabels(svg)).toEqual(['red General', 'General']);
    expect(substituteSvgText(svg, { 'red General': '帥', General: '將' })).toBe(
      '<svg><text data-i18n-key="red General">帥</text><text>將</text></svg>',
    );
  });

  it('treats coordinates, sample sizes, identifiers and the domain as language-neutral', () => {
    for (const t of ['a', 'n=33', 'only-mate', 'mistboard.com', '车吃马']) {
      expect(isLanguageNeutralLabel(t), t).toBe(true);
    }
    for (const t of ['CAPTURE', 'farm', 'RED’S VIEW']) expect(isLanguageNeutralLabel(t), t).toBe(false);
  });
});

// End to end through the real renderers: the zh path swaps labels in the DOM
// (localizeSvgMarkup), the Vietnamese derived page swaps them in its thunk.
describe('rendered figures carry translated labels', () => {
  const figureText = (page: HTMLElement) =>
    [...page.querySelectorAll('.article-figure svg text')].map((n) => n.textContent?.trim());

  it('zh-Hans jieqi rules page', () => {
    const labels = figureText(buildArticlePage('jieqi', 'zh-Hans'));
    expect(labels).toContain('洗混后的开局');
    expect(labels).toContain('翻子前：马位');
    expect(labels).not.toContain('SHUFFLED START');
    expect(labels).not.toContain('CAPTURE');
  });

  it('zh-Hant xiangqi mahjong page names each tile by its colour', () => {
    const page = buildArticlePage('xiangqi-mahjong-32', 'zh-Hant');
    const tileNames = [...page.querySelectorAll('.article-figure svg .xmj-kind-label')].map((n) =>
      n.textContent?.trim(),
    );
    expect(tileNames).toEqual(['帥', '仕', '相', '俥', '傌', '炮', '兵', '將', '士', '象', '車', '馬', '砲', '卒']);
    expect(figureText(page)).not.toContain('General');
    const tiles = page.querySelector('.article-figure svg.xmj-article-tiles');
    expect(tiles?.getAttribute('aria-label')).toBe('全部 32 張牌：上排十六張紅牌，下排十六張黑牌');
  });

  it('Vietnamese jieqi openings page', () => {
    const labels = figureText(buildArticlePage('khai-cuoc-co-up'));
    expect(labels).toContain('THẾ BAN ĐẦU ĐÃ XÁO');
    expect(labels).not.toContain('FOUR OPENINGS, ONE MOVE EACH');
  });

  it.each([
    ['jieqi-platform', 'en', 'Very unlucky', 'No warning'],
    ['jieqi-platform', 'zh-Hans', '非常不幸', '无警示'],
    ['jieqi-platform', 'zh-Hant', '非常不幸', '無警示'],
    ['co-up', 'en', 'Rất không may', 'Không cảnh báo'],
    ['co-up', 'zh-Hant', 'Rất không may', 'Không cảnh báo'],
  ] as const)('keeps %s close-up labels in their article language under %s', (slug, lang, luck, grade) => {
    const page = buildArticlePage(slug, lang === 'en' ? undefined : lang);
    const titles = [...page.querySelectorAll('.article-piece-marks svg title')].map((n) => n.textContent);
    expect(titles).toContain(luck);
    expect(titles).toContain(grade);
  });
});

describe('index cards carry translated words', () => {
  const cardText = (el: HTMLElement) =>
    [...el.querySelectorAll('svg text')].map((n) => ({
      text: n.textContent?.trim(),
      keep: n.getAttribute('translate') === 'no',
    }));

  it('a card is in the page language, every line', () => {
    const champions = articles.find((a) => a.slug === 'xiangqi-champions');
    if (!champions?.thumbnail) throw new Error('champions card missing');
    const zh = cardText(renderArticleThumbnail(champions.thumbnail, 'zh-Hant')).map((t) => t.text);
    expect(zh).toEqual(['象棋', '冠軍', '每一屆全國個人賽', '1956 年至今']);
    const en = cardText(renderArticleThumbnail(champions.thumbnail, 'en')).map((t) => t.text);
    expect(en).toEqual(['XIANGQI', 'CHAMPIONS', 'EVERY NATIONAL TITLE', 'SINCE 1956']);
  });

  it('a Vietnamese derived card swaps its words inside the SVG', () => {
    const svg = coUpArticle.thumbnail?.kind === 'svg' ? coUpArticle.thumbnail.svg : '';
    // Whatever interface the reader saved: a zh one must not flip the layout.
    for (const locale of ['en', 'zh-Hant'] as const) {
      const markup = typeof svg === 'function' ? svg(locale) : svg;
      expect(svgTextLabels(markup), locale).toEqual(['CỜ TƯỚNG', 'CỜ ÚP', 'QUÂN ÚP, BÀN CỜ MỞ']);
    }
  });
});
