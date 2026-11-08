import { describe, expect, it } from 'vitest';
import { articleProse } from './article-prose.js';
import { renderBlock } from './articles.js';
import type { Article } from './articles-data.js';

describe('list block', () => {
  it('renders a bulleted list of rich-text items', () => {
    const list = renderBlock({
      kind: 'list',
      items: ['**Memory** first', 'see [the rules](/rules/fog-chess)'],
    });
    expect(list.tagName).toBe('UL');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(list.querySelector('li strong')?.textContent).toBe('Memory');
    expect(list.querySelector('li a')?.getAttribute('href')).toBe('/rules/fog-chess');
  });

  it('renders a numbered list when ordered', () => {
    expect(renderBlock({ kind: 'list', ordered: true, items: ['one'] }).tagName).toBe('OL');
  });
});

describe('italics', () => {
  it('renders *text* as emphasis beside bold', () => {
    const p = renderBlock({
      kind: 'paragraph',
      text: 'the runner heading for *its* den, **fast**',
    });
    expect(p.querySelector('em')?.textContent).toBe('its');
    expect(p.querySelector('strong')?.textContent).toBe('fast');
  });

  it('leaves a lone or spaced asterisk literal', () => {
    for (const text of ['5 * 3 = 15', 'a*b*c', 'note * here *']) {
      const p = renderBlock({ kind: 'paragraph', text });
      expect(p.querySelector('em')).toBeNull();
      expect(p.textContent).toBe(text);
    }
  });
});

describe('image-row block', () => {
  const block = {
    kind: 'image-row' as const,
    items: [
      { src: '/a.png', darkSrc: '/a-dark.png', alt: 'Badge A' },
      { src: '/b.png', alt: 'Badge B', width: 200 },
    ],
  };

  it('renders each image standalone with its dark twin', () => {
    const figure = renderBlock(block);
    const cells = [...figure.querySelectorAll('.article-image-row-item')];
    expect(cells).toHaveLength(2);
    expect([...cells[0]!.querySelectorAll('img')].map((img) => img.className)).toEqual([
      'article-figure-light',
      'article-figure-dark',
    ]);
    expect(cells[1]!.querySelectorAll('img')).toHaveLength(1);
    expect((cells[1] as HTMLElement).style.maxWidth).toBe('200px');
  });

  it('counts list items and image alts as prose', () => {
    const article = {
      title: 'T',
      summary: 'S',
      sections: [{ heading: 'H', blocks: [block, { kind: 'list', items: ['Item'] }] }],
    } as unknown as Article;
    const texts = articleProse(article).map((p) => p.text);
    expect(texts).toEqual(expect.arrayContaining(['Badge A', 'Badge B', 'Item']));
  });
});
