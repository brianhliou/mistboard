// Selectable piece sets for the xiangqi family.
//
// Covers all seven xiangqi roles (general/advisor/elephant/horse/chariot/cannon/
// soldier) so the same sets serve every xiangqi-family surface. Image sets are the international default and the
// Dobutsu animal set; glyph sets cover traditional/simplified Hanzi. All four draw a
// disc on the lined board and a rounded square on the square grid (image sets
// 2026-10-14, glyph sets 2026-10-15). The asset sets
// (lacquer, wood, book, brush, clerical; 2026-10-08) are third-party SVG discs,
// each with its own face-down back; sources and licences sit beside the files
// in public/piece-sets/xiangqi/<id>/README.md.
// Chinese characters render from baked Noto Sans CJK SC Bold outlines (see
// cjkGlyphMark) so the live board matches the OG cards and variant mini-boards.

import { XIANGQI_GLYPH_PATHS } from '@mistboard/board-render';
import {
  hasOwnKey,
  type XiangqiColor,
  type XiangqiPiece,
  type XiangqiPieceRole,
} from '@mistboard/game';

export type XiangqiPieceSet =
  | 'international'
  | 'animal-dobutsu'
  | 'traditional'
  | 'simplified'
  | AssetXiangqiPieceSet;

// Third-party SVG sets drawn whole by their files (disc, ring and character).
export type AssetXiangqiPieceSet = 'lacquer' | 'wood' | 'book' | 'brush' | 'clerical';
export type XiangqiShroudedStyle = 'question' | 'back';

// labelKey names the set in the shell catalog (en, zh-Hans, zh-Hant); label is
// the English fallback for surfaces that render without a locale.
export const XIANGQI_PIECE_SETS: ReadonlyArray<{
  id: XiangqiPieceSet;
  label: string;
  labelKey: `prefs.xqPieceSet.${XiangqiPieceSet}`;
}> = [
  { id: 'international', label: 'International', labelKey: 'prefs.xqPieceSet.international' },
  { id: 'animal-dobutsu', label: 'Animal Dobutsu', labelKey: 'prefs.xqPieceSet.animal-dobutsu' },
  { id: 'traditional', label: 'Traditional', labelKey: 'prefs.xqPieceSet.traditional' },
  { id: 'simplified', label: 'Simplified', labelKey: 'prefs.xqPieceSet.simplified' },
  { id: 'lacquer', label: 'Lacquer', labelKey: 'prefs.xqPieceSet.lacquer' },
  { id: 'wood', label: 'Wood', labelKey: 'prefs.xqPieceSet.wood' },
  { id: 'book', label: 'Book', labelKey: 'prefs.xqPieceSet.book' },
  { id: 'brush', label: 'Brush', labelKey: 'prefs.xqPieceSet.brush' },
  { id: 'clerical', label: 'Clerical', labelKey: 'prefs.xqPieceSet.clerical' },
];

// Sets that were offered once and removed (2026-10-08: the Latin-initial and
// line-icon diagram sets; 2026-10-14: Chess-style and Animal (no disc), the two
// disc-less sets, when the international set took the new figures). A stored
// pick of one reads as "no pick", so the browser follows the default inference
// again.
export const RETIRED_XIANGQI_PIECE_SETS: ReadonlySet<string> = new Set([
  'western',
  'symbols',
  'international-flat',
  'animal-flat',
]);

export const DEFAULT_XIANGQI_PIECE_SET: XiangqiPieceSet = 'international';

// Traditional sets distinguish red and black with different characters (the
// two-set convention used on physical Chinese chess sets).
const TRADITIONAL: Record<XiangqiColor, Record<XiangqiPieceRole, string>> = {
  red: {
    general: '帥',
    advisor: '仕',
    elephant: '相',
    horse: '傌',
    chariot: '俥',
    cannon: '炮',
    soldier: '兵',
  },
  black: {
    general: '將',
    advisor: '士',
    elephant: '象',
    horse: '馬',
    chariot: '車',
    cannon: '砲',
    soldier: '卒',
  },
};

