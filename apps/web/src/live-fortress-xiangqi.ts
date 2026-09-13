// Live multiplayer room client for Fortress Xiangqi — an OPEN-INFORMATION
// tenant with reserves + drops, on the generic live-client core
// (variant-tenant/live-client.ts owns bootstrap, frame application, the
// renderAll skeleton, replay capture, and the two-column move list). This
// module keeps what is genuinely Fortress Xiangqi's: the wire view type, board
// + reserve rendering, click/drag/drop interaction, the in-check notice,
// sounds, and the drop-aware move notation.

import {
  applyFortressXiangqiMove,
  createInitialFortressXiangqiState,
  FORTRESS_DROP_ROLES,
  FORTRESS_XIANGQI_SPEC_ID,
  type FortressXiangqiColor,
  type FortressXiangqiDropRole,
  type FortressXiangqiMove,
  type FortressXiangqiPlayerView,
  type FortressXiangqiSquare,
  getFortressXiangqiPlayerView,
} from '@mistboard/game';
import './drop-reserve.css';
import { fortressXiangqiEnabled } from './feature-flags.js';
import {
  FORTRESS_XIANGQI_PIECE_PX,
  fortressXiangqiPieceGhostSvg,
  installFortressXiangqiBoardStyles,
  renderFortressXiangqiBoardSvg,
} from './fortress-xiangqi-render.js';
import {
  fillFortressXiangqiReserve,
  fortressXiangqiBoardMoves,
  fortressXiangqiDropTargets,
  fortressXiangqiMoveLabel,
} from './fortress-xiangqi-view.js';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import { setBoardFamily, xiangqiAppearanceChangedEvent } from './theme.js';
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

type FortressMoveEvent = TenantMovePlayed<FortressXiangqiColor, FortressXiangqiMove>;

// ── Fortress-owned interaction/render state ──────────────────────────────────

let core: TenantLiveClientContext<FortressXiangqiColor, FortressXiangqiPlayerView> | null = null;
let selectedSquare: FortressXiangqiSquare | null = null;
// Right-click arrows/circles the player drew on this board.
let annotations: BoardAnnotations | null = null;
let selectedDropRole: FortressXiangqiDropRole | null = null;
let draggingFrom: FortressXiangqiSquare | null = null;
// Snapshot extras that ride the frame (read by the chrome + play-again body).
let roomMode: 'pvp' | 'pve' = 'pvp';
let pveEngineId: string | null = null;
let forfeitDeadline: number | null = null;
// Last live status type, so the win/lose/draw sting fires once on the live
// playing -> finished transition (not on a reconnect into a finished game).
let lastStatusType: string | null = null;

const fortressWebTenant: WebVariantTenant<FortressXiangqiColor> = {
  displayName: 'Fortress Xiangqi',
  metaMarkerId: 'fortress-xiangqi',
  metaGlyph: '象',
  colors: ['red', 'black'],
  isColor: isFortressColor,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  enabled: fortressXiangqiEnabled,
  reviewUrl: (roomId) => `/fortress-xiangqi/game/${encodeURIComponent(roomId)}`,
  reasonPhrase: fortressReasonPhrase,
  disabledTitle: 'Fortress disabled',
  disabledBody: 'This client build has the room renderer off.',
  rejectedBody: 'This Fortress room is not active. Create a new invite to start a game.',
  spectatorBody: 'Watching the full board.',
  selectInstruction: 'Select a piece, or select a reserve and then a drop square.',
};

const client = createTenantLiveClient<
  FortressXiangqiColor,
  FortressXiangqiPlayerView,
  FortressXiangqiMove
