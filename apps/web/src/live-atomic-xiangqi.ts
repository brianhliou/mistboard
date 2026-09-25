// Live multiplayer room client for Atomic Xiangqi (9x10, open information, a
// capture is an explosion). The standard xiangqi live client with three
// differences: the board rings the points the last explosion cleared, the
// check notice says what check means here, and the move list is coordinate
// pairs (the WXF formatter replays a game through the standard kernel, which
// does not explode). Everything else is live-xiangqi.ts: the intersection
// board, click/drag, sounds, replay capture.

import {
  ATOMIC_XIANGQI_SPEC_ID,
  type AtomicXiangqiColor,
  type AtomicXiangqiMove,
  type AtomicXiangqiPlayerView,
  type AtomicXiangqiSquare,
  applyAtomicXiangqiMove,
  coordOf,
  createInitialAtomicXiangqiState,
  getAtomicXiangqiPlayerView,
} from '@mistboard/game';
import './live-xiangqi.css';
import './atomic-xiangqi.css';
import {
  animateAtomicXiangqiCapture,
  atomicXiangqiBlastKey,
  atomicXiangqiBlastMarkers,
  atomicXiangqiCaptureAnimates,
  atomicXiangqiCheckBody,
  atomicXiangqiReasonPhrase,
  markAtomicXiangqiBlastHost,
} from './atomic-xiangqi-board.js';
import { atomicXiangqiEnabled } from './feature-flags.js';
import {
  maybePlayAtomicXiangqiSnapshotSound,
  soundForOwnAtomicXiangqiMove,
} from './live-atomic-xiangqi-sound.js';
import { finishBadgesForResult, generalSquareIn } from './live-finish-badges.js';
import { playSound } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import { resetXiangqiSoundState } from './live-xiangqi-sound.js';
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
import { drawsCrossedSoldier } from './xiangqi-crossed-soldier.js';

type AtomicMoveEvent = TenantMovePlayed<AtomicXiangqiColor, AtomicXiangqiMove>;

let core: TenantLiveClientContext<AtomicXiangqiColor, AtomicXiangqiPlayerView> | null = null;
let selectedSquare: AtomicXiangqiSquare | null = null;
let draggingFrom: AtomicXiangqiSquare | null = null;
let annotations: BoardAnnotations | null = null;
// The position whose explosion has already played. A repaint of the same
// position (selection, drag, click-away) draws the aftermath without
// detonating it again.
let detonatedKey: string | null = null;
// Cancels an in-flight capture glide when a newer position arrives.
let cancelCapture: (() => void) | null = null;

const atomicXiangqiWebTenant: WebVariantTenant<AtomicXiangqiColor> = {
  displayName: 'Atomic Xiangqi',
  metaMarkerId: 'xiangqi',
  metaGlyph: '象',
  colors: ['red', 'black'],
  isColor: isXiangqiColor,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  enabled: atomicXiangqiEnabled,
  reviewUrl: (roomId) => `/atomic-xiangqi/game/${encodeURIComponent(roomId)}`,
  reasonPhrase: atomicXiangqiReasonPhrase,
  disabledTitle: 'Atomic Xiangqi disabled',
  disabledBody: 'This client build has the room renderer off.',
  rejectedBody: 'This Atomic Xiangqi room is not active. Create a new invite to start a game.',
  spectatorBody: 'Watching the full board.',
  selectInstruction: 'Select one of your pieces, then choose a destination.',
};

const client = createTenantLiveClient<
  AtomicXiangqiColor,
  AtomicXiangqiPlayerView,
  AtomicXiangqiMove
