import { describe, expect, it } from 'vitest';
import { ARTICLE_LANGS, isArticleTranslationPublished, translateArticle } from './article-i18n.js';
import { variantNavLabel } from './articles.js';
import { articles } from './articles-data.js';
import { gameSpecIdFromRulesSlug } from './variant-public-surfaces.js';

// A rules title feeds the sidebar label and the "Play X" button through
// variantNavLabel, which keeps only the variant name. A search-style title with
// no fullwidth colon ("暗棋規則怎麼玩？…") survives whole and fills both.
describe('rules rail labels', () => {
  const rules = articles.filter((article) => gameSpecIdFromRulesSlug(article.slug) !== null);

  it('covers the rules articles', () => {
    expect(rules.length).toBeGreaterThan(5);
  });

  for (const article of rules) {
    it(`${article.slug} reduces to a short variant name in every language`, () => {
      const titles = [article.title];
      for (const lang of ARTICLE_LANGS) {
        if (isArticleTranslationPublished(article.slug))
          titles.push(translateArticle(article, lang).title);
      }
      for (const title of titles) {
        const label = variantNavLabel(title);
        expect(label, title).not.toMatch(/[?？:：]/u);
        expect(label.length, title).toBeLessThanOrEqual(24);
      }
    });
  }

  it('fails a question-style title', () => {
    expect(variantNavLabel('暗棋規則怎麼玩？大小順序、吃法與連吃一次看懂')).toMatch(/？/u);
  });
});
