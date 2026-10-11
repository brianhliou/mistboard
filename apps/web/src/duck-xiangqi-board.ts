/**
 * Duck Xiangqi live board.
 *
 * Composed from the standard xiangqi board's own pure modules — the same
 * geometry, the same surface config, the same piece renderer — rather than
 * copied from `xiangqi-board.ts`. Only what differs lives here: the duck, and
 * the fact that a turn takes TWO clicks.
 *
 * Two deliberate differences from `xiangqiBoardSvg`:
 *
 *  1. **Targets are passed in, not derived.** The standard board reads
 *     `view.legalMoves` and filters by the selected square. That cannot work
 *     here, because phase two's targets are duck destinations, which come from
 *     a different kernel call. Fortress Xiangqi already solved this the same
 *     way (it has board moves and drop targets), so this follows a shape the
 *     codebase has proven rather than inventing one.
 *  2. **The duck is not a piece.** It is drawn on its own layer above the
 *     pieces, and `renderXiangqiPiece` is deliberately not extended to know
 *     about it — the duck belongs to nobody and has no role.
 */

import type { DuckXiangqiPlayerView, DuckXiangqiSquare, DuckXiangqiTurn } from '@mistboard/game';
import {
  readStoredXiangqiBoardLayout,
  readStoredXiangqiPieceSet,
  type XiangqiBoardLayout,
} from './xiangqi-appearance-storage.js';
import {
  LIVE_BOARD_GEO,
  LIVE_BOARD_SURFACE,
  XIANGQI_LIVE_PIECE_SIZE,
  type XiangqiBoardArrow,
  type XiangqiBoardMarker,
  xiangqiArrowSvg,
  xiangqiMarkerSvg,
  xiangqiPieceGhostSvg,
} from './xiangqi-board.js';
import { xiangqiBoardPoint, xiangqiBoardViewBox } from './xiangqi-board-geometry.js';
import {
  xiangqiSurfaceGrid,
  xiangqiSurfacePalace,
  xiangqiSurfacePalaceBands,
  xiangqiSurfaceRiver,
  xiangqiSurfaceStartMarkers,
} from './xiangqi-board-surface.js';
import { drawsCrossedSoldier } from './xiangqi-crossed-soldier.js';
import { duckPieceMarks, type XiangqiPieceSet } from './xiangqi-piece-sets.js';

// This board draws no coordinate labels, so it must not reserve their gutter -
// the standard board swaps the same way when labels are off. Leaving it in put
// a band of dead space around the grid.
const DUCK_SURFACE = {
  ...LIVE_BOARD_SURFACE,
  geo: { ...LIVE_BOARD_SURFACE.geo, coordGutter: 0 },
};

import { boardLastMoveMarkersSvg } from './board-lastmove.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import { renderXiangqiPiece } from './xiangqi-pieces.js';

type Color = 'red' | 'black';

/**
 * Which half of a turn the board is collecting.
 *
 * `piece` — waiting for a piece move. `duck` — the piece move is chosen and
 * shown optimistically; waiting for a duck placement. Nothing is sent to the
 * server until the second one lands.
 */
export type DuckXiangqiBoardPhase =
  | { kind: 'piece'; selected: DuckXiangqiSquare | null }
  | { kind: 'duck'; move: { from: DuckXiangqiSquare; to: DuckXiangqiSquare } };

export type DuckXiangqiBoardState = {
  interactive: boolean;
  phase: DuckXiangqiBoardPhase;
  /** Legal destinations for the CURRENT phase. The caller computes these. */
  targets: readonly DuckXiangqiSquare[];
  layout?: XiangqiBoardLayout;
  // Named directly rather than inferred off `renderXiangqiPiece`'s options. The
  // clever conditional this replaces collapsed to `undefined`, so the field was
  // impossible to pass and the board could only ever use the stored preference.
  pieceSet?: XiangqiPieceSet;
  /** Right-click arrows and circles, from the shared board-annotation store. */
  arrows?: readonly XiangqiBoardArrow[];
  markers?: readonly XiangqiBoardMarker[];
  /**
   * True on the one render where the duck has just landed on a new point, so it
   * plays its landing once. The CALLER decides (the live room tracks the last
   * square it drew); the board keeps no memory between renders, because replay,
   * review and postgame boards share this renderer and must never animate.
   */
  duckLanded?: boolean;
  /**
   * The point a drag has lifted its piece (or, in phase two, the duck) off.
   * The token stays there faded (`xq-piece--drag-source`, the standard
   * board's look) so the player can see where it came from.
   */
  lifted?: DuckXiangqiSquare | null;
};

