// The Green and Pine boards in article and rules diagrams. The art is drawn
// only in the reader's repaint (paintXqDiagram, from the root's board colour),
// so the prerendered page and every reader on another board get exactly the
// markup they got before the art existed, and a Green or Pine reader gets that
// same markup with one art group added under the grid, in the same viewBox.

import { afterEach, describe, expect, it } from 'vitest';
import { withXiangqiBoardArt, XQ_RULES_PRIMER_START_BOARD } from './articles/diagrams.js';
import { buildArticlePage } from './articles.js';

// One inserted art group: the translate onto the diagram's origin and the art
// itself, whose children are flat shapes (no nested <g>).
const ART_GROUP =
  /<g transform="translate\([^)]*\)"><g class="xq-board-art xq-board-art--(?:green|pine)"[^>]*>.*?<\/g><\/g>/g;

function diagramMarkup(slug: string): string[] {
  return Array.from(buildArticlePage(slug).querySelectorAll('.xq-article-svg')).map(
    (svg) => svg.outerHTML,
  );
}

function setBoardColor(color: string | null): void {
  const root = document.documentElement;
  if (color === null) delete root.dataset.xiangqiBoardColor;
  else root.dataset.xiangqiBoardColor = color;
}

afterEach(() => {
  setBoardColor(null);
  delete document.documentElement.dataset.xiangqiBoardTheme;
});

// Pages with arrows, dots, half boards, multi-board figures and fog.
const XIANGQI_PAGES = ['xiangqi', 'jieqi', 'riverbank-cannon', 'fog-xiangqi', 'xiangqi-endgames'];

describe('article board art', () => {
  it('draws no art for a reader on the default board or any non-art colour', () => {
    for (const slug of XIANGQI_PAGES) {
      const base = diagramMarkup(slug);
      expect(base.length).toBeGreaterThan(0);
      expect(base.join('')).not.toContain('xq-board-art');
      for (const color of ['traditional', 'paper', 'slate']) {
        setBoardColor(color);
        expect(diagramMarkup(slug)).toEqual(base);
      }
      setBoardColor(null);
    }
  });

  it('adds only the art group for Green and Pine, in the same viewBox', () => {
    for (const slug of XIANGQI_PAGES) {
      const base = diagramMarkup(slug);
      for (const color of ['green', 'pine']) {
        setBoardColor(color);
        const painted = diagramMarkup(slug);
        expect(painted.join('')).toContain(`xq-board-art--${color}`);
        expect(painted.map((svg) => svg.replace(ART_GROUP, ''))).toEqual(base);
        const viewBoxes = (list: string[]) => list.map((svg) => /viewBox="[^"]*"/.exec(svg)?.[0]);
        expect(viewBoxes(painted)).toEqual(viewBoxes(base));
      }
      setBoardColor(null);
    }
  });

  it('keeps art off a Jungle reader whose stored colour is an art board', () => {
    setBoardColor('green');
    document.documentElement.dataset.xiangqiBoardTheme = 'jungle';
    expect(diagramMarkup('xiangqi').join('')).not.toContain('xq-board-art');
  });

  it('leaves non-xiangqi diagrams untouched', () => {
    for (const slug of [
      'banqi',
      'banqi-perpetual-chase',
      'jungle-den-term',
      'en-passant-under-fog',
    ]) {
      const base = diagramMarkup(slug);
      setBoardColor('pine');
      expect(diagramMarkup(slug)).toEqual(base);
      setBoardColor(null);
    }
  });

  it('draws the art from the module state, never from the root', () => {
    setBoardColor('green');
    const thunk = XQ_RULES_PRIMER_START_BOARD;
    // A render outside the reader's repaint (prerender, feed thumbnail) stays plain.
    expect(thunk()).not.toContain('xq-board-art');
    expect(withXiangqiBoardArt('pine', thunk)).toContain('xq-board-art--pine');
    expect(withXiangqiBoardArt(null, thunk)).toBe(thunk());
  });
});
