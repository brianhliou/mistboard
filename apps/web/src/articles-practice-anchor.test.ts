// A practice link that returns the reader to a game names that game's anchor.
// The anchor is only useful if the article really has a figure with that id,
// and the figure only has it if the renderer copies the block's id across.

import { describe, expect, it } from 'vitest';
import type { ArticleBlock } from './articles/types.js';
import { renderBlock } from './articles.js';
import { articles } from './articles-data.js';
import { backPath } from './practice-position-params.js';

function* hrefs(value: unknown): Generator<string> {
  if (typeof value === 'string') {
    if (value.startsWith('/practice/position?')) yield value;
    return;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) yield* hrefs(child);
  }
}

/** Every block id anywhere in an article (blocks sit inside its sections). */
function blockIds(value: unknown, out = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (typeof rec.kind === 'string' && typeof rec.id === 'string') out.add(rec.id);
    for (const child of Object.values(rec)) blockIds(child, out);
  }
  return out;
}

describe('practice links back to an article game', () => {
  const links = articles.flatMap((article) =>
    [...hrefs(article)].map((href) => ({ article, href })),
  );

  it('finds at least the Meng Fanrui link, so the check is not vacuous', () => {
    expect(links.some(({ article }) => article.slug === 'meng-fanrui')).toBe(true);
  });

  it.each(links.map((l) => [l.article.slug, l.href] as const))(
    '%s: the #anchor names a game in that article',
    (slug, href) => {
      const back = backPath(new URLSearchParams(href.split('?')[1]));
      expect(back, 'the from= path must pass backPath').not.toBeNull();
      const [path, anchor] = back!.split('#');
      expect(path).toBe(`/blog/${slug}`);
      if (anchor) expect(blockIds(articles.find((a) => a.slug === slug))).toContain(anchor);
    },
  );

  it('the replay figure carries the block id so the browser can scroll to it', () => {
    const meng = articles.find((a) => a.slug === 'meng-fanrui');
    let block: ArticleBlock | undefined;
    (function find(v: unknown): void {
      if (block || !v || typeof v !== 'object') return;
      const rec = v as Record<string, unknown>;
      if (rec.kind === 'xq-replay' && rec.id === 'ju-longfei-game') block = v as ArticleBlock;
      else for (const c of Object.values(rec)) find(c);
    })(meng);
    expect(block).toBeDefined();
    const figure = renderBlock(block!);
    expect(figure.id).toBe('ju-longfei-game');
  });
});
