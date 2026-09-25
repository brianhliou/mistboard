// Live multiplayer room client for Jungle / Dou Shou Qi (斗兽棋) — a
// PERFECT-INFORMATION tenant on the generic live-client core
// (variant-tenant/live-client.ts owns bootstrap, frames, renderAll, replay
// capture, and the move list). This module keeps what is genuinely Jungle's:
// the wire view type, board rendering (jungle-render.ts), click/drag
// interaction, sounds, and the from-to move notation.

import {
  applyJungleMove,
  createInitialJungleState,
  getJunglePlayerView,
  type JungleColor,
  type JungleGameStatus,
  type JungleMove,
  type JunglePieceRole,
  type JungleSquare,
} from '@mistboard/game';
import './live-xiangqi.css';
import { jungleEnabled } from './feature-flags.js';
import {
  animateJungleBoardMove,
  JUNGLE_BOARD_VIEW,
  junglePieceGhostSvg,
  renderJungleBoardSvg,
} from './jungle-render.js';
import { jungleFinishBadges } from './live-finish-badges.js';
import {
  maybePlayJungleSnapshotSound,
  resetJungleSoundState,
  soundForOwnJungleMove,
} from './live-jungle-sound.js';
import { playSound } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
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

// ── Wire shapes (mirror JunglePlayerView; the board is a plain piece map) ─────

type JungleWireBoardEntry = { color: JungleColor; role: JunglePieceRole };

export type JungleWireView = {
  id: string;
  perspective: JungleColor;
  board: Partial<Record<JungleSquare, JungleWireBoardEntry>>;
  visibleSquares: JungleSquare[];
  legalMoves: JungleMove[];
  status: JungleGameStatus;
  moveNumber: number;
  lastMove?: JungleMove;
};

type JungleMoveEvent = TenantMovePlayed<JungleColor, JungleMove>;

// ── Jungle-owned interaction/render state ────────────────────────────────────

let core: TenantLiveClientContext<JungleColor, JungleWireView> | null = null;
let selectedSquare: JungleSquare | null = null;
// Right-click arrows/circles the player drew on this board.
let annotations: BoardAnnotations | null = null;
let draggingFrom: JungleSquare | null = null;
let roomMode: 'pve' | 'pvp' = 'pvp';
let pveEngineId: string | null = null;

function isJungleColor(value: unknown): value is JungleColor {
  return value === 'red' || value === 'black';
}

function oppositeColor(color: JungleColor): JungleColor {
  return color === 'red' ? 'black' : 'red';
}

const jungleWebTenant: WebVariantTenant<JungleColor> = {
  displayName: 'Jungle Chess',
  metaMarkerId: 'jungle',
  metaGlyph: '虎',
  colors: ['red', 'black'],
  isColor: isJungleColor,
  oppositeColor,
  enabled: jungleEnabled,
  reviewUrl: (roomId) => `/jungle/game/${encodeURIComponent(roomId)}`,
  reasonPhrase: jungleReasonPhrase,
  disabledTitle: 'Jungle disabled',
  disabledBody: 'This client build has the room renderer off.',
  rejectedBody: 'This Jungle room is not active. Create a new invite to start a game.',
  spectatorBody: 'Watching the game.',
  selectInstruction: 'Select one of your animals, then tap where it should move.',
  seatLabel: (seat) => (seat === 'red' ? 'Red' : 'Blue'),
  showPregameTurn: true,
};

