import type { Color, PieceRole, Square } from '@mistboard/game';
import { boardCornerRadius } from './board-metrics.js';
import { PIECE_SVGS } from './pieces.js';
import { type BoardPalette, BROWN_PALETTE, FOG_TILE_SIZE, type FogStyle } from './tokens.js';

export type PieceOnBoard = { file: number; rank: number; color: Color; role: PieceRole };

const FILE_CHARS = 'abcdefgh';
const FOG_LIGHT_PATTERN_ID = 'mb-fog-light';
const FOG_DARK_PATTERN_ID = 'mb-fog-dark';

function squareToFileRank(square: Square): { file: number; rank: number } {
  const file = FILE_CHARS.indexOf(square[0]!);
  const rank = Number(square[1]) - 1;
  return { file, rank };
}

// SVG <defs> with the two fog patterns. Callers pass the boardSize so the
// pattern tile is sized in objectBoundingBox fractions: each fogged square
// instances its own pattern, restarting the stripe phase at the square's
// top-left corner. This matches chessground, which applies the linear
// gradient per-square via background-image. With patternContentUnits set
// to userSpaceOnUse, the stripes inside the pattern stay in pixel coords
// (3 px wide, 14 px tile), so the stripe density matches the CSS pattern
// regardless of board size.
export function fogPatternDefs(boardSize: number, palette: BoardPalette = BROWN_PALETTE): string {
  const t = FOG_TILE_SIZE;
  const sq = boardSize / 8;
  // Tile as a fraction of the filled square's bounding box. For a 25 px
  // square (200 px board), this is 14/25 ≈ 0.56; for a 48 px square
  // (384 px OG board), 14/48 ≈ 0.29. In either case the rendered tile
  // is 14 px in user space.
  const tileOBB = t / sq;
  return [
    `<defs>`,
    `<pattern id="${FOG_LIGHT_PATTERN_ID}" patternUnits="objectBoundingBox" patternContentUnits="userSpaceOnUse" width="${tileOBB}" height="${tileOBB}" patternTransform="rotate(45)">`,
    `<rect width="${t}" height="${t}" fill="${palette.fogLightFill}"/>`,
    `<rect width="3" height="${t}" fill="${palette.fogLine}"/>`,
    `<rect x="7" width="3" height="${t}" fill="${palette.fogLineSoft}"/>`,
    `</pattern>`,
    `<pattern id="${FOG_DARK_PATTERN_ID}" patternUnits="objectBoundingBox" patternContentUnits="userSpaceOnUse" width="${tileOBB}" height="${tileOBB}" patternTransform="rotate(45)">`,
    `<rect width="${t}" height="${t}" fill="${palette.fogDarkFill}"/>`,
    `<rect width="3" height="${t}" fill="${palette.fogLineSoft}"/>`,
    `<rect x="7" width="3" height="${t}" fill="${palette.fogLine}"/>`,
    `</pattern>`,
    `</defs>`,
  ].join('');
}

/** The inset fog line around a square, with the board's outer corner rounded
 *  when the square sits in one: a square-cornered line is cut short by the
 *  board's rounded clip, and the fog's edge stops before the curve. */
function fogEdge(
  x: number,
  y: number,
  size: number,
  corners: { tl: number; tr: number; br: number; bl: number },
): string {
  const { tl, tr, br, bl } = corners;
  const arc = (r: number, ax: number, ay: number) => (r ? `A${r} ${r} 0 0 1 ${ax} ${ay}` : '');
  return [
    `M${x + tl} ${y}H${x + size - tr}`,
    arc(tr, x + size, y + tr),
    `V${y + size - br}`,
    arc(br, x + size - br, y + size),
    `H${x + bl}`,
    arc(bl, x, y + size - bl),
    `V${y + tl}`,
    arc(tl, x + tl, y),
    'Z',
  ].join('');
}

