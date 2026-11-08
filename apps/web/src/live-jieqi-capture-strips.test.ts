import { describe, expect, it } from 'vitest';
import { mountJieqiCaptureStrips } from './live-jieqi-capture-strips.js';
import { mountRevealOdds } from './live-jieqi-reveal-odds.js';

describe('live Jieqi capture strips', () => {
  it('moves the existing material and odds into review seat strips and restores phone order', () => {
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
      expect(strip.querySelector('.review-seat__material')).not.toBeNull();
    }
    expect(console.children).toHaveLength(1);
    // A render replaces captures, never the odds sibling or its strip.
    refs.capturesBottom.replaceChildren(document.createElement('span'));
    expect(room.querySelectorAll('[data-reveal-odds]')).toHaveLength(2);
    change({ matches: false });
    expect([...console.children]).toEqual(original);
    expect(room.querySelector('.jieqi-capture-strip')).toBeNull();
    expect(refs.capturesBottom.classList.contains('review-seat__material')).toBe(false);
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
});
