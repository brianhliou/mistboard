// Selectable piece sets for the xiangqi family.
//
// Covers all seven xiangqi roles (general/advisor/elephant/horse/chariot/cannon/
// soldier) so the same sets serve every xiangqi-family surface. Image sets are the international default and the
// Dobutsu animal set. The Chess-style prototype reuses the international art
// without its surrounding disc, and 'Animal (no disc)' does the same for the
// Dobutsu heads; glyph sets cover traditional/simplified Hanzi. The asset sets
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
  | 'international-flat'
  | 'animal-dobutsu'
  | 'animal-flat'
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
  {
    id: 'international-flat',
    label: 'Chess-style',
    labelKey: 'prefs.xqPieceSet.international-flat',
  },
  { id: 'animal-dobutsu', label: 'Animal Dobutsu', labelKey: 'prefs.xqPieceSet.animal-dobutsu' },
  { id: 'animal-flat', label: 'Animal (no disc)', labelKey: 'prefs.xqPieceSet.animal-flat' },
  { id: 'traditional', label: 'Traditional', labelKey: 'prefs.xqPieceSet.traditional' },
  { id: 'simplified', label: 'Simplified', labelKey: 'prefs.xqPieceSet.simplified' },
  { id: 'lacquer', label: 'Lacquer', labelKey: 'prefs.xqPieceSet.lacquer' },
  { id: 'wood', label: 'Wood', labelKey: 'prefs.xqPieceSet.wood' },
  { id: 'book', label: 'Book', labelKey: 'prefs.xqPieceSet.book' },
  { id: 'brush', label: 'Brush', labelKey: 'prefs.xqPieceSet.brush' },
  { id: 'clerical', label: 'Clerical', labelKey: 'prefs.xqPieceSet.clerical' },
];

// Sets that were offered once and removed (2026-10-08: the Latin-initial and
// line-icon diagram sets). A stored pick of one reads as "no pick", so the
// browser follows the default inference again.
export const RETIRED_XIANGQI_PIECE_SETS: ReadonlySet<string> = new Set(['western', 'symbols']);

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
  | Extract<
      XiangqiPieceSet,
      'animal-dobutsu' | 'animal-flat' | 'international' | 'international-flat'
    >
  | AssetXiangqiPieceSet;
type AnimalXiangqiPieceSet = Extract<XiangqiPieceSet, 'animal-dobutsu'>;

export type XiangqiPieceTilePreview =
  | { kind: 'text'; text: string }
  | { kind: 'svg'; markup: string };

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

export function xiangqiPieceTilePreview(set: XiangqiPieceSet): XiangqiPieceTilePreview {
  if (isImagePieceSet(set)) {
    return {
      kind: 'svg',
      markup: renderXiangqiPieceGlyphed({ color: 'red', role: 'general' }, set),
    };
  }
  return { kind: 'text', text: xiangqiPreviewGlyph(set) };
}