// Simplified sets share modern characters across colors where the simplification
// merges them (馬→马, 車→车, 砲/炮→炮); general keeps its color-distinct form.
const SIMPLIFIED: Record<XiangqiColor, Record<XiangqiPieceRole, string>> = {
  red: {
    general: '帅',
    advisor: '仕',
    elephant: '相',
    horse: '马',
    chariot: '车',
    cannon: '炮',
    soldier: '兵',
  },
  black: {
    general: '将',
    advisor: '士',
    elephant: '象',
    horse: '马',
    chariot: '车',
    cannon: '炮',
    soldier: '卒',
  },
};

type ImageXiangqiPieceSet =
  | Extract<XiangqiPieceSet, 'animal-dobutsu' | 'international'>
  | AssetXiangqiPieceSet;
type AnimalXiangqiPieceSet = Extract<XiangqiPieceSet, 'animal-dobutsu'>;

export type XiangqiPieceTilePreview = { kind: 'svg'; markup: string };

/**
 * The outline a piece is drawn in (2026-10-14). A lined board puts pieces on
 * points, so they are discs; the square grid puts them in cells, where the
 * international and Dobutsu sets draw a rounded square of the same half-width
 * (rect 4..96, rx 14, the same ring). The character sets joined them on
 * 2026-10-15 (Brian: "use rounded squares at 98% like the picture sets, to
 * unify"), keeping their own ring colours. The five asset sets are whole
 * third-party disc files and keep their disc on every board.
 */
export type XiangqiPieceShape = 'disc' | 'square';

/** The shape a board of this layout asks for: a rounded square on the square grid. */
export function xiangqiPieceShapeForLayout(layout: 'intersection' | 'cell'): XiangqiPieceShape {
  return layout === 'cell' ? 'square' : 'disc';
}

/** Whether this set draws the square when a board asks for one. */
export function xiangqiPieceSetHasSquare(set: XiangqiPieceSet): boolean {
  return (
    set === 'international' ||
    set === 'animal-dobutsu' ||
    set === 'traditional' ||
    set === 'simplified'
  );
}

/** The shape this set actually draws on a board that asks for `shape`. */
export function xiangqiPieceSetShape(
  set: XiangqiPieceSet,
  shape: XiangqiPieceShape | undefined,
): XiangqiPieceShape {
  return shape === 'square' && xiangqiPieceSetHasSquare(set) ? 'square' : 'disc';
}
const frameShape = xiangqiPieceSetShape;

/** Corner radius of the rounded square per unit of half-width (14 at 46). */
const SQUARE_CORNER_PER_HALF = 14 / 46;

/**
 * A disc of radius `half`, or the rounded square of the same half-width, centred
 * on (cx, cy). `attrs` carries the paint (fill, stroke, class).
 */
export function xiangqiPieceFrameOutline(
  shape: XiangqiPieceShape,
  half: number,
  attrs: string,
  cx = 50,
  cy = 50,
): string {
  if (shape === 'square') {
    const rx = frameValue(half * SQUARE_CORNER_PER_HALF);
    return `<rect x="${frameValue(cx - half)}" y="${frameValue(cy - half)}" width="${frameValue(2 * half)}" height="${frameValue(2 * half)}" rx="${rx}" ${attrs}/>`;
  }
  return `<circle cx="${frameValue(cx)}" cy="${frameValue(cy)}" r="${frameValue(half)}" ${attrs}/>`;
}

export type XiangqiPieceRenderOptions = {
  ariaLabel?: string;
  shrouded?: boolean;
  shroudedStyle?: XiangqiShroudedStyle;
  className?: string;
  x?: number;
  y?: number;
  size?: number;
  // A soldier that has crossed the river draws with the promoted-soldier art.
  // International set only (that is where the asset ships); other sets fall back
  // to the plain soldier glyph/art.
  crossed?: boolean;
  // The soft shadow under the disc (xiangqiPieceShadowMarks). Defaults to the
  // reader's "Piece shadow" switch, which is off unless the reader turns it on.
  shadow?: boolean;
  // The board's outline for the piece (xiangqiPieceShapeForLayout). The image and
  // character sets draw the square; the asset sets stay discs. Default disc.
  shape?: XiangqiPieceShape;
};

export function xiangqiGlyph(
  set: XiangqiPieceSet,
  color: XiangqiColor,
  role: XiangqiPieceRole,
): string {
  if (set === 'simplified') return SIMPLIFIED[color][role];
  return TRADITIONAL[color][role];
}