/**
 * The duck is drawn 10% larger than a piece. It is the one token both players
 * move and the one that blocks everything, so it should be the first thing the
 * eye finds; at piece size it read as one more disc. 1.1 still clears the
 * neighbouring points' pieces on both board layouts.
 */
export const DUCK_TOKEN_SCALE = 1.1;

/** The duck's ring: a brighter, thicker gold than the variant accent it frames. */
const DUCK_POP_RING = '#f2b705';

/** The set's own duck frame plus the duck's ring, in the 100-unit piece box. */
function duckTokenMarks(set: XiangqiPieceSet): string {
  return `${duckPieceMarks(set)}<circle class="dkx-duck-ring" cx="50" cy="50" r="46" fill="none" stroke="${DUCK_POP_RING}" stroke-width="5.5"/>`;
}

const SQUARES = (() => {
  const out: DuckXiangqiSquare[] = [];
  for (let rank = 1; rank <= 10; rank++) {
    for (const file of 'abcdefghi') out.push(`${file}${rank}` as DuckXiangqiSquare);
  }
  return out;
})();

function coordOf(square: DuckXiangqiSquare): { file: number; rank: number } {
  return { file: 'abcdefghi'.indexOf(square[0]!), rank: Number(square.slice(1)) };
}

function point(square: DuckXiangqiSquare, perspective: Color, layout: XiangqiBoardLayout) {
  const { file, rank } = coordOf(square);
  return xiangqiBoardPoint(file, rank, perspective, layout, LIVE_BOARD_GEO);
}

/**
 * The duck. A neutral token, drawn as its own thing so it never reads as either
 * seat's piece — that ambiguity is the one thing a shared blocker must not have.
 */
function duckLayer(
  duck: DuckXiangqiSquare | undefined,
  perspective: Color,
  layout: XiangqiBoardLayout,
  pieceSet: DuckXiangqiBoardState['pieceSet'],
  landed: boolean,
  lifted: DuckXiangqiSquare | null,
): string {
  if (!duck) return '';
  const p = point(duck, perspective, layout);
  const size = XIANGQI_LIVE_PIECE_SIZE * DUCK_TOKEN_SCALE;
  // Resolve the set the way `renderXiangqiPiece` does when the caller passes
  // none, so the duck's frame always matches the pieces beside it.
  const resolved = pieceSet ?? readStoredXiangqiPieceSet();
  // Authored in the same 100-unit piece box as every disc on this board, so the
  // duck scales with the pieces instead of being sized on its own.
  // On top of the set's own frame: a thick bright-gold ring, so the duck
  // separates from the cream discs around it and from the cream board. No drop
  // shadow: it was the board's only 3D effect and read as out of place beside
  // the flat pieces (Brian, 2026-10-08).
  return [
    // A dragged duck stays put, faded, as a dragged piece does on the standard
    // board: Brian wants to see where it came from (2026-10-10).
    `<g class="dkx-duck${landed ? ' dkx-duck--landed' : ''}${duck === lifted ? ' xq-piece--drag-source' : ''}" data-duck-square="${duck}" aria-label="duck">`,
    `<g transform="translate(${p.x - size / 2},${p.y - size / 2}) scale(${size / 100})">`,
    duckTokenMarks(resolved),
    `</g>`,
    `</g>`,
  ].join('');
}

