// The shared last-move layer for token boards (xiangqi, fog xiangqi, jieqi,
// mini/drop mini, fortress). Every one of these renderers used to emit its own marker geometry
// and inject its own style, which is how the homepage game viewer and the daily
// puzzle widget ended up drawing the same event two different ways. The markup
// and the CSS now live here; a renderer supplies only its own centers and piece
// size, so the marks scale with the board instead of being retuned per variant.
//
// The canonical proportions come from the standard xiangqi board (CELL 60,
// PIECE_SIZE 54): origin wash at the piece radius, destination ring in the
// 3 units of board between the piece and the cell edge, 4-unit stroke.
// Everything below is that ratio, so a board with a different cell renders the
// same picture at its own scale.
import { TOKEN_PIECE_RATIO } from './board-metrics.js';
import { type XiangqiPieceShape, xiangqiPieceFrameOutline } from './xiangqi-piece-sets.js';
import './board-lastmove.css';

/** Piece size the canonical radii/stroke were tuned against (xiangqi, CELL 60). */
const CANONICAL_PIECE_SIZE = 54;
const CANONICAL_STROKE = 4;
/**
 * How far the destination halo reaches. A piece is TOKEN_PIECE_RATIO of a cell,
 * so pieceRadius / TOKEN_PIECE_RATIO is exactly half a cell: at canonical scale
 * 30 against a 27 piece radius, using every one of the 3 units of board that
 * exist between the piece and the cell edge. The halo needed all of them while
 * it was drawn UNDER the pieces (only the part outside the piece showed), which
 * is why the clearance below is taken out of the origin mark instead. Pieces at
 * 98% of the gap left it no room at all, so it now draws over them (see
 * BoardLastMoveLayer); the radius is unchanged.
 *
 * Do not push this past half a cell. The numbers before 2026-08-27 put the
 * origin's outer edge at 32 and the ring's at 31, needing 63 units where a cell
 * gives 60, so every one-step move drew the origin wash through the halo.
 */
const CANONICAL_MARK_OUTER_EDGE = round2(CANONICAL_PIECE_SIZE / 2 / TOKEN_PIECE_RATIO);
/**
 * How far the origin wash reaches: the radius of the piece that left, and no
 * further. That is what buys the daylight on a one-step move.
 *
 * Both marks used to end on this same outer edge, on the reasoning that the
 * pair should read as one size. Half a cell each means they are exactly
 * TANGENT one point apart, and tangent circles do not read as two marks: on a
 * one-step move (which in xiangqi is most moves) they merged into a single
 * amber lozenge. tokenPieceSize also rounds, so deriving the cell back from the
 * piece overshoots at CELL 72 and the pair genuinely overlapped on fortress and
 * jieqi.
 *
 * Stopping the origin at the piece radius gives back a full 3 canonical units
 * between the two marks without taking a single unit off the halo, which is the
 * mark that has to survive being drawn under a piece. The pair is no longer the
 * same size, and that is fine: they never appear concentric, and the smaller
 * mark being the one the piece LEFT reinforces the direction the pair exists to
 * show.
 */
const CANONICAL_ORIGIN_OUTER_EDGE = CANONICAL_PIECE_SIZE / 2;
/** Outline weight on the origin marker, in canonical units (see the CSS). */
const CANONICAL_ORIGIN_STROKE = 2;

/**
 * What `drawMarkerOnArrival` targets. `-to` is the square-grid layout's
 * destination rect and `-piece-ring` its ring on the moved piece, `-ring` the
 * intersection layout's halo, and `.banqi-lastmove-to` banqi's cell tint (it
 * draws its own marks -- see the geometry note in live-banqi-render.ts -- but
 * shares the arrival fade). The square grid matches two elements, so a caller
 * fades every match (querySelectorAll), not just the first.
 */
export const BOARD_LASTMOVE_MARKER_SELECTOR =
  '.xq-live-lastmove-to, .xq-live-lastmove-piece-ring, .xq-live-lastmove-ring, .banqi-lastmove-to';

export type BoardPoint = { x: number; y: number };

/**
 * The `--board-lastmove-stroke` declaration a renderer puts on its board root so
 * the ring reads at the same weight as every other board. Boards whose cell is
 * larger than xiangqi's need a proportionally thicker stroke to render the same
 * picture, and mini takes its piece size per render, so this is an attribute
 * rather than a static rule. Returns '' at the canonical size (the CSS default
 * already matches), which keeps the xiangqi board's markup untouched.
 */
export function boardLastMoveStyleAttr(pieceSize: number): string {
  if (pieceSize === CANONICAL_PIECE_SIZE) return '';
  const scale = pieceSize / CANONICAL_PIECE_SIZE;
  const ring = round2(CANONICAL_STROKE * scale);
  const origin = round2(CANONICAL_ORIGIN_STROKE * scale);
  return ` style="--board-lastmove-stroke:${ring};--board-lastmove-origin-stroke:${origin}"`;
}

/**
 * One canonical unit at this board's scale. Lets a renderer place a mark of its
 * own just outside the shared ones (banqi's reveal ring) without copying the
 * constants above.
 */
export function boardLastMoveUnit(pieceSize: number): number {
  return round2(pieceSize / CANONICAL_PIECE_SIZE);
}

/**
 * The outermost radius any shared mark reaches (the destination halo's outer
 * stroke edge). Callers use it to size a box that has to contain the marks.
 */
export function boardLastMoveOuterRadius(pieceSize: number): number {
  return round2(CANONICAL_MARK_OUTER_EDGE * (pieceSize / CANONICAL_PIECE_SIZE));
}

