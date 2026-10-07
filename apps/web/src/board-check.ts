// The check mark for token boards (xiangqi, atomic, fortress, jieqi): a red glow
// around the general whose side faces the move while it is in check, lichess's
// check highlight on our boards. Drawn UNDER the pieces, so the general's disc
// sits on it and the glow shows in the board around it, fading out into the
// neighbouring points. Static by design: play surfaces move only on
// interaction (no pulse).
//
// A renderer supplies the point's centre and its piece size; WHICH general is
// in check is the caller's call, by its variant's own rule (the game package's
// *CheckedGeneral helpers). Fog Xiangqi never passes one: its rules have no
// check, and a glow there would tell a player where a hidden attacker stands.
import type { BoardPoint } from './board-lastmove.js';
import { TOKEN_PIECE_RATIO } from './board-metrics.js';
import './board-check.css';

/** How far the glow reaches, in cells: past the point's own half-cell so it
 *  reads in the gaps between the general and its neighbours. */
const GLOW_REACH_CELLS = 0.85;

let gradientSeq = 0;

/**
 * The glow for one point. Each call mints its own gradient id: several boards
 * share a page (review + thumbnails), and a gradient referenced across SVGs
 * stops painting when the SVG that defines it is hidden or removed.
 */
export function boardCheckGlowSvg(center: BoardPoint, pieceSize: number): string {
  const cell = pieceSize / TOKEN_PIECE_RATIO;
  const radius = round2(cell * GLOW_REACH_CELLS);
  const pieceEdge = round2(((pieceSize / 2) * 100) / radius);
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
