// Jungle-family look, split into the TWO axes it actually has (2026-07-26):
//
//   BOARD  'illustrated' — painted grass/water terrain + the dobutsu den/trap tiles.
//          'bare'        — flat tan land, flat water, vector den/trap marks.
//   PIECES 'animals'     — the dobutsu PNG cutouts (jungle-art.ts).
//          'characters'  — the traditional printed character + capture rank.
//
// They were one 'skin' toggle at first, which could not express the combination
// that won: animal pieces ON the bare board. Board texture and piece face are
// independent choices, so they are independent settings.
//
// DEFAULT: animals on bare. The animal faces carry the piece identity for players
// who do not read the characters (the whole point of an English-first surface),
// while the flat board drops the illustrated texture that pulled against the rest
// of the product's look.
//
// The den/trap marks come from LUCIDE — the same designer-drawn set the rest of
// the app's icons come from (see ui-icon.ts) — rather than the painted
// den.png/trap.png (which bake a grass texture into their background and patch
// oddly on a flat board) or hand-rolled shapes. House reads as the den; Crosshair
// is the trap, and happens to match the painted trap tile's silhouette.

import type { JungleColor, JunglePieceRole } from '@mistboard/game';
import { Crosshair, House, type IconNode } from 'lucide';
import {
  JUNGLE_ART,
  type JungleCueBadgeSpec,
  jungleCueBadgeSvg,
  jungleTokenSquare,
} from './jungle-art.js';

export type JungleBoardSkin = 'illustrated' | 'bare';
export type JunglePieceSkin = 'animals' | 'characters';

export const DEFAULT_JUNGLE_BOARD_SKIN: JungleBoardSkin = 'bare';
export const DEFAULT_JUNGLE_PIECE_SKIN: JunglePieceSkin = 'animals';

export function isJungleBoardSkin(value: unknown): value is JungleBoardSkin {
  return value === 'illustrated' || value === 'bare';
}

export function isJunglePieceSkin(value: unknown): value is JunglePieceSkin {
  return value === 'animals' || value === 'characters';
}

/** Traditional character per role, the face of a printed (unillustrated) set. */
const GLYPH: Record<JunglePieceRole, string> = {
  rat: '鼠',
  cat: '貓',
  dog: '狗',
  wolf: '狼',
  leopard: '豹',
  tiger: '虎',
  lion: '獅',
  elephant: '象',
};

/** Capture rank, 1 (rat) to 8 (elephant). The rat-takes-elephant exception is a
 *  rule, not a rank, so it is not encoded here. */
const RANK: Record<JunglePieceRole, number> = {
  rat: 1,
  cat: 2,
  dog: 3,
  wolf: 4,
  leopard: 5,
  tiger: 6,
  lion: 7,
  elephant: 8,
};

export function jungleRoleGlyph(role: JunglePieceRole): string {
  return GLYPH[role];
}

export function jungleRoleRank(role: JunglePieceRole): number {
  return RANK[role];
}

/** Flat terrain colours for the bare board, in the board's own warm family. */
export const JUNGLE_BARE_TERRAIN = {
  water: '#8fb9c9',
  /** Den/trap tile tints — present enough to read as special ground, quiet enough
   *  that the tokens stay the loudest thing on the board. */
  den: '#d8b06a',
  trap: '#e8d3ae',
  /** Ink for the vector den/trap marks. */
  mark: '#8a6534',
} as const;

/** How far the trap mark is softened against the den's full-strength ink.
 *  Applied as a GROUP opacity, never as a translucent stroke colour: see
 *  lucideMarkSvg. */
const TRAP_MARK_OPACITY = 0.75;

// Lucide icons are IconNode data ([tag, attrs][]) drawn on a 24-unit box with
// stroke-based geometry. The board renderers build SVG STRINGS (they also run in
// the static/OG pipeline), so serialize the node rather than using lucide's
// DOM createElement the way ui-icon.ts does.
const LUCIDE_BOX = 24;

