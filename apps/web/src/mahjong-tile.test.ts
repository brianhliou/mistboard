import { describe, expect, it } from 'vitest';

import { mahjongPipFace, mahjongTileFace, mahjongTileName } from './mahjong-tile.js';

// The pip arrangements are the part worth pinning. A player learns to read a
// tile by its pattern rather than by counting, so drawing 5筒 as a row of five
// would teach somebody a tile that does not exist in any set.

describe('pip faces', () => {
  it('draws the arrangement a real tile has, not a row', () => {
    // 5 is two, one centred, two. Four circles at the corners and one in the
    // middle: the centre pip must sit on the vertical midline.
    const five = mahjongPipFace('p', 5);
    const centres = [
      ...five.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="none"/g),
    ].map((m) => ({ cx: Number(m[1]), cy: Number(m[2]) }));
    expect(centres).toHaveLength(5);
    const middle = centres.filter((c) => c.cx === 12);
    expect(middle, '5 has exactly one centred pip').toHaveLength(1);
  });

  it('gives every rank the right number of pips', () => {
    const counts: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9 };
    for (const [rank, expected] of Object.entries(counts)) {
      const face = mahjongPipFace('p', Number(rank));
      const rings = [...face.matchAll(/fill="none"/g)].length;
      expect(rings, `${rank}筒 should draw ${expected} circles`).toBe(expected);
    }
  });

  it('draws bamboo as canes, and 索 never as circles', () => {
    const face = mahjongPipFace('s', 3);
    expect(face).not.toContain('<circle');
    expect([...face.matchAll(/<rect/g)].length).toBeGreaterThanOrEqual(3);
  });

  it('keeps every mark inside the face', () => {
    // A pip drawn outside the viewBox is clipped and the tile reads as a
    // different rank, which is worse than an ugly tile.
    for (const suit of ['p', 's'] as const) {
      for (let rank = 1; rank <= 9; rank += 1) {
        const face = mahjongPipFace(suit, rank);
        for (const [, value] of face.matchAll(/c[xy]="([\d.]+)"/g)) {
          expect(Number(value)).toBeGreaterThanOrEqual(0);
        }
        for (const [, x] of face.matchAll(/ x="(-?[\d.]+)"/g)) {
          expect(Number(x)).toBeGreaterThan(-1);
        }
      }
    }
  });
});

describe('tile faces', () => {
  it('writes 萬 with a Chinese numeral rather than drawing pips', () => {
    const face = mahjongTileFace(0);
    expect(face.inner).toContain('一');
    expect(face.inner).toContain('萬');
    expect(face.label).toBe('1萬');
  });

  it('marks the two coloured dragons and leaves 白 plain', () => {
    expect(mahjongTileFace(33).classes).toContain('mj-tile-red-dragon');
    expect(mahjongTileFace(32).classes).toContain('mj-tile-green-dragon');
    expect(mahjongTileFace(31).classes).not.toContain('mj-tile-red-dragon');
    expect(mahjongTileFace(31).label).toBe('白');
  });

  it('a face-down tile names nothing', () => {
    // Putting the real tile in a back's markup would leak the other three hands
    // into the page source, which is the leak the server view avoids.
    const back = mahjongTileFace(null);
    expect(back.inner).toBe('');
    expect(back.label).toBe('face-down tile');
  });

  it('names honours by their glyph and suits by rank', () => {
    expect(mahjongTileName(27)).toBe('東');
    expect(mahjongTileName(30)).toBe('北');
    expect(mahjongTileName(9)).toBe('1筒');
    expect(mahjongTileName(26)).toBe('9索');
  });
});
