// iOS Safari zooms on a double tap, so stepping an embed's moves quickly
// (Next, Next, Next) zoomed the reader's page. app-base.css sets
// `touch-action: manipulation` on the root and the controls; this test keeps
// it there. app-base.css is imported by main.ts and by every embed page entry
// (the article embeds are iframes with their own document), so the rule
// reaches both. It cannot catch a control styled `touch-action: auto` later,
// or a custom clickable element that is none of the listed selectors and sits
// inside a scrolling container.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(HERE, rel), 'utf8');

function manipulationSelectors(css: string): string[] {
  const selectors: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/touch-action:\s*manipulation/.test(m[2] ?? '')) {
      const head = (m[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
      selectors.push(...head.split(',').map((s) => s.trim()));
    }
  }
  return selectors;
}

describe('tap zoom guard', () => {
  it('app-base.css sets touch-action: manipulation on the root and the controls', () => {
    const selectors = manipulationSelectors(read('app-base.css'));
    for (const s of ['html', 'button', 'a', '[role="button"]']) {
      expect(selectors, `app-base.css has no touch-action: manipulation for ${s}`).toContain(s);
    }
  });

  it('the guard fails a stylesheet without the rule', () => {
    const planted = 'html { scrollbar-gutter: stable; }\nbutton { cursor: pointer; }';
    expect(manipulationSelectors(planted)).not.toContain('html');
  });

  it('the page entry and the embed entries load app-base.css', () => {
    expect(read('main.ts')).toMatch(/^import '\.\/app-base\.css';/m);
    for (const entry of ['embed-study-page.ts', 'embed-puzzle-page.ts', 'embed-analysis-page.ts']) {
      expect(read(`embed/${entry}`), entry).toMatch(/^import '\.\.\/app-base\.css';/m);
    }
  });
});