// A compact representative mark for the settings-panel tile (the red general).
export function xiangqiPreviewGlyph(set: XiangqiPieceSet): string {
  if (isImagePieceSet(set)) return 'G';
  return xiangqiGlyph(set, 'red', 'general');
}

// Every set previews as the board's own red general, so the character sets
// show their disc and ring rather than a bare glyph on the tile.
export function xiangqiPieceTilePreview(set: XiangqiPieceSet): XiangqiPieceTilePreview {
  return {
    kind: 'svg',
    markup: renderXiangqiPieceGlyphed({ color: 'red', role: 'general' }, set),
  };
}

export function renderXiangqiPieceGlyphed(
  piece: XiangqiPiece,
  set: XiangqiPieceSet,
  opts: XiangqiPieceRenderOptions = {},
): string {
  const colorHex = piece.color === 'red' ? '#b91c1c' : '#1f2937';
  const baseFill = '#f3e6c4';
  const shape = frameShape(set, opts.shape);
  const ariaLabel =
    opts.ariaLabel ??
    (opts.shrouded ? `${piece.color} hidden piece` : `${piece.color} ${piece.role}`);
  const classAttr = opts.className ? ` class="${escapeAttr(opts.className)}"` : '';
  const shadow = xiangqiPieceDiscShadow(set, opts);
  // The shadow falls a little below the 100-unit box, which a nested <svg>
  // clips by default. Only disc sets draw one, and their art sits well inside
  // the box, so letting it overflow uncovers nothing else.
  const overflowAttr = shadow ? ' overflow="visible"' : '';
  const posAttrs =
    (opts.size !== undefined || opts.x !== undefined || opts.y !== undefined
      ? ` x="${opts.x ?? 0}" y="${opts.y ?? 0}" width="${opts.size ?? 100}" height="${opts.size ?? 100}"`
      : '') + overflowAttr;
  const open = `<svg${classAttr}${posAttrs} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeAttr(ariaLabel)}">`;
  if (isAssetPieceSet(set)) {
    if (!opts.shrouded) {
      return `${open}${shadow}${assetImageMark(assetPieceHref(set, piece.color, piece.role))}</svg>`;
    }
    // Face-down (jieqi, banqi diagrams) shows the set's own back; a fog "?"
    // token draws the mark over that same back in the set's ink.
    const question =
      opts.shroudedStyle === 'back' ? '' : glyphMark('?', ASSET_SETS[set].ink[piece.color]);
    return `${open}${shadow}${assetImageMark(assetPieceHref(set, piece.color, 'back'))}${question}</svg>`;
  }
  if (opts.shrouded && opts.shroudedStyle === 'back') {
    return [open, shadow, pieceBackMark(piece.color, shape), `</svg>`].join('');
  }
  // A shrouded "?" token on an image set (international / animal) draws over that
  // set's single-ring disc so the hidden token sits flush with its revealed
  // neighbours. Without these branches it falls through to the generic
  // double-ring disc below and shows an extra inner ring the image-set pieces
  // never have.
  if (opts.shrouded && set === 'international') {
    return [
      open,
      shadow,
      internationalDiscMark(piece.color, shape),
      glyphMark('?', colorHex),
      `</svg>`,
    ].join('');
  }
  if (opts.shrouded && isAnimalPieceSet(set)) {
    return [
      open,
      shadow,
      animalDiscMark(shape),
      glyphMark('?', colorHex),
      animalRingMark(piece.color, shape),
      `</svg>`,
    ].join('');
  }
  if (!opts.shrouded && set === 'international') {
    return [
      open,
      shadow,
      internationalDiscMark(piece.color, shape),
      internationalImageMark(internationalPieceHref(piece, opts.crossed, shape), piece.role),
      `</svg>`,
    ].join('');
  }
  if (!opts.shrouded && isAnimalPieceSet(set)) {
    return [
      open,
      shadow,
      animalDiscMark(shape),
      `<image href="${escapeAttr(animalPieceHref(piece, set))}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet"/>`,
      animalRingMark(piece.color, shape),
      `</svg>`,
    ].join('');
  }
  const inner = opts.shrouded
    ? glyphMark('?', colorHex)
    : cjkGlyphMark(xiangqiGlyph(set, piece.color, piece.role), colorHex);
  return [open, shadow, xiangqiGlyphFrameMarks(colorHex, shape, baseFill), inner, `</svg>`].join(
    '',
  );
}

