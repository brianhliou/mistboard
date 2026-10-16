// The prerender's build-time CSS check (scripts/prerender-css-coverage.mjs):
// a baked page that does not link the stylesheet styling its markup paints
// unstyled until a lazy chunk brings it, which is how every /rules and /blog
// page flashed before 2026-10-16.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  linkedStylesheets,
  markupClasses,
  prerenderedCssMisses,
  selectorClassSets,
  stylesheetSelectors,
  unlinkedMatchingRules,
} from '../scripts/prerender-css-coverage.mjs';

const page = (links: string[], app: string) =>
  `<!doctype html><html><head>${links
    .map((href) => `<link rel="stylesheet" crossorigin href="/${href}">`)
    .join(
      '',
    )}</head><body><div id="app" class="landing-page articles-route">${app}</div></body></html>`;

const ARTICLE_MARKUP =
  '<nav class="site-nav"></nav><main class="article-page"><aside class="article-variant-sidebar"></aside>' +
  '<article class="article-sheet"><svg><circle class="xq-marker xq-shape--green"/></svg></article></main>';

const sheets = new Map([
  [
    'assets/index-a.css',
    stylesheetSelectors('.landing-page{background:#fff}.site-nav{display:flex}'),
  ],
  [
    'assets/articles-b.css',
    stylesheetSelectors(
      '@media (min-width:900px){.article-page{display:grid}}.articles-route .article-sheet{max-width:70ch}',
    ),
  ],
  [
    'assets/board-annotations-c.css',
    stylesheetSelectors('.xq-arrow--draw.xq-shape--green,.xq-marker.xq-shape--green{fill:#15803d}'),
  ],
  // Rules that cannot match the page: scoped by a class it never uses, an id it
  // lacks, or only negating one of its classes.
  [
    'assets/current-games-d.css',
    stylesheetSelectors(
      '.current-games .xq-marker{filter:none}.landing-page #landing-replay{gap:0}.x:not(.article-page){color:red}',
    ),
  ],
]);

describe('prerender CSS coverage', () => {
  it('reads what selectors require, ignoring negations and attribute values', () => {
    expect(selectorClassSets('.a.b > .c, #d .e:not(.f), [href$=".pdf"]')).toEqual([
      ['.a', '.b', '.c'],
      ['#d', '.e'],
    ]);
    expect(stylesheetSelectors('@keyframes spin{0%{opacity:0}}/* .gone{} */.k{x:1}')).toEqual([
      { selector: '.k', classes: ['.k'] },
    ]);
    expect([...markupClasses('<p class="a  b" id="c"></p>')]).toEqual(['.a', '.b', '#c']);
    expect(linkedStylesheets(page(['assets/x.css'], ''))).toEqual(['assets/x.css']);
  });

  it('flags a page that leaves out the stylesheet of the chunk that renders it', () => {
    const misses = unlinkedMatchingRules(page(['assets/index-a.css'], ARTICLE_MARKUP), sheets);
    expect(misses.map((m) => m.stylesheet)).toEqual([
      'assets/articles-b.css',
      'assets/board-annotations-c.css',
    ]);
    expect(misses[0]!.selectors).toEqual(['.article-page', '.articles-route .article-sheet']);
  });

  it('passes a page that links them, whatever unrelated sheets exist', () => {
    const linked = [
      'assets/index-a.css',
      'assets/articles-b.css',
      'assets/board-annotations-c.css',
    ];
    expect(unlinkedMatchingRules(page(linked, ARTICLE_MARKUP), sheets)).toEqual([]);
  });

  describe('over a dist directory', () => {
    let dist = '';
    afterEach(async () => {
      if (dist) await rm(dist, { recursive: true, force: true });
    });

    it('checks baked pages, skips the empty shell, and names the page and sheet', async () => {
      dist = await mkdtemp(join(tmpdir(), 'css-coverage-'));
      await mkdir(join(dist, 'assets'));
      await mkdir(join(dist, 'rules'));
      await writeFile(join(dist, 'assets', 'index-a.css'), '.landing-page{color:red}');
      await writeFile(join(dist, 'assets', 'articles-b.css'), '.article-page{display:grid}');
      await writeFile(
        join(dist, 'index.html'),
        '<html><head></head><body><div id="app"></div></body></html>',
      );
      await writeFile(
        join(dist, 'rules', 'banqi.html'),
        page(['assets/index-a.css'], ARTICLE_MARKUP),
      );
      await writeFile(
        join(dist, 'rules.html'),
        page(['assets/index-a.css', 'assets/articles-b.css'], ARTICLE_MARKUP),
      );
      expect(await prerenderedCssMisses(dist)).toEqual({
        pages: 2,
        lines: ['rules/banqi.html: /assets/articles-b.css (.article-page)'],
      });
    });
  });
});