>({
  tenant: fortressWebTenant,
  gameSpecId: FORTRESS_XIANGQI_SPEC_ID,
  defaultRoomId: 'fxq_dev',
  boardClass: 'fortress-xiangqi-live-board',
  chrome: {
    roomMode: () => roomMode,
    forfeitDeadline: () => forfeitDeadline,
  },
  playAgainRequestBody: (state) => ({
    mode: roomMode,
    gameSpecId: FORTRESS_XIANGQI_SPEC_ID,
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
    // Opponent's move plays the flat move sound (own moves already played their
    // sound on send); only event frames carry a singular `event`.
    const event = frame.event;
    if (
      event &&
      (event as { type?: unknown }).type === 'move-played' &&
      (event as { color?: unknown }).color !== frame.seat
    ) {
      playSound('move');
    }
    maybePlayFortressTerminalSound();
  },
  resetState: () => {
    selectedSquare = null;
    selectedDropRole = null;
    draggingFrom = null;
    roomMode = 'pvp';
    pveEngineId = null;
    forfeitDeadline = null;
    lastStatusType = null;
  },
  renderBoard: renderBoardReconciled,
  renderExtras: (refs, view) => {
    renderReserves(refs, view);
    renderCheckStatus(refs, view);
  },
  onDisabled: (refs) => {
    // Mirror the pre-guard renderAll steps the original ran even when the flag
    // was off: reconcile, then paint the reserve strips + check notice, then
    // clear the selection.
    reconcileInteractionState(core?.state.view ?? null);
    const view = core?.displayedView() ?? null;
    renderReserves(refs, view);
    renderCheckStatus(refs, view);
    selectedSquare = null;
    selectedDropRole = null;
  },
  setup: (ctx) => {
    core = ctx;
    installFortressXiangqiBoardStyles();
    setBoardFamily('xiangqi');
    installBoardInteraction(ctx.refs);
    // Hot-reload the viewer's xiangqi piece set mid-game (board + captured pool
    // render from the stored set); mirrors the chess family's appearance hook.
    window.addEventListener(xiangqiAppearanceChangedEvent, ctx.renderAll);
    installSelectionClickAway({
      roots: () => [core?.refs.board, core?.refs.capturesBottom],
      hasSelection: () => selectedSquare !== null || selectedDropRole !== null,
      clearSelection: () => {
        selectedSquare = null;
        selectedDropRole = null;
        core?.renderAll();
      },
    });
  },
  moveList: {
    rowClass: 'move-row xiangqi-move-row',
    cellPrefix: 'xiangqi-move-row',
    listClass: 'xiangqi-move-list',
    masked: false,
    notate: fortressXiangqiMoveLabel,
    isMoveEvent: isFortressMoveEvent,
  },
  replayCapture: {
    positionKey: replayPositionKey,
    plyForView: (view, ctx) => replayPlyForView(view, ctx.positionChanged, ctx.latestPly),
  },
  // Perfect information: the event log carries every move (board + drop)
  // unredacted, so the full per-ply history is rebuilt through the kernel on
  // mount and after every reconnect (#80). No new server payload.
  replayHistory: {
    rebuild: ({ events, view, state }) => {
      const perspective = isFortressColor(state.seat) ? state.seat : view.perspective;
      let gameState = createInitialFortressXiangqiState(view.id);
      const snapshots = [{ ply: 0, view: getFortressXiangqiPlayerView(gameState, perspective) }];
      for (const event of events) {
        if (!isFortressMoveEvent(event)) continue;
        const next = applyFortressXiangqiMove(gameState, event.move);
        if (next === gameState) return null; // kernel rejected: keep captured history
        gameState = next;
        snapshots.push({
          ply: snapshots.length,
          view: getFortressXiangqiPlayerView(gameState, perspective),
        });
      }
      return snapshots;
    },
  },
});

export function bootstrapFortressXiangqiLiveRoom(): void {
  client.bootstrap();
}

// ── Sounds ───────────────────────────────────────────────────────────────────

// Play the win/lose/draw sting once, on the live playing -> finished transition
// (not on a reconnect into an already-finished game). Reads the LIVE view/seat;
// the core calls onFrame after applying each frame.
function maybePlayFortressTerminalSound(): void {
  const view = core?.state.view ?? null;
  const nextType = view?.status.type ?? null;
  const seat = core?.state.seat;
  if (
    view &&
    view.status.type === 'finished' &&
    lastStatusType === 'playing' &&
    isFortressColor(seat)
  ) {
    const result: 'win' | 'lose' | 'draw' =
      view.status.winner === null ? 'draw' : view.status.winner === seat ? 'win' : 'lose';
    playTerminalPlan(result, view.status.reason ?? null);
  }
  lastStatusType = nextType;
}

// ── Rendering ────────────────────────────────────────────────────────────────

// The core calls this exactly once per renderAll, before the reserve strip
// reads the selection, so reconcile the selection against the LIVE view here.
// Interaction re-renders call the raw renderBoard directly, so a mid-drag
// selection is never reconciled away (matching the pre-migration behavior where
// reconcile ran only inside renderAll).
function renderBoardReconciled(liveRefs: LiveRefs, view: FortressXiangqiPlayerView | null): void {
  reconcileInteractionState(core?.state.view ?? null);
  renderBoard(liveRefs, view);
}

function renderCheckStatus(liveRefs: LiveRefs, view: FortressXiangqiPlayerView | null): void {
  if (view?.status.type !== 'playing' || !view.inCheck || !core?.replay.isLive()) return;
  liveRefs.actionSection.hidden = false;
  liveRefs.actionStatus.replaceChildren();
  const notice = document.createElement('div');
  notice.className = 'action-notice danger';
  const title = document.createElement('strong');
  title.textContent = 'Check';
  const body = document.createElement('p');
  body.textContent =
    core?.state.seat === view.perspective
      ? 'Your general is in check. Answer the threat.'
      : `${capitalize(view.perspective)} general is in check.`;
  notice.append(title, body);
  liveRefs.actionStatus.append(notice);
}

function renderBoard(liveRefs: LiveRefs, view: FortressXiangqiPlayerView | null): void {
  liveRefs.board.className = 'board fortress-xiangqi-live-board';
  liveRefs.board.setAttribute('aria-label', 'Fortress board');
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }
  const perspective = orientationFor(view);
  const targets = selectedDropRole
    ? fortressXiangqiDropTargets(view, selectedDropRole)
    : selectedSquare
      ? fortressXiangqiBoardMoves(view, selectedSquare).map((move) => move.to)
      : [];
  const drawn = drawnBoardOverlays<FortressXiangqiSquare>(annotations?.shapes() ?? []);
  liveRefs.board.innerHTML = renderFortressXiangqiBoardSvg(view, perspective, {
    arrows: drawn.arrows,
    markers: drawn.markers,
    interactive: true,
    selectedSquare,
    targets,
    draggingFrom,
  });
}

