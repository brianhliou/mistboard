// Shared Jungle / Flip Jungle art recipe — the SINGLE source of truth for the dobutsu
// token + terrain look, imported by the vanilla board (jungle-render.ts) and the flip board
// (jungle-flip-render.ts). Adjust the
// look here once and every jungle surface follows.
//
// CANONICAL: this recipe + the in-app piece set (apps/web/public/.../dobutsu) are the
// source of truth. The Dou Shou Qi blog widget (brianhliou.com,
// assets/js/jungle-replay.js) is a DOWNSTREAM copy that should match these values.
// Drop new piece art in public/, push it to the blog with `npm run publish:jungle-art`,
// and verify both are aligned with `npm run check:jungle-art` (diffs this recipe against
// the blog widget, and the blog's pieces against the canonical public set).

import {
  JUNGLE_JUMP_DIRS,
  type JungleColor,
  type JunglePieceRole,
  jungleRoleMayEnterWater,
} from '@mistboard/game';
import { roundPieceBox } from './board-metrics.js';

// The composition spec. Ratios are relative to the token's nominal size (a cell-sized
// box); the blog uses CELL=48, so e.g. its 1.55px ring stroke is 1.55/48 ≈ 0.032.
//
// 2026-10-14 (the grid-board piece look, Brian): a token is a rounded square, not a
// disc. The cream face stops at the ring and the ring sits on the edge, 2.8 wide per
// 46 of half-width with corners of 14 per 46, the same square the xiangqi family
// draws on its grid boards. On a board the outer edge spans the whole cell
// (jungleTokenSize; 98% until 2026-10-15, see JUNGLE_TOKEN_REACH). The blog widget still draws the old disc recipe, so
// `check:jungle-art` reports the drift until it is ported.
export const JUNGLE_ART = {
  /** Cream face under every revealed animal, out to the ring. */
  discFill: '#fff2cf',
  /** Ink by side: the last-move tint, the river badge and the character skin. */
  ink: { red: '#b5322b', black: '#28323c' } as Record<JungleColor, string>,
  /** The animal token's ring, one dark colour for both sides (Brian, 2026-10-14):
   *  the animal art is filled red or slate by side, so the ring need not say it. */
  animalRing: '#28323c',
  /** Cream face half-width ÷ token size (to the ring, not past it). */
  discRadiusRatio: 0.45,
  /** Ring half-width ÷ token size. */
  ringRadiusRatio: 0.45,
  /** Ring stroke width ÷ token size: 2.8 per 46 of the ring's half-width. */
  ringStrokeRatio: 0.0274,
  /** Corner radius per unit of half-width (14 per 46). */
  cornerPerHalf: 14 / 46,
  /** Per-role art trim so silhouettes sit consistently inside the disc; default 1. The
   *  v2 "Dobutsu Minimal" masters are pre-fitted (per-animal optical sizing baked into
   *  the PNGs), so no trims — adjust sizing in the masters, not here. */
  fit: {} as Partial<Record<JunglePieceRole, number>>,
  /** Soft drop-shadow, kept for callers that ask for one; the boards no longer do
   *  (2026-10-14: no shadow on the new tokens). */
  shadow: { dx: 0, dy: 1.5, std: 1, color: '#3a2c20', opacity: 0.34 },
  /** Flip Jungle face-down tile: a flat jade rounded square (neutral, the deal is
   *  hidden from both sides), the same outer size and shape as a face-up token, so
   *  its reach is JUNGLE_TOKEN_REACH's.
   *  Ratios ÷ cell: the stroke is today's 0.031 grown with the tile. */
  faceDown: { fill: '#2f8f6b', stroke: '#184a38', reach: 1, strokeRatio: 0.039 },
} as const;

/** A token's outer edge (ring included) as a share of the cell on a board: the
 *  whole cell (2026-10-15; was 0.98). The boards draw grid lines on interior cell
 *  boundaries only, never a perimeter, so at 0.98 a tile in an edge cell stopped
 *  half a unit short of the board edge and showed a strip of grass against the
 *  frame, while between cells the grid line hid the same gap. At 1 an edge tile
 *  meets the board edge and two neighbours' rings meet on the grid line. */
