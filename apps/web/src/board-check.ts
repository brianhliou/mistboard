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
import './board-check.css';

/** How far the halo reaches, as a multiple of the piece radius: 18% past the
 *  disc edge. A neighbour one point away sits a full cell off, so halo radius
 *  plus its piece radius stays under the cell and the halo never touches it
 *  (canonical: 31.86 + 27 = 58.86 < 60). Was 0.85 of a cell (51 units), which
 *  spread across the neighbouring advisors and the palace lines. */
export const CHECK_HALO_REACH_PIECE_RADII = 1.18;

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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
