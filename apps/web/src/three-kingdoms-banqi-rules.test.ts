import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasTranslation, translateArticle } from './article-i18n.js';
import { articleProse } from './article-prose.js';
import { threeKingdomsBanqiArticle } from './articles/content/three-kingdoms-banqi.js';
import { articleDiagramLabels } from './articles/svg-labels.js';
import { buildArticlePage } from './articles.js';
import type { Article } from './articles-data.js';

afterEach(() => vi.unstubAllEnvs());

function playButtons(page: HTMLElement): (string | null)[][][] {
  return [...page.querySelectorAll('.article-cta-row')].map((row) =>
    [...row.querySelectorAll('a.article-cta')].map((a) => [a.textContent, a.getAttribute('href')]),
  );
}

describe('Three Kingdoms Banqi rules page buttons', () => {
  it('offers no bot in either row while the variant has none', () => {
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    const friendOnly = [
      ['Play Three Kingdoms Banqi', '/?play=friend&gameSpecId=three-kingdoms-banqi'],
    ];
    expect(playButtons(buildArticlePage('three-kingdoms-banqi'))).toEqual([friendOnly, friendOnly]);
  });

  it('offers the bot in both rows once the engine flag is on', () => {
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENGINE', 'true');
    const both = [
      ['Play Three Kingdoms Banqi', '/?play=computer&gameSpecId=three-kingdoms-banqi'],
      ['Play a friend', '/?play=friend&gameSpecId=three-kingdoms-banqi'],
    ];
    expect(playButtons(buildArticlePage('three-kingdoms-banqi'))).toEqual([both, both]);
  });
});

// The page is a draft, so it is not in TRANSLATED_ARTICLE_SLUGS and the coverage
// gate skips it. These hold its Chinese ready for the day it is published.
describe('Three Kingdoms Banqi Chinese', () => {
  const article = threeKingdomsBanqiArticle as Article;

  it.each(['zh-Hans', 'zh-Hant'] as const)('%s has every string on the page', (lang) => {
    const texts = [
      ...articleProse(article).map(({ text }) => text),
      ...articleDiagramLabels(article).map(({ text }) => text),
    ];
    expect(texts.length).toBeGreaterThan(40);
    expect(texts.filter((text) => !hasTranslation(lang, text))).toEqual([]);
  });

  it('spots a string with no translation', () => {
    expect(hasTranslation('zh-Hans', 'A sentence nobody translated.')).toBe(false);
  });

  it('names the pieces as the banqi rules page does', () => {
    const diagramKeys = articleDiagramLabels(article).map(({ text }) => text);
    expect(diagramKeys).toEqual(expect.arrayContaining(['banqi soldier', 'banqi cannon']));
    for (const lang of ['zh-Hans', 'zh-Hant'] as const) {
      const page = JSON.stringify(translateArticle(article, lang));
      expect(page).toContain('兵');
      expect(page).not.toContain('砲');
    }
  });
});
