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
} from './xiangqi-board.js';
import { xiangqiBoardPoint, xiangqiBoardViewBox } from './xiangqi-board-geometry.js';
import {
  xiangqiSurfaceGrid,
  xiangqiSurfacePalace,
  xiangqiSurfacePalaceBands,
  xiangqiSurfaceRiver,
} from './xiangqi-board-surface.js';
import { duckPieceMarks, type XiangqiPieceSet } from './xiangqi-piece-sets.js';

// This board draws no coordinate labels, so it must not reserve their gutter -
// the standard board swaps the same way when labels are off. Leaving it in put
// a band of dead space around the grid.
const DUCK_SURFACE = {
  ...LIVE_BOARD_SURFACE,
  geo: { ...LIVE_BOARD_SURFACE.geo, coordGutter: 0 },
};

import { boardLastMoveMarkersSvg } from './board-lastmove.js';
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
};

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
): string {
  if (!duck) return '';
  const p = point(duck, perspective, layout);
  const size = XIANGQI_LIVE_PIECE_SIZE;
  // Resolve the set the way `renderXiangqiPiece` does when the caller passes
  // none, so the duck's frame always matches the pieces beside it.
  const resolved = pieceSet ?? readStoredXiangqiPieceSet();
  // Authored in the same 100-unit piece box as every disc on this board, so the
  // duck scales with the pieces instead of being sized on its own.
  return [
    `<g class="dkx-duck" data-duck-square="${duck}" aria-label="duck">`,
    `<g transform="translate(${p.x - size / 2},${p.y - size / 2}) scale(${size / 100})">`,
    duckPieceMarks(resolved),
    `</g>`,
    `</g>`,
  ].join('');
}

function pieceLayer(
  view: DuckXiangqiPlayerView,
  perspective: Color,
  layout: XiangqiBoardLayout,
  pieceSet: DuckXiangqiBoardState['pieceSet'],
): string {
  const out: string[] = [];
  for (const square of SQUARES) {
    const piece = view.board[square];
    if (!piece) continue;
    const p = point(square, perspective, layout);
    const size = XIANGQI_LIVE_PIECE_SIZE;
    out.push(
      `<g class="xq-piece-slot" data-piece-square="${square}" transform="translate(${p.x - size / 2},${p.y - size / 2})">`,
      renderXiangqiPiece(piece as never, { size, pieceSet } as never),
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
): string {
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
      return phase.kind === 'duck'
        ? `<circle class="dkx-target--duck" cx="${p.x}" cy="${p.y}" r="10"/>`
        : `<circle class="xq-live-hint-dot" cx="${p.x}" cy="${p.y}" r="7"/>`;
    })
    .join('');
}

function lastMoveLayer(
  view: DuckXiangqiPlayerView,
  perspective: Color,
  layout: XiangqiBoardLayout,
): string {
  if (!view.lastMove) return '';
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

function clickLayer(perspective: Color, layout: XiangqiBoardLayout): string {
  // Every point is clickable; the pure decision function below works out what a
  // click means. Hit areas are uniform so a duck placement onto an empty point
  // is exactly as easy to hit as a piece.
  const half = XIANGQI_LIVE_PIECE_SIZE * 0.5;
  return SQUARES.map((square) => {
    const p = point(square, perspective, layout);
    return `<rect class="dkx-click" data-square="${square}" x="${p.x - half}" y="${p.y - half}" width="${half * 2}" height="${half * 2}" fill="transparent"/>`;
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
  const layout = state.layout ?? 'intersection';
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

  return `
    <svg class="xq-live-svg xq-live-svg--${layout} dkx-live-svg xq-surface xq-surface--${layout}" data-xiangqi-layout="${layout}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
      <rect class="xq-live-bg" x="${vb.minX}" y="${vb.minY}" width="${vb.width}" height="${vb.height}"/>
      <g class="xq-live-grid">${xiangqiSurfaceGrid(DUCK_SURFACE, layout)}</g>
      <g class="xq-live-palace-bands">${xiangqiSurfacePalaceBands(DUCK_SURFACE, perspective, layout)}</g>
      <g class="xq-live-palace">${xiangqiSurfacePalace(DUCK_SURFACE, perspective, layout)}</g>
      <g class="xq-live-river" aria-hidden="true" pointer-events="none">${xiangqiSurfaceRiver(DUCK_SURFACE, perspective, layout)}</g>
      <g class="xq-live-lastmove">${lastMoveLayer(view, perspective, layout)}</g>
      <g class="xq-live-selection">${selectionSvg}</g>
      <g class="dkx-live-targets">${state.interactive ? targetLayer(state.targets, state.phase, perspective, layout) : ''}</g>
      <g class="xq-live-pieces">${pieceLayer(shown, perspective, layout, state.pieceSet)}</g>
      <g class="dkx-live-duck">${duckLayer(view.duck, perspective, layout, state.pieceSet)}</g>
      <g class="xq-live-markers" aria-hidden="true" pointer-events="none">${markerBand(state.markers ?? [], perspective, layout, 'point')}</g>
      <g class="xq-live-arrows" aria-hidden="true" pointer-events="none">${(state.arrows ?? [])
        .map((arrow) => xiangqiArrowSvg(arrow, perspective, layout))
        .join('')}</g>
      <g class="xq-live-glyphs" aria-hidden="true" pointer-events="none">${markerBand(state.markers ?? [], perspective, layout, 'glyph')}</g>
      <g class="xq-live-clicks">${state.interactive ? clickLayer(perspective, layout) : ''}</g>
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