/**
 * The character sets' double ring in the 100-unit box: the outer ring on the
 * edge (r 46, 2.5 wide) and a thin inner ring (r 38) the character sits inside.
 * On the square grid both become rounded squares of the same half-widths; the
 * inner corner (rx 9) is the one Brian reviewed on 2026-10-15.
 */
export function xiangqiGlyphFrameMarks(
  stroke: string,
  shape: XiangqiPieceShape = 'disc',
  fill = '#f3e6c4',
): string {
  const inner =
    shape === 'square'
      ? `<rect x="12" y="12" width="76" height="76" rx="9" fill="none" stroke="${stroke}" stroke-width="1.5"/>`
      : `<circle cx="50" cy="50" r="38" fill="none" stroke="${stroke}" stroke-width="1.5"/>`;
  return (
    xiangqiPieceFrameOutline(
      shape,
      PIECE_EDGE,
      `fill="${fill}" stroke="${stroke}" stroke-width="2.5"`,
    ) + inner
  );
}

// PIECE SHADOW (2026-10-08). One soft shadow under every disc piece, on every
// xiangqi-family board, so the sets stop disagreeing (three different CSS
// drop-shadows before this, and none at all on Duck and the replay board).
// Drawn as four stacked, offset circles of low opacity rather than a CSS
// `filter: drop-shadow`: a filter is an offscreen surface and a blur per piece,
// about 32 of them per board, and the stack is a few static shapes with a
// feathered edge. Nothing animates. The "Piece shadow" switch in the gear's Board
// panel turns it on and off (root data-xiangqi-piece-shadow, stamped by theme.ts);
// every board re-renders on an appearance change, and app-base.css hides a shadow
// a board drew before the switch flipped. Off by default since 2026-10-14 (the new
// piece look: Brian could barely tell the shadowed and flat pieces apart).
export const XIANGQI_PIECE_SHADOW = {
  /** Downward offset, in the 100-unit piece box. */
  dy: 3.5,
  /** Radii of the stacked circles relative to the disc's outer edge. */
  spread: [2, 1, 0, -1] as readonly number[],
  /** Fill opacity of each circle; four of them stack to about 0.22 under the disc. */
  opacity: 0.06,
  color: '#231b12',
} as const;

/** Whether the reader's "Piece shadow" switch is on. Off wherever there is no
 *  document (tests, server-side renders) and until theme.ts stamps the root 'on'. */
export function xiangqiPieceShadowEnabled(): boolean {
  return (
    typeof document !== 'undefined' && document.documentElement.dataset.xiangqiPieceShadow === 'on'
  );
}

/** The shadow under a disc of outer radius `radius` centred on (cx, cy), in
 *  units where the piece box is `box` wide (100 for the piece box itself). A
 *  square piece gets rounded squares of the same half-widths. */
export function xiangqiPieceShadowMarks(
  radius: number,
  cx = 50,
  cy = 50,
  box = 100,
  shape: XiangqiPieceShape = 'disc',
): string {
  const k = box / 100;
  const { dy, spread, opacity, color } = XIANGQI_PIECE_SHADOW;
  // One translate on the group instead of cx/cy on every circle: an article
  // diagram draws this under every piece, and its markup budget is per board.
  const layers = spread
    .map((s) => {
      const half = frameValue(radius + s * k);
      if (shape === 'disc') return `<circle r="${half}"/>`;
      return `<rect x="${-half}" y="${-half}" width="${frameValue(2 * half)}" height="${frameValue(2 * half)}" rx="${frameValue(half * SQUARE_CORNER_PER_HALF)}"/>`;
    })
    .join('');
  return `<g class="xq-piece-shadow" fill="${color}" fill-opacity="${opacity}" transform="translate(${frameValue(cx)} ${frameValue(cy + dy * k)})">${layers}</g>`;
}

/** The shadow a piece of this set draws under its disc in the 100-unit box, or
 *  '' when the switch is off. For callers that draw a disc of their own in a
 *  set's style (the Fortress Treasure); give the <svg> that holds it
 *  overflow="visible", as renderXiangqiPieceGlyphed does. */