function pieceLayer(
  view: DuckXiangqiPlayerView,
  perspective: Color,
  layout: XiangqiBoardLayout,
  pieceSet: DuckXiangqiBoardState['pieceSet'],
  lifted: DuckXiangqiSquare | null,
): string {
  const out: string[] = [];
  for (const square of SQUARES) {
    const piece = view.board[square];
    if (!piece) continue;
    const p = point(square, perspective, layout);
    const size = XIANGQI_LIVE_PIECE_SIZE;
    out.push(
      `<g class="xq-piece-slot${square === lifted ? ' xq-piece--drag-source' : ''}" data-piece-square="${square}" transform="translate(${p.x - size / 2},${p.y - size / 2})">`,
      // A soldier past the river draws the veteran art. This is the standard
      // 9x10 river, so the standard predicate applies (NOT the fortress one,
      // whose board is 7x8 and disagrees on rank 5 for both colours).
      renderXiangqiPiece(
        piece as never,
        {
          size,
          pieceSet,
          crossed: drawsCrossedSoldier(piece, coordOf(square).rank),
        } as never,
      ),
      `</g>`,
    );
  }
  return out.join('');
}

function targetLayer(
  targets: readonly DuckXiangqiSquare[],
  phase: DuckXiangqiBoardPhase,
  perspective: Color,
  layout: XiangqiBoardLayout,
  duckAnywhere: boolean,
  board: DuckXiangqiPlayerView['board'],
): string {
  // Phase two, unconstrained: paint NOTHING. The duck may go to any empty point,
  // so a dot on each is 58 marks that say "anywhere" - it buries the position
  // under decoration and tells the player something they already know from the
  // notice. The hover ghost answers "where exactly?" one point at a time.
  //
  // The dots used to survive for one case: generals facing down an open file,
  // where the duck was the only thing keeping the position legal and had to
  // land on the segment between them. D5 changed on 2026-09-10 and that case is
  // gone, so `duckAnywhere` is now true for every duck phase and this always
  // returns early. The guard stays because it is derived from the kernel's own
  // answer rather than assumed: if a future rule constrains the duck again, the
  // dots come back on their own instead of silently staying hidden.
  if (phase.kind === 'duck' && duckAnywhere) return '';
  // Phase two is marked differently on purpose. A player who has just moved a
  // piece and now sees dots everywhere needs to know instantly that these are
  // duck squares, not more moves — otherwise the second click feels like the
  // board misread the first.
  // Phase one reuses the board's own hint dot so a xiangqi player reads it
  // without being taught. Phase two gets its own mark, deliberately different:
  // a player who has just moved and suddenly sees dots again must know at a
  // glance that these are DUCK squares, not more moves.
  return targets
    .map((square) => {
      const p = point(square, perspective, layout);
      if (phase.kind === 'duck') {
        return `<circle class="dkx-target--duck" cx="${p.x}" cy="${p.y}" r="10"/>`;
      }
      // A CAPTURE is a ring around the piece, not a dot under it. The target
      // layer draws below the pieces, so a dot on an occupied point is hidden by
      // the piece standing there — which made capturing the general look
      // impossible in a real game. Same two marks the standard board uses.
      return board[square] !== undefined
        ? `<circle class="xq-live-hint-capture" cx="${p.x}" cy="${p.y}" r="28"/>`
        : `<circle class="xq-live-hint-dot" cx="${p.x}" cy="${p.y}" r="7"/>`;
    })
    .join('');
}

/**
 * The duck as it would look if placed here: the real token at half weight.
 *
 * A ghost rather than a dot because the duck is a large disc, and "may I put it
 * here" is really "what will the board look like after I do" - a 10px dot does
 * not answer that on a board where the duck blocks the horse's leg and screens
 * cannons.
 */
export function duckXiangqiGhostSvg(
  square: DuckXiangqiSquare,
  perspective: Color,
  layout: XiangqiBoardLayout,
  pieceSet: XiangqiPieceSet | undefined,
): string {
  const p = point(square, perspective, layout);
  const size = XIANGQI_LIVE_PIECE_SIZE * DUCK_TOKEN_SCALE;
  const resolved = pieceSet ?? readStoredXiangqiPieceSet();
  return [
    `<g class="dkx-duck-ghost-token" transform="translate(${p.x - size / 2},${p.y - size / 2}) scale(${size / 100})">`,
    duckTokenMarks(resolved),
    `</g>`,
  ].join('');
}