>({
  tenant: atomicXiangqiWebTenant,
  gameSpecId: ATOMIC_XIANGQI_SPEC_ID,
  defaultRoomId: 'axq_dev',
  boardClass: 'xiangqi-live-board',
  playAgainRequestBody: (state) => ({
    mode: 'pvp',
    gameSpecId: ATOMIC_XIANGQI_SPEC_ID,
    preferredColor: 'random',
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onSnapshotApplied: () => {
    if (core) maybePlayAtomicXiangqiSnapshotSound(core.state.view, core.state.seat);
  },
  onEventApplied: () => {
    if (core) maybePlayAtomicXiangqiSnapshotSound(core.state.view, core.state.seat);
  },
  resetSounds: resetXiangqiSoundState,
  resetState: () => {
    selectedSquare = null;
    draggingFrom = null;
    detonatedKey = null;
  },
  renderBoard,
  renderExtras: renderCheckStatus,
  finishBadges: (view, previous) =>
    view.status.type === 'finished'
      ? finishBadgesForResult({
          colors: atomicXiangqiWebTenant.colors,
          winner: view.status.winner,
          reason: view.status.reason,
          // A captured general is gone from the final board: badge where it stood.
          generalSquare: (color) => generalSquareIn([view.board, previous?.board], color),
        })
      : [],
  // Let the blast and its ghosts finish before the badges land.
  finishBadgeDelayMs: 650,
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
    installBoardInteraction(ctx.refs);
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
    masked: false,
    notate: (move) => `${move.from}-${move.to}`,
    isMoveEvent: isAtomicMoveEvent,
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
  // per-ply history is rebuilt through the atomic kernel on mount and after
  // every reconnect. Each rebuilt view carries its own aftermath.
  replayHistory: {
    rebuild: ({ events, view, state }) => {
      const perspective = isXiangqiColor(state.seat) ? state.seat : view.perspective;
      let gameState = createInitialAtomicXiangqiState(view.id);
      const snapshots = [{ ply: 0, view: getAtomicXiangqiPlayerView(gameState, perspective) }];
      for (const event of events) {
        if (!isAtomicMoveEvent(event)) continue;
        try {
          gameState = applyAtomicXiangqiMove(gameState, event.move);
        } catch {
          return null; // kernel rejected: keep captured history
        }
        snapshots.push({
          ply: snapshots.length,
          view: getAtomicXiangqiPlayerView(gameState, perspective),
        });
      }
      return snapshots;
    },
  },
});

export function bootstrapAtomicXiangqiLiveRoom(): void {
  client.bootstrap();
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderBoard(liveRefs: LiveRefs, view: AtomicXiangqiPlayerView | null): void {
  liveRefs.board.className = 'board xiangqi-live-board';
  liveRefs.board.setAttribute('aria-label', 'Atomic Xiangqi board');
  markAtomicXiangqiBlastHost(liveRefs.board, view);
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }
  const perspective = core?.orientation() ?? view.perspective;
  const drawn = drawnBoardOverlays<AtomicXiangqiSquare>(annotations?.shapes() ?? []);
  const key = atomicXiangqiBlastKey(view);
  const fresh = key !== detonatedKey;
  detonatedKey = key;
  if (fresh) {
    cancelCapture?.();
    cancelCapture = null;
  }
  liveRefs.board.innerHTML = xiangqiBoardSvg(view, perspective, {
    interactive: true,
    selectedSquare,
    draggingFrom,
    arrows: drawn.arrows,
    markers: [...atomicXiangqiBlastMarkers(view, { fresh }), ...drawn.markers],
  });
  if (fresh && atomicXiangqiCaptureAnimates(view)) {
    cancelCapture = animateAtomicXiangqiCapture(liveRefs.board, view, perspective);
  }
}

// The fortress notice, with this game's meaning of check: the perspective's
// general can be removed next move, by capture or by a blast beside it.
function renderCheckStatus(liveRefs: LiveRefs, view: AtomicXiangqiPlayerView | null): void {
  if (view?.status.type !== 'playing' || !view.inCheck || !core?.replay.isLive()) return;
  liveRefs.actionSection.hidden = false;
  liveRefs.actionStatus.replaceChildren();
  const notice = document.createElement('div');
  notice.className = 'action-notice danger';
  const title = document.createElement('strong');
  title.textContent = 'Check';
  const body = document.createElement('p');
  body.textContent = atomicXiangqiCheckBody(
    view.perspective,
    core?.state.seat === view.perspective,
  );
  notice.append(title, body);
  liveRefs.actionStatus.append(notice);
}

// ── Interaction ──────────────────────────────────────────────────────────────

function handleSquareClick(view: AtomicXiangqiPlayerView, square: AtomicXiangqiSquare): void {
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
    playSound(soundForOwnAtomicXiangqiMove(view, result.move));
  }
}

function installBoardInteraction(liveRefs: LiveRefs): void {
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
      handleSquareClick(view, square as AtomicXiangqiSquare);
      renderBoard(liveRefs, view);
    },
    canDragFrom: (square) => canDragPiece(square as AtomicXiangqiSquare),
    ghostHtml: (square) => {
      const piece = core?.state.view?.board[square as AtomicXiangqiSquare];
      if (!piece) return null;
      return xiangqiPieceGhostSvg(
        piece,
        drawsCrossedSoldier(piece, coordOf(square as AtomicXiangqiSquare).rank),
      );
    },
    onDragStart: (from) => {
      selectedSquare = from as AtomicXiangqiSquare;
      draggingFrom = from as AtomicXiangqiSquare;
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
    onDrop: (from, to) =>
      dropPiece(liveRefs, from as AtomicXiangqiSquare, to as AtomicXiangqiSquare | null),
  });
}

function canDragPiece(square: AtomicXiangqiSquare): boolean {
  const view = core?.state.view;
  if (!view || !core?.replay.isLive() || core.connection() !== 'connected') return false;
  if (!isXiangqiColor(core.state.seat)) return false;
  if (view.status.type !== 'playing' || view.status.turn !== core.state.seat) return false;
  const piece = view.board[square];
  if (!piece) return false;
  return piece.color === view.perspective;
}

function dropPiece(
  liveRefs: LiveRefs,
  from: AtomicXiangqiSquare,
  to: AtomicXiangqiSquare | null,
): void {
  draggingFrom = null;
  const view = core?.state.view;
  const move = to && view ? view.legalMoves.find((m) => m.from === from && m.to === to) : undefined;
  selectedSquare = null;
  if (move && view && core?.send({ type: 'move', from: move.from, to: move.to })) {
    playSound(soundForOwnAtomicXiangqiMove(view, move));
  }
  if (core?.state.view) renderBoard(liveRefs, core.state.view);
}

// ── Notation + replay capture key ────────────────────────────────────────────

function isAtomicMoveEvent(event: TenantLiveEvent): event is AtomicMoveEvent {
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

function replayPositionKey(view: AtomicXiangqiPlayerView): string {
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
