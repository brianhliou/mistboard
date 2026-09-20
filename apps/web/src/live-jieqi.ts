// Live multiplayer room client for jieqi (揭棋) — an IDENTITY-hidden tenant on
// the generic live-client core (variant-tenant/live-client.ts owns bootstrap,
// frame application, the renderAll skeleton, replay capture, and the two-column
// move list).
//
// Jieqi positions are fully PUBLIC: both players see every square, every piece's
// color, and every move. The only hidden axis is piece IDENTITY (a face-down
// piece's role). So this client carries NO fog: no fog mask, no visibleSquares,
// no opponent-move stripping, and the move list is unmasked (masked: false) —
// the server already redacts identities in the per-seat view, and there is
// nothing further to redact across replay.
//
// This module keeps what is genuinely jieqi's: the wire view type, board
// rendering (live-jieqi-render.ts), click/drag interaction
// (live-jieqi-interaction.ts), the captured-pool panel ("?" for an identity the
// viewer cannot see), sounds, and the from-to move notation.

import type {
  JieqiColor,
  JieqiGameStatus,
  JieqiMove,
  JieqiPieceRole,
  JieqiSquare,
} from '@mistboard/game';
import './live-xiangqi.css';
import { jieqiEnabled } from './feature-flags.js';
import { jieqiClickResult } from './live-jieqi-interaction.js';
import {
  animateJieqiBoardMove,
  installJieqiBoardStyles,
  JIEQI_PIECE_PX,
  jieqiPieceGhostSvg,
  renderJieqiBoardSvg,
} from './live-jieqi-render.js';
import {
  maybePlayJieqiSnapshotSound,
  resetJieqiSoundState,
  soundForOwnJieqiMove,
} from './live-jieqi-sound.js';
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
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import { renderXiangqiPieceGlyphed } from './xiangqi-piece-sets.js';

// ── Wire shapes (mirror JieqiPlayerView; board entries are faceDown-tagged) ──

type JieqiWireBoardEntry =
  | { color: JieqiColor; role: JieqiPieceRole; faceDown: false }
  | { color: JieqiColor; faceDown: true };

type JieqiWireCaptured = { owner: JieqiColor; role: JieqiPieceRole | null };

export type JieqiWireView = {
  id: string;
  perspective: JieqiColor;
  board: Partial<Record<JieqiSquare, JieqiWireBoardEntry>>;
  legalMoves: JieqiMove[];
  captured: JieqiWireCaptured[];
  inCheck: boolean;
  status: JieqiGameStatus;
  moveNumber: number;
  lastMove?: JieqiMove;
};

type JieqiMoveEvent = TenantMovePlayed<JieqiColor, JieqiMove>;

// ── Jieqi-owned interaction/render state ─────────────────────────────────────

let core: TenantLiveClientContext<JieqiColor, JieqiWireView> | null = null;
let selectedSquare: JieqiSquare | null = null;
// Right-click arrows/circles the player drew on this board.
let annotations: BoardAnnotations | null = null;
// The square a piece is being dragged from (its piece is lifted off the board so
// only the floating ghost shows). Null when not dragging.
let draggingFrom: JieqiSquare | null = null;
// Snapshot extras that ride the frame (read by the chrome + play-again body).
let roomMode: 'pve' | 'pvp' = 'pvp';
let pveEngineId: string | null = null;

const jieqiWebTenant: WebVariantTenant<JieqiColor> = {
  displayName: 'Jieqi',
  metaMarkerId: 'jieqi',
  metaGlyph: '象',
  colors: ['red', 'black'],
  isColor: isJieqiColor,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  enabled: jieqiEnabled,
  reviewUrl: (roomId) => `/jieqi/game/${encodeURIComponent(roomId)}`,
  reasonPhrase: jieqiReasonPhrase,
  disabledTitle: 'Jieqi disabled',
  disabledBody: 'This client build has the room renderer off.',
  rejectedBody: 'This Jieqi room is not active. Create a new invite to start a game.',
  spectatorBody: 'Watching without private information.',
  selectInstruction: 'Select one of your pieces, then choose a destination.',
};