export function xiangqiPieceDiscShadow(
  set: XiangqiPieceSet,
  opts: Pick<XiangqiPieceRenderOptions, 'shrouded' | 'shroudedStyle' | 'shadow' | 'shape'> = {},
): string {
  if (!(opts.shadow ?? xiangqiPieceShadowEnabled())) return '';
  return xiangqiPieceShadowMarks(
    xiangqiPieceOuterRadius(set, opts),
    50,
    50,
    100,
    frameShape(set, opts.shape),
  );
}

/** The outer radius (half-width, for a square) of the outline a set draws,
 *  stroke included, in the 100-unit box. */
export function xiangqiPieceOuterRadius(
  set: XiangqiPieceSet,
  opts: Pick<XiangqiPieceRenderOptions, 'shrouded' | 'shroudedStyle'> = {},
): number {
  // The asset files are normalised to a radius-45 disc (see ASSET_SETS).
  if (isAssetPieceSet(set)) return 45;
  // pieceBackMark: r 46 with a 3-unit stroke.
  if (opts.shrouded && opts.shroudedStyle === 'back') return PIECE_EDGE + BACK_STROKE / 2;
  // internationalDiscMark, animalDiscMark + animalRingMark: r 46 with a 2.8 ring.
  if (set === 'international' || isAnimalPieceSet(set)) return PIECE_EDGE + IMAGE_RING / 2;
  // The drawn glyph disc: r 46 with a 2.5 stroke.
  return 47.25;
}

// Chinese piece characters draw from baked Noto Sans CJK SC Bold outlines (the
// same XIANGQI_GLYPH_PATHS the OG cards and variant mini-boards use) so every
// surface renders one identical glyph and never depends on the viewer's system
// serif. Falls back to <text> for any character with no baked path (Western
// Latin initials, the '?' shroud mark) — those are font-agnostic anyway.
export function cjkGlyphMark(glyph: string, colorHex: string): string {
  const path = XIANGQI_GLYPH_PATHS[glyph];
  if (!path) return glyphMark(glyph, colorHex);
  // The path is pre-positioned for the 100-unit piece box (font-size 46,
  // centered on 50,50) — identical geometry to glyphMark — so it drops in flat.
  return `<path d="${path}" fill="${colorHex}"/>`;
}

function glyphMark(glyph: string, colorHex: string): string {
  return `<text x="50" y="50" font-family="serif" font-size="46" font-weight="700" fill="${colorHex}" text-anchor="middle" dominant-baseline="central">${glyph}</text>`;
}

// Every image-set piece and every face-down back ends at the same edge: the
// outline's centre line at 46 in the 100-unit box, so a face-down tile is the
// size of the face-up piece beside it (2026-10-14; the back was r 43).
const PIECE_EDGE = 46;
/** The image sets' ring (international and Dobutsu alike). */
const IMAGE_RING = 2.8;
const BACK_STROKE = 3;

function pieceBackMark(color: XiangqiColor, shape: XiangqiPieceShape = 'disc'): string {
  const fill = color === 'red' ? '#a95f4a' : '#2f7d62';
  const stroke = color === 'red' ? '#6f342c' : '#174536';
  return xiangqiPieceFrameOutline(
    shape,
    PIECE_EDGE,
    `class="xq-piece-back-mark" fill="${fill}" stroke="${stroke}" stroke-width="${BACK_STROKE}"`,
  );
}

// The Dobutsu piece is drawn as the international one is (2026-10-14): cream to
// the ring and the ring on the outer edge, nothing outside it. It used to fill
// cream to r 48.5 with the ring inset at r 45, which left a pale band outside
// the outline.
function animalDiscMark(shape: XiangqiPieceShape = 'disc'): string {
  return xiangqiPieceFrameOutline(shape, PIECE_EDGE, 'fill="#fff2cf"');
}

// One dark ring on both sides, as the international set (Brian, 2026-10-14): the
// animal art is filled red or slate by side, so the ring need not say it again.
export const ANIMAL_RING_STROKE = '#283a47';

function animalRingMark(_color: XiangqiColor, shape: XiangqiPieceShape = 'disc'): string {
  return animalRingOutline(ANIMAL_RING_STROKE, shape);
}

function animalRingOutline(stroke: string, shape: XiangqiPieceShape): string {
  return xiangqiPieceFrameOutline(
    shape,
    PIECE_EDGE,
    `fill="none" stroke="${stroke}" stroke-width="${IMAGE_RING}"`,
  );
}

