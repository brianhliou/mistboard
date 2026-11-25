// A seat's tiles keep one size at a given table width. Until 2026-11-25 a rack
// whose badges had no room beside its hand shrank its tiles (to 0.6x), so the
// same seat's tiles changed size as a fourth tile became a fifth or a set was
// claimed. Now the badges move to the felt's edge instead, decided from the
// widest hand the seat can ever hold. happy-dom has no layout, so these tests
// give the seat, its tiles and the badges fixed boxes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  placeXmjRackTags,
  XMJ_TAGS_EDGE_CLASS,
  xmjConcealedGap,
  xmjRackTagsBeside,
  xmjWidestHand,
} from './xiangqi-mahjong-table.js';

/** The self seat at the narrowest desktop table before the felt widened. */
const NARROW = { room: 282, tileW: 35.3, tileH: 46.3 };
/** The self seat at a 1440x900 window on the wider felt. */
const WIDE = { room: 646, tileW: 64.9, tileH: 85.2 };
const BADGE_W = 75;

describe('xmjRackTagsBeside', () => {
  it('keeps the badges beside the hand when the widest hand leaves them room', () => {
    expect(xmjRackTagsBeside({ ...WIDE, tag: BADGE_W })).toBe(true);
  });

  it('moves the badges to the edge when the widest hand would crowd them', () => {
    expect(xmjRackTagsBeside({ ...NARROW, tag: BADGE_W })).toBe(false);
  });

  it('answers from the widest hand, so room for five tiles today is not enough', () => {
    // Five concealed tiles and a 75px badge each side fit in 470px; a claimed
    // set with two concealed (4 upright, 1 sideways) does not, so the answer
    // is already no before any set is claimed.
    const tileW = 64.9;
    const tileH = 85.2;
    const fiveConcealed = 5 * tileW + 4 * xmjConcealedGap(tileW) + 12;
    const room = fiveConcealed + 2 * (BADGE_W + 8) + 1;
    expect(room).toBeLessThan(xmjWidestHand(tileW, tileH) + 2 * (BADGE_W + 8));
    expect(xmjRackTagsBeside({ room, tileW, tileH, tag: BADGE_W })).toBe(false);
  });
});

function box(width: number, height: number): DOMRect {
  return {
    left: 0,
    right: width,
    width,
    top: 0,
    bottom: height,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

const TILE = '<span class="xmj-tile"></span>';

/** A self seat holding `tiles` concealed tiles and a turn badge, `room` wide. */
function mountSeat(tiles: number, room: number, tile: { w: number; h: number }): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = `<section class="xmj-seat xmj-seat--self"><div class="xmj-rack"><span class="xmj-rack__tag xmj-rack__tag--start"></span><span class="xmj-rack__hand"><span class="xmj-concealed">${TILE.repeat(tiles)}</span></span><span class="xmj-rack__tag xmj-rack__tag--end"><span class="xmj-badge xmj-badge--turn">To discard</span></span></div></section>`;
  document.body.append(host);
  const seat = host.querySelector<HTMLElement>('.xmj-seat') as HTMLElement;
  Object.defineProperty(seat, 'clientWidth', { configurable: true, value: room });
  for (const el of seat.querySelectorAll<HTMLElement>('.xmj-tile')) {
    el.getBoundingClientRect = () => box(tile.w, tile.h);
  }
  return host;
}

describe('placeXmjRackTags', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function badgesMeasure(width: number): void {
    const real = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('xmj-badge') ? box(width, 20) : real.call(this);
    });
  }

  it('never writes a tile size, at four tiles or five, wide or narrow', () => {
    badgesMeasure(BADGE_W);
    for (const tiles of [4, 5]) {
      for (const at of [NARROW, WIDE]) {
        const host = mountSeat(tiles, at.room, { w: at.tileW, h: at.tileH });
        placeXmjRackTags(host);
        for (const el of host.querySelectorAll<HTMLElement>('.xmj-rack__hand, .xmj-tile')) {
          expect(el.style.getPropertyValue('--xmj-tile-w')).toBe('');
          expect(el.style.getPropertyValue('--xmj-tile-h')).toBe('');
        }
        host.remove();
      }
    }
  });

  it('gives a seat the same placement at four tiles as at five', () => {
    badgesMeasure(BADGE_W);
    for (const at of [NARROW, WIDE]) {
      const placed = [4, 5].map((tiles) => {
        const host = mountSeat(tiles, at.room, { w: at.tileW, h: at.tileH });
        placeXmjRackTags(host);
        const edge = host.querySelector('.xmj-seat')?.classList.contains(XMJ_TAGS_EDGE_CLASS);
        host.remove();
        return edge;
      });
      expect(placed[0]).toBe(placed[1]);
    }
  });

  it('sets the badges on the edge of a narrow seat and beside the hand of a wide one', () => {
    badgesMeasure(BADGE_W);
    const narrow = mountSeat(4, NARROW.room, { w: NARROW.tileW, h: NARROW.tileH });
    const wide = mountSeat(4, WIDE.room, { w: WIDE.tileW, h: WIDE.tileH });
    placeXmjRackTags(document.body);
    expect(narrow.querySelector('.xmj-seat')?.classList.contains(XMJ_TAGS_EDGE_CLASS)).toBe(true);
    expect(wide.querySelector('.xmj-seat')?.classList.contains(XMJ_TAGS_EDGE_CLASS)).toBe(false);
    // The probe that measured the badges is gone.
    expect(document.querySelectorAll('.xmj-badge').length).toBe(2);
  });
});
