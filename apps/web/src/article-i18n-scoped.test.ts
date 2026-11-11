import { describe, expect, it } from 'vitest';
import { type ArticleLang, translateArticle } from './article-i18n.js';
import { type Article, articles } from './articles-data.js';

// The dictionary matches whole strings, so a bare word translates one way
// site-wide. "Pieces" is a count (子数) in the flip-jungle tablebase table and
// the Settings page (棋子) in set-up-your-board; a per-article override keeps
// both. Without it the board-looks table told zh readers to open a page named
// 子数, which no menu shows.
const LANGS: ArticleLang[] = ['zh-Hans', 'zh-Hant'];

function bySlug(slug: string): Article {
  const article = articles.find((a) => a.slug === slug);
  if (!article) throw new Error(`no article ${slug}`);
  return article;
}

function tableCells(article: Article): string[] {
  const cells: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) for (const v of value) walk(v);
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record.kind === 'table') {
        for (const h of (record.headers as string[]) ?? []) cells.push(h);
        for (const row of (record.rows as string[][]) ?? []) cells.push(...row);
      }
      for (const v of Object.values(record)) walk(v);
    }
  };
  walk(article);
  return cells;
}

describe('per-article dictionary overrides', () => {
  for (const lang of LANGS) {
    it(`${lang}: "Pieces" is the settings page in set-up-your-board`, () => {
      const cells = tableCells(translateArticle(bySlug('set-up-your-board'), lang));
      expect(cells).toContain('棋子');
      expect(cells).not.toContain('子数');
      expect(cells).not.toContain('Pieces');
    });

    it(`${lang}: "Pieces" stays a count in flip-jungle-skill-ceiling`, () => {
      const cells = tableCells(translateArticle(bySlug('flip-jungle-skill-ceiling'), lang));
      expect(cells).toContain(lang === 'zh-Hans' ? '子数' : '子數');
      expect(cells).not.toContain('棋子');
    });
  }
});