function renderReserves(liveRefs: LiveRefs, view: FortressXiangqiPlayerView | null): void {
  liveRefs.capturesTop.replaceChildren();
  liveRefs.capturesBottom.replaceChildren();
  if (!view) return;
  const bottom = orientationFor(view);
  const top = bottom === 'red' ? 'black' : 'red';
  fillFortressXiangqiReserve(liveRefs.capturesTop, view, top);
  fillFortressXiangqiReserve(liveRefs.capturesBottom, view, bottom, {
    interactive: canInteract(view) && core?.state.seat === bottom,
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
    ghostSizePx: FORTRESS_XIANGQI_PIECE_PX,
    onSquareClick: (square) => handleSquareClick(square as FortressXiangqiSquare),
    canDragFrom: (square) => canDragPiece(square as FortressXiangqiSquare),
    ghostHtml: (square) => {
      const piece = core?.state.view?.board[square as FortressXiangqiSquare];
      return piece ? fortressXiangqiPieceGhostSvg(piece) : null;
    },
    onDragStart: (from) => {
      selectedDropRole = null;
      selectedSquare = from as FortressXiangqiSquare;
      draggingFrom = from as FortressXiangqiSquare;
      renderBoard(liveRefs, core?.state.view ?? null);
    },
    onDrop: (from, to) =>
      dropPiece(from as FortressXiangqiSquare, to as FortressXiangqiSquare | null),
  });
  installHandDrag({
    hand: liveRefs.capturesBottom,
    ghostSizePx: FORTRESS_XIANGQI_PIECE_PX,
    isRole: isDropRole,
    canDragRole: canDragDropRole,
    ghostHtml: (role) => {
      const seat = core?.state.seat;
      return isFortressColor(seat) ? fortressXiangqiPieceGhostSvg({ color: seat, role }) : null;
    },
    onDragStart: (role) => {
      selectedSquare = null;
      selectedDropRole = role;
      core?.renderAll();
    },
    onDrop: (role, to) => dropReservePiece(role, to),
  });
}

function handleSquareClick(square: FortressXiangqiSquare): void {
  const view = core?.state.view;
  if (!view || !canInteract(view)) return;
  if (selectedDropRole) {
    const targets = fortressXiangqiDropTargets(view, selectedDropRole);
    if (targets.includes(square)) {
      core?.send({ type: 'move', drop: selectedDropRole, to: square });
      playSound('drop');
      selectedDropRole = null;
      selectedSquare = null;
      core?.renderAll();
      return;
    }
    selectedDropRole = null;
  }

  if (!selectedSquare) {
    if (canSelect(view, square)) selectedSquare = square;
    renderBoardIfMounted();
    return;
  }
  if (selectedSquare === square) {
    selectedSquare = null;
    renderBoardIfMounted();
    return;
  }
  const move = fortressXiangqiBoardMoves(view, selectedSquare).find(
    (candidate) => candidate.to === square,
  );
  if (move) {
    selectedSquare = null;
    core?.send({ type: 'move', from: move.from, to: move.to });
    playSound(view.board[move.to] ? 'capture' : 'move');
    core?.renderAll();
    return;
  }
  selectedSquare = canSelect(view, square) ? square : null;
  renderBoardIfMounted();
}