/**
 * Paint the ghost under the cursor while a duck placement is pending.
 *
 * Writes straight into the ghost layer instead of re-rendering: a pointermove
 * re-render would rebuild ninety hit areas and every piece on every mouse
 * twitch. A full render clears the layer on its own, which is what should happen
 * when the phase ends.
 *
 * Hover is an ENHANCEMENT, never the mechanism: the click still places the duck,
 * so a touch device loses the preview and keeps the game. Returns a teardown.
 */
export function installDuckXiangqiGhost(opts: {
  board: HTMLElement;
  /** True only while a duck placement is pending and this seat may act. */
  active: () => boolean;
  isTarget: (square: DuckXiangqiSquare) => boolean;
  perspective: () => Color;
  layout: () => XiangqiBoardLayout;
  pieceSet: () => XiangqiPieceSet | undefined;
}): () => void {
  let painted: DuckXiangqiSquare | null = null;

  const layer = (): Element | null => opts.board.querySelector('.dkx-duck-ghost');

  function clear(): void {
    painted = null;
    const host = layer();
    if (host) host.innerHTML = '';
  }

  function onMove(event: PointerEvent): void {
    if (!opts.active()) {
      if (painted !== null) clear();
      return;
    }
    const cell = (event.target as Element | null)?.closest?.('[data-square]');
    const square = cell?.getAttribute('data-square') as DuckXiangqiSquare | undefined;
    if (!square || !opts.isTarget(square)) {
      if (painted !== null) clear();
      return;
    }
    if (square === painted) return;
    const host = layer();
    if (!host) return;
    painted = square;
    host.innerHTML = duckXiangqiGhostSvg(
      square,
      opts.perspective(),
      opts.layout(),
      opts.pieceSet(),
    );
  }

  opts.board.addEventListener('pointermove', onMove);
  opts.board.addEventListener('pointerleave', clear);
  return () => {
    opts.board.removeEventListener('pointermove', onMove);
    opts.board.removeEventListener('pointerleave', clear);
  };
}

function lastMoveLayer(
  view: DuckXiangqiPlayerView,
  perspective: Color,
  layout: XiangqiBoardLayout,
): string {
  if (!view.lastMove) return '';
  // Square grid: tint the two cells, the cell boards' grammar (the intersection
  // layout rings the piece instead). Same classes as the standard board.
  if (layout === 'cell') {
    const c = LIVE_BOARD_GEO.cell;
    const from = point(view.lastMove.from, perspective, layout);
    const to = point(view.lastMove.to, perspective, layout);
    return (
      `<rect class="xq-live-lastmove-square xq-live-lastmove-from" x="${from.x - c / 2}" y="${from.y - c / 2}" width="${c}" height="${c}"/>` +
      `<rect class="xq-live-lastmove-square xq-live-lastmove-to" x="${to.x - c / 2}" y="${to.y - c / 2}" width="${c}" height="${c}"/>`
    );
  }
  // The SHARED marker markup, not an invented class: origin shadow disc plus a
  // gold destination ring, tuned on the standard xiangqi board and used by every
  // token board here. Rolling my own gave two unstyled circles.
  return boardLastMoveMarkersSvg(
    {
      from: point(view.lastMove.from, perspective, layout),
      to: point(view.lastMove.to, perspective, layout),
    },
    XIANGQI_LIVE_PIECE_SIZE,
  );
}

function clickLayer(
  perspective: Color,
  layout: XiangqiBoardLayout,
  hoverTargets: readonly DuckXiangqiSquare[],
): string {
  // Every point is clickable; the pure decision function below works out what a
  // click means. Hit areas are uniform so a duck placement onto an empty point
  // is exactly as easy to hit as a piece.
  //
  // A target point carries the standard board's hover disc
  // (`.xq-live-hit--target:hover .xq-live-target-hover`, live-xiangqi.css), so
  // a dragged piece or duck shows the point it will snap to exactly as a piece
  // dragged on the xiangqi board does.
  const half = XIANGQI_LIVE_PIECE_SIZE * 0.5;
  const hover = new Set(hoverTargets);
  return SQUARES.map((square) => {
    const p = point(square, perspective, layout);
    const rect = `<rect class="dkx-click" data-square="${square}" x="${p.x - half}" y="${p.y - half}" width="${half * 2}" height="${half * 2}" fill="transparent"/>`;
    if (!hover.has(square)) return rect;
    return `<g class="xq-live-hit--target"><circle class="xq-live-target-hover" cx="${p.x}" cy="${p.y}" r="31"/>${rect}</g>`;
  }).join('');
}