// Softening is a GROUP opacity, not a translucent stroke colour. A Lucide icon is
// several separate stroked elements, so a translucent stroke composites once per
// element and every overlap doubles up: Crosshair's four ticks end exactly on the
// circle's centreline with round caps, and at rgba(...,0.75) those four contact
// points rendered at 0.947 ink against the circle's own 0.755 (measured). Nothing
// overlapped the circle geometrically, but four patches ~25% darker than the curve
// they sat on read as bumps pushing out of it. A group opacity flattens the icon
// first and composites the result once, so overlaps cost nothing.
function lucideMarkSvg(
  icon: IconNode,
  cx: number,
  cy: number,
  size: number,
  color: string,
  opts: { opacity?: number; strokeWidth?: number } = {},
): string {
  const { opacity, strokeWidth = 2 } = opts;
  const scale = size / LUCIDE_BOX;
  const body = icon
    .map(([tag, attrs]) => {
      const serialized = Object.entries(attrs)
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');
      return `<${tag} ${serialized}/>`;
    })
    .join('');
  const softness = opacity === undefined ? '' : ` opacity="${opacity}"`;
  return (
    `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${scale})"${softness} fill="none" ` +
    `stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    `${body}</g>`
  );
}

/** The den (the square you must reach): a tinted tile under Lucide's House. */
export function jungleBareDenSvg(x: number, y: number, cell: number): string {
  const tile = `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${JUNGLE_BARE_TERRAIN.den}"/>`;
  return (
    tile + lucideMarkSvg(House, x + cell / 2, y + cell / 2, cell * 0.52, JUNGLE_BARE_TERRAIN.mark)
  );
}

/** The trap (where any animal can be taken): a tinted tile under Lucide's Crosshair. */
export function jungleBareTrapSvg(x: number, y: number, cell: number): string {
  const tile = `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${JUNGLE_BARE_TERRAIN.trap}"/>`;
  return (
    tile +
    lucideMarkSvg(Crosshair, x + cell / 2, y + cell / 2, cell * 0.5, JUNGLE_BARE_TERRAIN.mark, {
      opacity: TRAP_MARK_OPACITY,
    })
  );
}

export type PlainTokenOptions = {
  cx: number;
  cy: number;
  /** Nominal token size — the same value the animal token is sized from. */
  size: number;
  ink: JungleColor;
  role: JunglePieceRole;
  ringStrokeRatio?: number;
  filterId?: string;
  /** PROTOTYPE: the river-ability badge. Skin-independent -- it describes the RULE,
   *  not the art -- so both token skins draw the identical mark. */
  cueBadge?: boolean;
  cueBadgeOverrides?: Partial<JungleCueBadgeSpec>;
  /** The size the river badge is drawn from; defaults to `size` (see framedTokenSvg). */
  badgeSize?: number;
};

/** The character token: the same cream rounded square + ring as the animal token,
 *  with the traditional character and its capture rank in place of the cutout.
 *  Sharing the geometry means a swap never moves a piece or breaks a last-move mark.
 *  The ring keeps the side's ink here: only the animal art carries the side colour
 *  on its own. */
export function characterTokenSvg(opts: PlainTokenOptions): string {
  const { cx, cy, size, ink, role, ringStrokeRatio, filterId, cueBadge, cueBadgeOverrides } = opts;
  const faceHalf = size * JUNGLE_ART.discRadiusRatio;
  const ringHalf = size * JUNGLE_ART.ringRadiusRatio;
  const ringW = size * (ringStrokeRatio ?? JUNGLE_ART.ringStrokeRatio);
  const inkHex = JUNGLE_ART.ink[ink];
  const open = filterId ? `<g filter="url(#${filterId})">` : '<g>';
  // The character sits slightly high so the rank numeral below it stays inside
  // the ring; both are centred on the disc as one optical block.
  return [
    open,
    jungleTokenSquare(cx, cy, faceHalf, `fill="${JUNGLE_ART.discFill}"`),
    `<text x="${cx}" y="${cy - size * 0.06}" font-family="serif" font-size="${size * 0.5}" font-weight="700" ` +
      `fill="${inkHex}" text-anchor="middle" dominant-baseline="central">${GLYPH[role]}</text>`,
    `<text x="${cx}" y="${cy + size * 0.27}" font-family="system-ui, sans-serif" font-size="${size * 0.19}" font-weight="600" ` +
      `fill="${inkHex}" fill-opacity="0.75" text-anchor="middle" dominant-baseline="central">${RANK[role]}</text>`,
    jungleTokenSquare(cx, cy, ringHalf, `fill="none" stroke="${inkHex}" stroke-width="${ringW}"`),
    `</g>`,
    cueBadge
      ? jungleCueBadgeSvg(cx, cy, opts.badgeSize ?? size, role, ink, cueBadgeOverrides ?? {})
      : '',
  ].join('');
}