// One dark ring on both sides (Brian, 2026-10-14): the art carries the colour, so
// red wears black's ring on every board, lines or grid.
export const INTERNATIONAL_RING_STROKE = '#202427';

function internationalDiscMark(_color: XiangqiColor, shape: XiangqiPieceShape = 'disc'): string {
  return xiangqiPieceFrameOutline(
    shape,
    PIECE_EDGE,
    `fill="#fef0d7" stroke="${INTERNATIONAL_RING_STROKE}" stroke-width="${IMAGE_RING}"`,
  );
}

type InternationalArtRole = XiangqiPieceRole | 'treasure';
type InternationalImageFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const INTERNATIONAL_IMAGE_FRAMES: Record<InternationalArtRole, InternationalImageFrame> = {
  general: { x: -7, y: -7, width: 114, height: 114 },
  advisor: { x: -7, y: -7, width: 114, height: 114 },
  elephant: { x: -5, y: -5, width: 110, height: 110 },
  horse: { x: -7, y: -7, width: 114, height: 114 },
  chariot: { x: -5.5, y: -7, width: 111, height: 114 },
  cannon: { x: -11, y: -11, width: 122, height: 122 },
  soldier: { x: 0, y: 0, width: 100, height: 100 },
  treasure: { x: -7, y: -7, width: 114, height: 114 },
};

// The treasure diamond is top-heavy (a wide table over a point), so centred by
// its box it reads high on the disc; it drops 2 units to sit visually centred
// (2026-09-25).
const INTERNATIONAL_DISC_Y_NUDGE: Partial<Record<InternationalArtRole, number>> = {
  treasure: 2,
};

function internationalImageMark(href: string, role: InternationalArtRole): string {
  const frame = INTERNATIONAL_IMAGE_FRAMES[role];
  const y = frame.y + (INTERNATIONAL_DISC_Y_NUDGE[role] ?? 0);
  return `<image href="${escapeAttr(href)}" x="${frame.x}" y="${y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="xMidYMid meet"/>`;
}

function frameValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function isAnimalPieceSet(set: XiangqiPieceSet): set is AnimalXiangqiPieceSet {
  return set === 'animal-dobutsu';
}

function isImagePieceSet(set: XiangqiPieceSet): set is ImageXiangqiPieceSet {
  return set === 'international' || set === 'animal-dobutsu' || isAssetPieceSet(set);
}

export function isAssetPieceSet(set: XiangqiPieceSet): set is AssetXiangqiPieceSet {
  return hasOwnKey(ASSET_SETS, set);
}

// The asset sets' files are normalised so the disc is centred with radius 45
// in the 100-unit box (scripts in the README of each folder), so one frame
// fits them all. `ink` is the set's character colour per side, used for marks
// Mistboard draws on the set's back (the fog "?", the Fortress treasure).
// `neutralBack` names the back a banqi tile may show: only a set whose red and
// black backs look alike has one, since a banqi tile must not leak its colour.
type AssetSetSpec = {
  version: number;
  ink: Record<XiangqiColor, string>;
  neutralBack: XiangqiColor | null;
};

const ASSET_SETS: Record<AssetXiangqiPieceSet, AssetSetSpec> = {
  lacquer: { version: 1, ink: { red: '#ffffff', black: '#ffffff' }, neutralBack: null },
  wood: { version: 1, ink: { red: '#ae1d04', black: '#1e1e1a' }, neutralBack: 'red' },
  book: { version: 1, ink: { red: '#ff0000', black: '#000000' }, neutralBack: null },
  brush: { version: 2, ink: { red: '#ff0000', black: '#005500' }, neutralBack: 'red' },
  clerical: { version: 2, ink: { red: '#ff0101', black: '#005500' }, neutralBack: 'red' },
};

function assetPieceHref(
  set: AssetXiangqiPieceSet,
  color: XiangqiColor,
  role: XiangqiPieceRole | 'back',
): string {
  return `/piece-sets/xiangqi/${set}/${color}-${role}.svg?v=${ASSET_SETS[set].version}`;
}

function assetImageMark(href: string): string {
  return `<image href="${escapeAttr(href)}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet"/>`;
}