const client = createTenantLiveClient<JieqiColor, JieqiWireView, JieqiMove>({
  tenant: jieqiWebTenant,
  gameSpecId: 'jieqi',
  defaultRoomId: 'jq_dev',
  boardClass: 'jieqi-live-board',
  chrome: {
    roomMode: () => roomMode,
  },
  playAgainRequestBody: (state) => ({
    mode: roomMode,
    gameSpecId: 'jieqi',
    preferredColor: 'random',
    ...(roomMode === 'pve' && pveEngineId ? { engineId: pveEngineId } : {}),
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onFrame: (frame) => {
    if (frame.roomMode === 'pve' || frame.roomMode === 'pvp') roomMode = frame.roomMode;
    if (typeof frame.pveEngineId === 'string') pveEngineId = frame.pveEngineId;
  },
  onSnapshotApplied: () => {
    if (core) maybePlayJieqiSnapshotSound(core.state.view, core.state.seat);
  },
  onEventApplied: () => {
    if (core) maybePlayJieqiSnapshotSound(core.state.view, core.state.seat);
  },
  resetSounds: resetJieqiSoundState,
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
  // drag ghost. A jieqi move may also REVEAL the piece it moves; the glide
  // carries whatever the final render put on the destination square, so the
  // reveal lands with the piece rather than ahead of it.
  animateBoard: (liveRefs, view, takePendingAnimation) => {
    if (!view || draggingFrom) return;
    const pending = takePendingAnimation();
    if (!pending) return;
    const perspective = orientationFor(view);
    if (pending.kind === 'live') {
      if (pending.color === core?.state.seat) return;
      animateJieqiBoardMove(liveRefs.board, pending.move, perspective);
      return;
    }
    if (pending.direction === 'forward') {
      if (view.lastMove) animateJieqiBoardMove(liveRefs.board, view.lastMove, perspective);
      return;
    }
    const undone = pending.prevView?.lastMove;
    if (undone) animateJieqiBoardMove(liveRefs.board, undone, perspective, { reverse: true });
  },
  renderExtras: (refs, view) => renderCapturedPools(refs, view),
  onDisabled: (refs) => {
    // renderCapturedPools ran before the enabled guard in the original, so it
    // paints even when the flag is off; then the selection clears.
    renderCapturedPools(refs, core?.displayedView() ?? null);
    selectedSquare = null;
  },
  setup: (ctx) => {
    core = ctx;
    installJieqiBoardStyles();
    installJieqiBoardInteraction(ctx.refs);
    // Hot-reload the viewer's xiangqi piece set mid-game (board + captured pool
    // render from the stored set); mirrors the chess family's appearance hook.
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
    masked: false,
    notate: (move) => `${move.from}-${move.to}`,
    isMoveEvent: isJieqiMoveEvent,
  },
  replayCapture: {
    positionKey: replayPositionKey,
    plyForView: (view, ctx) => replayPlyForView(view, ctx.positionChanged, ctx.latestPly),
  },
});

export function bootstrapJieqiLiveRoom(): void {
  client.bootstrap();
}

function jieqiReasonPhrase(reason: string): string {
  switch (reason) {
    case 'checkmate':
      return 'checkmate';
    case 'stalemate':
      return 'stalemate';
    case 'no-capture-clock':
      return 'no progress';
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

// ── Rendering ────────────────────────────────────────────────────────────────

function renderBoard(liveRefs: LiveRefs, view: JieqiWireView | null): void {
  liveRefs.board.className = 'board jieqi-live-board';
  liveRefs.board.setAttribute('aria-label', 'Jieqi board');
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }

  const perspective = orientationFor(view);
  const drawn = drawnBoardOverlays<JieqiSquare>(annotations?.shapes() ?? []);
  liveRefs.board.innerHTML = renderJieqiBoardSvg(view, perspective, {
    arrows: drawn.arrows,
    markers: drawn.markers,
    interactive: true,
    selectedSquare,
    draggingFrom,
    legalMoves: selectedSquare
      ? view.legalMoves.filter((move) => move.from === selectedSquare)
      : [],
  });
  // Click + drag are delegated to the persistent board container once at mount
  // (installJieqiBoardInteraction), so they survive these innerHTML re-renders.
}

function handleSquareClick(view: JieqiWireView, square: JieqiSquare): void {
  if (!core?.replay.isLive() || core.connection() !== 'connected') return;
  const result = jieqiClickResult(view, core.state.seat, selectedSquare, square);
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
    playSound(soundForOwnJieqiMove(view, result.move));
  }
}

// Click + drag, delegated to the persistent board container once at mount so they
// survive every innerHTML re-render. Click is the existing select/move; drag lifts
// one of your pieces (face-down or revealed) and drops it on a legal target. A tap
// that never crosses the movement threshold falls through to the click handler.
function installJieqiBoardInteraction(liveRefs: LiveRefs): void {
  annotations = installBoardAnnotations({
    board: liveRefs.board,
    gameId: () => annotationOwner(core?.state.view),
    repaint: () => {
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
  });
  installBoardDrag({
    board: liveRefs.board,
    ghostSizePx: JIEQI_PIECE_PX,
    onSquareClick: (square) => {
      const view = core?.state.view;
      if (!view) return;
      handleSquareClick(view, square as JieqiSquare);
      renderBoard(liveRefs, view);
    },
    canDragFrom: (square) => canDragJieqiPiece(square as JieqiSquare),
    ghostHtml: (square) => {
      const entry = core?.state.view?.board[square as JieqiSquare];
      if (!entry) return null;
      return jieqiPieceGhostSvg(entry, undefined, square as JieqiSquare);
    },
    onDragStart: (from) => {
      selectedSquare = from as JieqiSquare;
      draggingFrom = from as JieqiSquare;
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
    onDrop: (from, to) => dropJieqiPiece(liveRefs, from as JieqiSquare, to as JieqiSquare | null),
  });
}

// Any of YOUR OWN pieces can be lifted on your turn — INCLUDING face-down ones
// (a face-down jieqi piece moves AND reveals, so it is draggable, unlike banqi
// where face-down = click-to-flip). It snaps back if you drop it somewhere it
// cannot move, so this need not require a legal move right now.
function canDragJieqiPiece(square: JieqiSquare): boolean {
  const view = core?.state.view;
  if (!view || !core?.replay.isLive() || core.connection() !== 'connected') return false;
  if (!isJieqiColor(core.state.seat)) return false;
  if (view.status.type !== 'playing' || view.status.turn !== core.state.seat) return false;
  const entry = view.board[square];
  if (!entry) return false;
  // Jieqi seats ARE colors (red/black): a piece is yours if its color is your seat.
  return entry.color === core.state.seat;
}

function dropJieqiPiece(liveRefs: LiveRefs, from: JieqiSquare, to: JieqiSquare | null): void {
  draggingFrom = null;
  const view = core?.state.view;
  const move = to && view ? view.legalMoves.find((m) => m.from === from && m.to === to) : undefined;
  if (move && view && core) {
    selectedSquare = null;
    if (core.send({ type: 'move', from: move.from, to: move.to })) {
      playSound(soundForOwnJieqiMove(view, move));
    }
  } else {
    selectedSquare = null;
  }
  if (core?.state.view) renderBoard(liveRefs, core.state.view);
}

// ── Material: captured pools ─────────────────────────────────────────────────

// Lichess convention: a player's captured material sits next to that player.
// The bottom strip is the viewer's side, so it shows the pieces the viewer has
// captured (the opponent's lost pieces); the top strip is the opponent's side,
// so it shows the pieces the opponent has captured (the viewer's lost pieces).
// A null role (a dark piece the viewer did not capture, so cannot identify)
// renders as a shrouded "?" tile. Jieqi does NOT render the "still face-down"
// pool the other flip variants do (hidden-pool-panel.ts): under capturer-only
// reveal the viewer's own pool cannot be computed (the dark pieces the opponent
// took are unknown to them), and a row that lists pieces which may already be
// gone was read as a bug (2026-09-20). The strips carry the same facts; the
// player does the subtraction. The hiddenPool slot is cleared so a variant
// switch never leaves a stale panel behind.
function renderCapturedPools(liveRefs: LiveRefs, view: JieqiWireView | null): void {
  renderJieqiMaterial(liveRefs, view, orientationFor(view));
}

// Exported for unit testing the material data path (revealed identity vs an
// unidentifiable "?" dark piece) without a live socket — same
// extraction rationale as live-jieqi-render / live-jieqi-interaction.
export function renderJieqiMaterial(
  slots: Pick<LiveRefs, 'capturesTop' | 'capturesBottom' | 'hiddenPool'>,
  view: JieqiWireView | null,
  viewer: JieqiColor,
): void {
  slots.capturesTop.replaceChildren();
  slots.capturesBottom.replaceChildren();
  slots.hiddenPool.replaceChildren();
  // A spectator's view in a tenant room is an EMPTY board (/room/ never reveals),
  // and an empty board must not read as "everything still face-down".
  if (!view || Object.keys(view.board).length === 0) return;
  const pieceSet = readStoredXiangqiPieceSet();
  const glyph = (entry: { color: JieqiColor; role: JieqiPieceRole }): string =>
    renderXiangqiPieceGlyphed(entry, pieceSet, { ariaLabel: `${entry.color} ${entry.role}` });
  const hidden = (color: JieqiColor): string =>
    renderXiangqiPieceGlyphed({ color, role: 'soldier' }, pieceSet, {
      ariaLabel: `${color} hidden piece`,
      shrouded: true,
    });
  const opponent: JieqiColor = viewer === 'red' ? 'black' : 'red';
  fillCapturedPoolWith(slots.capturesTop, view.captured, viewer, glyph, hidden);
  fillCapturedPoolWith(slots.capturesBottom, view.captured, opponent, glyph, hidden);
}

// ── Replay capture (no fog to redact; capture every distinct position) ────────

function replayPlyForView(
  view: JieqiWireView,
  positionChanged: boolean,
  latestPly: number,
): number {
  if (view.status.type === 'playing') {
    const completedFullMoves = Math.max(0, view.moveNumber - 1);
    return completedFullMoves * 2 + (view.status.turn === 'black' ? 1 : 0);
  }
  if (positionChanged && view.lastMove) return latestPly + 1;
  return latestPly;
}

function replayPositionKey(view: JieqiWireView): string {
  const board = Object.entries(view.board)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([square, entry]) =>
      entry.faceDown ? [square, entry.color, true] : [square, entry.color, entry.role, false],
    );
  return JSON.stringify({
    board,
    lastMove: view.lastMove ?? null,
    moveNumber: view.moveNumber,
    perspective: view.perspective,
    captured: view.captured,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isJieqiMoveEvent(event: TenantLiveEvent): event is JieqiMoveEvent {
  const move = (event as { move?: unknown }).move;
  return (
    event.type === 'move-played' &&
    isJieqiColor((event as { color?: unknown }).color) &&
    typeof move === 'object' &&
    move !== null &&
    typeof (move as { from?: unknown }).from === 'string' &&
    typeof (move as { to?: unknown }).to === 'string'
  );
}

function orientationFor(view: JieqiWireView | null): JieqiColor {
  const seat = core?.state.seat;
  if (isJieqiColor(seat)) return seat;
  return view?.perspective ?? 'red';
}

function isJieqiColor(value: unknown): value is JieqiColor {
  return value === 'red' || value === 'black';
}
