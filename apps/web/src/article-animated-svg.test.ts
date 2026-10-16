import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBlock } from './articles.js';

// The animated-svg block plays its SVG's keyframes once, when the figure
// first scrolls half into view, and holds the last frame; Replay restarts it.
// Reduced motion gets the static frames and no button.

const MOVING = '<svg class="moving"><style>.a{animation:x 5s both}</style><g class="a"/></svg>';
const STILL = '<svg class="still-before"></svg><svg class="still-after"></svg>';

type ObserverCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;

function stubObserver() {
  const instances: { callback: ObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
  class FakeObserver {
    disconnect = vi.fn();
    constructor(callback: ObserverCallback) {
      instances.push({ callback, disconnect: this.disconnect });
    }
    observe() {}
    unobserve() {}
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  return instances;
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe('animated-svg block', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits until the figure is in view, then plays once', () => {
    stubReducedMotion(false);
    const observers = stubObserver();
    const figure = renderBlock({
      kind: 'animated-svg',
      svg: () => MOVING,
      reducedSvg: () => STILL,
      caption: 'A claim.',
    });
    expect(figure.classList.contains('article-anim')).toBe(true);
    expect(figure.dataset.animState).toBe('idle');
    expect(figure.querySelector('.article-anim-stage svg.moving')).not.toBeNull();
    expect(figure.querySelector('.article-figure-caption')?.textContent).toBe('A claim.');
    expect(observers).toHaveLength(1);

    observers[0]?.callback([{ isIntersecting: false }]);
    expect(figure.dataset.animState).toBe('idle');
    observers[0]?.callback([{ isIntersecting: true }]);
    expect(figure.dataset.animState).toBe('playing');
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });

  it('Replay swaps in a fresh copy of the SVG so its keyframes restart', () => {
    stubReducedMotion(false);
    stubObserver();
    const figure = renderBlock({ kind: 'animated-svg', svg: MOVING, reducedSvg: STILL });
    const before = figure.querySelector('svg.moving');
    const replay = figure.querySelector<HTMLButtonElement>('button.article-anim-replay');
    expect(replay?.textContent).toBe('Replay');
    replay?.click();
    const after = figure.querySelector('svg.moving');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(figure.dataset.animState).toBe('playing');
  });

  it('shows the static frames and no Replay under reduced motion', () => {
    stubReducedMotion(true);
    const observers = stubObserver();
    const figure = renderBlock({
      kind: 'animated-svg',
      svg: () => MOVING,
      reducedSvg: () => STILL,
    });
    expect(figure.dataset.animState).toBe('static');
    expect(figure.querySelector('svg.moving')).toBeNull();
    expect(figure.querySelectorAll('.article-anim-stage svg')).toHaveLength(2);
    expect(figure.querySelector('button')).toBeNull();
    expect(observers).toHaveLength(0);
  });
});

describe('table highlightColumns', () => {
  it('marks the header and every cell of the column', () => {
    const figure = renderBlock({
      kind: 'table',
      headers: ['Hand', '1', '2', 'Total'],
      rows: [
        ['Ana', '2', '', '2'],
        ['Ben', '', '3', '3'],
      ],
      highlightColumns: [2],
    });
    const marked = [...figure.querySelectorAll('.article-table-col-emphasis')].map(
      (cell) => `${cell.tagName}:${cell.textContent}`,
    );
    expect(marked).toEqual(['TH:2', 'TD:', 'TD:3']);
  });
});