/**
 * A banqi face-down tile in this set's own back art, in the 100-unit piece box,
 * or null when the set has no colour-neutral back (the caller keeps its plain
 * disc). Banqi hides the colour from both players, so a back that differs by
 * side cannot be used.
 */
export function xiangqiNeutralBackMarks(set: XiangqiPieceSet): string | null {
  if (!isAssetPieceSet(set)) return null;
  const color = ASSET_SETS[set].neutralBack;
  return color ? assetImageMark(assetPieceHref(set, color, 'back')) : null;
}

/**
 * The Fortress Xiangqi Treasure on an asset set: none of the five sources draws
 * one, so it is the set's back with 寶 in the set's ink, the same character the
 * glyph sets use.
 */
export function assetTreasureMarks(set: AssetXiangqiPieceSet, color: XiangqiColor): string {
  return [
    assetImageMark(assetPieceHref(set, color, 'back')),
    cjkGlyphMark('寶', ASSET_SETS[set].ink[color]),
  ].join('');
}

// ?v bump: the animal art files are swapped in place (stable URLs), so a version
// query is needed to bust CDN/browser caches when the art changes (e.g. the v2
// dobutsu-minimal swap). Bump on every animal-art change.
const ANIMAL_ART_VERSION = 4;
// 16 (2026-10-14): the figures rebuilt from the Chess-style art, grown to radius
// 43, ivory tusks and advisor neck band, cannon turned 15 degrees.
const INTERNATIONAL_ART_VERSION = 16;

// On the square grid the cannon has a figure of its own (international-grid/):
// turned 17 degrees and 6% bigger, so it clears the square's inner edge. Every
// other role uses the same art on both boards.
function internationalPieceHref(
  piece: XiangqiPiece,
  crossed = false,
  shape: XiangqiPieceShape = 'disc',
): string {
  const role = crossed && piece.role === 'soldier' ? 'crossed-soldier' : piece.role;
  const dir = shape === 'square' && role === 'cannon' ? 'international-grid' : 'international';
  return `/piece-sets/xiangqi/${dir}/${piece.color}-${role}.png?v=${INTERNATIONAL_ART_VERSION}`;
}

export function internationalTreasureHref(color: XiangqiColor): string {
  return `/piece-sets/xiangqi/international/${color}-treasure.png?v=${INTERNATIONAL_ART_VERSION}`;
}

function animalPieceHref(piece: XiangqiPiece, set: AnimalXiangqiPieceSet): string {
  return `/piece-sets/xiangqi/${set}/${piece.color}-${piece.role}.png?v=${ANIMAL_ART_VERSION}`;
}

// The Fortress Xiangqi Treasure is not a XiangqiPieceRole, but its Dobutsu art
// (the peacock) ships in the same set directory; the fortress renderer builds
// its href here so the cache-bust version stays in one place.
export function animalTreasureHref(color: XiangqiColor): string {
  return `/piece-sets/xiangqi/animal-dobutsu/${color}-treasure.png?v=${ANIMAL_ART_VERSION}`;
}

// The Treasure's Dobutsu disc (cream fill + peacock art + colored ring), authored
// in the 100-unit piece box like every other animal disc so the full board and
// the mini-boards render it identically. Treasure is not a XiangqiPieceRole, so
// it can't go through renderXiangqiPieceGlyphed; this is the shared source.
export function animalTreasureMarks(
  color: XiangqiColor,
  shape: XiangqiPieceShape = 'disc',
): string {
  return [
    animalDiscMark(shape),
    `<image href="${animalTreasureHref(color)}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet"/>`,
    animalRingMark(color, shape),
  ].join('');
}

// The Duck Xiangqi duck, wired like the Treasure rather than like a role: it is
// not a XiangqiPieceRole, so it needs its own href and its own marks.
//
// It takes NO COLOR, which is the whole point. Every other disc on this board
// declares its seat through `animalRingMark(color)`, and the duck belongs to
// neither seat: it is shared, it is uncapturable, and both players move it. So
// it gets the same cream disc and the same ring geometry with a NEUTRAL ink, and
// says "no seat" inside the board's own grammar rather than by opting out of it.
//
// Drawing it as a bare cutout was the first call and was reversed: kernel rule
// D1 makes the duck an ordinary blocker (it screens cannons, blocks the horse's
// leg and the elephant's eye), so drawing it as furniture would contradict a
// decision made deliberately elsewhere.
//
// Art provenance and the palette reasoning live in the physical-set repo at
// duck-xiangqi-dobutsu-minimal/MANIFEST.md. Only the Dobutsu set has duck art;
// the other six sets fall back to the neutral token in duck-xiangqi-board.ts.
// Duck Xiangqi's own accent from the variant registry. It replaced a neutral
// grey on 2026-09-11: grey said "no seat" by being absent, gold says it by
// being a colour that belongs to neither side, and it reads as deliberate
// rather than as a missing ring at board size.
const DUCK_RING = '#b8860b';

