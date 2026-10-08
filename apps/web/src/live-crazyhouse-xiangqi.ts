// Live multiplayer room client for Crazyhouse Xiangqi (9x10, open
// information, a captured piece joins the capturer's hand and may be dropped
// back). The standard xiangqi board (xiangqi-board.ts) with the fortress
// room's hands: a pocket strip above and below the board, click a hand piece
// or drag it out, and the points it may drop on are marked like any other
// legal destination. Everything else is the shared tenant live client.

import {
  applyCrazyhouseXiangqiMove,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiDropRole,
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
  type CrazyhouseXiangqiSquare,
  coordOf,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiPlayerView,
  isCrazyhouseXiangqiDropMove,
} from '@mistboard/game';
import './live-xiangqi.css';
import './drop-reserve.css';
import {
  crazyhouseXiangqiBoardMoves,
  crazyhouseXiangqiBoardView,
  crazyhouseXiangqiDropTargets,
  crazyhouseXiangqiLastDrop,
  crazyhouseXiangqiMoveLabel,
  crazyhouseXiangqiReasonPhrase,
  fillCrazyhouseXiangqiReserve,
  isCrazyhouseXiangqiDropRole,
} from './crazyhouse-xiangqi-view.js';
import { crazyhouseXiangqiEnabled } from './feature-flags.js';
import { soundForOwnCrazyhouseXiangqiMove } from './live-crazyhouse-xiangqi-sound.js';
import { finishBadgesForResult, generalSquareIn } from './live-finish-badges.js';
import { playSound } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import {
  classifyXiangqiOpponentSound,
  maybePlayXiangqiSnapshotSound,
  resetXiangqiSoundState,
  type XiangqiSeatOrSpectator,
  type XiangqiSoundView,
} from './live-xiangqi-sound.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import {
  annotationOwner,
  type BoardAnnotations,
  drawnBoardOverlays,
  installBoardAnnotations,
} from './variant-tenant/board-annotations.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import { installHandDrag } from './variant-tenant/hand-drag.js';
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
  xiangqiPieceGhostSvg,
} from './xiangqi-board.js';
import { drawsCrossedSoldier } from './xiangqi-crossed-soldier.js';

type CrazyhouseMoveEvent = TenantMovePlayed<CrazyhouseXiangqiColor, CrazyhouseXiangqiMove>;

let core: TenantLiveClientContext<CrazyhouseXiangqiColor, CrazyhouseXiangqiPlayerView> | null =
  null;
// Snapshot extras that ride the frame (read by the chrome + play-again body).
let roomMode: 'pve' | 'pvp' = 'pvp';
let pveEngineId: string | null = null;
let forfeitDeadline: number | null = null;
let selectedSquare: CrazyhouseXiangqiSquare | null = null;
let selectedDropRole: CrazyhouseXiangqiDropRole | null = null;
let draggingFrom: CrazyhouseXiangqiSquare | null = null;
let annotations: BoardAnnotations | null = null;

const crazyhouseXiangqiWebTenant: WebVariantTenant<CrazyhouseXiangqiColor> = {
  displayName: 'variant.crazyhouseXiangqi.name',
  colors: ['red', 'black'],
  isColor: isXiangqiColor,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  enabled: crazyhouseXiangqiEnabled,
  reviewUrl: (roomId) => `/crazyhouse-xiangqi/game/${encodeURIComponent(roomId)}`,
  reasonPhrase: crazyhouseXiangqiReasonPhrase,
  spectatorBody: 'live.spectatorFullBoard',
  selectInstruction: 'live.selectFortress',
};

const client = createTenantLiveClient<
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiPlayerView,
  CrazyhouseXiangqiMove
