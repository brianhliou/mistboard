import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

// The article table, its translations and the announcement list are about four
// fifths of the homepage's script. The board waits for every module the
// homepage imports statically, so none of them may be in that set.
const HEAVY = ['articles.ts', 'articles-data.ts', 'article-i18n.ts', 'landing-announcements.ts'];

/** Every src module reached from `entry` through value imports (type-only
 *  imports and stylesheets are left out, as the bundler leaves them out). */
function staticImportGraph(entry: string): Map<string, string> {
  const parent = new Map<string, string>([[entry, '']]);
  const queue = [entry];
  const importRe =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:([^'";]*?)\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
  while (queue.length > 0) {
    const file = queue.shift()!;
    const text = readFileSync(resolve(SRC, file), 'utf8');
    for (const match of text.matchAll(importRe)) {
      const [, typeOnly, clause, spec] = match;
      if (typeOnly || !spec!.endsWith('.js')) continue;
      // `import { type A, type B } from` is type-only too.
      if (clause && /^\{[^}]*\}$/.test(clause.trim())) {
        const names = clause
          .trim()
          .slice(1, -1)
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean);
        if (names.length > 0 && names.every((n) => n.startsWith('type '))) continue;
      }
      const target = resolve(dirname(resolve(SRC, file)), spec!.replace(/\.js$/, '.ts'));
      const rel = target.slice(SRC.length + 1);
      if (rel.startsWith('..') || parent.has(rel)) continue;
      try {
        readFileSync(target);
      } catch {
        continue;
      }
      parent.set(rel, file);
      queue.push(rel);
    }
  }
  return parent;
}

function chain(graph: Map<string, string>, file: string): string {
  const path = [file];
  let at = graph.get(file);
  while (at) {
    path.push(at);
    at = graph.get(at);
  }
  return path.reverse().join(' -> ');
}

describe('homepage script weight', () => {
  it('keeps the article table and News out of the homepage static imports', () => {
    const graph = staticImportGraph('landing.ts');
    expect(graph.size).toBeGreaterThan(50);
    const reached = HEAVY.filter((file) => graph.has(file)).map((file) => chain(graph, file));
    expect(reached).toEqual([]);
  });

  it('the graph walker sees a static import of the article table', () => {
    // Planted case: the article page imports articles-data statically.
    expect(staticImportGraph('articles.ts').has('articles-data.ts')).toBe(true);
  });
});

describe('homepage article rows and News before their chunk loads', () => {
  // One ordered test: the content module loads once per file, so the "before"
  // half has to run before anything loads it.
  it('holds the prerendered rows and plain names, then swaps both in place', async () => {
    const { buildPlayPanel } = await import('./landing-play-panel.js');
    const panel = buildPlayPanel('en', { hydrate: false });
    document.body.append(panel);
    const xiangqiName = (): Element | null =>
      panel.querySelector('.pp-row-bot[data-game-spec="xiangqi"] .pp-name');
    expect(xiangqiName()?.tagName).toBe('SPAN');
    expect(xiangqiName()?.textContent).toContain('Xiangqi');

    // The prerendered page's links carry over as a hint, so a panel rebuilt
    // before the article table lands keeps them (only the hinted ones).
    const { setPlayPanelRulesHint } = await import('./landing-play-panel.js');
    setPlayPanelRulesHint(['/rules/jieqi']);
    const hinted = buildPlayPanel('zh-Hans', { hydrate: false });
    const jieqi = hinted.querySelector('.pp-row-bot[data-game-spec="jieqi"] .pp-name');
    expect(jieqi?.tagName).toBe('A');
    expect(jieqi?.getAttribute('href')).toBe('/zh-hans/rules/jieqi');
    expect(hinted.querySelector('.pp-row-bot[data-game-spec="xiangqi"] .pp-name')?.tagName).toBe(
      'SPAN',
    );

    const held = {
      articles: Object.assign(document.createElement('div'), {
        className: 'landing-articles-row held',
      }),
      dives: Object.assign(document.createElement('div'), {
        className: 'landing-articles-row landing-dives-row held',
      }),
      news: Object.assign(document.createElement('div'), { className: 'held-news' }),
    };
    const { buildLandingStage } = await import('./landing.js');
    const { fallbackPlayableEngines } = await import('./landing-play.js');
    let release: () => void = () => undefined;
    const contentAfter = new Promise<void>((done) => {
      release = done;
    });
    const stage = buildLandingStage(fallbackPlayableEngines(), {
      phone: false,
      skipLiveWidgets: true,
      prebuilt: held,
      contentAfter,
    });
    document.body.append(stage.el);
    const demo = stage.el.querySelector('.landing-demo')!;
    expect(demo.querySelector(':scope > .landing-articles-row.held:not(.landing-dives-row)')).toBe(
      held.articles,
    );
    expect(demo.querySelector(':scope > .landing-dives-row')).toBe(held.dives);
    expect(demo.querySelector('.landing-news-column > *')).toBe(held.news);

    // Nothing loads until the first board is up.
    const early = await Promise.race([
      stage.content.then(() => 'loaded'),
      new Promise((done) => setTimeout(() => done('waiting'), 300)),
    ]);
    expect(early).toBe('waiting');
    expect(held.articles.isConnected).toBe(true);
    release();

    const content = await stage.content;
    expect(content).not.toBeNull();
    expect(held.articles.isConnected).toBe(false);
    expect(held.dives.isConnected).toBe(false);
    expect(held.news.isConnected).toBe(false);
    const rows = [...demo.querySelectorAll(':scope > .landing-articles-row')];
    expect(rows.map((row) => row.classList.contains('landing-dives-row'))).toEqual([false, true]);
    expect(rows[0]!.querySelectorAll('a[href*="/"]').length).toBeGreaterThan(0);
    // Same slots as before: the rows still sit ahead of the phone tiles.
    const children = [...demo.children];
    const tiles = demo.querySelector(':scope > .landing-phone-tiles');
    if (tiles) expect(children.indexOf(rows[1]!)).toBeLessThan(children.indexOf(tiles));
    expect(demo.querySelector('.landing-news-column > *')).not.toBeNull();

    // The panel drawn before the lookup now links its names, label unchanged.
    const link = xiangqiName();
    expect(link?.tagName).toBe('A');
    expect(link?.getAttribute('href')).toBe('/rules/xiangqi');
    expect(link?.classList.contains('pp-rules-link')).toBe(true);
    expect(link?.querySelector('.pp-name-label')?.textContent).toContain('Xiangqi');
    document.body.replaceChildren();
  });
});
