// Selectable piece sets for the xiangqi family.
//
// Covers all seven xiangqi roles (general/advisor/elephant/horse/chariot/cannon/
// soldier) so the same sets serve both Dark Mini Xiangqi (which uses five of them)
// and full Dark Xiangqi. Image sets are the international default and the
// Dobutsu animal set. The Chess-style prototype reuses the international art
// without its surrounding disc; glyph sets cover traditional/simplified Hanzi,
// Western Latin initials, and stroked line-art symbols.
// Chinese characters render from baked Noto Sans CJK SC Bold outlines (see
// cjkGlyphMark) so the live board matches the OG cards and variant mini-boards.

import { XIANGQI_GLYPH_PATHS } from '@mistboard/board-render';
import type { XiangqiColor, XiangqiPiece, XiangqiPieceRole } from '@mistboard/game';

export type XiangqiPieceSet =
  | 'international'
  | 'international-flat'
  | 'animal-dobutsu'
  | 'traditional'
  | 'simplified'
  | 'western'
  | 'symbols';
export type XiangqiShroudedStyle = 'question' | 'back';

export const XIANGQI_PIECE_SETS: ReadonlyArray<{ id: XiangqiPieceSet; label: string }> = [
  { id: 'international', label: 'International' },
  { id: 'international-flat', label: 'Chess-style' },
  { id: 'animal-dobutsu', label: 'Animal Dobutsu' },
  { id: 'traditional', label: 'Traditional' },
  { id: 'simplified', label: 'Simplified' },
  { id: 'western', label: 'Western' },
  { id: 'symbols', label: 'Symbols' },
];

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

const WESTERN: Record<XiangqiPieceRole, string> = {
  general: 'G',
  advisor: 'A',
  elephant: 'E',
  horse: 'H',
  cannon: 'C',
  chariot: 'R',
  soldier: 'S',
};

type ImageXiangqiPieceSet = Extract<
  XiangqiPieceSet,
  'animal-dobutsu' | 'international' | 'international-flat'
>;
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
  if (set === 'western') return WESTERN[role];
  if (isImagePieceSet(set)) return WESTERN[role];
  return TRADITIONAL[color][role];
}

// A compact representative mark for the settings-panel tile (the red general).
export function xiangqiPreviewGlyph(set: XiangqiPieceSet): string {
  if (set === 'symbols') return '★';
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
  const classAttr = opts.className ? ` class="${escapeAttr(opts.className)}"` : '';
  const styleAttr = set === 'international-flat' && !opts.shrouded ? ' style="filter:none"' : '';
  const posAttrs =
    opts.size !== undefined || opts.x !== undefined || opts.y !== undefined
      ? ` x="${opts.x ?? 0}" y="${opts.y ?? 0}" width="${opts.size ?? 100}" height="${opts.size ?? 100}"`
      : '';
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
  if (opts.shrouded && isAnimalPieceSet(set)) {
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
  const inner = opts.shrouded
    ? glyphMark('?', colorHex)
    : set === 'symbols'
      ? symbolMark(piece.role, colorHex)
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

function internationalImageMark(href: string, role: InternationalArtRole): string {
  const frame = INTERNATIONAL_IMAGE_FRAMES[role];
  return `<image href="${escapeAttr(href)}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="xMidYMid meet"/>`;
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
  return set === 'international' || set === 'international-flat' || set === 'animal-dobutsu';
}

// ?v bump: the animal art files are swapped in place (stable URLs), so a version
// query is needed to bust CDN/browser caches when the art changes (e.g. the v2
// dobutsu-minimal swap). Bump on every animal-art change.
const ANIMAL_ART_VERSION = 4;
const INTERNATIONAL_ART_VERSION = 12;
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
const DUCK_NEUTRAL_RING = '#6f7b83';

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
// What DOES change per set is the FRAME. Each set has its own disc grammar, and
// the duck sits in the board's furniture correctly by keeping it: the Dobutsu
// cream disc with one ring, the international disc, the flat set's bare image,
// and the double ring the glyph sets use. The ring ink is neutral in all of
// them, because that is the board's way of saying "no seat" and the duck has
// none.
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
      `<circle cx="50" cy="50" r="45" fill="none" stroke="${DUCK_NEUTRAL_RING}" stroke-width="3.2"/>`,
    ].join('');
  }
  if (set === 'international') {
    return [
      `<circle cx="50" cy="50" r="46" fill="#fef0d7" stroke="${DUCK_NEUTRAL_RING}" stroke-width="2.8"/>`,
      duckImageMark(84),
    ].join('');
  }
  if (set === 'international-flat') {
    // No disc in this set, so nothing frames the figure and it carries the whole
    // square. The other flat pieces are scaled up for the same reason.
    return duckImageMark(100);
  }
  // The glyph sets (traditional, simplified, western, symbols) share one
  // double-ring disc. The art has to live INSIDE the inner ring, where those
  // sets put their character: the master is ~80% content inside its own box, so
  // a 74-unit box lands ~59 units tall against the inner ring's 76 diameter,
  // which is the same visual weight as a 46pt glyph.
  return [
    `<circle cx="50" cy="50" r="46" fill="#f3e6c4" stroke="${DUCK_NEUTRAL_RING}" stroke-width="2.5"/>`,
    `<circle cx="50" cy="50" r="38" fill="none" stroke="${DUCK_NEUTRAL_RING}" stroke-width="1.5"/>`,
    duckImageMark(74),
  ].join('');
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

