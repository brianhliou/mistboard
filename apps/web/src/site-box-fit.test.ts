// fitRows() (site-box-fit.ts) and the home forum box's stacked sizing (#574).
// happy-dom does no layout, so each test lays rows out by hand: a body of a
// given height at top 0 and rows stacked from it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fitRows } from './site-box-fit.js';

const FILL = 'body--fill';

function layout(bodyHeight: number, heights: (number | 'hidden')[]) {
  const body = document.createElement('div');
  Object.defineProperty(body, 'clientHeight', { value: bodyHeight });
  body.getBoundingClientRect = () => ({ top: 0, bottom: bodyHeight }) as DOMRect;
  const rows: HTMLElement[] = [];
  let y = 0;
  for (const height of heights) {
    const row = document.createElement('div');
    const top = y;
    const shown = height !== 'hidden';
    if (shown) y += height;
    row.getBoundingClientRect = () =>
      (shown ? { top, bottom: top + height } : { top: 0, bottom: 0 }) as DOMRect;
    row.getClientRects = () => ({ length: shown ? 1 : 0 }) as DOMRectList;
    rows.push(row);
  }
  return { body, rows };
}

describe('fitRows', () => {
  it('spreads the slack a trimmed box leaves, however tall the dropped row', () => {
    // 1000px wide home: three topics, then 86px under them (a fourth needs 98).
    const { body, rows } = layout(330, [88, 70, 86, 98, 98]);
    fitRows(body, rows, FILL);
    expect(body.childElementCount).toBe(3);
    expect(body.classList.contains(FILL)).toBe(true);
  });

  it('leaves a content-starved box its slack', () => {
    const { body, rows } = layout(330, [88, 70]);
    fitRows(body, rows, FILL);
    expect(body.childElementCount).toBe(2);
    expect(body.classList.contains(FILL)).toBe(false);
  });

  it('still spreads a small slack when every row fits', () => {
    const { body, rows } = layout(330, [100, 100, 100]);
    fitRows(body, rows, FILL);
    expect(body.childElementCount).toBe(3);
    expect(body.classList.contains(FILL)).toBe(true);
  });

  it('does not measure rows a stylesheet hides', () => {
    // Stacked layout: the box sizes to its four shown rows; the rest are capped
    // by CSS and must neither be trimmed against nor count as slack.
    const { body, rows } = layout(332, [88, 70, 87, 87, 'hidden', 'hidden']);
    fitRows(body, rows, FILL);
    expect(body.childElementCount).toBe(6);
    expect(body.classList.contains(FILL)).toBe(false);
  });

  it('keeps every row in an unlaid-out document', () => {
    const { body, rows } = layout(0, [88, 70, 87]);
    fitRows(body, rows, FILL);
    expect(body.childElementCount).toBe(3);
  });
});

describe('home forum box when the page stacks', () => {
  const css = readFileSync('src/landing-forum-preview.css', 'utf8').replace(/\s+/g, ' ');
  const at = css.indexOf('@media (max-width: 959px)');
  const stacked = css.slice(at);

  it('stacks at the same width as the home grid', () => {
    expect(at).toBeGreaterThan(0);
    expect(readFileSync('src/landing.css', 'utf8')).toContain('@media (max-width: 959px)');
  });

  it('sizes to its rows and caps them at four topics', () => {
    expect(stacked).toContain('.landing-forum { height: auto; }');
    expect(stacked).toContain(
      '.landing-forum .site-box-body > .landing-forum-topic:nth-child(n + 5) { display: none; }',
    );
  });

  it('keeps the band height on the wide layouts', () => {
    expect(css.slice(0, at)).toContain('height: var(--landing-lower-widget-height, 20em);');
  });
});
