// The shared last-move layer for token boards (xiangqi, fog xiangqi, jieqi,
// duck xiangqi, fortress). Every one of these renderers used to emit its own
// marker geometry and inject its own style, which is how the homepage game
// viewer and the daily puzzle widget ended up drawing the same event two
// different ways. The markup and the CSS now live here; a renderer supplies only
// its own centers and piece geometry, so the marks scale with the board instead
// of being retuned per variant.
//
// The origin wash's proportions come from the standard xiangqi board (CELL 60,
// layout piece 54): it stops at the piece radius. The destination ring is a
// thin band hugging the OUTSIDE of the drawn piece's outline (Brian,
// 2026-10-15), so it is sized from the piece actually drawn, not the layout size.
import { drawMarkerOnArrival, glideSvgPiece } from './board-anim.js';
import { TOKEN_PIECE_RATIO, xiangqiPieceDrawSize } from './board-metrics.js';
import {
  type XiangqiPieceSet,
  type XiangqiPieceShape,
  xiangqiPieceFrameOutline,
  xiangqiPieceOuterRadius,
} from './xiangqi-piece-sets.js';
import './board-lastmove.css';

/** Layout piece size the canonical origin wash was tuned against (xiangqi, CELL 60). */
const CANONICAL_PIECE_SIZE = 54;
/**
 * How far the origin wash reaches: the radius of the piece that left, and no
 * further. That is what buys the daylight on a one-step move.
 *
 * Both marks used to end on half a cell, on the reasoning that the pair should
 * read as one size. Half a cell each means they are exactly TANGENT one point
 * apart, and tangent circles do not read as two marks: on a one-step move
 * (which in xiangqi is most moves) they merged into a single amber lozenge.
 * The pair is not the same size, and that is fine: they never appear
 * concentric, and the smaller mark being the one the piece LEFT reinforces the
 * direction the pair exists to show.
 */
const CANONICAL_ORIGIN_OUTER_EDGE = CANONICAL_PIECE_SIZE / 2;
/** Outline weight on the origin marker, in canonical units (see the CSS). */
const CANONICAL_ORIGIN_STROKE = 2;

/**
 * The box a piece is drawn in on the canonical board (62 at CELL 60): the
 * destination band's width is tuned against it and scales with the box.
 */
const CANONICAL_PIECE_BOX = xiangqiPieceDrawSize(CANONICAL_PIECE_SIZE / TOKEN_PIECE_RATIO);
/**
 * The destination band's width on the canonical board (Brian, 2026-10-15, from
 * the video prototype: 2.5 units, the band from 29.39 to 31.89 at CELL 60).
 */
export const BOARD_LASTMOVE_BAND_WIDTH = 2.5;

/**
 * The drawn piece the destination band hugs: the box it is drawn in
 * (xiangqiPieceDrawSize, NOT the layout size the origin wash is tuned on) and
 * the outer radius of its outline, stroke included, in its 100-unit box
 * (xiangqiPieceOuterRadius: 47.4 for the international and Dobutsu sets, 47.25
 * for the character discs, 45 for the asset discs).
 */
export type BoardLastMovePiece = {
  box: number;
  outer: number;
  /** How far the drawn disc sits above its anchor: a 3D piece raises its disc
   *  by half its rim, and its mark is that rim in gold (boardLastMoveEdgeSvg). */
  lift?: number;
};

/** The piece a set draws face up in a box of this size. */
export function boardLastMovePiece(box: number, set: XiangqiPieceSet): BoardLastMovePiece {
  return { box, outer: xiangqiPieceOuterRadius(set) };
}

/**
 * The destination band for this piece: its inner edge exactly on the drawn
 * disc's outer edge, its width the canonical band scaled with the piece box.
 * `inner` and `outer` are the band's edges, `r` its centre line (a stroke is
 * centred on its circle).
 */
export function boardLastMoveBand(piece: BoardLastMovePiece): {
  inner: number;
  outer: number;
  r: number;
  width: number;
} {
  const inner = (piece.box * piece.outer) / 100;
  const width = (BOARD_LASTMOVE_BAND_WIDTH * piece.box) / CANONICAL_PIECE_BOX;
  return {
    inner: round2(inner),
    outer: round2(inner + width),
    r: round2(inner + width / 2),
    width: round2(width),
  };
}

