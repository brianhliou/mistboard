// A player article (one that links its subject's own /players/<slug> page) carries
// the "Corrections or rights requests: contact us." line under its panel, as the
// player pages do. Meng Fanrui's article reached review without it on 2026-11-11
// because the flag is set per article.
import { describe, expect, it } from 'vitest';
import { articles } from '../articles-data.js';

describe('player articles', () => {
  const playerArticles = articles.filter((article) =>
    JSON.stringify(article).includes(`/players/${article.slug}`),
  );

  it('finds the player articles', () => {
    expect(playerArticles.length).toBeGreaterThanOrEqual(5);
  });

  it.each(playerArticles.map((a) => [a.slug, a] as const))('%s carries the contact note', (_, article) => {
    expect(article.contactNote).toBe(true);
  });
});