export function renderBoardSvg(
  pieces: PieceOnBoard[],
  fogSquares: Square[],
  x: number,
  y: number,
  size: number,
  orientation: Color = 'white',
  opts: {
    palette?: BoardPalette;
    fogStyle?: FogStyle;
    // When set, the board content is clipped to a rounded rect matching the shared
    // base corner radius (--board-corner-radius, 1.9%). The id must be unique
    // within the containing <svg> document. Omit for
    // square corners (the default, used by the live draft-picker thumbnails).
    clipId?: string;
    // Corner radius in user units; defaults to the 1.9% base radius.
    cornerRadius?: number;
  } = {},
): string {
  const palette = opts.palette ?? BROWN_PALETTE;
  const fogStyle = opts.fogStyle ?? 'solid';
  const round = opts.clipId !== undefined;
  const radius = opts.cornerRadius ?? boardCornerRadius(size);
  const sq = size / 8;
  const out: string[] = [];
  const fogCoords = fogSquares.map(squareToFileRank);
  // For orientation 'white': file 0 → left, rank 0 → bottom.
  // For orientation 'black': flip both so the viewer's pieces sit at the bottom.
  const fileToCol = (file: number): number => (orientation === 'white' ? file : 7 - file);
  const rankToRow = (rank: number): number => (orientation === 'white' ? 7 - rank : rank);
  out.push(`<g>`);
  if (round) {
    out.push(
      `<clipPath id="${opts.clipId}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${radius}"/></clipPath>`,
    );
    out.push(`<g clip-path="url(#${opts.clipId})">`);
  }
  for (let f = 0; f < 8; f += 1) {
    for (let r = 0; r < 8; r += 1) {
      const isLight = (f + r) % 2 === 1;
      const sx = x + fileToCol(f) * sq;
      const sy = y + rankToRow(r) * sq;
      out.push(
        `<rect x="${sx}" y="${sy}" width="${sq}" height="${sq}" fill="${isLight ? palette.light : palette.dark}"/>`,
      );
    }
  }
  const fogSet = new Set(fogCoords.map((s) => `${s.file},${s.rank}`));
  for (const piece of pieces) {
    if (fogSet.has(`${piece.file},${piece.rank}`)) continue;
    const svg = PIECE_SVGS[`${piece.color}:${piece.role}`];
    if (!svg) continue;
    const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    const px = x + fileToCol(piece.file) * sq;
    const py = y + rankToRow(piece.rank) * sq;
    out.push(
      `<svg x="${px}" y="${py}" width="${sq}" height="${sq}" viewBox="0 0 45 45">${inner}</svg>`,
    );
  }
  for (const fog of fogCoords) {
    const fx = x + fileToCol(fog.file) * sq;
    const fy = y + rankToRow(fog.rank) * sq;
    // Square color polarity mirrors chessground's .fog-hidden.white /
    // .fog-hidden.black: light squares get the lighter fog treatment and dark
    // squares get the darker one.
    const isLight = (fog.file + fog.rank) % 2 === 1;
    const fill =
      fogStyle === 'solid'
        ? isLight
          ? palette.fogSolidLightFill
          : palette.fogSolidDarkFill
        : fogStyle === 'veil'
          ? isLight
            ? palette.fogLightFill
            : palette.fogDarkFill
          : `url(#${isLight ? FOG_LIGHT_PATTERN_ID : FOG_DARK_PATTERN_ID})`;
    out.push(`<rect x="${fx}" y="${fy}" width="${sq}" height="${sq}" fill="${fill}"/>`);
    if (fogStyle !== 'veil') {
      // Inset 1 px cream shadow matching chessground's non-veil fog styles.
      const col = fileToCol(fog.file);
      const row = rankToRow(fog.rank);
      const curve = round ? Math.max(0, radius - 0.5) : 0;
      const atCorner = curve > 0 && (col === 0 || col === 7) && (row === 0 || row === 7);
      out.push(
        atCorner
          ? `<path d="${fogEdge(fx + 0.5, fy + 0.5, sq - 1, {
              tl: col === 0 && row === 0 ? curve : 0,
              tr: col === 7 && row === 0 ? curve : 0,
              br: col === 7 && row === 7 ? curve : 0,
              bl: col === 0 && row === 7 ? curve : 0,
            })}" fill="none" stroke="${palette.fogShadow}" stroke-width="1"/>`
          : `<rect x="${fx + 0.5}" y="${fy + 0.5}" width="${sq - 1}" height="${sq - 1}" fill="none" stroke="${palette.fogShadow}" stroke-width="1"/>`,
      );
    }
  }
  if (round) out.push(`</g>`);
  out.push(`</g>`);
  return out.join('');
}