/**
 * What `drawMarkerOnArrival` targets. `-to` is the square-grid layout's
 * destination rect and `-piece-ring` its ring on the moved piece, `-ring` the
 * intersection layout's band (which glides with the piece instead of fading:
 * animateBoardLastMoveArrival), and `.banqi-lastmove-to` banqi's cell tint (it
 * draws its own marks -- see the geometry note in live-banqi-render.ts -- but
 * shares the arrival fade). The square grid matches two elements, so a caller
 * fades every match (querySelectorAll), not just the first.
 */
export const BOARD_LASTMOVE_MARKER_SELECTOR =
  '.xq-live-lastmove-to, .xq-live-lastmove-piece-ring, .xq-live-lastmove-ring, .banqi-lastmove-to';

export type BoardPoint = { x: number; y: number };

/**
 * The `--board-lastmove-origin-stroke` declaration a renderer puts on its board
 * root so the origin wash's outline reads at the same weight as every other
 * board. Boards whose cell is larger than xiangqi's need a proportionally
 * thicker stroke to render the same picture, so this is an attribute rather than
 * a static rule. Returns '' at the canonical size (the CSS default already
 * matches), which keeps the xiangqi board's markup untouched. The destination
 * band carries its own stroke-width (see boardLastMoveMarkersSvg).
 */
