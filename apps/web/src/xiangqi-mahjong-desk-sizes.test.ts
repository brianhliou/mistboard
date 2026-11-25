// The desk table's tiles are sized once per window, never by what is on it:
// a pond holds the most discards a seat can make in a hand in one row, the
// widest hand fits its rack, and both seats get the same tiles.
//
// Blind spots, by design:
// - xmjDeskSizes mirrors the sum xiangqi-mahjong.css does in custom
//   properties. happy-dom has no layout, so nothing here renders the CSS; the
//   ties to it are the column count read from the source and the tile widths
//   a browser drew at three windows (DESKS). A CSS edit that changes the sizes
//   fails only when those widths are re-measured.
// - Badges, fonts, the wall counter and the centre's own contents are not
//   modelled; the centre is only held to its floor.
// - The 521-799px band (two rows of XMJ_POND_COLUMNS) is not covered.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type XmjHandState,
  type XmjSeatIndex,
  xmjClaim,
  xmjClaimsOpen,
  xmjDeal,
  xmjDiscard,
  xmjOtherSeat,
  xmjPass,
  xmjShuffle,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  XMJ_DESK,
  XMJ_MAX_DISCARDS,
  xmjDeskSizes,
  xmjMostPondDiscards,
} from './xiangqi-mahjong-table.js';

describe('the most discards a seat can make', () => {
  it('is 13 with the 23-tile wall and one claimed set a seat', () => {
    expect(XMJ_MAX_DISCARDS).toBe(13);
    expect(xmjMostPondDiscards(23, 1)).toBe(13);
  });

  it('would be 12 with no claims, so the claim is what makes the thirteenth', () => {
    expect(xmjMostPondDiscards(23, 0)).toBe(12);
  });

  /** A seeded generator, so a failure replays. */
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  /**
   * Play a hand to the end of the wall with nobody winning: each seat throws a
   * random tile, and a seat claims a set when `claims(seat)` says so and one is
   * open. Returns the largest pond seen at any point.
   */
  function playOut(seed: number, claims: (seat: XmjSeatIndex) => boolean): number {
    const random = lcg(seed);
    const dealer: XmjSeatIndex = seed % 2 === 0 ? 0 : 1;
    let state: XmjHandState = xmjDeal(xmjShuffle(random), dealer);
    let most = 0;
    for (let step = 0; step < 200; step += 1) {
      most = Math.max(most, state.discards[0].length, state.discards[1].length);
      if (state.phase.type === 'exhausted' || state.phase.type === 'won') break;
      if (state.phase.type === 'discard') {
        const hand = state.hands[state.turn];
        state = xmjDiscard(state, hand[Math.floor(random() * hand.length)] as never);
        continue;
      }
      const claimant = xmjOtherSeat(state.phase.discarder);
      const set = xmjClaimsOpen(state).find((c) => c.kind !== 'win');
      state = set && claims(claimant) ? xmjClaim(state, set) : xmjPass(state);
    }
    return most;
  }

  it('is reached in play: the dealer claims once, the other seat never, the wall runs dry', () => {
    let reached = 0;
    for (let seed = 0; seed < 600; seed += 1) {
      const dealer: XmjSeatIndex = seed % 2 === 0 ? 0 : 1;
      const most = playOut(seed, (seat) => seat === dealer);
      expect(most).toBeLessThanOrEqual(XMJ_MAX_DISCARDS);
      if (most === XMJ_MAX_DISCARDS) reached += 1;
    }
    expect(reached).toBeGreaterThan(0);
  });

  it('is never passed, whoever claims', () => {
    for (let seed = 0; seed < 600; seed += 1) {
      const random = lcg(seed + 10_000);
      expect(playOut(seed, () => random() < 0.5)).toBeLessThanOrEqual(XMJ_MAX_DISCARDS);
    }
  });

  it('is the pond width the desk and phone CSS draw, in one row', () => {
    // import.meta.url is not a file: URL under the vite transform, so resolve
    // from the working directory (the workspace root or the repo root).
    const cssPath = ['src/xiangqi-mahjong.css', 'apps/web/src/xiangqi-mahjong.css']
      .map((candidate) => resolve(process.cwd(), candidate))
      .find((candidate) => existsSync(candidate));
    const css = readFileSync(cssPath as string, 'utf8');
    const rows = [
      ...css.matchAll(/grid-template-columns:\s*repeat\((\d+),\s*var\(--xmj-pond-w\)\)/g),
    ].map((m) => Number(m[1]));
    // The base 8 (521-799px, two rows), then the desk and phone rows.
    expect(rows.filter((n) => n !== 8)).toEqual([XMJ_MAX_DISCARDS, XMJ_MAX_DISCARDS]);
    expect(css).toContain(`mod(var(--xmj-i, 0), ${XMJ_MAX_DISCARDS})`);
  });
});