function canDragPiece(square: FortressXiangqiSquare): boolean {
  const view = core?.state.view;
  if (!view || !canInteract(view)) return false;
  const piece = view.board[square];
  return !!piece && piece.color === core?.state.seat;
}

function dropPiece(from: FortressXiangqiSquare, to: FortressXiangqiSquare | null): void {
  draggingFrom = null;
  const view = core?.state.view;
  const move =
    to && view
      ? fortressXiangqiBoardMoves(view, from).find((candidate) => candidate.to === to)
      : undefined;
  if (move && view) {
    selectedSquare = null;
    core?.send({ type: 'move', from: move.from, to: move.to });
    playSound(view.board[move.to] ? 'capture' : 'move');
  } else {
    selectedSquare = null;
  }
  core?.renderAll();
}

function canDragDropRole(role: FortressXiangqiDropRole): boolean {
  const view = core?.state.view;
  const seat = core?.state.seat;
  if (!view || !canInteract(view) || !isFortressColor(seat)) return false;
  return (view.hands[seat][role] ?? 0) > 0;
}

function dropReservePiece(role: FortressXiangqiDropRole, to: string | null): void {
  const view = core?.state.view;
  if (!view || !canInteract(view)) {
    selectedDropRole = null;
    core?.renderAll();
    return;
  }
  selectedSquare = null;
  selectedDropRole = role;
  const targets = fortressXiangqiDropTargets(view, role);
  if (to && isFortressSquare(to) && targets.includes(to)) {
    core?.send({ type: 'move', drop: role, to });
    playSound('drop');
  }
  selectedDropRole = null;
  core?.renderAll();
}

function canInteract(view: FortressXiangqiPlayerView): boolean {
  return (
    !!core &&
    core.replay.isLive() &&
    core.connection() === 'connected' &&
    view.status.type === 'playing' &&
    isFortressColor(core.state.seat) &&
    view.status.turn === core.state.seat
  );
}

function canSelect(view: FortressXiangqiPlayerView, square: FortressXiangqiSquare): boolean {
  if (!canInteract(view)) return false;
  const piece = view.board[square];
  return (
    !!piece &&
    piece.color === core?.state.seat &&
    fortressXiangqiBoardMoves(view, square).length > 0
  );
}

function reconcileInteractionState(view: FortressXiangqiPlayerView | null): void {
  if (!view || !canInteract(view)) {
    selectedSquare = null;
    selectedDropRole = null;
    return;
  }
  if (selectedSquare && fortressXiangqiBoardMoves(view, selectedSquare).length === 0) {
    selectedSquare = null;
  }
  if (
    selectedDropRole &&
    (view.hands[core?.state.seat as FortressXiangqiColor][selectedDropRole] ?? 0) <= 0
  ) {
    selectedDropRole = null;
  }
}

function renderBoardIfMounted(): void {
  if (core?.refs) renderBoard(core.refs, core.displayedView());
}

// ── Replay capture ─────────────────────────────────────────────────────────

function replayPlyForView(
  view: FortressXiangqiPlayerView,
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

function replayPositionKey(view: FortressXiangqiPlayerView): string {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function isFortressMoveEvent(event: TenantLiveEvent): event is FortressMoveEvent {
  const move = (event as { move?: unknown }).move;
  return (
    event.type === 'move-played' &&
    isFortressColor((event as { color?: unknown }).color) &&
    typeof move === 'object' &&
    move !== null &&
    ((typeof (move as { from?: unknown }).from === 'string' &&
      typeof (move as { to?: unknown }).to === 'string') ||
      (typeof (move as { drop?: unknown }).drop === 'string' &&
        typeof (move as { to?: unknown }).to === 'string'))
  );
}

function orientationFor(view: FortressXiangqiPlayerView | null): FortressXiangqiColor {
  const seat = core?.state.seat;
  if (isFortressColor(seat)) return seat;
  return view?.perspective ?? 'red';
}

function fortressReasonPhrase(reason: string): string {
  switch (reason) {
    case 'checkmate':
      return 'checkmate';
    case 'stalemate':
      return 'stalemate';
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

function isFortressColor(value: unknown): value is FortressXiangqiColor {
  return value === 'red' || value === 'black';
}

function isFortressSquare(value: string): value is FortressXiangqiSquare {
  return /^[a-g][1-8]$/.test(value);
}

function isDropRole(value: string): value is FortressXiangqiDropRole {
  return (FORTRESS_DROP_ROLES as readonly string[]).includes(value);
}

function capitalize(value: string): string {
  if (!value) return value;
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
