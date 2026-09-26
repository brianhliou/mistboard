// Live multiplayer room client for hidden/dev-only Dark Xiangqi (9x10) — a FOG
// tenant on the generic live-client core (variant-tenant/live-client.ts owns
// bootstrap, frame application, renderAll skeleton, the fog-safe replay CAPTURE
// controller, and the two-column move list). This module keeps what is genuinely
// Dark Xiangqi's: the intersection-board SVG with its fog mask, click/drag over
// visible pieces, the fog-safe replay CAPTURE key, and the pure click-to-move
// decision. The postgame module reuses renderDarkXiangqiBoardSvg.
//
// Move-list note: Dark Xiangqi is masked (opponent plies render as a dimmed
// placeholder) but keeps EVERY row during a scrub (plyWindow: 'all') — stepping
// back only moves the active highlight, it never drops rows. Zero moves render
// an empty list (shared core behavior, lichess parity).
//
// Wire shape pinned by dark-xiangqi-golden-wire.test.ts: the tenant core snapshot
// with NO extras (no mode/pveEngineId/rated/forfeitDeadline/rematch), so the
// chrome's forfeit banner and rematch block simply never arm.

import type {
  XiangqiColor,
  XiangqiGameStatus,
  XiangqiMove,
  XiangqiPiece,
  XiangqiPieceRole,
  XiangqiSquare,
} from '@mistboard/game';
import { type SvgBoardArrowStyle, svgBoardArrow } from './svg-board-arrow.js';
import { type SvgBoardMarkerStyle, svgBoardCircleMarker } from './svg-board-marker.js';
import './live-xiangqi.css';
import { type BoardPoint, boardLastMoveMarkersSvg } from './board-lastmove.js';
import { tokenPieceSize } from './board-metrics.js';
import { readDisplayPreferences } from './display-preferences.js';
import { darkXiangqiEnabled } from './feature-flags.js';
import {
  maybePlayDarkXiangqiSnapshotSound,
  resetDarkXiangqiSoundState,
  soundForOwnDarkXiangqiMove,
} from './live-dark-xiangqi-sound.js';
import { playSound } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import { fillCapturedPoolWith } from './review/captured-pool.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import {
  annotationOwner,
  type BoardAnnotations,
  drawnBoardOverlays,
  installBoardAnnotations,
} from './variant-tenant/board-annotations.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
} from './variant-tenant/live-client.js';
import type { WebVariantTenant } from './variant-tenant/room-chrome.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';
import type { XiangqiBoardLayout } from './xiangqi-appearance-storage.js';
import { readStoredXiangqiBoardLayout } from './xiangqi-appearance-storage.js';
import {
  type XiangqiBoardGeometry,
  xiangqiBoardPoint,
  xiangqiBoardViewBox,
  xiangqiDisplayFile,
} from './xiangqi-board-geometry.js';
import {
  type XiangqiSurfaceConfig,
  xiangqiSurfaceCoords,
  xiangqiSurfaceGrid,
  xiangqiSurfacePalace,
  xiangqiSurfacePalaceBands,
  xiangqiSurfaceRiver,
} from './xiangqi-board-surface.js';
import { xiangqiCoordLabels } from './xiangqi-coord-labels.js';
import { drawsCrossedSoldier } from './xiangqi-crossed-soldier.js';
import { xiangqiFogRegion } from './xiangqi-fog.js';
import { currentXiangqiNotationStyle } from './xiangqi-notation.js';
import { renderXiangqiPiece } from './xiangqi-pieces.js';

type DarkXiangqiWireBoardEntry =
  | { piece: XiangqiPiece; shrouded: false }
  | { color: XiangqiColor; shrouded: true };

export type DarkXiangqiWireView = {
  id: string;
  perspective: XiangqiColor;
  board: Partial<Record<XiangqiSquare, DarkXiangqiWireBoardEntry>>;
  visibleSquares: XiangqiSquare[];
  legalMoves: XiangqiMove[];
  status: XiangqiGameStatus;
  moveNumber: number;
  lastMove?: XiangqiMove;
  // Dead pieces per color, in capture order (server-computed ledger). Common
  // knowledge between the seats; empty for spectators.
  captures: { red: XiangqiPieceRole[]; black: XiangqiPieceRole[] };
};

type DarkXiangqiMoveEvent = TenantMovePlayed<XiangqiColor, XiangqiMove>;