/**
 * Which marks to emit. Since pieces are drawn at 98% of the point gap
 * (2026-10-14) a piece covers the destination halo almost entirely, so the
 * boards draw the halo in its own layer ABOVE the pieces: 'under' is the origin
 * wash (it marks an empty point, and must stay under whatever lands there
 * next), 'over' the destination halo. 'both' keeps the old single-layer markup
 * for a board that has not been split.
 */
export type BoardLastMoveLayer = 'under' | 'over' | 'both';

/**
 * Attributes for the group a board draws the 'over' layer in: after the piece
 * layer and before the click layer, and never a hit target.
 */
export const BOARD_LASTMOVE_OVER_GROUP_ATTRS =
  'class="xq-live-lastmove-over" aria-hidden="true" pointer-events="none"';

/**
 * Origin disc + destination halo for one move. Either endpoint may be null: a
 * drop has no origin, and a fog board passes only the endpoints the viewer can
 * actually see. Returns '' when there is nothing to mark.
 */
export function boardLastMoveMarkersSvg(
  endpoints: { from?: BoardPoint | null; to?: BoardPoint | null },
  pieceSize: number,
  layer: BoardLastMoveLayer = 'both',
): string {
  const scale = pieceSize / CANONICAL_PIECE_SIZE;
  // A stroke is centred on its circle, so a mark's centre line sits half its
  // own stroke inside the edge it is meant to reach. Get this wrong and the
  // outline, not the fill, is what collides with the neighbouring mark.
  const originRadius = round2((CANONICAL_ORIGIN_OUTER_EDGE - CANONICAL_ORIGIN_STROKE / 2) * scale);
  const ringRadius = round2((CANONICAL_MARK_OUTER_EDGE - CANONICAL_STROKE / 2) * scale);
  const parts: string[] = [];
  if (endpoints.from && layer !== 'over') {
    parts.push(
      `<circle class="xq-live-lastmove-cell xq-live-lastmove-from" cx="${endpoints.from.x}" cy="${endpoints.from.y}" r="${originRadius}"/>`,
    );
  }
  if (endpoints.to && layer !== 'under') {
    parts.push(
      `<circle class="xq-live-lastmove-ring" cx="${endpoints.to.x}" cy="${endpoints.to.y}" r="${ringRadius}"/>`,
    );
  }
  return parts.join('');
}

/**
 * The square-grid xiangqi family's last move (Brian, 2026-10-15: the C3 origin
 * fill with the D2 ring, picked from the board-sweep option tiles). Pieces on
 * the square grid are rounded squares at 98% of the cell, so the cell tints of
 * the cell boards' grammar (memory board_lastmove_two_grammars) mostly hid
 * under the piece that landed and read as nothing on the origin. The marks:
 * - origin: the whole cell, edge to edge, in solid amber at 0.65, under the
 *   pieces (it marks an empty square and must sit under whatever lands there);
 * - destination: today's soft cell tint under the piece, plus an amber ring
 *   traced on the moved piece's own outline, over the pieces.
 * Jungle, Flip Jungle and banqi keep their own cell tints; the intersection
 * layout keeps the wash and halo above.
 */
export const CELL_LASTMOVE_AMBER = '#f59e0b';
/** The origin cell's fill opacity. */
export const CELL_LASTMOVE_ORIGIN_OPACITY = 0.65;
/** The destination ring's width in the piece's 100-unit box: 1.5x the piece's own 2.8 ring. */
export const CELL_LASTMOVE_RING_WIDTH = 4.2;
/** Half-width of a piece's outline in its 100-unit box (rect 4..96 / r 46). */
const PIECE_OUTLINE_HALF = 46;

/**
 * Last-move marks for a xiangqi-family board drawn on the square grid. `piece`
 * is the box the pieces are drawn in (its side, not the layout size the
 * intersection marks are tuned on) and the outline the set draws there: the
 * asset sets keep their disc on the square grid, so the ring follows the piece
 * actually drawn. A null endpoint is left unmarked, as with the intersection
 * marks (a drop has no origin; a fog board passes only what the viewer sees).
 */
export function boardLastMoveCellMarksSvg(
  endpoints: { from?: BoardPoint | null; to?: BoardPoint | null },
  cell: number,
  layer: BoardLastMoveLayer,
  piece: { size: number; shape: XiangqiPieceShape },
): string {
  const parts: string[] = [];
  const cellRect = (p: BoardPoint, attrs: string) =>
    `<rect ${attrs} x="${round2(p.x - cell / 2)}" y="${round2(p.y - cell / 2)}" width="${cell}" height="${cell}"/>`;
  if (layer !== 'over') {
    if (endpoints.from) {
      parts.push(
        cellRect(
          endpoints.from,
          `class="xq-live-lastmove-origin xq-live-lastmove-from" fill="${CELL_LASTMOVE_AMBER}" fill-opacity="${CELL_LASTMOVE_ORIGIN_OPACITY}" pointer-events="none"`,
        ),
      );
    }
    if (endpoints.to) {
      parts.push(cellRect(endpoints.to, 'class="xq-live-lastmove-square xq-live-lastmove-to"'));
    }
  }
  if (endpoints.to && layer !== 'under') {
    const k = piece.size / 100;
    parts.push(
      xiangqiPieceFrameOutline(
        piece.shape,
        PIECE_OUTLINE_HALF * k,
        `class="xq-live-lastmove-piece-ring" fill="none" stroke="${CELL_LASTMOVE_AMBER}" stroke-width="${round2(CELL_LASTMOVE_RING_WIDTH * k)}"`,
        endpoints.to.x,
        endpoints.to.y,
      ),
    );
  }
  return parts.join('');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