export const JUNGLE_TOKEN_REACH = 1;

/** The nominal token size whose outer edge spans JUNGLE_TOKEN_REACH of the cell:
 *  the ring's outer half-width is size × (ringRadiusRatio + ringStrokeRatio / 2). */
export function jungleTokenSize(cell: number): number {
  const outerPerSize = 2 * JUNGLE_ART.ringRadiusRatio + JUNGLE_ART.ringStrokeRatio;
  return roundPieceBox((cell * JUNGLE_TOKEN_REACH) / outerPerSize);
}

/** A rounded square centred on (cx, cy), `half` from centre to edge. */
export function jungleTokenSquare(cx: number, cy: number, half: number, attrs: string): string {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return `<rect x="${r(cx - half)}" y="${r(cy - half)}" width="${r(2 * half)}" height="${r(2 * half)}" rx="${r(half * JUNGLE_ART.cornerPerHalf)}" ${attrs}/>`;
}

const PIECES_DIR = '/piece-sets/jungle/dobutsu';
const BOARD_DIR = '/piece-sets/jungle/dobutsu/board';
/** Cache-buster for the piece PNGs; bump when the art in public/ changes. v2 = the
 *  "Dobutsu Minimal" edition (2026-07-02). */
const PIECES_VERSION = 2;
/** Cache-buster for board terrain PNGs; bump when board art in public/ changes. */
const BOARD_VERSION = 2;

/** Dobutsu animal cutout href (same masters as the blog's jungle-dobutsu-pieces). */
export function jungleDobutsuPieceHref(color: JungleColor, role: JunglePieceRole): string {
  return `${PIECES_DIR}/${color}-${role}.png?v=${PIECES_VERSION}`;
}

/** Board terrain / tile art href: 'grass' | 'water' | 'den' | 'trap' | 'flip-board' | 'flip-back'. */
export function jungleBoardAssetHref(name: string): string {
  return `${BOARD_DIR}/${name}.png?v=${BOARD_VERSION}`;
}

/** A `<defs>` drop-shadow filter (not CSS, so it also renders in the rsvg/resvg OG pipeline). */
export function jungleShadowFilterDef(id: string): string {
  const { dx, dy, std, color, opacity } = JUNGLE_ART.shadow;
  return (
    `<filter id="${id}" x="-25%" y="-25%" width="150%" height="160%">` +
    `<feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${std}" flood-color="${color}" flood-opacity="${opacity}"/>` +
    `</filter>`
  );
}