const FILES = 'abcdefghi';
const FILE_COUNT = 9;
const RANK_COUNT = 10;
const CELL = 60;
const MARGIN = 36;
const PIECE_SIZE = tokenPieceSize(CELL);
const HIT_HALF = 26;
const NON_SELECTABLE_RIVER_ATTRS =
  'aria-hidden="true" pointer-events="none" style="-webkit-user-select: none; user-select: none;"';
const FOG_OVERLAP = 0.5;

// Fog xiangqi draws the standard 9x10 board, so it takes the shared surface and
// the shared point transform rather than keeping a fourth copy. Two consequences
// beyond the appearance preferences finally reaching this board: flipping now
// ROTATES 180 rather than mirroring the rank only (this file carried the same
// defect standard xiangqi did), and 'Square grid' works here as well.
export const FOG_GEO: XiangqiBoardGeometry = {
  fileCount: FILE_COUNT,
  rankCount: RANK_COUNT,
  cell: CELL,
  margin: MARGIN,
  riverGap: Math.round(CELL / 5),
  // Reserved only while labels are shown, and reclaimed when they are off, so a
  // reader who never turns coordinates on sees the board exactly as it was.
  coordGutter: Math.round(CELL / 5),
};
const FOG_GEO_NO_COORDS: XiangqiBoardGeometry = { ...FOG_GEO, coordGutter: 0 };
const FOG_SURFACE: XiangqiSurfaceConfig = {
  geo: FOG_GEO,
  palaces: [
    { fileMin: 3, fileMax: 5, rankMin: 1, rankMax: 3 },
    { fileMin: 3, fileMax: 5, rankMin: 8, rankMax: 10 },
  ],
  riverAfterRank: 5,
  riverLabel: '楚 河   漢 界',
};
let activeLayout: XiangqiBoardLayout = 'intersection';

// ── Dark-Xiangqi-owned interaction/render state ──────────────────────────────

let core: TenantLiveClientContext<XiangqiColor, DarkXiangqiWireView> | null = null;
// Right-click arrows/circles the player drew on this board.
let annotations: BoardAnnotations | null = null;
let selectedSquare: XiangqiSquare | null = null;
// The square a piece is being dragged from. The renderer keeps a dim source
// shadow while the shared drag layer shows the floating ghost.
let draggingFrom: XiangqiSquare | null = null;

// ── Shared tenant room chrome config ─────────────────────────────────────────

const darkXiangqiWebTenant: WebVariantTenant<XiangqiColor> = {
  displayName: 'Fog Xiangqi',
  metaMarkerId: 'dark-xiangqi',
  metaGlyph: '象',
  colors: ['red', 'black'],
  isColor: isXiangqiColor,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  enabled: darkXiangqiEnabled,
  reviewUrl: (roomId) => `/dark-xiangqi/game/${encodeURIComponent(roomId)}`,
  reasonPhrase: darkXiangqiReasonPhrase,
  disabledTitle: 'Fog Xiangqi disabled',
  disabledBody: 'This client build has the room renderer off.',
  rejectedBody: 'This Fog Xiangqi room is not active. Create a new invite to start a game.',
  spectatorBody: 'Watching without private information.',
  selectInstruction: 'Select one of your visible pieces, then choose a destination.',
};

function darkXiangqiReasonPhrase(reason: string): string {
  switch (reason) {
    case 'general-captured':
      return 'general capture';
    case 'timeout':
      return 'timeout';
    case 'resignation':
      return 'resignation';
    case 'abandonment':
      return 'abandonment';
    default:
      return 'the game rules';
  }
}

