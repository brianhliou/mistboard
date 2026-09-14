// Live multiplayer room client for standard Xiangqi (9x10) — an OPEN-INFORMATION
// tenant on the generic live-client core (variant-tenant/live-client.ts owns
// bootstrap, frame application, renderAll skeleton, the replay CAPTURE
// controller, and the two-column move list). This module keeps what is genuinely
// the live room's: seat-gated click/drag wiring, sounds, and replay capture.
// The intersection-board SVG (grid, river, last-move, selection, hints, pieces)
// and the pure click-to-move decision live in xiangqi-board.ts; this module
// re-exports renderXiangqiBoardSvg for its existing importers (watch replay,
// broadcast, postgame).
//
// Unlike Dark Xiangqi there is NO fog: every player and spectator receives the
// full truth board (plain pieces, no shrouding), so there is no fog mask, no
// shrouded entries, and no visible-square gating.

import {
  applyStandardXiangqiMove,
  coordOf,
  createInitialXiangqiState,
  formatXiangqiMoves,
  getStandardXiangqiPlayerView,
  type StandardXiangqiPlayerView,
  XIANGQI_SPEC_ID,
  type XiangqiColor,
  type XiangqiMove,
  type XiangqiSquare,
} from '@mistboard/game';
import './live-xiangqi.css';
import { xiangqiEnabled } from './feature-flags.js';
import { playSound } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import {
  maybePlayXiangqiSnapshotSound,
  resetXiangqiSoundState,
  soundForOwnXiangqiMove,
} from './live-xiangqi-sound.js';
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
import {
  animateXiangqiBoardMove,
  isXiangqiColor,
  XIANGQI_PIECE_SIZE,
  xiangqiBoardSvg,
  xiangqiClickResult,
  xiangqiPieceGhostSvg,
} from './xiangqi-board.js';
import { currentXiangqiNotationStyle, xiangqiNotationChangedEvent } from './xiangqi-notation.js';

// Board SVG + click decision are canonical in xiangqi-board.ts; re-exported here
// for the existing importers of this module.
export {
  renderXiangqiBoardSvg,
  type XiangqiClickResult,
  xiangqiClickResult,
} from './xiangqi-board.js';

import { drawsCrossedSoldier } from './xiangqi-crossed-soldier.js';

type XiangqiMoveEvent = TenantMovePlayed<XiangqiColor, XiangqiMove>;

// ── Xiangqi-owned interaction/render state ───────────────────────────────────

let core: TenantLiveClientContext<XiangqiColor, StandardXiangqiPlayerView> | null = null;
let selectedSquare: XiangqiSquare | null = null;
// The square a piece is being dragged from. The renderer keeps a dim source
// shadow while the shared drag layer shows the floating ghost.
let draggingFrom: XiangqiSquare | null = null;
// Right-click arrows/circles the player drew on this board.
let annotations: BoardAnnotations | null = null;

// ── Shared tenant room chrome config ─────────────────────────────────────────

const xiangqiWebTenant: WebVariantTenant<XiangqiColor> = {
  displayName: 'Xiangqi',
  metaMarkerId: 'xiangqi',
  metaGlyph: '象',
  colors: ['red', 'black'],
  isColor: isXiangqiColor,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  enabled: xiangqiEnabled,
  reviewUrl: (roomId) => `/xiangqi/game/${encodeURIComponent(roomId)}`,
  reasonPhrase: xiangqiReasonPhrase,
  disabledTitle: 'Xiangqi disabled',
  disabledBody: 'This client build has the room renderer off.',
  rejectedBody: 'This Xiangqi room is not active. Create a new invite to start a game.',
  spectatorBody: 'Watching the full board.',
  selectInstruction: 'Select one of your pieces, then choose a destination.',
};

function xiangqiReasonPhrase(reason: string): string {
  switch (reason) {
    case 'checkmate':
      return 'checkmate';
    case 'stalemate':
      return 'stalemate';
    case 'general-captured':
      return 'general capture';
    case 'timeout':
      return 'timeout';
    case 'resignation':
      return 'resignation';
    case 'abandonment':
      return 'abandonment';
    case 'repetition':
      return 'threefold repetition';
    case 'chasing':
      return 'perpetual check';
    default:
      return 'the game rules';
  }
}