export function animalDuckHref(): string {
  return `/piece-sets/xiangqi/animal-dobutsu/duck.png?v=${ANIMAL_ART_VERSION}`;
}

// ONE drawing, every set. The seven sets are seven ways of writing the same
// seven ROLES, and a role is an idea that each idiom renders in its own hand: a
// horse is 馬, a knight figurine, a cartoon horse. The duck is not a role and has
// no cast to join. It is a single object that Duck Chess put on the board, and
// it looks like itself in every idiom, the way a football looks like a football
// whoever is drawing the players.
//
// What DOES change per set is the FRAME. Each set has its own disc grammar and
// the duck keeps it, so it sits in the board's furniture correctly: the Dobutsu
// cream disc, the international disc (each a rounded square on the square grid),
// and the glyph sets' disc. The ring ink is the variant's own gold in all of them, because
// the board needs a way to say "no seat" and the duck has none.
//
// SIZING. The master carries 15.7% padding on every side: the duck fills 79.6%
// of its own PNG, and it is taller than it is wide, so the drawn art's radius
// is 0.398 * box. A box of 100 therefore draws a duck of radius 39.8, NOT 50,
// which is why the boxes below can exceed the glyph height they replace.
//
// Each box is derived from its own disc's INNERMOST edge, never from the outer
// one. That rule is the whole reason the glyph value used to be 74: it was
// clearing an inner ring at r=38. Dropping that ring is what let the duck grow.
const DUCK_ART_FILL = 0.796;

/** A box whose DRAWN art reaches `radius`, given the master's own padding. */
function duckBoxForRadius(radius: number): number {
  return Math.round((2 * radius) / DUCK_ART_FILL);
}

function duckImageMark(box: number): string {
  const inset = (100 - box) / 2;
  return `<image href="${animalDuckHref()}" x="${inset}" y="${inset}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet"/>`;
}

export function duckPieceMarks(set: XiangqiPieceSet, shapeAsked?: XiangqiPieceShape): string {
  const shape = frameShape(set, shapeAsked);
  if (isAnimalPieceSet(set)) {
    // 0.88 inside the disc: the set's animals run 62-70% of the square tall and
    // this master is 76.2%, so it is fitted down into the same band rather than
    // crowding the ring (physical-set MANIFEST, render scale).
    return [animalDiscMark(shape), duckImageMark(88), animalRingOutline(DUCK_RING, shape)].join('');
  }
  if (set === 'international') {
    return [
      xiangqiPieceFrameOutline(
        shape,
        PIECE_EDGE,
        `fill="#fef0d7" stroke="${DUCK_RING}" stroke-width="${IMAGE_RING}"`,
      ),
      duckImageMark(84),
    ].join('');
  }
  // The asset sets frame the duck on their own neutral back where they have one
  // (the wood sets); the lacquer and book backs are red or black, which would
  // seat the duck, so those take the glyph sets' cream disc below.
  const back = xiangqiNeutralBackMarks(set);
  if (back) return [back, duckImageMark(72)].join('');
  // The glyph sets (traditional, simplified, and the lacquer and book sets) share one
  // double-ring disc. The art has to live INSIDE the inner ring, where those
  // sets put their character: the master is ~80% content inside its own box, so
  // a 74-unit box lands ~59 units tall against the inner ring's 76 diameter,
  // which is the same visual weight as a 46pt glyph.
  return [xiangqiGlyphFrameMarks(DUCK_RING, shape), duckImageMark(74)].join('');
}

export function internationalTreasureMarks(
  color: XiangqiColor,
  shape: XiangqiPieceShape = 'disc',
): string {
  return [
    internationalDiscMark(color, shape),
    internationalImageMark(internationalTreasureHref(color), 'treasure'),
  ].join('');
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