const client = createTenantLiveClient<XiangqiColor, DarkXiangqiWireView, XiangqiMove>({
  tenant: darkXiangqiWebTenant,
  gameSpecId: 'dark-xiangqi',
  defaultRoomId: 'dxq_dev',
  boardClass: 'xiangqi-live-board',
  // Not on the Dark Xiangqi wire (golden-pinned, no snapshot extras): the forfeit
  // banner and rematch block never arm. Chrome defaults (pvp, no forfeit, no
  // rematch) match the original, so no chrome overrides are needed.
  playAgainRequestBody: (state) => ({
    mode: 'pvp',
    gameSpecId: 'dark-xiangqi',
    preferredColor: 'random',
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onSnapshotApplied: () => {
    if (core) maybePlayDarkXiangqiSnapshotSound(core.state.view, core.state.seat);
  },
  onEventApplied: () => {
    if (core) maybePlayDarkXiangqiSnapshotSound(core.state.view, core.state.seat);
  },
  resetSounds: resetDarkXiangqiSoundState,
  resetState: () => {
    selectedSquare = null;
    draggingFrom = null;
  },
  renderBoard,
  renderExtras: renderLiveCaptureStrips,
  onDisabled: () => {
    selectedSquare = null;
  },
  setup: (ctx) => {
    core = ctx;
    installDarkXiangqiBoardInteraction(ctx.refs);
    // Hot-reload the viewer's xiangqi piece set mid-game (the fog board renders
    // revealed pieces from the stored set); mirrors the chess appearance hook.
    window.addEventListener(xiangqiAppearanceChangedEvent, ctx.renderAll);
    installSelectionClickAway({
      roots: () => [core?.refs.board],
      hasSelection: () => selectedSquare !== null,
      clearSelection: () => {
        selectedSquare = null;
        draggingFrom = null;
        if (core) renderBoard(core.refs, core.displayedView());
      },
    });
  },
  moveList: {
    rowClass: 'move-row xiangqi-move-row',
    cellPrefix: 'xiangqi-move-row',
    listClass: 'xiangqi-move-list',
    masked: true,
    // Render every move that has been played, always. Stepping back only moves
    // the active highlight; it must never drop rows. The ceiling is the full
    // game length, not the scrubbed ply.
    plyWindow: 'all',
    notate: (move) => `${move.from}-${move.to}`,
    isMoveEvent: isDarkXiangqiMoveEvent,
  },
  replayCapture: {
    positionKey: replayPositionKey,
    plyForView: (view, ctx) => {
      if (view.status.type === 'playing') {
        const completedFullMoves = Math.max(0, view.moveNumber - 1);
        return completedFullMoves * 2 + (view.status.turn === 'black' ? 1 : 0);
      }
      if (ctx.positionChanged && view.lastMove) return ctx.latestPly + 1;
      return ctx.latestPly;
    },
  },
});

export function bootstrapDarkXiangqiLiveRoom(): void {
  client.bootstrap();
}

// ── Rendering ────────────────────────────────────────────────────────────────

export function renderDarkXiangqiBoardSvg(
  view: DarkXiangqiWireView,
  perspective: XiangqiColor = view.perspective,
  options: { showFog?: boolean } = {},
): string {
  return boardSvg(view, perspective, { interactive: false, showFog: options.showFog ?? true });
}

// Interactive (review/analysis) render: like the live board but with selection +
// drag state passed in EXPLICITLY rather than read from this module's live-room
// globals, so several independent boards (the fog triptych) can coexist. Mirrors
// createBanqiInteractiveBoard's renderer contract. Used by dark-xiangqi-tree-board.ts.
export function renderDarkXiangqiInteractiveBoardSvg(
  view: DarkXiangqiWireView,
  perspective: XiangqiColor,
  state: {
    selectedSquare: XiangqiSquare | null;
    draggingFrom: XiangqiSquare | null;
    showFog?: boolean;
  },
): string {
  return boardSvg(view, perspective, {
    interactive: true,
    showFog: state.showFog ?? true,
    selectedSquare: state.selectedSquare,
    draggingFrom: state.draggingFrom,
  });
}

// The floating drag ghost (a single visible piece). Exported for the review
// interactive board's installBoardDrag wiring.
export function darkXiangqiInteractivePieceGhostSvg(piece: XiangqiPiece, crossed = false): string {
  return darkXiangqiPieceGhostSvg(piece, crossed);
}

function renderBoard(liveRefs: LiveRefs, view: DarkXiangqiWireView | null): void {
  liveRefs.board.className = 'board xiangqi-live-board';
  liveRefs.board.setAttribute('aria-label', 'Fog Xiangqi board');
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }

  const perspective = core?.orientation() ?? view.perspective;
  const drawn = drawnBoardOverlays<XiangqiSquare>(annotations?.shapes() ?? []);
  liveRefs.board.innerHTML = boardSvg(view, perspective, {
    interactive: true,
    arrows: drawn.arrows,
    markers: drawn.markers,
  });
  // Click + drag are delegated to the persistent board container once at mount
  // (installDarkXiangqiBoardInteraction), so they survive these innerHTML re-renders.
}

// Rail capture rows from the server-computed ledger on the wire view. Chess-room
// convention: each strip shows the pieces captured BY the player on that side of
// the board — top strip = the bottom side's dead pieces, bottom strip = the top
// side's. Spectators get empty arrays from the server, so the rows collapse.
function renderLiveCaptureStrips(liveRefs: LiveRefs, view: DarkXiangqiWireView | null): void {
  liveRefs.capturesTop.replaceChildren();
  liveRefs.capturesBottom.replaceChildren();
  liveRefs.capturesTop.classList.remove('has-captures');
  liveRefs.capturesBottom.classList.remove('has-captures');
  if (!view) return;
  const bottomColor = core?.orientation() ?? view.perspective;
  const topColor: XiangqiColor = bottomColor === 'red' ? 'black' : 'red';
  const dead = [
    ...view.captures.red.map((role) => ({ owner: 'red' as XiangqiColor, role })),
    ...view.captures.black.map((role) => ({ owner: 'black' as XiangqiColor, role })),
  ];
  fillCapturedPoolWith(liveRefs.capturesTop, dead, bottomColor, renderLiveCapturedGlyph);
  fillCapturedPoolWith(liveRefs.capturesBottom, dead, topColor, renderLiveCapturedGlyph);
}

function renderLiveCapturedGlyph(piece: { color: XiangqiColor; role: XiangqiPieceRole }): string {
  return renderXiangqiPiece(piece, { ariaLabel: `${piece.color} ${piece.role}` });
}

function boardSvg(
  view: DarkXiangqiWireView,
  perspective: XiangqiColor,
  options: {
    interactive: boolean;
    showFog?: boolean;
    // Explicit selection/drag state; when omitted (the live room) the module
    // globals are used, so an independent review board can pass its own state
    // without disturbing the live board. `null` = explicitly nothing selected.
    selectedSquare?: XiangqiSquare | null;
    draggingFrom?: XiangqiSquare | null;
    arrows?: readonly DarkXiangqiBoardArrow[];
    markers?: readonly DarkXiangqiBoardMarker[];
    /** Override the stored board-layout preference (tests, previews). */
    layout?: XiangqiBoardLayout;
  },
): string {
  const sel = options.selectedSquare !== undefined ? options.selectedSquare : selectedSquare;
  const drag = options.draggingFrom !== undefined ? options.draggingFrom : draggingFrom;
  // Key the fog mask by the VIEW's own perspective, not the render orientation.
  // The postgame triptych draws the red, truth, and black views in one document,
  // all with the same board orientation and the same view.id (one game) — keying
  // by render orientation made the red and black masks collide, so the black
  // board resolved url(#…) to the red board's mask and showed RED's fog. The
  // view's perspective (red vs black) is unique per fogged board.
  const maskId = `xq-live-fog-${view.id.replace(/[^a-zA-Z0-9_-]/g, '')}-${view.perspective}`;
  const layout = options.layout ?? readStoredXiangqiBoardLayout();
  activeLayout = layout;
  const fog = options.showFog === false ? '' : fogLayer(view, perspective, maskId, layout);
  const showCoords = readDisplayPreferences().boardCoordinates;
  const surface = showCoords ? FOG_SURFACE : { ...FOG_SURFACE, geo: FOG_GEO_NO_COORDS };
  const vb = xiangqiBoardViewBox(layout, surface.geo);
  const coords = showCoords
    ? xiangqiSurfaceCoords(
        surface,
        perspective,
        layout,
        xiangqiCoordLabels(currentXiangqiNotationStyle(), FILE_COUNT, RANK_COUNT),
      )
    : '';
  return `
    <svg class="xq-live-svg xq-live-svg--${layout} xq-surface xq-surface--${layout}" data-xiangqi-layout="${layout}" viewBox="${vb.minX} ${vb.minY} ${vb.width} ${vb.height}" xmlns="http://www.w3.org/2000/svg">
      <rect class="xq-live-bg" x="${vb.minX}" y="${vb.minY}" width="${vb.width}" height="${vb.height}"/>
      <g class="xq-live-grid">${xiangqiSurfaceGrid(surface, layout)}</g>
      <g class="xq-live-palace-bands">${xiangqiSurfacePalaceBands(surface, perspective, layout)}</g>
      <g class="xq-live-palace">${xiangqiSurfacePalace(surface, perspective, layout)}</g>
      ${layout === 'cell' ? '' : `<g class="xq-live-river" ${NON_SELECTABLE_RIVER_ATTRS}>${xiangqiSurfaceRiver(surface, perspective, layout)}</g>`}
      <g class="xq-live-fog">${fog}</g>
      ${coords ? `<g class="xq-live-coords" aria-hidden="true" pointer-events="none">${coords}</g>` : ''}
      ${
        // The square grid's river is a 12-unit strip BETWEEN two rows of cells,
        // so it overlaps no square and can sit above the fog: board furniture,
        // not information. Deliberately NOT done on the intersection layout,
        // where the "river" is the 60-unit gap between the rank 5 and rank 6
        // lines and a piece on rank 5 occupies 27 of those units -- lifting the
        // fog there would show the top half of every piece on that rank.
        layout === 'cell'
          ? `<g class="xq-live-river" ${NON_SELECTABLE_RIVER_ATTRS}>${xiangqiSurfaceRiver(surface, perspective, layout)}</g>`
          : ''
      }
      <g class="xq-live-lastmove">${lastMoveLayer(view, perspective)}</g>
      <g class="xq-live-selection">${selectionLayer(sel, perspective)}</g>
      <g class="xq-live-hints">${options.interactive ? '' : hintLayer(view, perspective, sel)}</g>
      <g class="xq-live-pieces">${pieceLayer(view, perspective, drag)}</g>
      <g class="xq-live-markers" aria-hidden="true" pointer-events="none">${(options.markers ?? []).map((marker) => darkXiangqiMarkerSvg(marker, perspective)).join('')}</g>
      <g class="xq-live-arrows" aria-hidden="true" pointer-events="none">${(options.arrows ?? []).map((arrow) => darkXiangqiArrowSvg(arrow, perspective)).join('')}</g>
      <g class="xq-live-clicks">${options.interactive ? clickLayer(view, perspective, sel) : ''}</g>
    </svg>
  `;
}

export function fogLayer(
  view: DarkXiangqiWireView,
  perspective: XiangqiColor,
  maskId: string,
  layout: XiangqiBoardLayout,
): string {
  // The fog covers the board as drawn: the intersection board from the origin,
  // or the square grid's cells plus its river strip, which start half a cell
  // before the first intersection and end 6 units below the intersection board.
  // Sizing it to the intersection board on the square grid left the bottom
  // edge of every last-row square unfogged.
  const bounds = xiangqiBoardViewBox(layout, FOG_GEO_NO_COORDS);
  const minX = bounds.minX;
  const minY = bounds.minY;
  const maxX = bounds.minX + bounds.width;
  const maxY = bounds.minY + bounds.height;
  const cutouts = view.visibleSquares
    .map((square) => {
      const coord = coordOf(square);
      // The layout is explicit, not the module's activeLayout: the fog used to
      // be built before activeLayout was set, so a first render on the square
      // grid cut its holes at intersection heights, a river gap too high on
      // every square below the river.
      const center = intersection(coord.file, coord.rank, perspective, layout);
      const displayRank = displayRankFor(coord.rank, perspective);
      // Edge cutouts bleed to the board edge so no fog hairline survives between
      // a visible outer square and the frame. The test must therefore be on the
      // DISPLAY column, not the logical file: black sees the board rotated, so
      // file a sits on the right. (The y axis already used displayRank; x did
      // not, which was invisible only while flipping mirrored the rank alone.)
      const displayFile = xiangqiDisplayFile(coord.file, perspective, FILE_COUNT);
      const x0 = displayFile === 0 ? minX : center.x - CELL / 2 - FOG_OVERLAP;
      const x1 = displayFile === FILE_COUNT - 1 ? maxX : center.x + CELL / 2 + FOG_OVERLAP;
      const y0 = displayRank === 0 ? minY : center.y - CELL / 2 - FOG_OVERLAP;
      const y1 = displayRank === RANK_COUNT - 1 ? maxY : center.y + CELL / 2 + FOG_OVERLAP;
      return `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="black"/>`;
    })
    .join('');
  return xiangqiFogRegion(
    // The `.xiangqi-live-board` wrapper clips every full-bleed SVG layer to its
    // CSS radius. A second viewBox-unit radius would diverge when responsive.
    {
      x: minX,
      y: minY,
      width: bounds.width,
      height: bounds.height,
      cell: CELL,
      margin: MARGIN,
      rx: 0,
    },
    maskId,
    'xq-live-fog-mask',
    cutouts,
  );
}

// Same origin-wash + destination-halo grammar as the open board
// (xiangqi-board.ts), through the same shared geometry -- fog changes what a
// viewer may be told, not how a move is drawn. Until 2026-08-30 this board drew
// a symmetric pair of plain amber discs while every other token board drew the
// directional pair, so the same event looked like two different things
// depending on which room you were in.
//
// The per-endpoint null is a guard, not the operative filter. The SERVER is
// what enforces the hidden-info rule here, and it is stricter than visibility:
// getDarkXiangqiClientView drops lastMove wholesale unless the viewing seat is
// the one that moved (dark-xiangqi-runtime.test.ts pins that red gets no
// lastMove even when the destination square is in its visibleSquares). So in a
// live room these marks describe your own move; the half-visible case only
// arises where the reveal widens -- postgame, /watch replay. Draw nothing for a
// square this view cannot see anyway: a render path that can only ever be fed
// safe input is one refactor away from being fed unsafe input.
function lastMoveLayer(view: DarkXiangqiWireView, perspective: XiangqiColor): string {
  if (!view.lastMove) return '';
  return boardLastMoveMarkersSvg(
    {
      from: visibleLastMoveCenter(view, view.lastMove.from, perspective),
      to: visibleLastMoveCenter(view, view.lastMove.to, perspective),
    },
    PIECE_SIZE,
  );
}

function visibleLastMoveCenter(
  view: DarkXiangqiWireView,
  square: XiangqiSquare,
  perspective: XiangqiColor,
): BoardPoint | null {
  if (!view.visibleSquares.includes(square)) return null;
  const coord = coordOf(square);
  return intersection(coord.file, coord.rank, perspective);
}

function selectionLayer(square: XiangqiSquare | null, perspective: XiangqiColor): string {
  if (!square) return '';
  const coord = coordOf(square);
  const center = intersection(coord.file, coord.rank, perspective);
  return `<circle class="xq-live-selection-cell" cx="${center.x}" cy="${center.y}" r="30"/>`;
}

function hintLayer(
  view: DarkXiangqiWireView,
  perspective: XiangqiColor,
  selected: XiangqiSquare | null,
): string {
  if (!selected) return '';
  return view.legalMoves
    .filter((move) => move.from === selected)
    .map((move) => {
      const coord = coordOf(move.to);
      const center = intersection(coord.file, coord.rank, perspective);
      const occupied = view.board[move.to] !== undefined;
      return occupied
        ? `<circle class="xq-live-hint-capture" cx="${center.x}" cy="${center.y}" r="28"/>`
        : `<circle class="xq-live-hint-dot" cx="${center.x}" cy="${center.y}" r="7"/>`;
    })
    .join('');
}

function pieceLayer(
  view: DarkXiangqiWireView,
  perspective: XiangqiColor,
  draggingFromSquare: XiangqiSquare | null,
): string {
  const parts: string[] = [];
  for (const [square, entry] of Object.entries(view.board)) {
    if (!entry) continue;
    const dragSource = square === draggingFromSquare;
    const coord = coordOf(square as XiangqiSquare);
    const center = intersection(coord.file, coord.rank, perspective);
    const piece =
      'piece' in entry ? entry.piece : ({ color: entry.color, role: 'soldier' } as const);
    parts.push(
      renderXiangqiPiece(piece, {
        ariaLabel: entry.shrouded ? `${entry.color} hidden piece` : undefined,
        x: center.x - PIECE_SIZE / 2,
        y: center.y - PIECE_SIZE / 2,
        size: PIECE_SIZE,
        shrouded: entry.shrouded,
        // A shrouded entry is a soldier-shaped placeholder for an unknown role,
        // so promoting its art would assert a piece the viewer has not seen.
        crossed: !entry.shrouded && drawsCrossedSoldier(piece, coord.rank),
        className: dragSource ? 'xq-piece xq-piece--drag-source' : 'xq-piece',
      }),
    );
  }
  return parts.join('');
}

function clickLayer(
  view: DarkXiangqiWireView,
  perspective: XiangqiColor,
  selected: XiangqiSquare | null,
): string {
  const targets = new Map<XiangqiSquare, { capture: boolean }>();
  if (selected) {
    for (const move of view.legalMoves) {
      if (move.from === selected) {
        targets.set(move.to, { capture: view.board[move.to] !== undefined });
      }
    }
  }
  const parts: string[] = [];
  for (let file = 0; file < FILE_COUNT; file++) {
    for (let rank = 1; rank <= RANK_COUNT; rank++) {
      const square = `${FILES[file]}${rank}` as XiangqiSquare;
      const center = intersection(file, rank, perspective);
      const target = targets.get(square);
      const marker = target
        ? target.capture
          ? `<circle class="xq-live-hint-capture" cx="${center.x}" cy="${center.y}" r="28"/>`
          : `<circle class="xq-live-hint-dot" cx="${center.x}" cy="${center.y}" r="7"/>`
        : '';
      const hover = target
        ? `<circle class="xq-live-target-hover" cx="${center.x}" cy="${center.y}" r="31"/>`
        : '';
      parts.push(
        `<g class="xq-live-hit${target ? ' xq-live-hit--target' : ''}" data-square="${square}">${hover}${marker}<rect x="${center.x - HIT_HALF}" y="${center.y - HIT_HALF}" width="${HIT_HALF * 2}" height="${HIT_HALF * 2}"/></g>`,
      );
    }
  }
  return parts.join('');
}

// ── Interaction ──────────────────────────────────────────────────────────────

function handleSquareClick(view: DarkXiangqiWireView, square: XiangqiSquare): void {
  if (!core?.replay.isLive() || core.connection() !== 'connected') return;
  const result = darkXiangqiClickResult(view, core.state.seat, selectedSquare, square);
  if (result.kind === 'noop') return;
  if (result.kind === 'select') {
    selectedSquare = result.square;
    return;
  }
  if (result.kind === 'clear') {
    selectedSquare = null;
    return;
  }
  selectedSquare = null;
  if (core.send({ type: 'move', from: result.move.from, to: result.move.to })) {
    playSound(soundForOwnDarkXiangqiMove(view, result.move));
  }
}

// The standalone piece SVG for the floating drag ghost (board-drag.ts mounts it
// in a sized <div>). Only your own VISIBLE pieces are draggable, so the entry is
// always a known piece — never shrouded.
function darkXiangqiPieceGhostSvg(piece: XiangqiPiece, crossed = false): string {
  return renderXiangqiPiece(piece, {
    ariaLabel: `${piece.color} ${piece.role}`,
    className: 'xq-piece',
    size: PIECE_SIZE,
    crossed,
  });
}

// Click + drag, delegated to the persistent board container once at mount so they
// survive every innerHTML re-render. Click is the existing select/move; drag lifts
// one of your visible pieces and drops it on a legal target. A tap that never
// crosses the movement threshold falls through to the click handler.
function installDarkXiangqiBoardInteraction(liveRefs: LiveRefs): void {
  annotations = installBoardAnnotations({
    board: liveRefs.board,
    gameId: () => annotationOwner(core?.state.view),
    repaint: () => {
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
  });
  installBoardDrag({
    board: liveRefs.board,
    ghostSizePx: PIECE_SIZE,
    onSquareClick: (square) => {
      const view = core?.state.view;
      if (!view) return;
      handleSquareClick(view, square as XiangqiSquare);
      renderBoard(liveRefs, view);
    },
    canDragFrom: (square) => canDragDarkXiangqiPiece(square as XiangqiSquare),
    ghostHtml: (square) => {
      const entry = core?.state.view?.board[square as XiangqiSquare];
      if (!entry || entry.shrouded) return null;
      return darkXiangqiPieceGhostSvg(
        entry.piece,
        drawsCrossedSoldier(entry.piece, coordOf(square as XiangqiSquare).rank),
      );
    },
    onDragStart: (from) => {
      selectedSquare = from as XiangqiSquare;
      draggingFrom = from as XiangqiSquare;
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
    onDrop: (from, to) =>
      dropDarkXiangqiPiece(liveRefs, from as XiangqiSquare, to as XiangqiSquare | null),
  });
}

// Your own visible piece can be lifted on your turn. A shrouded entry is an enemy
// occupancy with no piece type, so it is never yours; your own pieces are NEVER
// shrouded. (It snaps back if dropped somewhere it cannot move, so any of your
// visible pieces is draggable, not just ones with a legal move right now.)
function canDragDarkXiangqiPiece(square: XiangqiSquare): boolean {
  const view = core?.state.view;
  if (!view || !core?.replay.isLive() || core.connection() !== 'connected') return false;
  if (!isXiangqiColor(core.state.seat)) return false;
  if (view.status.type !== 'playing' || view.status.turn !== core.state.seat) return false;
  const entry = view.board[square];
  if (!entry || entry.shrouded) return false;
  return entry.piece.color === view.perspective;
}

function dropDarkXiangqiPiece(
  liveRefs: LiveRefs,
  from: XiangqiSquare,
  to: XiangqiSquare | null,
): void {
  draggingFrom = null;
  const view = core?.state.view;
  const move = to && view ? view.legalMoves.find((m) => m.from === from && m.to === to) : undefined;
  if (move && view) {
    selectedSquare = null;
    if (core?.send({ type: 'move', from: move.from, to: move.to })) {
      playSound(soundForOwnDarkXiangqiMove(view, move));
    }
  } else {
    selectedSquare = null;
  }
  if (core?.state.view) renderBoard(liveRefs, core.state.view);
}

export type DarkXiangqiClickResult =
  | { kind: 'select'; square: XiangqiSquare }
  | { kind: 'clear' }
  | { kind: 'move'; move: XiangqiMove }
  | { kind: 'noop' };

// Pure click-to-move decision over a fog view: only the seated player's own
// VISIBLE pieces with at least one legal move are selectable (the web-side
// half of the hidden-info guarantee; pinned by live-dark-xiangqi.test.ts).
export function darkXiangqiClickResult(
  view: DarkXiangqiWireView,
  seat: unknown,
  selected: XiangqiSquare | null,
  square: XiangqiSquare,
): DarkXiangqiClickResult {
  if (!canInteract(view, seat)) return { kind: 'noop' };
  if (!selected) {
    return canSelect(view, seat, square) ? { kind: 'select', square } : { kind: 'noop' };
  }
  if (selected === square) return { kind: 'clear' };
  const move = view.legalMoves.find(
    (candidate) => candidate.from === selected && candidate.to === square,
  );
  if (move) return { kind: 'move', move };
  return canSelect(view, seat, square) ? { kind: 'select', square } : { kind: 'clear' };
}

function canInteract(view: DarkXiangqiWireView, seat: unknown): boolean {
  return view.status.type === 'playing' && isXiangqiColor(seat) && view.status.turn === seat;
}

function canSelect(view: DarkXiangqiWireView, seat: unknown, square: XiangqiSquare): boolean {
  if (!canInteract(view, seat)) return false;
  const entry = view.board[square];
  if (!entry || !('piece' in entry) || entry.piece.color !== seat) return false;
  return view.legalMoves.some((move) => move.from === square);
}

// ── Notation + fog-safe replay capture key ───────────────────────────────────

function isDarkXiangqiMoveEvent(event: TenantLiveEvent): event is DarkXiangqiMoveEvent {
  const move = (event as { move?: unknown }).move;
  return (
    event.type === 'move-played' &&
    isXiangqiColor((event as { color?: unknown }).color) &&
    typeof move === 'object' &&
    move !== null &&
    typeof (move as { from?: unknown }).from === 'string' &&
    typeof (move as { to?: unknown }).to === 'string'
  );
}

function replayPositionKey(view: DarkXiangqiWireView): string {
  const board = Object.entries(view.board)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([square, entry]) =>
      'piece' in entry
        ? [square, entry.piece.color, entry.piece.role, false]
        : [square, entry.color, true],
    );
  return JSON.stringify({
    board,
    lastMove: view.lastMove ?? null,
    moveNumber: view.moveNumber,
    perspective: view.perspective,
    visibleSquares: [...view.visibleSquares].sort(),
  });
}

// ── Geometry ─────────────────────────────────────────────────────────────────

export interface DarkXiangqiBoardArrow extends SvgBoardArrowStyle {
  from: XiangqiSquare;
  to: XiangqiSquare;
}

export interface DarkXiangqiBoardMarker extends SvgBoardMarkerStyle {
  square: XiangqiSquare;
  kind: 'circle';
}

function darkXiangqiArrowSvg(arrow: DarkXiangqiBoardArrow, perspective: XiangqiColor): string {
  const from = coordOf(arrow.from);
  const to = coordOf(arrow.to);
  return svgBoardArrow(
    arrow,
    intersection(from.file, from.rank, perspective),
    intersection(to.file, to.rank, perspective),
    { baseClassName: 'xq-arrow' },
  );
}

function darkXiangqiMarkerSvg(marker: DarkXiangqiBoardMarker, perspective: XiangqiColor): string {
  const { file, rank } = coordOf(marker.square);
  return svgBoardCircleMarker(marker, intersection(file, rank, perspective), 30, {
    baseClassName: 'xq-marker engine-marker',
  });
}

function intersection(
  file: number,
  rank: number,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout = activeLayout,
): { x: number; y: number } {
  return xiangqiBoardPoint(file, rank, perspective, layout, FOG_GEO);
}

function displayRankFor(rank: number, perspective: XiangqiColor): number {
  return perspective === 'red' ? RANK_COUNT - rank : rank - 1;
}

function coordOf(square: XiangqiSquare): { file: number; rank: number } {
  return {
    file: Math.max(0, FILES.indexOf(square[0] ?? '')),
    rank: Number(square.slice(1)),
  };
}

function isXiangqiColor(value: unknown): value is XiangqiColor {
  return value === 'red' || value === 'black';
}