export function renderXiangqiPieceGlyphed(
  piece: XiangqiPiece,
  set: XiangqiPieceSet,
  opts: XiangqiPieceRenderOptions = {},
): string {
  const colorHex = piece.color === 'red' ? '#b91c1c' : '#1f2937';
  const baseFill = '#f3e6c4';
  const ringWidth = 2.5;
  const ariaLabel =
    opts.ariaLabel ??
    (opts.shrouded ? `${piece.color} hidden piece` : `${piece.color} ${piece.role}`);
  // The disc-less animal heads carry a class of their own so the lined board can
  // outline them (live-xiangqi.css): with no disc, the grid lines run straight
  // into the head and it stops reading as a piece standing on the point.
  const className =
    set === 'animal-flat' && !opts.shrouded
      ? [opts.className, 'xq-piece--bare-animal'].filter(Boolean).join(' ')
      : opts.className;
  const classAttr = className ? ` class="${escapeAttr(className)}"` : '';
  const styleAttr = set === 'international-flat' && !opts.shrouded ? ' style="filter:none"' : '';
  const posAttrs =
    opts.size !== undefined || opts.x !== undefined || opts.y !== undefined
      ? ` x="${opts.x ?? 0}" y="${opts.y ?? 0}" width="${opts.size ?? 100}" height="${opts.size ?? 100}"`
      : '';
  if (isAssetPieceSet(set)) {
    const open = `<svg${classAttr}${posAttrs} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeAttr(ariaLabel)}">`;
    if (!opts.shrouded) {
      return `${open}${assetImageMark(assetPieceHref(set, piece.color, piece.role))}</svg>`;
    }
    // Face-down (jieqi, banqi diagrams) shows the set's own back; a fog "?"
    // token draws the mark over that same back in the set's ink.
    const question =
      opts.shroudedStyle === 'back' ? '' : glyphMark('?', ASSET_SETS[set].ink[piece.color]);
    return `${open}${assetImageMark(assetPieceHref(set, piece.color, 'back'))}${question}</svg>`;
  }
  if (opts.shrouded && opts.shroudedStyle === 'back') {
    return [
      `<svg${classAttr}${styleAttr}${posAttrs} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeAttr(ariaLabel)}">`,
      pieceBackMark(piece.color),
      `</svg>`,
    ].join('');
  }
  // A shrouded "?" token on an image set (international / animal) draws over that
  // set's single-ring disc so the hidden token sits flush with its revealed
  // neighbours. Without these branches it falls through to the generic
  // double-ring disc below and shows an extra inner ring the image-set pieces
  // never have.
  if (opts.shrouded && (set === 'international' || set === 'international-flat')) {
    return [
      `<svg${classAttr}${styleAttr}${posAttrs} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeAttr(ariaLabel)}">`,
      internationalDiscMark(piece.color),
      glyphMark('?', colorHex),
      `</svg>`,
    ].join('');
  }
  // A hidden token keeps the Dobutsu disc on the disc-less set too: a lone "?"
  // with no disc would not read as a piece at all.
  if (opts.shrouded && (isAnimalPieceSet(set) || set === 'animal-flat')) {
    return [
      `<svg${classAttr}${styleAttr}${posAttrs} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeAttr(ariaLabel)}">`,
      animalDiscMark(),
      glyphMark('?', colorHex),
      animalRingMark(piece.color),
      `</svg>`,
    ].join('');
  }
  if (!opts.shrouded && set === 'international') {
    return [
      `<svg${classAttr}${styleAttr}${posAttrs} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeAttr(ariaLabel)}">`,
      internationalDiscMark(piece.color),
      internationalImageMark(internationalPieceHref(piece, opts.crossed), piece.role),
      `</svg>`,
    ].join('');
  }
  if (!opts.shrouded && set === 'international-flat') {
    return [
      `<svg${classAttr}${styleAttr}${posAttrs} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeAttr(ariaLabel)}">`,
      internationalFlatImageMark(internationalFlatPieceHref(piece, opts.crossed), piece.role),
      `</svg>`,
    ].join('');
  }
  if (!opts.shrouded && isAnimalPieceSet(set)) {
    return [
      `<svg${classAttr}${styleAttr}${posAttrs} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeAttr(ariaLabel)}">`,
      animalDiscMark(),
      `<image href="${escapeAttr(animalPieceHref(piece, set))}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet"/>`,
      animalRingMark(piece.color),
      `</svg>`,
    ].join('');
  }
  if (!opts.shrouded && set === 'animal-flat') {
    return [
      `<svg${classAttr}${styleAttr}${posAttrs} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeAttr(ariaLabel)}">`,
      animalFlatImageMark(animalPieceHref(piece, 'animal-dobutsu')),
      `</svg>`,
    ].join('');
  }
  const inner = opts.shrouded
    ? glyphMark('?', colorHex)
    : cjkGlyphMark(xiangqiGlyph(set, piece.color, piece.role), colorHex);
  return [
    `<svg${classAttr}${styleAttr}${posAttrs} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeAttr(ariaLabel)}">`,
    `<circle cx="50" cy="50" r="46" fill="${baseFill}" stroke="${colorHex}" stroke-width="${ringWidth}"/>`,
    `<circle cx="50" cy="50" r="38" fill="none" stroke="${colorHex}" stroke-width="1.5"/>`,
    inner,
    `</svg>`,
  ].join('');
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

function pieceBackMark(color: XiangqiColor): string {
  const fill = color === 'red' ? '#a95f4a' : '#2f7d62';
  const stroke = color === 'red' ? '#6f342c' : '#174536';
  return [
    `<circle class="xq-piece-back-mark" cx="50" cy="50" r="43" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`,
  ].join('');
}

function animalDiscMark(): string {
  return `<circle cx="50" cy="50" r="48.5" fill="#fff2cf"/>`;
}

function animalRingMark(color: XiangqiColor): string {
  const stroke = color === 'red' ? '#c2261e' : '#283a47';
  return `<circle cx="50" cy="50" r="45" fill="none" stroke="${stroke}" stroke-width="3.2"/>`;
}

// With no disc to fill, the heads grow 15% to carry the square, as the
// Chess-style figures do. The masters leave 16-20% padding on every side, so at
// this scale the drawing still lands inside the 100-unit box (about 11-92).
const ANIMAL_FLAT_SCALE = 1.15;

function animalFlatImageMark(href: string): string {
  const box = frameValue(100 * ANIMAL_FLAT_SCALE);
  const inset = frameValue((100 - box) / 2);
  return `<image href="${escapeAttr(href)}" x="${inset}" y="${inset}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet"/>`;
}

function internationalDiscMark(color: XiangqiColor): string {
  const stroke = color === 'red' ? '#c30d0d' : '#202427';
  return `<circle cx="50" cy="50" r="46" fill="#fef0d7" stroke="${stroke}" stroke-width="2.8"/>`;
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
// (2026-09-25). The disc set only: the Chess-style figure has its own fits.
const INTERNATIONAL_DISC_Y_NUDGE: Partial<Record<InternationalArtRole, number>> = {
  treasure: 2,
};

function internationalImageMark(href: string, role: InternationalArtRole): string {
  const frame = INTERNATIONAL_IMAGE_FRAMES[role];
  const y = frame.y + (INTERNATIONAL_DISC_Y_NUDGE[role] ?? 0);
  return `<image href="${escapeAttr(href)}" x="${frame.x}" y="${y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="xMidYMid meet"/>`;
}

const INTERNATIONAL_FLAT_IMAGE_SCALE = 1.34;
// The flat (disc-less) art is chess-style figurines whose content sits at a
// different vertical offset inside each 1024px source box, so at a uniform scale
// their flat bases land at different board-y values (measured content bottoms, as
// % down the box: general 76.2, advisor 77.0, soldier 77.2, chariot 72.6). These
// per-role yOffsets pull the general/advisor/soldier/chariot bases onto a common
// baseline (~y=90, the general's), and the chariot — the smallest figure — is
// scaled up to sit at the same visual weight as its neighbours.
const INTERNATIONAL_FLAT_IMAGE_FITS: Partial<
  Record<InternationalArtRole, { scale?: number; yOffset?: number }>
> = {
  advisor: { yOffset: -1.2 },
  chariot: { scale: 1.46, yOffset: 3.4 },
  cannon: { scale: 1.4 },
  elephant: { scale: INTERNATIONAL_FLAT_IMAGE_SCALE, yOffset: -3 },
  soldier: { yOffset: 3.6 },
};

function internationalFlatImageMark(href: string, role: InternationalArtRole): string {
  const frame = INTERNATIONAL_IMAGE_FRAMES[role];
  const fit = INTERNATIONAL_FLAT_IMAGE_FITS[role];
  const scale = fit?.scale ?? INTERNATIONAL_FLAT_IMAGE_SCALE;
  const x = frameValue(50 + (frame.x - 50) * scale);
  const y = frameValue(50 + (frame.y - 50) * scale + (fit?.yOffset ?? 0));
  const width = frameValue(frame.width * scale);
  const height = frameValue(frame.height * scale);
  return `<image href="${escapeAttr(href)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
}

function frameValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function isAnimalPieceSet(set: XiangqiPieceSet): set is AnimalXiangqiPieceSet {
  return set === 'animal-dobutsu';
}

function isImagePieceSet(set: XiangqiPieceSet): set is ImageXiangqiPieceSet {
  return (
    set === 'international' ||
    set === 'international-flat' ||
    set === 'animal-dobutsu' ||
    set === 'animal-flat' ||
    isAssetPieceSet(set)
  );
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
  brush: { version: 1, ink: { red: '#ff0000', black: '#005500' }, neutralBack: 'red' },
  clerical: { version: 1, ink: { red: '#ff0101', black: '#005500' }, neutralBack: 'red' },
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
const INTERNATIONAL_ART_VERSION = 15;
const INTERNATIONAL_FLAT_ART_VERSION = 2;

function internationalPieceHref(piece: XiangqiPiece, crossed = false): string {
  const role = crossed && piece.role === 'soldier' ? 'crossed-soldier' : piece.role;
  return `/piece-sets/xiangqi/international/${piece.color}-${role}.png?v=${INTERNATIONAL_ART_VERSION}`;
}

function internationalFlatPieceHref(piece: XiangqiPiece, crossed = false): string {
  const role = crossed && piece.role === 'soldier' ? 'crossed-soldier' : piece.role;
  return `/piece-sets/xiangqi/international-flat/${piece.color}-${role}.png?v=${INTERNATIONAL_FLAT_ART_VERSION}`;
}

export function internationalTreasureHref(color: XiangqiColor): string {
  return `/piece-sets/xiangqi/international/${color}-treasure.png?v=${INTERNATIONAL_ART_VERSION}`;
}

function internationalFlatTreasureHref(color: XiangqiColor): string {
  return `/piece-sets/xiangqi/international-flat/${color}-treasure.png?v=${INTERNATIONAL_FLAT_ART_VERSION}`;
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
export function animalTreasureMarks(color: XiangqiColor): string {
  return [
    animalDiscMark(),
    `<image href="${animalTreasureHref(color)}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet"/>`,
    animalRingMark(color),
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
// cream disc, the international disc, the flat set's bare image, and the glyph
// sets' disc. The ring ink is the variant's own gold in all of them, because
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

export function duckPieceMarks(set: XiangqiPieceSet): string {
  if (isAnimalPieceSet(set)) {
    // 0.88 inside the disc: the set's animals run 62-70% of the square tall and
    // this master is 76.2%, so it is fitted down into the same band rather than
    // crowding the ring (physical-set MANIFEST, render scale).
    return [
      animalDiscMark(),
      duckImageMark(88),
      `<circle cx="50" cy="50" r="45" fill="none" stroke="${DUCK_RING}" stroke-width="3.2"/>`,
    ].join('');
  }
  if (set === 'international') {
    return [
      `<circle cx="50" cy="50" r="46" fill="#fef0d7" stroke="${DUCK_RING}" stroke-width="2.8"/>`,
      duckImageMark(84),
    ].join('');
  }
  if (set === 'international-flat' || set === 'animal-flat') {
    // No disc in these sets, so nothing frames the figure and it carries the whole
    // square. The other flat pieces are scaled up for the same reason.
    return duckImageMark(100);
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
  return [
    `<circle cx="50" cy="50" r="46" fill="#f3e6c4" stroke="${DUCK_RING}" stroke-width="2.5"/>`,
    `<circle cx="50" cy="50" r="38" fill="none" stroke="${DUCK_RING}" stroke-width="1.5"/>`,
    duckImageMark(74),
  ].join('');
}

export function animalFlatTreasureMarks(color: XiangqiColor): string {
  return animalFlatImageMark(animalTreasureHref(color));
}

export function internationalTreasureMarks(color: XiangqiColor): string {
  return [
    internationalDiscMark(color),
    internationalImageMark(internationalTreasureHref(color), 'treasure'),
  ].join('');
}

export function internationalFlatTreasureMarks(color: XiangqiColor): string {
  return internationalFlatImageMark(internationalFlatTreasureHref(color), 'treasure');
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
