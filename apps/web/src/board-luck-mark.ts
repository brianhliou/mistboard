// The on-board luck mark for a chance move (a jieqi reveal): a die with no number, pinned
// as a corner badge to the piece's lower-left. Its hue says which way the reveal went
// (one hue per side, grey when tiny); its face says how far, in fixed buckets
// (luckSizePips), so a five is always a huge swing, and its ink deepens with the face
// (luckInk), so a big swing also looks bigger. Variant-agnostic: it takes a point centre and the board's
// piece and cell sizes, so any intersection or cell board can draw it.
//
// Two rules shape it:
// - It never sits where the decision glyph sits. The glyph is a disc on the top-right
//   corner (svg-board-marker.ts, GLYPH_OFFSET_RATIO); a reveal can carry both, because
//   the choice and the dice are graded separately. The die takes the opposite corner, in
//   the glyph's family (filled, white edge, white mark) but square, so it never reads as
//   a second glyph.
// - It is still. No idle motion; the hover card is the only thing that moves, and only
//   when the reader points at the piece.
import './board-luck-mark.css';
import { luckInk, luckSizePips } from './review/jieqi-luck-mark.js';
import { GLYPH_RADIUS_RATIO } from './svg-board-marker.js';

export type LuckMarkSpec = {
  /** Signed win% swing vs the average reveal (+ lucky). */
  luck: number;
};

/** The board's own rectangle (no coordinate gutter): the die stays inside it. */
export type LuckMarkBounds = { minX: number; minY: number; maxX: number; maxY: number };

type Point = { x: number; y: number };

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Die side as a share of the cell: the glyph disc's diameter, less a little, because a
 *  square of equal width reads heavier than a disc. Exported for tests. */
export const LUCK_DIE_RATIO = GLYPH_RADIUS_RATIO * 2 * 0.92;

/** How far the die's centre sits down and left of the point, per axis, as a share of the
 *  cell. Past the glyph's 0.33 on purpose: there the die's centre sat on the piece's rim
 *  and half of it covered the disc; here the centre is just outside the rim, so it reads
 *  as a badge on the corner, and it clears the neighbouring points' pieces. On an edge point
 *  the clamp in luckDieCentre keeps it on the board. Exported for tests. */
export const LUCK_DIE_OFFSET_RATIO = 0.375;

/** The die's white edge (CSS stroke-width), in board units: part of its footprint. */
const DIE_STROKE = 2;
/** Gap kept between the die's edge and the board's edge when an edge piece clamps it:
 *  enough that the die's rounded corner stays inside the board's rounded corner. */
const EDGE_INSET = 2;

/**
 * Centre of the die for a piece at `center`. Down and left by LUCK_DIE_OFFSET_RATIO, then
 * pulled back inside `bounds` when given: on the square grid the board ends half a cell
 * past the outer points (36 of 72), so a piece on the edge file or rank would push the die
 * off the board. The clamp is screen-space, so it holds on a flipped board too.
 */
export function luckDieCentre(center: Point, cell: number, bounds?: LuckMarkBounds): Point {
  const offset = cell * LUCK_DIE_OFFSET_RATIO;
  const c = { x: center.x - offset, y: center.y + offset };
  if (!bounds) return c;
  const reach = (cell * LUCK_DIE_RATIO) / 2 + DIE_STROKE / 2 + EDGE_INSET;
  return {
    x: Math.min(bounds.maxX - reach, Math.max(bounds.minX + reach, c.x)),
    y: Math.min(bounds.maxY - reach, Math.max(bounds.minY + reach, c.y)),
  };
}

/** Classes that pick the die's ink: its side and its step on the scale. */
export function luckInkClass(luck: number): string {
  const ink = luckInk(luck);
  return `luck-mark--${ink.side} luck-mark--s${ink.step}`;
}

export function svgBoardLuckMark(
  spec: LuckMarkSpec,
  center: Point,
  sizes: { piece: number; cell: number },
  square: string,
  bounds?: LuckMarkBounds,
): string {
  const side = sizes.cell * LUCK_DIE_RATIO;
  const c = luckDieCentre(center, sizes.cell, bounds);
  // The hit disc and the die's square are what the hover card measures
  // (getBoundingClientRect): pointing at the revealed piece, or at its die, is pointing at
  // its luck.
  const hit = `<circle class="luck-mark__hit" cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(sizes.piece / 2)}"/>`;
  return (
    `<g class="luck-mark ${luckInkClass(spec.luck)}" data-luck-square="${square}">` +
    `<rect class="luck-mark__cube" x="${fmt(c.x - side / 2)}" y="${fmt(c.y - side / 2)}" width="${fmt(side)}" height="${fmt(side)}" rx="${fmt(side * 0.22)}"/>` +
    dieFace(c, side, luckSizePips(spec.luck)) +
    `${hit}</g>`
  );
}

const PIP_LAYOUT: Record<number, ReadonlyArray<[number, number]>> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

/** The die's pips, centred on `centre`, for a die of side `side`. Large pips: at phone
 *  width the die is ~15px and the face is the message. */
function dieFace(centre: Point, side: number, pips: number): string {
  const pipR = side * 0.105;
  const pipStep = side * 0.255;
  return PIP_LAYOUT[pips]!.map(
    ([dx, dy]) =>
      `<circle class="luck-mark__pip" cx="${fmt(centre.x + dx * pipStep)}" cy="${fmt(centre.y + dy * pipStep)}" r="${fmt(pipR)}"/>`,
  ).join('');
}

/** The same die as a standalone inline icon, for the card's size line, so the card shows
 *  the face it is putting into words. */
export function luckDieIconSvg(luck: number, px = 16): string {
  const side = 20;
  const box = side + 4;
  return (
    `<svg class="luck-mark ${luckInkClass(luck)}" viewBox="0 0 ${box} ${box}" width="${px}" height="${px}" aria-hidden="true">` +
    `<rect class="luck-mark__cube" x="2" y="2" width="${side}" height="${side}" rx="${fmt(side * 0.22)}"/>` +
    dieFace({ x: box / 2, y: box / 2 }, side, luckSizePips(luck)) +
    `</svg>`
  );
}
