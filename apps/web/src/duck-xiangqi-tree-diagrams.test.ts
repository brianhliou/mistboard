import { allDuckXiangqiSquares } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { XQ_BOARD_W } from './articles/diagrams.js';
import { svgTextLabels } from './articles/svg-labels.js';
import {
  duckTreeBoardSvg,
  duckTreeH3e3Marks,
  duckTreeThumbnailSvg,
} from './duck-xiangqi-tree-diagrams.js';

// The article's prose quotes these numbers beside the two boards. The boards
// are computed from the kernel, so this is where the claim is checked: if the
// rules move, the test fails instead of the figure silently disagreeing with
// the paragraph next to it. scripts/duck-tree-figures.mjs asserts the same
// table independently for the charts.
const EXPECTED_H3E3 =
  'b2 -1, h2 -1/+1, h3 -2/+1, b4 -2/+1, h4 -3/+1, b5 -3/+1, h5 -4/+1, a6 -1, b6 -4/+1, c6 -1, e6 -1, g6 -1, h6 -5/+1, i6 -1, b7 -5/+1, h7 -6/+1, a8 -4, c8 -7, d8 -6, e8 -8, f8 -6, g8 -7, i8 -4, a9 -2, b9 -4, d9 -1, e9 -3, f9 -1, h9 -4, i9 -2';

const rankOf = (sq: string) => Number(sq.slice(1));
const fileOf = (sq: string) => sq.charCodeAt(0) - 97;

function pointMarks(svg: string): Array<{ square: string; mark: string; removed?: number }> {
  const out: Array<{ square: string; mark: string; removed?: number }> = [];
  const re =
    /<g data-point="([a-i]\d+)">(?:<circle class="duck-tree-mark" data-mark="(duck|none)"|<g class="duck-tree-mark" data-mark="removed" data-removed="(\d+)">)/g;
  for (const m of svg.matchAll(re)) {
    out.push(
      m[3] !== undefined
        ? { square: m[1]!, mark: 'removed', removed: Number(m[3]) }
        : { square: m[1]!, mark: m[2]! },
    );
  }
  return out;
}

describe('duck tree h3e3 marks (kernel)', () => {
  const marks = duckTreeH3e3Marks();

  it('black has 45 replies with no duck on the board', () => {
    expect(marks.baseReplies).toBe(45);
  });

  it('the duck can land on exactly the 58 empty points', () => {
    const empty = allDuckXiangqiSquares().filter((sq) => !marks.board[sq]);
    expect(empty).toHaveLength(58);
    expect(marks.points.map((p) => p.square).sort()).toEqual([...empty].sort());
  });

  it('30 points change black, 28 do not, matching the article table', () => {
    const effective = marks.points
      .filter((p) => p.removed || p.added)
      .sort((a, b) => rankOf(a.square) - rankOf(b.square) || fileOf(a.square) - fileOf(b.square));
    expect(effective).toHaveLength(30);
    expect(marks.points.filter((p) => !p.removed && !p.added)).toHaveLength(28);
    expect(
      effective.map((p) => `${p.square} -${p.removed}${p.added ? `/+${p.added}` : ''}`).join(', '),
    ).toBe(EXPECTED_H3E3);
    // Every changing point takes something away, so a disc number is never 0.
    expect(effective.every((p) => p.removed > 0)).toBe(true);
    expect(marks.points.find((p) => p.square === 'e8')?.removed).toBe(8);
  });
});

describe('duck tree board figures', () => {
  const all = duckTreeBoardSvg('all', 'ALT ALL');
  const matter = duckTreeBoardSvg('matter', 'ALT MATTER');

  it('board-all puts a duck-yellow dot on every one of the 58 points', () => {
    const marks = pointMarks(all);
    expect(marks).toHaveLength(58);
    expect(marks.every((m) => m.mark === 'duck')).toBe(true);
  });

  it('board numbers the 30 points that change black and greys the 28 others', () => {
    const marks = pointMarks(matter);
    const kernel = new Map(duckTreeH3e3Marks().points.map((p) => [p.square, p]));
    expect(marks).toHaveLength(58);
    const discs = marks.filter((m) => m.mark === 'removed');
    expect(discs).toHaveLength(30);
    expect(marks.filter((m) => m.mark === 'none')).toHaveLength(28);
    for (const disc of discs) {
      expect(disc.removed).toBe(kernel.get(disc.square as never)?.removed);
    }
    // The disc's visible number is its removed count.
    expect(matter).toMatch(/data-removed="8">[\s\S]*?font-weight="800" fill="#ffffff">8<\/text>/);
  });

  it('draws the h3-e3 move and no duck', () => {
    for (const svg of [all, matter]) {
      expect(svg).toContain('xq-arrow-h3-e3');
      expect(svg).not.toContain('aria-label="duck"');
      expect(svg).toContain('class="xq-article-svg"');
      expect(svg).toContain('data-xq-layout="single"');
    }
    // The alt is a <title>, so the zh pages' SVG text swap reaches it.
    expect(all).toMatch(/^<svg\b[^>]*><title>ALT ALL<\/title>/);
    expect(matter).toMatch(/^<svg\b[^>]*><title>ALT MATTER<\/title>/);
  });

  it('every mark lands inside the board', () => {
    for (const svg of [all, matter]) {
      const xs = svg
        .split('<g data-point=')
        .slice(1)
        .map((chunk) => Number(/cx="([-\d.]+)"/.exec(chunk)?.[1]));
      expect(xs).toHaveLength(58);
      expect(xs.every((x) => x > 0 && x < XQ_BOARD_W)).toBe(true);
    }
  });

  it('keeps the heading and legend text', () => {
    expect(all).toContain('After cannon h3 to e3, the duck can land');
    expect(all).toContain('A point the duck can land on.');
    expect(matter).toContain('Only 30 of those 58 points change');
    expect(matter).toContain('45 replies away');
    expect(matter).toContain('A duck here changes nothing for black');
  });
});

describe('duck tree index card', () => {
  const card = duckTreeThumbnailSvg();
  const matter = duckTreeBoardSvg('matter', 'ALT MATTER');

  it('is the matter board with no words: only disc numerals and piece glyphs are text', () => {
    const labels = svgTextLabels(card);
    // No Latin letters anywhere, so the card has nothing to translate.
    expect(labels.filter((label) => /\p{Script=Latin}/u.test(label))).toEqual([]);
    expect(labels.filter((label) => /^\d+$/.test(label))).toHaveLength(30);
    expect(card).not.toContain('<title>');
    const open = /^<svg\b[^>]*>/.exec(card)?.[0];
    expect(open).not.toContain('aria-label');
    // Decorative on the card: the numerals must not become the link's name.
    expect(open).toContain('aria-hidden="true"');
    expect(card).not.toContain('duck-tree-legend');
    expect(card).not.toContain('xq-diagram-title');
  });

  it('carries the same marks as the article board', () => {
    const marks = pointMarks(card);
    expect(marks).toEqual(pointMarks(matter));
    expect(marks.filter((m) => m.mark === 'removed')).toHaveLength(30);
    expect(marks.filter((m) => m.mark === 'none')).toHaveLength(28);
    expect(card).toContain('xq-arrow-h3-e3');
  });

  it('is framed like the other full-board xiangqi cards', () => {
    expect(card).toContain('class="xq-article-svg"');
    expect(card).toContain('data-xq-layout="single"');
  });
});