// Right-click arrows and circles. The point band sits UNDER the arrows and the
// glyph band OVER them, which is the standard board's split and the reason it
// exists: an arrow landing on an annotated point would otherwise cover the badge
// it is competing with for attention.
function markerBand(
  markers: readonly XiangqiBoardMarker[],
  perspective: Color,
  layout: XiangqiBoardLayout,
  band: 'point' | 'glyph',
): string {
  return markers
    .filter((marker) => (marker.kind === 'glyph') === (band === 'glyph'))
    .map((marker) => xiangqiMarkerSvg(marker, perspective, layout))
    .join('');
}

export function duckXiangqiBoardSvg(
  view: DuckXiangqiPlayerView,
  perspective: Color,
  state: DuckXiangqiBoardState,
): string {
  // The reader's board preference, like every other xiangqi-shaped board. This
  // defaulted to 'intersection' and no caller passed one, so 'Square grid' never
  // reached Duck Xiangqi even though the page CSS already sized for it.
  const layout = state.layout ?? readStoredXiangqiBoardLayout();
  const vb = xiangqiBoardViewBox(layout, DUCK_SURFACE.geo);
  const viewBox = `${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`;
  const selected = state.phase.kind === 'piece' ? state.phase.selected : null;
  const selectionSvg = selected
    ? (() => {
        const p = point(selected, perspective, layout);
        return `<circle class="xq-live-selection-cell" cx="${p.x}" cy="${p.y}" r="30"/>`;
      })()
    : '';
  // In phase two the piece has already moved on screen but not on the server.
  // Rendering it at its destination is what makes the two-step feel like one
  // move rather than a lag.
  const shown: DuckXiangqiPlayerView =
    state.phase.kind === 'duck'
      ? {
          ...view,
          board: (() => {
            const next = { ...view.board };
            const piece = next[state.phase.move.from];
            delete next[state.phase.move.from];
            if (piece) next[state.phase.move.to] = piece;
            return next;
          })(),
        }
      : view;

  // "Anywhere empty" vs a real constraint. Derived rather than passed so it
  // cannot drift from what the kernel actually returned: the duck's unconstrained
  // set is every empty point of the post-move board except its own square, so an
  // equal count means the target list carries no information.
  const emptyAfterMove = SQUARES.filter(
    (square) => shown.board[square] === undefined && square !== view.duck,
  ).length;
  const duckAnywhere = state.phase.kind === 'duck' && state.targets.length >= emptyAfterMove;
  // Snap discs: a selected or dragged piece's moves in phase one; in phase two
  // only while the duck itself is being dragged; plain hover there already
  // previews the duck at half weight (installDuckXiangqiGhost).
  const duckLifted =
    state.phase.kind === 'duck' && view.duck !== null && state.lifted === view.duck;
  const hoverTargets = state.phase.kind === 'piece' || duckLifted ? state.targets : [];

  return `
    <svg class="xq-live-svg xq-live-svg--${layout} dkx-live-svg xq-surface xq-surface--${layout}" data-xiangqi-layout="${layout}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
      <rect class="xq-live-bg" x="${vb.minX}" y="${vb.minY}" width="${vb.width}" height="${vb.height}"/>
      <g class="xq-live-grid">${xiangqiSurfaceGrid(DUCK_SURFACE, layout)}${xiangqiSurfaceStartMarkers(DUCK_SURFACE, perspective, layout)}</g>
      <g class="xq-live-palace-bands">${xiangqiSurfacePalaceBands(DUCK_SURFACE, perspective, layout)}</g>
      <g class="xq-live-palace">${xiangqiSurfacePalace(DUCK_SURFACE, perspective, layout)}</g>
      <g class="xq-live-river" aria-hidden="true" pointer-events="none">${xiangqiSurfaceRiver(DUCK_SURFACE, perspective, layout)}</g>
      <g class="xq-live-lastmove">${lastMoveLayer(view, perspective, layout)}</g>
      <g class="xq-live-selection">${selectionSvg}</g>
      <g class="dkx-live-targets">${state.interactive ? targetLayer(state.targets, state.phase, perspective, layout, duckAnywhere, shown.board) : ''}</g>
      <g class="xq-live-pieces">${pieceLayer(shown, perspective, layout, state.pieceSet, state.lifted ?? null)}</g>
      <g class="dkx-live-duck">${duckLayer(view.duck, perspective, layout, state.pieceSet, state.duckLanded === true, state.lifted ?? null)}</g>
      <g class="dkx-duck-ghost" aria-hidden="true" pointer-events="none"></g>
      <g class="xq-live-markers" aria-hidden="true" pointer-events="none">${markerBand(state.markers ?? [], perspective, layout, 'point')}</g>
      <g class="xq-live-arrows" aria-hidden="true" pointer-events="none">${(state.arrows ?? [])
        .map((arrow) => xiangqiArrowSvg(arrow, perspective, layout))
        .join('')}</g>
      <g class="xq-live-glyphs" aria-hidden="true" pointer-events="none">${markerBand(state.markers ?? [], perspective, layout, 'glyph')}</g>
      <g class="xq-live-clicks">${state.interactive ? clickLayer(perspective, layout, hoverTargets) : ''}</g>
    </svg>
  `;
}