>({
  tenant: crazyhouseXiangqiWebTenant,
  gameSpecId: CRAZYHOUSE_XIANGQI_SPEC_ID,
  defaultRoomId: 'chx_dev',
  flippable: true,
  boardClass: 'xiangqi-live-board',
  chrome: {
    roomMode: () => roomMode,
    forfeitDeadline: () => forfeitDeadline,
  },
  playAgainRequestBody: (state) => ({
    mode: roomMode,
    gameSpecId: CRAZYHOUSE_XIANGQI_SPEC_ID,
    preferredColor: 'random',
    ...(roomMode === 'pvp' ? { rated: false } : {}),
    ...(roomMode === 'pve' && pveEngineId ? { engineId: pveEngineId } : {}),
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onFrame: (frame) => {
    if (frame.roomMode === 'pve' || frame.roomMode === 'pvp') roomMode = frame.roomMode;
    if (typeof frame.pveEngineId === 'string') pveEngineId = frame.pveEngineId;
    else if (frame.roomMode !== 'pve') pveEngineId = null;
    forfeitDeadline = typeof frame.forfeitDeadline === 'number' ? frame.forfeitDeadline : null;
  },
  onSnapshotApplied: () => playSnapshotSound(),
  onEventApplied: () => playSnapshotSound(),
  resetSounds: resetXiangqiSoundState,
  resetState: () => {
    roomMode = 'pvp';
    pveEngineId = null;
    forfeitDeadline = null;
    selectedSquare = null;
    selectedDropRole = null;
    draggingFrom = null;
  },
  renderBoard: renderBoardReconciled,
  renderExtras: (refs, view) => {
    renderHands(refs, view);
  },
  finishBadges: (view, previous) =>
    view.status.type === 'finished'
      ? finishBadgesForResult({
          colors: crazyhouseXiangqiWebTenant.colors,
          winner: view.status.winner,
          reason: view.status.reason,
          generalSquare: (color) => generalSquareIn([view.board, previous?.board], color),
        })
      : [],
  animateBoard: (liveRefs, view, takePendingAnimation) => {
    if (!view || draggingFrom) return;
    const pending = takePendingAnimation();
    if (!pending) return;
    const perspective = core?.orientation() ?? view.perspective;
    // A drop has no origin to glide from: it simply lands, ringed.
    if (pending.kind === 'live') {
      if (pending.color === core?.state.seat || isCrazyhouseXiangqiDropMove(pending.move)) return;
      animateXiangqiBoardMove(liveRefs.board, pending.move, perspective);
      return;
    }
    if (pending.direction === 'forward') {
      const last = view.lastMove;
      if (last && !isCrazyhouseXiangqiDropMove(last)) {
        animateXiangqiBoardMove(liveRefs.board, last, perspective);
      }
      return;
    }
    const undone = pending.prevView?.lastMove;
    if (undone && !isCrazyhouseXiangqiDropMove(undone)) {
      animateXiangqiBoardMove(liveRefs.board, undone, perspective, { reverse: true });
    }
  },
  onDisabled: (refs) => {
    const view = core?.displayedView() ?? null;
    renderHands(refs, view);
    selectedSquare = null;
    selectedDropRole = null;
  },
  setup: (ctx) => {
    core = ctx;
    installBoardInteraction(ctx.refs);
    // Re-render the hands (they draw in the stored piece set) when the reader
    // changes their xiangqi appearance mid-game.
    window.addEventListener(xiangqiAppearanceChangedEvent, ctx.renderAll);
    installSelectionClickAway({
      roots: () => [core?.refs.board, core?.refs.capturesBottom],
      hasSelection: () => selectedSquare !== null || selectedDropRole !== null,
      clearSelection: () => {
        selectedSquare = null;
        selectedDropRole = null;
        draggingFrom = null;
        core?.renderAll();
      },
    });
  },
  moveList: {
    rowClass: 'move-row xiangqi-move-row',
    cellPrefix: 'xiangqi-move-row',
    listClass: 'xiangqi-move-list',
    masked: false,
    notate: crazyhouseXiangqiMoveLabel,
    isMoveEvent: isCrazyhouseMoveEvent,
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
  // Perfect information: the event log carries every move (board and drop)
  // unredacted, so the per-ply history is rebuilt through the kernel on mount
  // and after every reconnect. Each rebuilt view carries its hands.
  replayHistory: {
    rebuild: ({ events, view, state }) => {
      const perspective = isXiangqiColor(state.seat) ? state.seat : view.perspective;
      let gameState = createInitialCrazyhouseXiangqiState(view.id);
      const snapshots = [{ ply: 0, view: getCrazyhouseXiangqiPlayerView(gameState, perspective) }];
      for (const event of events) {
        if (!isCrazyhouseMoveEvent(event)) continue;
        try {
          gameState = applyCrazyhouseXiangqiMove(gameState, event.move);
        } catch {
          return null; // kernel rejected: keep captured history
        }
        snapshots.push({
          ply: snapshots.length,
          view: getCrazyhouseXiangqiPlayerView(gameState, perspective),
        });
      }
      return snapshots;
    },
  },
});

export function bootstrapCrazyhouseXiangqiLiveRoom(): void {
  client.bootstrap();
}

// ── Sounds ───────────────────────────────────────────────────────────────────

// The xiangqi policy, with one more reading of the opponent's move: a drop
// sounds as a drop rather than a quiet move.
function playSnapshotSound(): void {
  if (!core) return;
  maybePlayXiangqiSnapshotSound(
    core.state.view as XiangqiSoundView | null,
    core.state.seat as XiangqiSeatOrSpectator,
    (prev, next, seat) => {
      const kind = classifyXiangqiOpponentSound(prev, next, seat);
      const last = core?.state.view?.lastMove;
      if (kind === 'move' && last && isCrazyhouseXiangqiDropMove(last)) return 'drop';
      return kind;
    },
  );
}

// ── Rendering ────────────────────────────────────────────────────────────────

// The core calls this once per renderAll, before the hand strips read the
// selection, so reconcile the selection against the LIVE view here.
function renderBoardReconciled(liveRefs: LiveRefs, view: CrazyhouseXiangqiPlayerView | null): void {
  reconcileInteractionState(core?.state.view ?? null);
  renderBoard(liveRefs, view);
}

function renderBoard(liveRefs: LiveRefs, view: CrazyhouseXiangqiPlayerView | null): void {
  liveRefs.board.className = 'board xiangqi-live-board';
  liveRefs.board.setAttribute('aria-label', 'Crazyhouse Xiangqi board');
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }
  const perspective = core?.orientation() ?? view.perspective;
  const drawn = drawnBoardOverlays<CrazyhouseXiangqiSquare>(annotations?.shapes() ?? []);
  liveRefs.board.innerHTML = xiangqiBoardSvg(crazyhouseXiangqiBoardView(view), perspective, {
    interactive: true,
    selectedSquare,
    draggingFrom,
    arrows: drawn.arrows,
    markers: drawn.markers,
    dropTargets: crazyhouseXiangqiDropTargets(view, selectedDropRole),
    lastDropSquare: crazyhouseXiangqiLastDrop(view),
  });
}

function renderHands(liveRefs: LiveRefs, view: CrazyhouseXiangqiPlayerView | null): void {
  liveRefs.capturesTop.replaceChildren();
  liveRefs.capturesBottom.replaceChildren();
  if (!view) return;
  const bottom = core?.orientation() ?? view.perspective;
  const top = bottom === 'red' ? 'black' : 'red';
  fillCrazyhouseXiangqiReserve(liveRefs.capturesTop, view, top, { pocket: true });
  const ownHand = core?.state.seat === bottom;
  fillCrazyhouseXiangqiReserve(liveRefs.capturesBottom, view, bottom, {
    pocket: true,
    interactive: canInteract(view) && ownHand,
    selectedRole: selectedDropRole,
    onSelect: (role) => {
      if (!canInteract(view) || core?.state.seat !== bottom) return;
      selectedSquare = null;
      selectedDropRole = selectedDropRole === role ? null : role;
      core?.renderAll();
    },
  });
}

// ── Interaction ──────────────────────────────────────────────────────────────

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
    onSquareClick: (square) => handleSquareClick(square as CrazyhouseXiangqiSquare),
    canDragFrom: (square) => canDragPiece(square as CrazyhouseXiangqiSquare),
    ghostHtml: (square) => {
      const piece = core?.state.view?.board[square as CrazyhouseXiangqiSquare];
      if (!piece) return null;
      return xiangqiPieceGhostSvg(
        piece,
        drawsCrossedSoldier(piece, coordOf(square as CrazyhouseXiangqiSquare).rank),
      );
    },
    onDragStart: (from) => {
      selectedDropRole = null;
      selectedSquare = from as CrazyhouseXiangqiSquare;
      draggingFrom = from as CrazyhouseXiangqiSquare;
      renderBoardIfMounted();
    },
    onDrop: (from, to) =>
      dropBoardPiece(from as CrazyhouseXiangqiSquare, to as CrazyhouseXiangqiSquare | null),
  });
  installHandDrag({
    hand: liveRefs.capturesBottom,
    ghostSizePx: XIANGQI_PIECE_SIZE,
    isRole: isCrazyhouseXiangqiDropRole,
    canDragRole,
    ghostHtml: (role) => {
      const seat = core?.state.seat;
      return isXiangqiColor(seat) ? xiangqiPieceGhostSvg({ color: seat, role }) : null;
    },
    onDragStart: (role) => {
      selectedSquare = null;
      selectedDropRole = role;
      core?.renderAll();
    },
    onDrop: (role, to) => dropHandPiece(role, to),
  });
}