// Stroked line-art icons (the "Symbols" diagram set). One consistent visual style:
// piece-color strokes, no fill, rounded joins. Intentionally simple v1 art.
function symbolMark(role: XiangqiPieceRole, colorHex: string): string {
  const stroke = `fill="none" stroke="${colorHex}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`;
  switch (role) {
    case 'general':
      // Five-point star (commander).
      return `<path d="M50 26 L55.9 41.9 L72.8 42.6 L59.5 53.1 L64.1 69.4 L50 60 L35.9 69.4 L40.5 53.1 L27.2 42.6 L44.1 41.9 Z" ${stroke}/>`;
    case 'advisor':
      // Diamond (palace guard).
      return `<path d="M50 30 L68 51 L50 72 L32 51 Z" ${stroke}/>`;
    case 'elephant':
      // Diagonal cross (the elephant moves diagonally).
      return `<path d="M37 38 L63 64 M63 38 L37 64" ${stroke}/>`;
    case 'chariot':
      // Battlemented tower (rook/chariot).
      return [
        `<rect x="36" y="46" width="28" height="24" ${stroke}/>`,
        `<rect x="36" y="38" width="8" height="8" ${stroke}/>`,
        `<rect x="46" y="38" width="8" height="8" ${stroke}/>`,
        `<rect x="56" y="38" width="8" height="8" ${stroke}/>`,
      ].join('');
    case 'horse':
      // Open-bottom horseshoe.
      return `<path d="M36 66 A16 16 0 1 1 64 66" fill="none" stroke="${colorHex}" stroke-width="8" stroke-linecap="round"/>`;
    case 'cannon':
      // Bore ring with a centered shot (the cannon's muzzle).
      return `<circle cx="50" cy="51" r="16" ${stroke}/><circle cx="50" cy="51" r="5" fill="${colorHex}"/>`;
    case 'soldier':
      // Double advancing chevron.
      return `<path d="M36 60 L50 44 L64 60" ${stroke}/><path d="M36 70 L50 54 L64 70" ${stroke}/>`;
  }
}

// Faceted gem for the Fortress Xiangqi Treasure in the Symbols set (the Treasure
// is the objective piece). Same stroked-line-art style as symbolMark above,
// distinct from the advisor's plain diamond. Treasure is not a XiangqiPieceRole,
// so it gets its own mark rather than a symbolMark case.
export function treasureSymbolMark(colorHex: string): string {
  const stroke = `fill="none" stroke="${colorHex}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`;
  return [
    `<path d="M38 38 L62 38 L72 48 L50 72 L28 48 Z" ${stroke}/>`,
    `<path d="M28 48 L72 48 M38 38 L46 48 M62 38 L54 48 M46 48 L50 72 M54 48 L50 72" ${stroke}/>`,
  ].join('');
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