/**
 * What a click means, as a pure function. Kept out of the DOM handler so it can
 * be tested without a browser — the click rules ARE the two-phase turn, and a
 * rule that only exists inside an event listener is a rule with no test.
 */
export type DuckXiangqiClickResult =
  | { kind: 'select'; square: DuckXiangqiSquare }
  | { kind: 'clear' }
  /** Phase one done. Show the piece moved, light the duck squares, send nothing. */
  | { kind: 'await-duck'; move: { from: DuckXiangqiSquare; to: DuckXiangqiSquare } }
  /** A complete turn, ready to send as ONE message. */
  | { kind: 'turn'; turn: DuckXiangqiTurn }
  | { kind: 'noop' };

export function duckXiangqiClickResult(opts: {
  view: DuckXiangqiPlayerView;
  seat: Color | null;
  phase: DuckXiangqiBoardPhase;
  targets: readonly DuckXiangqiSquare[];
  square: DuckXiangqiSquare;
  /** True when this piece move captures the enemy general, ending the game. */
  capturesGeneral: (from: DuckXiangqiSquare, to: DuckXiangqiSquare) => boolean;
}): DuckXiangqiClickResult {
  const { view, seat, phase, targets, square, capturesGeneral } = opts;
  if (!seat || view.status.type !== 'playing' || view.status.turn !== seat) {
    return { kind: 'noop' };
  }

  if (phase.kind === 'duck') {
    if (!targets.includes(square)) {
      // Clicking a non-target in phase two cancels the whole turn rather than
      // half-committing it. Nothing has been sent, so this is free.
      return { kind: 'clear' };
    }
    return { kind: 'turn', turn: { from: phase.move.from, to: phase.move.to, duckTo: square } };
  }

  const piece = view.board[square];
  if (phase.selected && targets.includes(square)) {
    const move = { from: phase.selected, to: square };
    // A turn that captures the general ends the game before the duck would move,
    // so it is complete after one click and the kernel wants duckTo: null.
    if (capturesGeneral(move.from, move.to)) {
      return { kind: 'turn', turn: { ...move, duckTo: null } };
    }
    return { kind: 'await-duck', move };
  }
  if (piece && piece.color === seat) return { kind: 'select', square };
  return phase.selected ? { kind: 'clear' } : { kind: 'noop' };
}

// ── Drag ─────────────────────────────────────────────────────────────────────

/**
 * What a drag may lift from `square`: one of the mover's pieces in phase one,
 * the duck itself in phase two (Brian, 2026-10-10: the duck is one more piece),
 * or nothing.
 */
export function duckXiangqiDragSource(opts: {
  view: DuckXiangqiPlayerView;
  seat: Color | null;
  phase: DuckXiangqiBoardPhase;
  square: DuckXiangqiSquare;
}): 'piece' | 'duck' | null {
  const { view, seat, phase, square } = opts;
  if (!seat || view.status.type !== 'playing' || view.status.turn !== seat) return null;
  if (phase.kind === 'duck') return view.duck === square ? 'duck' : null;
  const piece = view.board[square];
  return piece && piece.color === seat ? 'piece' : null;
}