/** An <image> that covers its box (the terrain/tile layers). */
export function jungleCoverImage(href: string, x: number, y: number, w: number, h: number): string {
  return `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
}

export type FramedTokenOptions = {
  /** Token centre. */
  cx: number;
  cy: number;
  /** Nominal token size (the disc is sized from this, not the literal disc diameter). */
  size: number;
  ink: JungleColor;
  role: JunglePieceRole;
  /** Override the ring stroke ratio (markers use a heavier ring so it survives at thumbnail size). */
  ringStrokeRatio?: number;
  /** Optional drop-shadow filter id (the boards no longer pass one). */
  filterId?: string;
  /** PROTOTYPE: draw the river-ability badge (Rat / Tiger / Lion). Off by default;
   *  per-token overrides let the lab sweep the look live. */
  cueBadge?: boolean;
  cueBadgeOverrides?: Partial<JungleCueBadgeSpec>;
  /** The size the river badge is drawn from, when it should not grow with the token
   *  (the boards keep the badge at its pre-2026-10-14 size). Defaults to `size`. */
  badgeSize?: number;
};

/** The framed dobutsu token: cream rounded square + cutout (trimmed per role) + ring. */
export function framedTokenSvg(opts: FramedTokenOptions): string {
  const { cx, cy, size, ink, role, ringStrokeRatio, filterId, cueBadge, cueBadgeOverrides } = opts;
  const faceHalf = size * JUNGLE_ART.discRadiusRatio;
  const ringHalf = size * JUNGLE_ART.ringRadiusRatio;
  const ringW = size * (ringStrokeRatio ?? JUNGLE_ART.ringStrokeRatio);
  const imgSize = size * (JUNGLE_ART.fit[role] ?? 1);
  const open = filterId ? `<g filter="url(#${filterId})">` : '<g>';
  return [
    open,
    jungleTokenSquare(cx, cy, faceHalf, `fill="${JUNGLE_ART.discFill}"`),
    `<image href="${jungleDobutsuPieceHref(ink, role)}" x="${cx - imgSize / 2}" y="${cy - imgSize / 2}" width="${imgSize}" height="${imgSize}" preserveAspectRatio="xMidYMid meet"/>`,
    jungleTokenSquare(
      cx,
      cy,
      ringHalf,
      `fill="none" stroke="${JUNGLE_ART.animalRing}" stroke-width="${ringW}"`,
    ),
    `</g>`,
    // Outside the token group on purpose: a shadow tuned for the big token would
    // smear a 10px badge into a grey smudge.
    cueBadge
      ? jungleCueBadgeSvg(cx, cy, opts.badgeSize ?? size, role, ink, cueBadgeOverrides ?? {})
      : '',
  ].join('');
}

/* ── River-ability badge (PROTOTYPE, off by default) ──────────────────────────
 *
 * Jungle's newcomer problem: three of the eight pieces have business with the
 * river and the other five do not, and the board never says which.
 *
 * WHY A CORNER BADGE and not a ring. A first pass drew concentric arcs outside
 * the token and it was the wrong family three ways over. (1) Every token already
 * wears an ink ring for identity, so a second ring made the piece mean two
 * unrelated things in one shape. (2) Rings and arcs are already spoken for on
 * this board -- last-move, selection and target marks are all circular -- so a
 * blue arc reads as unrecognised UI state before it reads as "jumps". (3) There
 * is no room: the token is 0.9 of a cell and the cream disc is 0.97 of the
 * token, leaving about 3px of margin on the AXES at a 48px cell, and the arcs
 * came out visibly shaved by the board edge on the back rank -- which is exactly
 * where both Lions and both Tigers start.
 *
 * The clearance is at the CORNERS, not the edges: the cell half-diagonal is
 * 0.786 in token units against a disc edge at 0.485, so a diagonal badge has
 * roughly 13px to live in at the same cell size. A badge is also icon
 * vocabulary rather than ring vocabulary, so it stops competing with the marks
 * the board already uses.
 *
 * The DIRECTIONS are not written here. They are read out of the rules
 * (JUNGLE_JUMP_DIRS / jungleRoleMayEnterWater), so a badge cannot promise a jump
 * the move generator will refuse. In this ruleset the Tiger and the Lion both
 * jump vertically or sideways (the Tiger was vertical-only until #430).
 *
 * Corner placement is screen-space and direction-free, so flipping the board for
 * Black's perspective needs no special case. The chevrons ARE direction-bearing,
 * and vertical stays vertical under that flip. */

/** What a role's badge says. Derived from the rules, never declared. */
export type JungleCueGlyph = 'water' | 'jump-vertical' | 'jump-ortho';

export function jungleCueGlyphFor(role: JunglePieceRole): JungleCueGlyph | null {
  if (jungleRoleMayEnterWater(role)) return 'water';
  const dirs = JUNGLE_JUMP_DIRS[role];
  if (!dirs || dirs.length === 0) return null;
  return dirs.some(([df]) => df !== 0) ? 'jump-ortho' : 'jump-vertical';
}

export type JungleCueBadgeSpec = {
  /** Badge centre distance from the token centre, along the diagonal, ÷ token size. */
  offsetRatio: number;
  /** Badge disc radius ÷ token size. */
  radiusRatio: number;
  corner: 'br' | 'tr' | 'bl' | 'tl';
  /** Badge disc fill. Ignored when `useInk`. */
  fill: string;
  /** Glyph (and, with `useInk`, still the glyph) colour. */
  glyph: string;
  stroke: string;
  strokeRatio: number;
  /** Fill the badge with the PIECE's ink instead of `fill`, so it reads as part of
   *  this piece rather than as a separate system laid over the board. */
  useInk: boolean;
  /**
   * Where each arm STARTS, ÷ badge radius. Must be > 0: with the arms running all
   * the way to the centre, the Lion's four shafts plus their round caps fuse into
   * a blob and the badge reads as a filled cross rather than as four directions.
   * A hole in the middle is what separates them.
   */
  shaftInnerRatio: number;
  /**
   * Draw arrowheads. OFF by default, and that is a finding rather than a taste:
   * at a 48px cell the badge is ~10px and a head is barely over a pixel, so the
   * Lion's four heads close into a diamond outline no matter how the arms are
   * spaced -- arms to the centre fuse into a blob, arms pushed off the centre
   * re-form the same rhombus one ring out. Dropping the heads entirely leaves a
   * bare BAR for the Tiger against a bare CROSS for the Lion: two shapes that
   * survive at any size and still say which axes the piece may leap along.
   */
  arrowHeads: boolean;
  /** Arm stroke width ÷ badge radius. */
  armStrokeRatio: number;
};

/**
 * Default: a solid water-blue badge with a cream glyph, at the bottom-right.
 *
 * The numbers are the corner budget spent deliberately. At 0.56 along the
 * diagonal the badge cleared the board boundary by a measured 1.71px at a 48px
 * cell -- not clipped, but the same knife-edge that made the ring look shaved,
 * so the default backs off to 0.54 for ~2.3px and lets the badge overlap the
 * cream disc a little more instead. A badge overlapping its host is ordinary;
 * a badge kissing the board edge is not. The lab prints the live worst-case
 * margin under the board so this stays a number rather than a judgement call.
 */
export const JUNGLE_CUE_BADGE: JungleCueBadgeSpec = {
  offsetRatio: 0.54,
  radiusRatio: 0.12,
  corner: 'br',
  // Only consulted when useInk is false; kept as the water-blue alternate.
  fill: '#2f7f9e',
  glyph: '#fff2cf',
  stroke: '#3a2c20',
  strokeRatio: 0.018,
  // The badge wears the PIECE's own red or navy, so the board gains a mark but no
  // new colour. Note what this trades away: with a water-blue badge the colour
  // itself said "river", and here it does not -- the meaning rides entirely on the
  // glyph (droplet / bar / cross). That is the better split anyway, because the
  // glyph is the part that distinguishes Rat from Tiger from Lion, and a colour
  // could never have carried that.
  useInk: true,
  shaftInnerRatio: 0,
  arrowHeads: false,
  armStrokeRatio: 0.2,
};

/** Unit corner directions, in SVG space (y grows downward). */
const CUE_CORNERS: Record<JungleCueBadgeSpec['corner'], readonly [number, number]> = {
  br: [1, 1],
  tr: [1, -1],
  bl: [-1, 1],
  tl: [-1, -1],
};

/**
 * An arrow -- shaft from the badge centre plus a head -- pointing along (ux, uy).
 *
 * Shaft, not a bare chevron. Four bare chevrons at this size close up into a
 * diamond outline: the reader sees one rhombus rather than four directions, which
 * loses the distinction between a four-way and a two-way jumper. Shafts make
 * a both-axes jumper a four-way arrow and a vertical-only one a double-headed
 * vertical arrow -- two shapes nobody has to be taught.
 */
function cueArrow(
  bx: number,
  by: number,
  inner: number,
  dist: number,
  arm: number,
  heads: boolean,
  ux: number,
  uy: number,
): string {
  // Perpendicular to the pointing direction, so one helper draws all four.
  const px = -uy;
  const py = ux;
  const tipX = bx + ux * dist;
  const tipY = by + uy * dist;
  const shaft =
    `M ${(bx + ux * inner).toFixed(2)} ${(by + uy * inner).toFixed(2)} ` +
    `L ${tipX.toFixed(2)} ${tipY.toFixed(2)}`;
  if (!heads) return shaft;
  const backX = tipX - ux * arm;
  const backY = tipY - uy * arm;
  return (
    `${shaft} ` +
    `M ${(backX + px * arm).toFixed(2)} ${(backY + py * arm).toFixed(2)} ` +
    `L ${tipX.toFixed(2)} ${tipY.toFixed(2)} ` +
    `L ${(backX - px * arm).toFixed(2)} ${(backY - py * arm).toFixed(2)}`
  );
}

/** The badge for one token, or '' when the role has no river business. */
export function jungleCueBadgeSvg(
  cx: number,
  cy: number,
  size: number,
  role: JunglePieceRole,
  ink: JungleColor,
  overrides: Partial<JungleCueBadgeSpec> = {},
): string {
  const spec = { ...JUNGLE_CUE_BADGE, ...overrides };
  const glyph = jungleCueGlyphFor(role);
  if (!glyph) return '';

  const [sx, sy] = CUE_CORNERS[spec.corner];
  // offsetRatio is measured along the diagonal, so each axis gets 1/sqrt(2) of it.
  const along = (size * spec.offsetRatio) / Math.SQRT2;
  const bx = cx + sx * along;
  const by = cy + sy * along;
  const r = size * spec.radiusRatio;
  const fill = spec.useInk ? JUNGLE_ART.ink[ink] : spec.fill;

  // data-cue-badge is a measurement handle, not styling: the lab reads these back
  // out of the rendered board to print the worst badge-to-board-edge gap.
  const disc =
    `<circle data-cue-badge cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="${r.toFixed(2)}" ` +
    `fill="${fill}" stroke="${spec.stroke}" stroke-width="${(size * spec.strokeRatio).toFixed(2)}"/>`;

  if (glyph === 'water') {
    // A teardrop, point up. Filled rather than stroked: at a ~10px badge a stroked
    // outline closes up into a blob, where a solid silhouette still reads.
    const h = r * 0.62;
    const w = r * 0.44;
    const d =
      `M ${bx.toFixed(2)} ${(by - h).toFixed(2)} ` +
      `C ${(bx + w).toFixed(2)} ${(by - h * 0.1).toFixed(2)} ` +
      `${(bx + w).toFixed(2)} ${(by + h * 0.62).toFixed(2)} ${bx.toFixed(2)} ${(by + h).toFixed(2)} ` +
      `C ${(bx - w).toFixed(2)} ${(by + h * 0.62).toFixed(2)} ` +
      `${(bx - w).toFixed(2)} ${(by - h * 0.1).toFixed(2)} ${bx.toFixed(2)} ${(by - h).toFixed(2)} Z`;
    return `${disc}<path d="${d}" fill="${spec.glyph}"/>`;
  }

  // One arrow per direction the piece may LEAP: four for a both-axes jumper (Lion
  // and Tiger), two for a vertical-only one -- so the badges differ in overall
  // SHAPE, not in the count of marks a reader would have to stop and tally.
  const dirs: ReadonlyArray<readonly [number, number]> =
    glyph === 'jump-ortho'
      ? [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ]
      : [
          [0, -1],
          [0, 1],
        ];
  const dist = r * 0.64;
  const inner = r * spec.shaftInnerRatio;
  const arm = r * 0.26;
  const strokes = dirs
    .map(([ux, uy]) => `<path d="${cueArrow(bx, by, inner, dist, arm, spec.arrowHeads, ux, uy)}"/>`)
    .join('');
  return (
    `${disc}<g fill="none" stroke="${spec.glyph}" ` +
    `stroke-width="${(r * spec.armStrokeRatio).toFixed(2)}" ` +
    `stroke-linecap="round" stroke-linejoin="round">${strokes}</g>`
  );
}

/** Flip Jungle face-down tile: the neutral jade rounded square (no identity), the same
 *  outer size and shape as a face-up token. `cell` is the cell size; pass a filter id
 *  for a shadow. */
export function jungleFaceDownDiscSvg(
  cx: number,
  cy: number,
  cell: number,
  filterId?: string,
): string {
  const { fill, stroke, reach, strokeRatio } = JUNGLE_ART.faceDown;
  const width = cell * strokeRatio;
  const half = (cell * reach - width) / 2;
  const open = filterId ? `<g filter="url(#${filterId})">` : '<g>';
  return `${open}${jungleTokenSquare(cx, cy, half, `fill="${fill}" stroke="${stroke}" stroke-width="${Math.round(width * 1000) / 1000}"`)}</g>`;
}

/** Last-move mark spec shared by Jungle AND Flip Jungle (one spec so the two
 *  boards never drift apart again).
 *
 *  These boards place pieces in CELL CENTRES, so the mark tints the whole cell
 *  rather than ringing the piece -- the same call banqi makes, and for the same
 *  reason: a circular mark on a cell board either traces the grid line or has to
 *  be squeezed into the few units between the piece and the cell edge. A tint is
 *  bounded by the cell by construction.
 *
 *  The tint carries the MOVER's ink. On a normal move the piece that landed
 *  already says who moved, but Flip Jungle turns up a RANDOM tile whose colour
 *  is independent of the flipper, so a flip otherwise carries no signal at all.
 *
 *  EVERY alpha lives in the rgba colour, never in `opacity`: the arrival
 *  animation fades element opacity 0 -> 1, and a mark with a resting opacity
 *  below 1 flashes solid and then snaps back. Concrete colours (no CSS vars)
 *  keep the marks visible in standalone SVGs such as OG cards.
 */
export const JUNGLE_LAST_MOVE = {
  /** Border on a flip's single cell, ÷ cell. */
  flipStrokeRatio: 3 / 48,
  /** Tints keyed by the ink that ACTED. `null` is the pre-binding fallback. */
  fill: {
    red: { from: 'rgba(181,50,43,0.20)', to: 'rgba(181,50,43,0.38)' },
    // JungleColor calls this side 'black', but it inks as navy (#28323c) and
    // reads as blue on the board, so the tint follows the ink, not the name.
    black: { from: 'rgba(22,78,150,0.28)', to: 'rgba(22,78,150,0.5)' },
    none: { from: 'rgba(227,179,77,0.26)', to: 'rgba(227,179,77,0.44)' },
  },
  stroke: {
    red: 'rgba(140,32,26,0.38)',
    black: 'rgba(20,38,60,0.44)',
    none: 'rgba(227,179,77,0.44)',
  },
} as const;

export type JungleLastMoveInk = 'red' | 'black' | null;
export type JungleLastMoveKind = 'from' | 'to' | 'flip';

/**
 * One last-move cell tint. `x`/`y` are the cell's top-left corner.
 *
 * A flip's border straddles the rect edge, so its rect comes in by half the
 * stroke -- an un-inset border paints its outer half into the next cell, which
 * is the whole failure a cell-bounded mark exists to avoid.
 */
export function jungleLastMoveCellSvg(
  x: number,
  y: number,
  cell: number,
  kind: JungleLastMoveKind,
  ink: JungleLastMoveInk,
): string {
  const key = ink ?? 'none';
  const flip = kind === 'flip';
  const inset = flip ? (cell * JUNGLE_LAST_MOVE.flipStrokeRatio) / 2 : 0;
  const span = cell - inset * 2;
  const fill = JUNGLE_LAST_MOVE.fill[key][kind === 'from' ? 'from' : 'to'];
  const border = flip
    ? ` stroke="${JUNGLE_LAST_MOVE.stroke[key]}" stroke-width="${cell * JUNGLE_LAST_MOVE.flipStrokeRatio}"`
    : '';
  return `<rect class="jungle-last-move-${kind}" x="${x + inset}" y="${y + inset}" width="${span}" height="${span}" fill="${fill}"${border}/>`;
}