function handleSquareClick(square: CrazyhouseXiangqiSquare): void {
  const view = core?.state.view;
  if (!view || !canInteract(view)) return;
  if (selectedDropRole) {
    if (crazyhouseXiangqiDropTargets(view, selectedDropRole).includes(square)) {
      sendMove(view, { drop: selectedDropRole, to: square });
      return;
    }
    // A click off the targets puts the hand piece back and reads as a board click.
    selectedDropRole = null;
  }

  if (!selectedSquare) {
    if (canSelect(view, square)) selectedSquare = square;
    core?.renderAll();
    return;
  }
  if (selectedSquare === square) {
    selectedSquare = null;
    core?.renderAll();
    return;
  }
  const move = crazyhouseXiangqiBoardMoves(view, selectedSquare).find(
    (candidate) => candidate.to === square,
  );
  if (move) {
    sendMove(view, move);
    return;
  }
  selectedSquare = canSelect(view, square) ? square : null;
  core?.renderAll();
}

function sendMove(view: CrazyhouseXiangqiPlayerView, move: CrazyhouseXiangqiMove): void {
  selectedSquare = null;
  selectedDropRole = null;
  draggingFrom = null;
  const message = isCrazyhouseXiangqiDropMove(move)
    ? { type: 'move', drop: move.drop, to: move.to }
    : { type: 'move', from: move.from, to: move.to };
  if (core?.send(message)) playSound(soundForOwnCrazyhouseXiangqiMove(view, move));
  core?.renderAll();
}

