// The check mark for token boards (xiangqi, atomic, fortress, jieqi): a red halo
// around the general whose side faces the move while it is in check, lichess's
// check highlight on our boards. Drawn UNDER the pieces as a tight halo: the
// general's disc sits on it and only a thin band shows past the disc edge,
// never reaching a neighbouring piece. Static by design: play surfaces move
// only on interaction (no pulse).
//
// A renderer supplies the point's centre and its piece size; WHICH general is
// in check is the caller's call, by its variant's own rule (the game package's
// *CheckedGeneral helpers). Fog Xiangqi never passes one: its rules have no
// check, and a glow there would tell a player where a hidden attacker stands.
import type { BoardPoint } from './board-lastmove.js';
import { type XiangqiPieceSet, xiangqiPieceSetShape } from './xiangqi-piece-sets.js';
import './board-check.css';

/** How far the halo reaches, as a multiple of the piece radius: 36% past the
 *  disc edge. Was 1.18 until 2026-10-15, when the X clip drew it 1.15x larger
 *  and Brian asked for the site to match the clip. A neighbour one point away
 *  sits a full cell off, so the faded tail can pass under its disc edge
 *  (canonical: 36.72 + 27 = 63.72 against a 60 cell); the halo draws under the
 *  pieces, so that disc covers it. Was 0.85 of a cell (51 units) before
 *  2026-10-06, which spread across the neighbouring advisors and the palace
 *  lines. */
export const CHECK_HALO_REACH_PIECE_RADII = 1.36;

let gradientSeq = 0;

/**
 * The halo for one point. Each call mints its own gradient id: several boards
 * share a page (review + thumbnails), and a gradient referenced across SVGs
 * stops painting when the SVG that defines it is hidden or removed.
 */
export function boardCheckGlowSvg(center: BoardPoint, pieceSize: number): string {
  const pieceRadius = pieceSize / 2;
  const radius = round2(pieceRadius * CHECK_HALO_REACH_PIECE_RADII);
  const pieceEdge = round2((pieceRadius * 100) / radius);
  gradientSeq += 1;
  const id = `board-check-glow-${gradientSeq}`;
  return (
    `<g class="board-check" aria-hidden="true" pointer-events="none">` +
    `<defs><radialGradient id="${id}">` +
    `<stop offset="0%" class="board-check__core"/>` +
    `<stop offset="${pieceEdge}%" class="board-check__core"/>` +
    `<stop offset="100%" class="board-check__edge"/>` +
    `</radialGradient></defs>` +
    `<circle class="board-check__glow" cx="${round2(center.x)}" cy="${round2(center.y)}" r="${radius}" fill="url(#${id})"/>` +
    `</g>`
  );
}

/**
 * The check mark on the square grid: the general's whole cell in red, under the
 * piece, the way the last move tints its origin cell amber. A rounded-square
 * tile nearly fills its cell, so the disc halo only peeked out at the middle of
 * each edge (Brian, 2026-10-29). A set whose pieces stay discs keeps the halo.
 */
export function boardCheckCellSvg(
  center: BoardPoint,
  cell: number,
  set: XiangqiPieceSet,
  pieceSize: number,
): string {
  if (xiangqiPieceSetShape(set, 'square') === 'disc') return boardCheckGlowSvg(center, pieceSize);
  return (
    `<g class="board-check board-check--cell" aria-hidden="true" pointer-events="none">` +
    `<rect class="board-check__cell" x="${round2(center.x - cell / 2)}" y="${round2(center.y - cell / 2)}" width="${cell}" height="${cell}"/>` +
    `</g>`
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