/** The duck token as a standalone SVG for the floating drag ghost. */
export function duckXiangqiDuckGhostSvg(pieceSet?: XiangqiPieceSet): string {
  // The ghost box is piece-sized (board-drag sizes every ghost the same), so the
  // token is scaled up inside it to keep the duck's 10% lead over the pieces.
  const s = DUCK_TOKEN_SCALE;
  return [
    '<svg viewBox="0 0 100 100" overflow="visible" xmlns="http://www.w3.org/2000/svg" aria-label="duck">',
    `<g transform="translate(50 50) scale(${s}) translate(-50 -50)">`,
    duckTokenMarks(pieceSet ?? readStoredXiangqiPieceSet()),
    '</g></svg>',
  ].join('');
}

/**
 * Drag-to-move on the shared board-drag mechanics (variant-tenant/board-drag.ts),
 * for the live room and the review board alike.
 *
 * A drag is the same gesture as the click it replaces and resolves through the
 * caller's own click handler (`duckXiangqiClickResult`), so the two-phase turn
 * has one set of rules: dropping a piece on a legal point ARMS phase two exactly
 * as clicking it would (or completes the turn when it takes the general), and in
 * phase two the duck on the board drags like a piece to its new point. Clicking
 * still works for both: a tap below the drag threshold falls through to `click`.
 */
export function installDuckXiangqiDrag(opts: {
  board: HTMLElement;
  /** The position being played, or null whenever this seat may not act. */
  view: () => DuckXiangqiPlayerView | null;
  seat: (view: DuckXiangqiPlayerView) => Color | null;
  phase: () => DuckXiangqiBoardPhase;
  setPhase: (phase: DuckXiangqiBoardPhase) => void;
  /** Legal destinations for the current phase (the board's own target list). */
  targets: () => readonly DuckXiangqiSquare[];
  /** Record the lifted point (or null to put it back) and repaint the board. */
  lift: (square: DuckXiangqiSquare | null) => void;
  /** The board's click handler: applies `duckXiangqiClickResult` and repaints. */
  click: (square: DuckXiangqiSquare) => void;
}): void {
  const sourceAt = (square: DuckXiangqiSquare): 'piece' | 'duck' | null => {
    const view = opts.view();
    if (!view) return null;
    return duckXiangqiDragSource({ view, seat: opts.seat(view), phase: opts.phase(), square });
  };

  installBoardDrag({
    board: opts.board,
    ghostSizePx: XIANGQI_LIVE_PIECE_SIZE,
    onSquareClick: (square) => opts.click(square as DuckXiangqiSquare),
    canDragFrom: (square) => sourceAt(square as DuckXiangqiSquare) !== null,
    ghostHtml: (square) => {
      const from = square as DuckXiangqiSquare;
      const source = sourceAt(from);
      if (source === 'duck') return duckXiangqiDuckGhostSvg();
      const piece = source === 'piece' ? opts.view()?.board[from] : undefined;
      if (!piece) return null;
      return xiangqiPieceGhostSvg(piece as never, drawsCrossedSoldier(piece, coordOf(from).rank));
    },
    onDragStart: (square) => {
      const from = square as DuckXiangqiSquare;
      // Lifting a piece selects it, so the targets are its moves and the drop
      // resolves exactly like a second click. Lifting the duck keeps phase two.
      if (opts.phase().kind === 'piece') opts.setPhase({ kind: 'piece', selected: from });
      opts.lift(from);
    },
    onDrop: (_from, to) => {
      const dropped = to as DuckXiangqiSquare | null;
      const hit = dropped !== null && opts.targets().includes(dropped);
      // A missed piece drop snaps back unselected, as on the xiangqi board. A
      // missed DUCK drop snaps only the duck back: the piece move stays made,
      // since abandoning the whole turn for a slipped drag would punish it.
      if (!hit && opts.phase().kind === 'piece') opts.setPhase({ kind: 'piece', selected: null });
      opts.lift(null);
      if (hit) opts.click(dropped);
    },
  });
}