export function boardLastMoveStyleAttr(pieceSize: number): string {
  if (pieceSize === CANONICAL_PIECE_SIZE) return '';
  const origin = round2(CANONICAL_ORIGIN_STROKE * (pieceSize / CANONICAL_PIECE_SIZE));
  return ` style="--board-lastmove-origin-stroke:${origin}"`;
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
 * The outermost radius any shared mark reaches: the destination band's outer
 * edge, or the origin wash's if a board ever made that the larger. Callers use
 * it to size a box that has to contain the marks.
 */
export function boardLastMoveOuterRadius(pieceSize: number, piece: BoardLastMovePiece): number {
  const origin = CANONICAL_ORIGIN_OUTER_EDGE * (pieceSize / CANONICAL_PIECE_SIZE);
  return round2(Math.max(origin, boardLastMoveBand(piece).outer));
}

/**
 * Which marks to emit. The intersection marks both draw UNDER the pieces
 * (2026-10-15): the origin wash marks an empty point and must stay under
 * whatever lands there next, and the destination band hugs the outside of the
 * piece's outline, so the piece covers none of it, while a neighbour one point
 * away (whose disc reaches 1.28 canonical units into the band) still paints
 * its own outline over it. From 2026-10-14 to 10-15 the halo drew above the
 * pieces at r 28 and crossed the piece's dark edge; the band replaced it.
 * 'over' is kept for the square-grid layout's piece ring, which still draws
 * over the pieces (boardLastMoveCellMarksSvg); on the intersection layout it
 * emits nothing. 'both' is the single-layer markup for a board that has not
 * been split.
 */
export type BoardLastMoveLayer = 'under' | 'over' | 'both';

/**
 * Attributes for the group a board draws the 'over' layer in: after the piece
 * layer and before the click layer, and never a hit target.
 */
export const BOARD_LASTMOVE_OVER_GROUP_ATTRS =
  'class="xq-live-lastmove-over" aria-hidden="true" pointer-events="none"';

/**
 * Origin disc + destination band for one move. Either endpoint may be null: a
 * drop has no origin, and a fog board passes only the endpoints the viewer can
 * actually see. `pieceSize` is the layout size the origin wash is tuned on;
 * `piece` the drawn piece the band hugs. Returns '' when there is nothing to
 * mark.
 */
export function boardLastMoveMarkersSvg(
  endpoints: { from?: BoardPoint | null; to?: BoardPoint | null },
  pieceSize: number,
  layer: BoardLastMoveLayer,
  piece: BoardLastMovePiece,
): string {
  // A raised (3D) piece's mark is its gold edge, over the pieces
  // (boardLastMoveEdgeSvg); a flat one's band goes under.
  const lift = piece.lift ?? 0;
  if (layer === 'over' && !lift) return '';
  const scale = pieceSize / CANONICAL_PIECE_SIZE;
  // A stroke is centred on its circle, so a mark's centre line sits half its
  // own stroke inside the edge it is meant to reach. Get this wrong and the
  // outline, not the fill, is what collides with the neighbouring mark.
  const originRadius = round2((CANONICAL_ORIGIN_OUTER_EDGE - CANONICAL_ORIGIN_STROKE / 2) * scale);
  const parts: string[] = [];
  if (endpoints.from && layer !== 'over') {
    parts.push(
      `<circle class="xq-live-lastmove-cell xq-live-lastmove-from" cx="${endpoints.from.x}" cy="${endpoints.from.y}" r="${originRadius}"/>`,
    );
  }
  if (endpoints.to && lift && layer !== 'under') {
    parts.push(boardLastMoveEdgeSvg(endpoints.to, boardLastMoveBand(piece).inner, lift));
  } else if (endpoints.to && !lift) {
    const band = boardLastMoveBand(piece);
    parts.push(
      `<circle class="xq-live-lastmove-ring" cx="${endpoints.to.x}" cy="${endpoints.to.y}" r="${band.r}" stroke-width="${band.width}"/>`,
    );
  }
  return parts.join('');
}

/**
 * A raised (3D) piece's destination mark: its edge, the wall showing below the
 * face, painted gold (Brian, 2026-10-29, picked over a band on the rim, which
 * "sits a little bit on the edge of the disk" and made it harder to read as
 * one). Down both sides from the face's centre line, round the base, back up
 * under the face. `data-cx`/`data-cy` name the point the piece stands on, so the
 * mark glides with the piece (animateBoardLastMoveArrival) instead of fading in
 * after it lands.
 */
function boardLastMoveEdgeSvg(to: BoardPoint, radius: number, lift: number): string {
  const r = round2(radius);
  const left = round2(to.x - r);
  const right = round2(to.x + r);
  const top = round2(to.y - lift);
  const base = round2(to.y + lift);
  const d = `M${left} ${top}V${base}A${r} ${r} 0 0 0 ${right} ${base}V${top}A${r} ${r} 0 0 1 ${left} ${top}Z`;
  return `<path class="xq-live-lastmove-ring xq-live-lastmove-edge" d="${d}" data-cx="${to.x}" data-cy="${to.y}"/>`;
}

/**
 * Start a move's last-move marks with the glide that brings the piece in, after
 * the board has been re-rendered at the final position. The intersection band
 * rides on the piece: it takes the piece's own translate (the same offset,
 * duration and easing glideSvgPiece gives the slot) at full opacity, so it
 * never sits on the destination while the piece is still travelling, and it is
 * already in place when the piece lands. A band that is not centred on `to`
 * (a board whose marks belong to another move) and every other destination mark
 * (the square grid's tint and piece ring, banqi's tint) keep the fade-in on
 * arrival. `from` and `to` are the glide's start and end centres in viewBox
 * units. A reverse step (stepping back) should not call this.
 */
export function animateBoardLastMoveArrival(
  root: ParentNode,
  from: BoardPoint,
  to: BoardPoint,
  durationMs: number,
): void {
  for (const marker of root.querySelectorAll(BOARD_LASTMOVE_MARKER_SELECTOR)) {
    if (marker.classList.contains('xq-live-lastmove-ring') && centredOn(marker, to)) {
      glideSvgPiece(marker, from.x - to.x, from.y - to.y, durationMs);
    } else {
      drawMarkerOnArrival(marker, durationMs);
    }
  }
}

/** The gold edge a 3D piece standing on `at` carries, if it is the last move's. */
export function boardLastMoveEdgeOn(root: ParentNode, at: BoardPoint): Element | null {
  for (const edge of root.querySelectorAll('.xq-live-lastmove-edge')) {
    if (centredOn(edge, at)) return edge;
  }
  return null;
}

function centredOn(el: Element, p: BoardPoint): boolean {
  // A 3D piece's edge is a path; it names the point it stands on.
  const cx = Number(el.getAttribute('data-cx') ?? el.getAttribute('cx'));
  const cy = Number(el.getAttribute('data-cy') ?? el.getAttribute('cy'));
  return Math.abs(cx - p.x) < 0.01 && Math.abs(cy - p.y) < 0.01;
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
 * layout keeps the wash and band above.
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
 * intersection origin wash is tuned on) and the outline the set draws there: the
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
