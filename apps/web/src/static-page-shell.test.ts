import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStaticPageLayout, type StaticPageKey } from './static-page-shell.js';

describe('phone About rail', () => {
  let resize: () => void;
  let frame: FrameRequestCallback;
  const observe = vi.fn();

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = observe;
      },
    );
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    observe.mockClear();
  });

  function mount(activeKey: StaticPageKey = 'about', width = 300, contentWidth = 900) {
    const layout = buildStaticPageLayout(activeKey, document.createElement('div'), 'en');
    document.body.append(layout);
    const rail = layout.querySelector<HTMLElement>('.static-page-rail')!;
    Object.defineProperties(rail, {
      clientWidth: { configurable: true, value: width },
      scrollWidth: { configurable: true, value: contentWidth },
    });
    return rail;
  }

  it.each([
    ['start', 0, 900, false, true],
    ['middle', 300, 900, true, true],
    ['end', 600, 900, true, false],
    ['fitting', 0, 300, false, false],
    ['fractional end', 599.5, 900, true, false],
    ['overscroll before start', -20, 900, false, true],
    ['overscroll past end', 620, 900, true, false],
  ] as const)('fades the hidden edges at %s', (_name, left, contentWidth, fadeLeft, fadeRight) => {
    const rail = mount('about', 300, contentWidth);
    rail.scrollLeft = left;
    rail.dispatchEvent(new Event('scroll'));
    expect(rail.classList.contains('fade-left')).toBe(fadeLeft);
    expect(rail.classList.contains('fade-right')).toBe(fadeRight);
  });

  it('updates on initial layout and observes both viewport and link content resizing', () => {
    const rail = mount();
    frame(0);
    expect(rail.classList.contains('fade-right')).toBe(true);
    expect(observe.mock.calls.map(([target]) => target)).toEqual([
      rail,
      rail.querySelector('.static-page-rail-nav'),
    ]);
    Object.defineProperty(rail, 'clientWidth', { value: 900 });
    resize();
    expect(rail.classList.contains('fade-left')).toBe(false);
    expect(rail.classList.contains('fade-right')).toBe(false);
  });

  it('reveals a late current tab inside the strip once, leaving the window alone', () => {
    const rail = mount('privacy');
    const active = rail.querySelector<HTMLElement>('[aria-current="page"]')!;
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({ left: 14, right: 314 } as DOMRect);
    vi.spyOn(active, 'getBoundingClientRect').mockReturnValue({ left: 714, right: 794 } as DOMRect);
    const windowScroll = vi.spyOn(window, 'scrollTo');
    const scrollIntoView = vi.spyOn(active, 'scrollIntoView');
    resize();
    expect(rail.scrollLeft).toBe(508);
    expect(active.classList.contains('active')).toBe(true);
    expect(windowScroll).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    rail.scrollLeft = 0;
    resize();
    expect(rail.scrollLeft).toBe(0);
  });

  it('leaves the desktop rail scroll position alone', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
    const rail = mount('privacy');
    const active = rail.querySelector<HTMLElement>('[aria-current="page"]')!;
    const measure = vi.spyOn(active, 'getBoundingClientRect');
    resize();
    expect(rail.scrollLeft).toBe(0);
    expect(measure).not.toHaveBeenCalled();
  });
});