function jungleReasonPhrase(reason: string): string {
  switch (reason) {
    case 'den-entered':
      return 'reaching the den';
    case 'pieces-captured':
      return 'capturing every animal';
    case 'stalemate':
      return 'no legal move';
    case 'no-progress':
      return 'no progress';
    case 'repetition':
      return 'repetition';
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

const client = createTenantLiveClient<JungleColor, JungleWireView, JungleMove>({
  tenant: jungleWebTenant,
  gameSpecId: 'jungle',
  defaultRoomId: 'jgl_dev',
  boardClass: 'jungle-live-board',
  chrome: {
    roomMode: () => roomMode,
  },
  playAgainRequestBody: (state) => ({
    mode: roomMode,
    gameSpecId: 'jungle',
    // Alternate the opener each rematch: request the seat opposite this game's.
    preferredColor: isJungleColor(state.seat) ? oppositeColor(state.seat) : 'random',
    ...(roomMode === 'pve' && pveEngineId ? { engineId: pveEngineId } : {}),
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onFrame: (frame) => {
    if (frame.roomMode === 'pve' || frame.roomMode === 'pvp') roomMode = frame.roomMode;
    if (typeof frame.pveEngineId === 'string') pveEngineId = frame.pveEngineId;
  },
  onSnapshotApplied: () => {
    if (core) maybePlayJungleSnapshotSound(core.state.view, core.state.seat);
  },
  onEventApplied: () => {
    if (core) maybePlayJungleSnapshotSound(core.state.view, core.state.seat);
  },
  resetSounds: resetJungleSoundState,
  resetState: () => {
    selectedSquare = null;
    draggingFrom = null;
    roomMode = 'pvp';
    pveEngineId = null;
  },
  renderBoard,
  // Piece glides (pieceAnimation pref). Live: only REMOTE moves animate -- an own
  // move already re-rendered synchronously at input time, so animating the server
  // echo would double-play it. Scrubs glide the stepped-into move forward and
  // reverse-glide the undone one. Skipped mid-drag so a glide never fights the
  // drag ghost. Mirrors live-banqi.ts; this room had no hook at all until then,
  // so jungle glided everywhere EXCEPT the one surface people actually play on.
  finishBadges: (view, previous) =>
    view.status.type === 'finished'
      ? jungleFinishBadges({
          winner: view.status.winner,
          reason: view.status.reason,
          lastMove: view.lastMove,
          previousLastMove: previous?.lastMove,
        })
      : [],
  animateBoard: (liveRefs, view, takePendingAnimation) => {
    if (!view || draggingFrom) return;
    const pending = takePendingAnimation();
    if (!pending) return;
    const perspective = core?.orientation() ?? view.perspective;
    if (pending.kind === 'live') {
      if (pending.color === core?.state.seat) return;
      animateJungleBoardMove(liveRefs.board, pending.move, perspective);
      return;
    }
    if (pending.direction === 'forward') {
      if (view.lastMove) animateJungleBoardMove(liveRefs.board, view.lastMove, perspective);
      return;
    }
    const undone = pending.prevView?.lastMove;
    if (undone) animateJungleBoardMove(liveRefs.board, undone, perspective, { reverse: true });
  },
  onDisabled: () => {
    selectedSquare = null;
  },
  setup: (ctx) => {
    core = ctx;
    installJungleBoardInteraction(ctx.refs);
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
    isMoveEvent: isJungleMoveEvent,
  },
  replayCapture: {
    positionKey: (view) =>
      JSON.stringify({
        board: view.board,
        lastMove: view.lastMove ?? null,
        status: view.status,
      }),
    // Ply = number of moves played so far; the initial position is ply 0.
    plyForView: (_view, ctx) => ctx.events.filter(isJungleMoveEvent).length,
  },
  // Perfect information: the event log carries every move unredacted, so the
  // full per-ply history is rebuilt through the kernel on mount and after
  // every reconnect (#80). The kernel's JunglePlayerView is structurally the
  // wire view. No new server payload.
  replayHistory: {
    rebuild: ({ events, view, state }) => {
      const perspective = isJungleColor(state.seat) ? state.seat : view.perspective;
      let gameState = createInitialJungleState(view.id);
      const snapshots = [{ ply: 0, view: getJunglePlayerView(gameState, perspective) }];
      for (const event of events) {
        if (!isJungleMoveEvent(event)) continue;
        const next = applyJungleMove(gameState, event.move);
        if (next === gameState) return null; // kernel rejected: keep captured history
        gameState = next;
        snapshots.push({
          ply: snapshots.length,
          view: getJunglePlayerView(gameState, perspective),
        });
      }
      return snapshots;
    },
  },
});

export function bootstrapJungleLiveRoom(): void {
  client.bootstrap();
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderBoard(liveRefs: LiveRefs, view: JungleWireView | null): void {
  liveRefs.board.className = 'board jungle-live-board';
  liveRefs.board.setAttribute('aria-label', 'Jungle Chess board');
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }
  const targets = selectedSquare
    ? view.legalMoves.filter((m) => m.from === selectedSquare).map((m) => m.to)
    : [];
  const drawn = drawnBoardOverlays<JungleSquare>(annotations?.shapes() ?? []);
  liveRefs.board.innerHTML = renderJungleBoardSvg(view.board, {
    arrows: drawn.arrows,
    markers: drawn.markers,
    perspective: core?.orientation() ?? view.perspective,
    interactive: true,
    selected: selectedSquare,
    targets,
    draggingFrom,
    lastMove: view.lastMove ?? null,
  });
}

// Click is delegated to the persistent board container once at mount so it
// survives every innerHTML re-render (closest [data-square] reads the cell).
function installJungleBoardInteraction(liveRefs: LiveRefs): void {
  annotations = installBoardAnnotations({
    board: liveRefs.board,
    gameId: () => annotationOwner(core?.state.view),
    repaint: () => {
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
  });
  installBoardDrag({
    board: liveRefs.board,
    // The board scales well above its SVG units, so size the ghost to the on-screen cell.
    ghostSizePx: () => {
      const width = liveRefs.board.getBoundingClientRect().width;
      return width > 0 ? width / JUNGLE_BOARD_VIEW.files : JUNGLE_BOARD_VIEW.cell;
    },
    onSquareClick: (square) => {
      const view = core?.state.view;
      if (!view) return;
      handleSquareClick(view, square as JungleSquare);
      renderBoard(liveRefs, view);
    },
    canDragFrom: (square) => canDragJunglePiece(square as JungleSquare),
    ghostHtml: (square) => {
      const piece = core?.state.view?.board[square as JungleSquare];
      return piece ? junglePieceGhostSvg(piece) : null;
    },
    onDragStart: (from) => {
      selectedSquare = from as JungleSquare;
      draggingFrom = from as JungleSquare;
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
    onDrop: (from, to) =>
      dropJunglePiece(liveRefs, from as JungleSquare, to as JungleSquare | null),
  });
}

// A piece may be lifted if it's your own animal on your turn (it snaps back if dropped
// somewhere it cannot move). Mirrors the click-to-move select rule.
function canDragJunglePiece(square: JungleSquare): boolean {
  if (!core?.canActNow() || core.connection() !== 'connected') return false;
  const view = core.state.view;
  const seat = core.state.seat;
  if (!view || !isJungleColor(seat)) return false;
  const piece = view.board[square];
  return !!piece && piece.color === seat;
}

function dropJunglePiece(liveRefs: LiveRefs, from: JungleSquare, to: JungleSquare | null): void {
  draggingFrom = null;
  const view = core?.state.view;
  const move = to && view ? view.legalMoves.find((m) => m.from === from && m.to === to) : undefined;
  if (move && view) {
    selectedSquare = null;
    core?.send({ type: 'move', from: move.from, to: move.to });
    playSound(soundForOwnJungleMove(view, move));
  } else {
    selectedSquare = null;
  }
  if (core?.state.view) renderBoard(liveRefs, core.state.view);
}

function handleSquareClick(view: JungleWireView, square: JungleSquare): void {
  if (!core?.replay.isLive() || core.connection() !== 'connected') return;
  const seat = core.state.seat;
  if (!isJungleColor(seat) || view.status.type !== 'playing' || view.status.turn !== seat) {
    selectedSquare = null;
    return;
  }
  const piece = view.board[square];
  // Click your own animal to select it (or re-select another of yours).
  if (piece && piece.color === seat) {
    selectedSquare = square;
    return;
  }
  // With a selection, a click on a legal target plays the move.
  if (selectedSquare) {
    const move = view.legalMoves.find((m) => m.from === selectedSquare && m.to === square);
    if (move) {
      selectedSquare = null;
      core.send({ type: 'move', from: move.from, to: move.to });
      playSound(soundForOwnJungleMove(view, move));
      return;
    }
  }
  selectedSquare = null;
}

function isJungleMoveEvent(event: TenantLiveEvent): event is JungleMoveEvent {
  const move = (event as { move?: unknown }).move;
  return (
    event.type === 'move-played' &&
    isJungleColor((event as { color?: unknown }).color) &&
    typeof move === 'object' &&
    move !== null &&
    typeof (move as { from?: unknown }).from === 'string' &&
    typeof (move as { to?: unknown }).to === 'string'
  );
}
