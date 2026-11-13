// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLandingCarousel } from './articles.js';
import { navPhoneMediaQuery } from './site-shell.js';

let phone = false;
let reducedMotion = false;
let visibility: DocumentVisibilityState = 'visible';
const intersections = new Map<Element, (ratio: number) => void>();
beforeEach(() => {
  vi.useFakeTimers();
  phone = false;
  reducedMotion = false;
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === navPhoneMediaQuery ? phone : reducedMotion,
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private targets: Element[] = [];
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.targets.push(target);
        intersections.set(target, (ratio) =>
          this.callback(
            [
              {
                target,
                isIntersecting: ratio > 0,
                intersectionRatio: ratio,
              } as IntersectionObserverEntry,
            ],
            this as unknown as IntersectionObserver,
          ),
        );
      }
      disconnect() {
        for (const target of this.targets) intersections.delete(target);
      }
    },
  );
});

// happy-dom has no layout, so the geometry the carousel reads is stubbed: cards
// at a fixed pitch inside a narrower window, as on the desktop band-2 rows
// where 210px cards leave part of the next card in view.
function carousel(cardCount: number, cardPx: number, gapPx: number, viewPx: number) {
  const root = document.createElement('div');
  root.innerHTML = `<div class="landing-carousel"><div class="landing-carousel-track"></div>
    <button class="landing-carousel-nav-prev"></button><button class="landing-carousel-nav-next"></button></div>`;
  const car = root.querySelector<HTMLElement>('.landing-carousel')!;
  const track = root.querySelector<HTMLElement>('.landing-carousel-track')!;
  for (let i = 0; i < cardCount; i++) {
    const card = document.createElement('a');
    const left = i * (cardPx + gapPx);
    card.getBoundingClientRect = () => ({ left, width: cardPx }) as DOMRect;
    track.append(card);
  }
  Object.defineProperty(track, 'scrollWidth', {
    value: cardCount * cardPx + (cardCount - 1) * gapPx,
  });
  Object.defineProperty(car, 'clientWidth', { value: viewPx });
  Object.defineProperty(car, 'scrollWidth', { value: track.scrollWidth });
  const scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    car.scrollLeft = typeof options === 'number' ? options : (options?.left ?? 0);
    car.dispatchEvent(new Event('scroll'));
  });
  car.scrollTo = scrollTo;
  document.body.append(root);
  initLandingCarousel(root);
  const next = root.querySelector<HTMLButtonElement>('.landing-carousel-nav-next')!;
  const offset = () =>
    Math.abs(Number(/translateX\((-?[\d.]+)px\)/.exec(track.style.transform)?.[1] ?? 0));
  const inView = (ratio: number) => intersections.get(car)?.(ratio);
  inView(1);
  return { car, track, next, offset, scrollTo, inView };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  intersections.clear();
});

describe('landing carousel with a part card in view', () => {
  it('stops with the last card flush right, never past it', () => {
    // 1280px window: six 210px cards, 8px gap, 515px view. Overflow 785px is
    // 3.6 steps of 218px; rounding gave 4 steps (872px), 87px of blank track.
    const { next, offset } = carousel(6, 210, 8, 515);
    const stops: number[] = [];
    for (let i = 0; i < 6; i++) {
      next.click();
      stops.push(offset());
    }
    expect(stops).toEqual([218, 436, 654, 785, 785, 785]);
    expect(next.disabled).toBe(true);
  });

  it('still steps whole cards when the view holds a whole number of them', () => {
    const { next, offset } = carousel(6, 210, 8, 646);
    const stops: number[] = [];
    for (let i = 0; i < 4; i++) {
      next.click();
      stops.push(offset());
    }
    expect(stops).toEqual([218, 436, 654, 654]);
  });
});

describe('landing carousel rotation', () => {
  it('rotates desktop cards every ten seconds and ping-pongs at the ends', () => {
    const { offset } = carousel(4, 200, 10, 410);
    const stops: number[] = [];
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(10_000);
      stops.push(offset());
    }
    expect(stops).toEqual([210, 420, 210, 0]);
  });

  it.each([
    ...['pointerdown', 'touchstart', 'wheel', 'focusin'].map((event) => [event, false] as const),
    ...['pointerdown', 'touchstart', 'wheel', 'focusin'].map((event) => [event, true] as const),
  ])('permanently stops after %s inside a carousel (phone: %s)', (event, isPhone) => {
    phone = isPhone;
    const { car, track } = carousel(6, 210, 8, 515);
    track.firstElementChild!.dispatchEvent(new Event(event, { bubbles: true }));
    const before = track.style.transform;
    if (isPhone) car.scrollLeft = 137; // A native swipe remains where the reader left it.
    const left = car.scrollLeft;
    car.dispatchEvent(new Event('mouseenter'));
    car.dispatchEvent(new Event('mouseleave'));
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(30_000);
    expect(track.style.transform).toBe(before);
    expect(car.scrollLeft).toBe(left);
  });

  it('stops on a navigation click while still allowing manual navigation', () => {
    const { next, offset } = carousel(6, 210, 8, 515);
    next.click();
    vi.advanceTimersByTime(30_000);
    expect(offset()).toBe(218);
    next.click();
    expect(offset()).toBe(436);
  });

  it.each([false, true])(
    'rotates only when half visible and the tab is visible (phone: %s)',
    (isPhone) => {
      phone = isPhone;
      const { car, offset, inView } = carousel(4, 200, 10, 410);
      const position = () => (phone ? car.scrollLeft : offset());
      inView(0.49);
      vi.advanceTimersByTime(10_000);
      expect(position()).toBe(0);
      inView(0.5);
      vi.advanceTimersByTime(10_000);
      expect(position()).toBe(210);
      visibility = 'hidden';
      vi.advanceTimersByTime(20_000);
      expect(position()).toBe(210);
      visibility = 'visible';
      vi.advanceTimersByTime(10_000);
      expect(position()).toBe(420);
    },
  );

  it('scrolls phone cards smoothly, keeps programmatic scrolls rotating, then stops forever on touch', () => {
    phone = true;
    const { car, track, scrollTo, inView } = carousel(4, 200, 10, 410);
    vi.advanceTimersByTime(10_000);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 210, behavior: 'smooth' });
    vi.advanceTimersByTime(10_000);
    expect(car.scrollLeft).toBe(420);
    vi.advanceTimersByTime(10_000);
    expect(car.scrollLeft).toBe(210);
    expect(track.style.transform).toBe('none');
    car.dispatchEvent(new Event('touchstart'));
    inView(0);
    inView(1);
    car.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(30_000);
    expect(car.scrollLeft).toBe(210);
  });

  it.each([false, true])('does not rotate with reduced motion (phone: %s)', (isPhone) => {
    phone = isPhone;
    reducedMotion = true;
    const { car, offset, scrollTo } = carousel(4, 200, 10, 410);
    vi.advanceTimersByTime(30_000);
    expect(offset()).toBe(0);
    expect(car.scrollLeft).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('stops rotating and disconnects its observer after unmount', () => {
    const { car, track } = carousel(4, 200, 10, 410);
    const before = track.style.transform;
    car.remove();
    vi.advanceTimersByTime(20_000);
    expect(track.style.transform).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
    expect(intersections.has(car)).toBe(false);
  });
});