const client = createTenantLiveClient<XiangqiColor, StandardXiangqiPlayerView, XiangqiMove>({
  tenant: xiangqiWebTenant,
  gameSpecId: XIANGQI_SPEC_ID,
  defaultRoomId: 'xq_dev',
  boardClass: 'xiangqi-live-board',
  playAgainRequestBody: (state) => ({
    mode: 'pvp',
    gameSpecId: XIANGQI_SPEC_ID,
    preferredColor: 'random',
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onSnapshotApplied: () => {
    if (core) maybePlayXiangqiSnapshotSound(core.state.view, core.state.seat);
  },
  onEventApplied: () => {
    if (core) maybePlayXiangqiSnapshotSound(core.state.view, core.state.seat);
  },
  resetSounds: resetXiangqiSoundState,
  resetState: () => {
    selectedSquare = null;
    draggingFrom = null;
  },
  renderBoard,
  // Piece glides (pieceAnimation pref). Live: only REMOTE moves animate — own
  // moves already re-rendered synchronously at input time, so animating the
  // server echo would double-play them. Spectators see both sides glide.
  // Scrubs: adjacent forward steps glide the stepped-into move; back steps
  // reverse-glide the undone move (the previous view's lastMove). Skipped
  // mid-drag so a glide never fights the drag ghost.
  animateBoard: (liveRefs, view, takePendingAnimation) => {
    if (!view || draggingFrom) return;
    const pending = takePendingAnimation();
    if (!pending) return;
    const perspective = core?.orientation() ?? view.perspective;
    if (pending.kind === 'live') {
      if (pending.color === core?.state.seat) return;
      animateXiangqiBoardMove(liveRefs.board, pending.move, perspective);
      return;
    }
    if (pending.direction === 'forward') {
      if (view.lastMove) animateXiangqiBoardMove(liveRefs.board, view.lastMove, perspective);
      return;
    }
    const undone = pending.prevView?.lastMove;
    if (undone) animateXiangqiBoardMove(liveRefs.board, undone, perspective, { reverse: true });
  },
  onDisabled: () => {
    selectedSquare = null;
  },
  setup: (ctx) => {
    core = ctx;
    installXiangqiBoardInteraction(ctx.refs);
    installSelectionClickAway({
      roots: () => [core?.refs.board],
      hasSelection: () => selectedSquare !== null,
      clearSelection: () => {
        selectedSquare = null;
        draggingFrom = null;
        if (core) renderBoard(core.refs, core.displayedView());
      },
    });
    // The theme gear changes the notation mid-game; relabel the list in place.
    window.addEventListener(xiangqiNotationChangedEvent, () => ctx.renderAll());
  },
  moveList: {
    rowClass: 'move-row xiangqi-move-row',
    cellPrefix: 'xiangqi-move-row',
    listClass: 'xiangqi-move-list',
    masked: false,
    notate: (move) => `${move.from}-${move.to}`,
    // The reader's notation (algebraic by default) needs the pre-move board;
    // the live room always starts from the opening, so replay the line.
    notateLine: (moves) => formatXiangqiMoves(moves, currentXiangqiNotationStyle()),
    isMoveEvent: isXiangqiMoveEvent,
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
  // Perfect information: the event log carries every move unredacted, so the
  // full per-ply history is rebuilt through the standard kernel on mount and
  // after every reconnect (#80). Same client-held data, no new server payload.
  replayHistory: {
    rebuild: ({ events, view, state }) => {
      const perspective = isXiangqiColor(state.seat) ? state.seat : view.perspective;
      let gameState = createInitialXiangqiState(view.id);
      const snapshots = [{ ply: 0, view: getStandardXiangqiPlayerView(gameState, perspective) }];
      for (const event of events) {
        if (!isXiangqiMoveEvent(event)) continue;
        const next = applyStandardXiangqiMove(gameState, event.move);
        if (next === gameState) return null; // kernel rejected: keep captured history
        gameState = next;
        snapshots.push({
          ply: snapshots.length,
          view: getStandardXiangqiPlayerView(gameState, perspective),
        });
      }
      return snapshots;
    },
  },
});

export function bootstrapXiangqiLiveRoom(): void {
  client.bootstrap();
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderBoard(liveRefs: LiveRefs, view: StandardXiangqiPlayerView | null): void {
  liveRefs.board.className = 'board xiangqi-live-board';
  liveRefs.board.setAttribute('aria-label', 'Xiangqi board');
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }

  const perspective = core?.orientation() ?? view.perspective;
  const drawn = drawnBoardOverlays<XiangqiSquare>(annotations?.shapes() ?? []);
  liveRefs.board.innerHTML = xiangqiBoardSvg(view, perspective, {
    interactive: true,
    selectedSquare,
    draggingFrom,
    arrows: drawn.arrows,
    markers: drawn.markers,
  });
  // Click + drag are delegated to the persistent board container once at mount
  // (installXiangqiBoardInteraction), so they survive these innerHTML re-renders.
}

// ── Interaction ──────────────────────────────────────────────────────────────

function handleSquareClick(view: StandardXiangqiPlayerView, square: XiangqiSquare): void {
  if (!core?.replay.isLive() || core.connection() !== 'connected') return;
  const result = xiangqiClickResult(view, core.state.seat, selectedSquare, square);
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
    playSound(soundForOwnXiangqiMove(view, result.move));
  }
}

// Click + drag, delegated to the persistent board container once at mount so they
// survive every innerHTML re-render. Click is the existing select/move; drag lifts
// one of your pieces and drops it on a legal target. A tap that never crosses the
// movement threshold falls through to the click handler.
function installXiangqiBoardInteraction(liveRefs: LiveRefs): void {
  annotations = installBoardAnnotations({
    board: liveRefs.board,
    gameId: () => annotationOwner(core?.state.view),
    repaint: () => {
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
  });
  installBoardDrag({
    board: liveRefs.board,
    ghostSizePx: XIANGQI_PIECE_SIZE,
    onSquareClick: (square) => {
      const view = core?.state.view;
      if (!view) return;
      handleSquareClick(view, square as XiangqiSquare);
      renderBoard(liveRefs, view);
    },
    canDragFrom: (square) => canDragXiangqiPiece(square as XiangqiSquare),
    ghostHtml: (square) => {
      const piece = core?.state.view?.board[square as XiangqiSquare];
      if (!piece) return null;
      return xiangqiPieceGhostSvg(
        piece,
        drawsCrossedSoldier(piece, coordOf(square as XiangqiSquare).rank),
      );
    },
    onDragStart: (from) => {
      selectedSquare = from as XiangqiSquare;
      draggingFrom = from as XiangqiSquare;
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
    onDrop: (from, to) =>
      dropXiangqiPiece(liveRefs, from as XiangqiSquare, to as XiangqiSquare | null),
  });
}

// Your own piece can be lifted on your turn. (It snaps back if dropped somewhere
// it cannot move, so any of your pieces is draggable, not just ones with a legal
// move right now.)
function canDragXiangqiPiece(square: XiangqiSquare): boolean {
  const view = core?.state.view;
  if (!view || !core?.replay.isLive() || core.connection() !== 'connected') return false;
  if (!isXiangqiColor(core.state.seat)) return false;
  if (view.status.type !== 'playing' || view.status.turn !== core.state.seat) return false;
  const piece = view.board[square];
  if (!piece) return false;
  return piece.color === view.perspective;
}

function dropXiangqiPiece(liveRefs: LiveRefs, from: XiangqiSquare, to: XiangqiSquare | null): void {
  draggingFrom = null;
  const view = core?.state.view;
  const move = to && view ? view.legalMoves.find((m) => m.from === from && m.to === to) : undefined;
  if (move && view) {
    selectedSquare = null;
    if (core?.send({ type: 'move', from: move.from, to: move.to })) {
      playSound(soundForOwnXiangqiMove(view, move));
    }
  } else {
    selectedSquare = null;
  }
  if (core?.state.view) renderBoard(liveRefs, core.state.view);
}

// ── Notation + replay capture key ────────────────────────────────────────────

function isXiangqiMoveEvent(event: TenantLiveEvent): event is XiangqiMoveEvent {
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

function replayPositionKey(view: StandardXiangqiPlayerView): string {
  const board = Object.entries(view.board)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([square, piece]) => [square, piece.color, piece.role]);
  return JSON.stringify({
    board,
    lastMove: view.lastMove ?? null,
    moveNumber: view.moveNumber,
    perspective: view.perspective,
    turn: view.status.type === 'playing' ? view.status.turn : view.status.type,
  });
}
