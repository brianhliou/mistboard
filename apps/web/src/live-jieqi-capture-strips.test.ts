import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RevealOddsSide } from './jieqi-reveal-odds.js';
import { mountJieqiCaptureStrips } from './live-jieqi-capture-strips.js';
import { mountRevealOdds, renderPoolRow } from './live-jieqi-reveal-odds.js';

const cssPath = ['src/live-jieqi-capture-strips.css', 'apps/web/src/live-jieqi-capture-strips.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
const css = readFileSync(cssPath as string, 'utf8');

function desktopMedia(): MediaQueryList {
  return { matches: true, addEventListener: () => {} } as unknown as MediaQueryList;
}

describe('live Jieqi capture strips', () => {
  it('moves the odds into review seat strips, keeps captures in the column, and restores phone order', () => {
    const room = document.createElement('div');
    room.innerHTML = `<div class="board-stage"><div data-board></div></div>
      <div class="game-console"><div data-top></div><div data-clock></div><div data-bottom></div></div>`;
    const refs = {
      board: room.querySelector<HTMLDivElement>('[data-board]')!,
      capturesTop: room.querySelector<HTMLDivElement>('[data-top]')!,
      capturesBottom: room.querySelector<HTMLDivElement>('[data-bottom]')!,
    };
    mountRevealOdds(refs, () => () => '<svg></svg>');
    const console = room.querySelector('.game-console')!;
    const original = [...console.children];
    let change = (_event: { matches: boolean }) => {};
    const media = {
      matches: true,
      addEventListener: (_type: string, listener: typeof change) => {
        change = listener;
      },
    } as unknown as MediaQueryList;
    mountJieqiCaptureStrips(refs, media);
    for (const position of ['top', 'bottom']) {
      const strip = room.querySelector(`.review-seat--${position}`)!;
      expect(strip.closest('.board-stage')).not.toBeNull();
      expect(strip.querySelector('[data-reveal-odds]')?.getAttribute('data-reveal-odds')).toBe(
        position,
      );
      // Captured pieces stay in the right column, like every other variant.
      expect(strip.querySelector('[data-top], [data-bottom]')).toBeNull();
    }
    expect([...console.children]).toEqual([
      refs.capturesTop,
      room.querySelector('[data-clock]'),
      refs.capturesBottom,
    ]);
    // A render replaces captures, never the odds sibling or its strip.
    refs.capturesBottom.replaceChildren(document.createElement('span'));
    expect(room.querySelectorAll('[data-reveal-odds]')).toHaveLength(2);
    change({ matches: false });
    expect([...console.children]).toEqual(original);
    expect(room.querySelector('.jieqi-capture-strip')).toBeNull();
    change({ matches: true });
    expect(room.querySelectorAll('.jieqi-capture-strip')).toHaveLength(2);
    expect(room.querySelectorAll('[data-reveal-odds]')).toHaveLength(2);
  });

  it('reserves each strip height on the room and clears it off desktop', () => {
    const room = document.createElement('div');
    room.className = 'live-route--jieqi';
    room.innerHTML = `<div class="board-stage"><div data-board></div></div>
      <div class="game-console"><div data-top></div><div data-clock></div><div data-bottom></div></div>`;
    document.body.append(room);
    const refs = {
      board: room.querySelector<HTMLDivElement>('[data-board]')!,
      capturesTop: room.querySelector<HTMLDivElement>('[data-top]')!,
      capturesBottom: room.querySelector<HTMLDivElement>('[data-bottom]')!,
    };
    mountRevealOdds(refs, () => () => '<svg></svg>');
    const heights = new Map<string, number>([
      ['top', 30],
      ['bottom', 62],
    ]);
    const proto = HTMLElement.prototype;
    const original = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: HTMLElement) {
      const position = this.classList.contains('review-seat--top')
        ? 'top'
        : this.classList.contains('review-seat--bottom')
          ? 'bottom'
          : null;
      const height = position && this.isConnected ? heights.get(position)! : 0;
      return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0 } as DOMRect;
    };
    try {
      let change = (_event: { matches: boolean }) => {};
      const media = {
        matches: true,
        addEventListener: (_type: string, listener: typeof change) => {
          change = listener;
        },
      } as unknown as MediaQueryList;
      mountJieqiCaptureStrips(refs, media);
      expect(room.style.getPropertyValue('--jieqi-strip-top-h')).toBe('30px');
      expect(room.style.getPropertyValue('--jieqi-strip-bottom-h')).toBe('62px');
      // The phone layout puts the rows back in the player bars: no reserve.
      change({ matches: false });
      expect(room.querySelector('.jieqi-capture-strip')).toBeNull();
      expect(room.style.getPropertyValue('--jieqi-strip-top-h')).toBe('');
      expect(room.style.getPropertyValue('--jieqi-strip-bottom-h')).toBe('');
      change({ matches: true });
      expect(room.style.getPropertyValue('--jieqi-strip-bottom-h')).toBe('62px');
    } finally {
      proto.getBoundingClientRect = original;
      room.remove();
    }
  });

  // 2026-11-24: on a finished game's replay at 1920x1080 the strip was 38px
  // while a side had face-down pieces and 30px once it had none, so stepping
  // past the last flip grew the board by 8px and moved the game card and the
  // right column. The strip's height must not depend on what the pool holds.
  it('sizes each strip from a fixed fullest line, never from the pool it shows', () => {
    const room = document.createElement('div');
    room.className = 'live-route--jieqi';
    room.innerHTML = `<div class="board-stage"><div data-board></div></div>
      <div class="game-console"><div data-top></div><div data-clock></div><div data-bottom></div></div>`;
    const refs = {
      board: room.querySelector<HTMLDivElement>('[data-board]')!,
      capturesTop: room.querySelector<HTMLDivElement>('[data-top]')!,
      capturesBottom: room.querySelector<HTMLDivElement>('[data-bottom]')!,
    };
    mountRevealOdds(refs, () => () => '<svg></svg>');
    mountJieqiCaptureStrips(refs, desktopMedia());
    for (const position of ['top', 'bottom']) {
      const strip = room.querySelector<HTMLElement>(`.review-seat--${position}`)!;
      const sizer = strip.querySelector<HTMLElement>(':scope > .jieqi-capture-strip__sizer');
      expect(sizer).not.toBeNull();
      expect(sizer!.getAttribute('aria-hidden')).toBe('true');
      // The fullest line: every role a face-down piece can be.
      expect(
        [...sizer!.querySelectorAll<HTMLElement>('.reveal-odds-chip')].map((c) => c.dataset.role),
      ).toEqual(['chariot', 'horse', 'elephant', 'advisor', 'cannon', 'soldier']);
      expect(sizer!.querySelector('.reveal-odds-row__note')).not.toBeNull();
      // Not a second odds row: nothing that reads [data-reveal-odds] sees it,
      // and it carries no accessible name.
      expect(sizer!.hasAttribute('data-reveal-odds')).toBe(false);
      expect(sizer!.querySelector('[aria-label], [role]')).toBeNull();
      const before = sizer!.outerHTML;
      const odds = strip.querySelector<HTMLElement>('[data-reveal-odds]')!;
      const full: RevealOddsSide = {
        color: 'black',
        entries: [{ role: 'cannon', count: 1, probability: 0.5 }],
        unseen: 2,
        takenUnseen: 1,
        faceDown: 1,
      };
      renderPoolRow(odds, full, () => '<svg></svg>');
      renderPoolRow(odds, null, () => '<svg></svg>');
      // The game's pool never reaches the sizer: same bytes whatever is shown.
      expect(sizer!.outerHTML).toBe(before);
    }
  });

  it('lays the real row and the sizer in one grid cell, so the taller sets the height', () => {
    const strip = css.match(/\.jieqi-capture-stage > \.jieqi-capture-strip \{([^}]*)\}/)?.[1] ?? '';
    expect(strip).toContain('display: grid;');
    expect(strip).toContain('grid-template: "line" auto / minmax(0, 1fr);');
    const rows =
      css.match(
        /\.jieqi-capture-strip > :is\(\.reveal-odds-row, \.jieqi-capture-strip__sizer\) \{([^}]*)\}/,
      )?.[1] ?? '';
    expect(rows).toContain('grid-area: line;');
    expect(rows).toContain('display: flex;');
    // A display: contents row has no box of its own, so its contents set the
    // strip's height directly: the shift this rule removed.
    expect(css).not.toMatch(/\.jieqi-capture-strip \.reveal-odds-row \{[^}]*display: contents/);
    expect(css).toMatch(/\.jieqi-capture-strip__sizer \{[^}]*visibility: hidden;/);
  });
});