/**
 * Desk windows as the table sees them: the felt's width and the height-bound
 * unit (from the felt's measured height), with the hand and discard widths the
 * browser drew there on 2026-11-25, so the mirror is pinned to the CSS at
 * three real sizes. The last row is a narrower felt, not a measured window.
 */
const DESKS = [
  {
    name: '2576x1395',
    feltW: 1232,
    unitW: (560 * (1077 - 130)) / 513,
    drawn: { tile: 188.6, pond: 83.4 },
  },
  {
    name: '1440x900',
    feltW: 672,
    unitW: (560 * (646 - 130)) / 513,
    drawn: { tile: 107, pond: 44.4 },
  },
  {
    name: '1280x720',
    feltW: 456,
    unitW: (560 * (470 - 248)) / 395,
    drawn: { tile: 58.5, pond: 29.4 },
  },
  { name: 'a narrower felt', feltW: 400, unitW: 280, drawn: null },
];

describe('xmjDeskSizes', () => {
  for (const desk of DESKS) {
    describe(desk.name, () => {
      const s = xmjDeskSizes(desk);
      const inner = desk.feltW - XMJ_DESK.sideChrome;

      if (desk.drawn) {
        const drawn = desk.drawn;
        it('matches the tiles the browser drew at this window', () => {
          expect(Math.abs(s.tileW - drawn.tile)).toBeLessThan(0.6);
          expect(Math.abs(s.pondW - drawn.pond)).toBeLessThan(0.3);
        });
      }

      it('lays a full pond of 13 in one row inside the felt', () => {
        const row = XMJ_MAX_DISCARDS * s.pondW + (XMJ_MAX_DISCARDS - 1) * s.pondGap;
        expect(row).toBeLessThanOrEqual(inner + 0.01);
      });

      it('fits the widest hand, a claimed set and two concealed, inside the felt', () => {
        const widest = 4 * s.tileW + s.tileH + 48;
        expect(widest).toBeLessThanOrEqual(inner + 0.01);
      });

      it('keeps the table its old height and the centre at least its floor', () => {
        const u = desk.unitW / 560;
        expect(s.tableH).toBeCloseTo(130 + 395 * u + Math.max(118, 118 * u), 6);
        expect(s.centreH).toBeGreaterThanOrEqual(Math.max(118, 118 * u) - 0.01);
      });

      it('stacks rack, pond, centre, pond, rack without overlap', () => {
        const rack = s.tileW * (73 / 52) + XMJ_DESK.rackExtra;
        const pond = s.pondH + XMJ_DESK.pondExtra;
        const used = XMJ_DESK.fixedHeight + 2 * rack + 2 * pond + s.centreH;
        expect(used).toBeCloseTo(s.tableH, 6);
      });

      it('makes hand tiles as large as the felt allows: the widest hand or the centre floor binds', () => {
        const u = desk.unitW / 560;
        const widthBound = (inner - 48) / (4 + 68 / 52);
        const centreAtFloor = Math.abs(s.centreH - Math.max(118, 118 * u)) < 0.01;
        expect(Math.abs(s.tileW - widthBound) < 0.01 || centreAtFloor).toBe(true);
        expect(s.tileW).toBeGreaterThan(s.pondW);
      });
    });
  }

  it('takes no tile count, so one window gives one size for the whole match', () => {
    // The signature is the guarantee: the inputs are the felt and the window.
    // Both seats read the same tileW and the same pondW.
    expect(xmjDeskSizes.length).toBe(1);
    const window = { feltW: 672, unitW: 563 };
    const a = xmjDeskSizes(window);
    const b = xmjDeskSizes({ ...window });
    expect(a).toEqual(b);
  });

  it('grows the tiles with the window', () => {
    const [big, mid, small] = DESKS.map((d) => xmjDeskSizes(d).tileW);
    expect(big).toBeGreaterThan(mid as number);
    expect(mid).toBeGreaterThan(small as number);
  });
});
