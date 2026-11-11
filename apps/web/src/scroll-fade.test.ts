import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindScrollFade, hasMoreBelow } from './scroll-fade.js';

// The broadcast game list fades its foot while more rows sit below, like the
// homepage News box (Brian, 2026-10-28): on only while the list overflows and
// is not at its end.

function box(dims: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => dims.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => dims.clientHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => dims.scrollTop ?? 0,
    set: (value: number) => {
      dims.scrollTop = value;
    },
  });
  return el;
}

describe('hasMoreBelow', () => {
  it('is false when nothing overflows', () => {
    expect(hasMoreBelow({ scrollHeight: 300, clientHeight: 300, scrollTop: 0 })).toBe(false);
  });

  it('is true while rows sit below the visible part', () => {
    expect(hasMoreBelow({ scrollHeight: 900, clientHeight: 300, scrollTop: 0 })).toBe(true);
    expect(hasMoreBelow({ scrollHeight: 900, clientHeight: 300, scrollTop: 500 })).toBe(true);
  });

  it('is false at the bottom, with a pixel of slack for fractional heights', () => {
    expect(hasMoreBelow({ scrollHeight: 900, clientHeight: 300, scrollTop: 600 })).toBe(false);
    expect(hasMoreBelow({ scrollHeight: 900, clientHeight: 300, scrollTop: 599.5 })).toBe(false);
  });
});

describe('bindScrollFade', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('turns the class on while overflowing and off at the bottom', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const dims = { scrollHeight: 900, clientHeight: 300, scrollTop: 0 };
    const list = box(dims);
    document.body.append(list);
    bindScrollFade(list, 'more');
    expect(list.classList.contains('more')).toBe(true);

    list.scrollTop = 600;
    list.dispatchEvent(new Event('scroll'));
    expect(list.classList.contains('more')).toBe(false);

    list.scrollTop = 200;
    list.dispatchEvent(new Event('scroll'));
    expect(list.classList.contains('more')).toBe(true);
  });

  it('leaves a list that fits without the class', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const list = box({ scrollHeight: 300, clientHeight: 300 });
    document.body.append(list);
    bindScrollFade(list, 'more');
    expect(list.classList.contains('more')).toBe(false);
  });
});

describe('fade styles', () => {
  const css = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

  it('uses the News box mask, one token for both', () => {
    expect(css('landing.css')).toContain('mask-image: var(--site-scroll-fade);');
    expect(css('xiangqi-broadcast.css')).toMatch(
      /\.xqb-rail-list\.xqb-rail-list-more \{\s*mask-image: var\(--site-scroll-fade\);/,
    );
    expect(css('app-base.css')).toContain('--site-scroll-fade:');
  });
});