function canDragPiece(square: CrazyhouseXiangqiSquare): boolean {
  const view = core?.state.view;
  if (!view || !canInteract(view)) return false;
  const piece = view.board[square];
  return !!piece && piece.color === core?.state.seat;
}

function dropBoardPiece(from: CrazyhouseXiangqiSquare, to: CrazyhouseXiangqiSquare | null): void {
  draggingFrom = null;
  const view = core?.state.view;
  const move =
    to && view
      ? crazyhouseXiangqiBoardMoves(view, from).find((candidate) => candidate.to === to)
      : undefined;
  if (move && view) {
    sendMove(view, move);
    return;
  }
  selectedSquare = null;
  core?.renderAll();
}

function canDragRole(role: CrazyhouseXiangqiDropRole): boolean {
  const view = core?.state.view;
  const seat = core?.state.seat;
  if (!view || !canInteract(view) || !isXiangqiColor(seat)) return false;
  return (view.hands[seat][role] ?? 0) > 0;
}

function dropHandPiece(role: CrazyhouseXiangqiDropRole, to: string | null): void {
  const view = core?.state.view;
  if (view && canInteract(view) && to) {
    const square = to as CrazyhouseXiangqiSquare;
    if (crazyhouseXiangqiDropTargets(view, role).includes(square)) {
      sendMove(view, { drop: role, to: square });
      return;
    }
  }
  selectedDropRole = null;
  core?.renderAll();
}

function canInteract(view: CrazyhouseXiangqiPlayerView): boolean {
  return (
    !!core &&
    core.replay.isLive() &&
    core.connection() === 'connected' &&
    view.status.type === 'playing' &&
    isXiangqiColor(core.state.seat) &&
    view.status.turn === core.state.seat
  );
}

function canSelect(view: CrazyhouseXiangqiPlayerView, square: CrazyhouseXiangqiSquare): boolean {
  if (!canInteract(view)) return false;
  const piece = view.board[square];
  return (
    !!piece &&
    piece.color === core?.state.seat &&
    crazyhouseXiangqiBoardMoves(view, square).length > 0
  );
}

function reconcileInteractionState(view: CrazyhouseXiangqiPlayerView | null): void {
  if (!view || !canInteract(view)) {
    selectedSquare = null;
    selectedDropRole = null;
    return;
  }
  if (selectedSquare && crazyhouseXiangqiBoardMoves(view, selectedSquare).length === 0) {
    selectedSquare = null;
  }
  const seat = core?.state.seat;
  if (selectedDropRole && isXiangqiColor(seat) && (view.hands[seat][selectedDropRole] ?? 0) <= 0) {
    selectedDropRole = null;
  }
}

function renderBoardIfMounted(): void {
  if (core?.refs) renderBoard(core.refs, core.displayedView());
}

// ── Notation + replay capture key ────────────────────────────────────────────

function isCrazyhouseMoveEvent(event: TenantLiveEvent): event is CrazyhouseMoveEvent {
  const move = (event as { move?: unknown }).move;
  if (event.type !== 'move-played') return false;
  if (!isXiangqiColor((event as { color?: unknown }).color)) return false;
  if (typeof move !== 'object' || move === null) return false;
  const shape = move as { from?: unknown; to?: unknown; drop?: unknown };
  if (typeof shape.to !== 'string') return false;
  return typeof shape.from === 'string' || typeof shape.drop === 'string';
}

function replayPositionKey(view: CrazyhouseXiangqiPlayerView): string {
  const board = Object.entries(view.board)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([square, piece]) => [square, piece.color, piece.role]);
  return JSON.stringify({
    board,
    hands: view.hands,
    lastMove: view.lastMove ?? null,
    moveNumber: view.moveNumber,
    perspective: view.perspective,
    turn: view.status.type === 'playing' ? view.status.turn : view.status.type,
  });
}
