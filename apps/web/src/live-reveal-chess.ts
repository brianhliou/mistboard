// Live multiplayer room client for Reveal Chess (chess-jieqi) — an IDENTITY-hidden
// tenant on the generic live-client core (variant-tenant/live-client.ts owns
// bootstrap, frame application, the renderAll skeleton, replay capture, and the
// two-column move list). Modeled on the jieqi/banqi rooms but on an 8x8 CHESS
// board with cburnett pieces (the grid-board geometry) and standard white/black
// colors.
//
// Reveal Chess is IDENTITY-hidden, not POSITION-hidden: both players see every
// square, every piece's color, and every move. The only hidden axis is piece
// IDENTITY (a face-down piece's role). So this client carries NO fog: no fog
// mask, no visibleSquares, no opponent-move stripping, and the move list is
// unmasked. It renders ONLY the server-sent PlayerView and never invents or
// infers a hidden identity, so the replay capture stores the server's per-seat
// views directly (a local kernel replay is impossible — the client does not know
// the hidden identities).
//
// This module keeps what is genuinely Reveal Chess's: the wire view type, board
// rendering (face-down disc vs revealed cburnett glyph, reveal-chess-render.ts),
// select/drag interaction, the captured-pool panel (grouped by owner, "?" disc
// for an identity the viewer cannot see), the promotion picker (only for a KNOWN
// pawn reaching its far rank), the uci move notation, and the chess board-family
// theme.

import { PIECE_SVGS } from '@mistboard/board-render';
import type {
  RevealChessColor,
  RevealChessGameStatus,
  RevealChessMove,
  RevealChessPieceRole,
  RevealChessPromotionRole,
  RevealChessSquare,
} from '@mistboard/game';
import './live-reveal-chess.css';
import { revealChessEnabled } from './feature-flags.js';
import {
  maybePlayRevealChessSnapshotSound,
  resetRevealChessSoundState,
  soundForOwnRevealChessMove,
} from './live-reveal-chess-sound.js';
import { playSound } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import {
  REVEAL_CHESS_PIECE_PX,
  renderRevealChessBoardSvg,
  revealChessFacedownDisc,
  revealChessPieceGhostSvg,
} from './reveal-chess-render.js';
import { boardAppearanceChangedEvent, setBoardFamily } from './theme.js';
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

// ── Wire shapes (mirror RevealChessPlayerView; entries are faceDown-tagged) ──

type RevealChessWireBoardEntry =
  | { color: RevealChessColor; role: RevealChessPieceRole; faceDown: false }
  | { color: RevealChessColor; faceDown: true };

type RevealChessWireCaptured = { owner: RevealChessColor; role: RevealChessPieceRole | null };

export type RevealChessWireView = {
  id: string;
  perspective: RevealChessColor;
  board: Partial<Record<RevealChessSquare, RevealChessWireBoardEntry>>;
  legalMoves: RevealChessMove[];
  captured: RevealChessWireCaptured[];
  inCheck: boolean;
  status: RevealChessGameStatus;
  moveNumber: number;
  lastMove?: RevealChessMove;
};

type RevealChessMoveEvent = TenantMovePlayed<RevealChessColor, RevealChessMove>;
type RevealChessVisibleMoveRow = { fullMove: number; white?: string; black?: string };
type RevealChessLiveTimeControl = { initialMs: number; incrementMs: number };

// ── Reveal-Chess-owned interaction/render state ──────────────────────────────

let core: TenantLiveClientContext<RevealChessColor, RevealChessWireView> | null = null;
// Right-click arrows/circles the player drew on this board.
let annotations: BoardAnnotations | null = null;
let selectedSquare: RevealChessSquare | null = null;
// The square a piece is being dragged from (its piece is lifted off the board so
// only the floating ghost shows). Null when not dragging.
let draggingFrom: RevealChessSquare | null = null;
// A pending promotion: the from/to of a known-pawn move whose promotion role the
// player still has to pick. While set, the board is non-interactive (the picker
// owns the next input).
let pendingPromotion: { from: RevealChessSquare; to: RevealChessSquare } | null = null;
// Snapshot extras that ride the frame (read by the chrome + play-again body).
let roomMode: 'pve' | 'pvp' = 'pvp';
let pveEngineId: string | null = null;
let forfeitDeadline: number | null = null;

// ── Shared tenant room chrome config ─────────────────────────────────────────

const revealChessWebTenant: WebVariantTenant<RevealChessColor> = {
  displayName: 'Reveal Chess',
  metaMarkerId: 'reveal-chess',
  metaGlyph: '♔',
  colors: ['white', 'black'],
  isColor: isRevealChessColor,
  oppositeColor: (color) => (color === 'white' ? 'black' : 'white'),
  enabled: revealChessEnabled,
  reviewUrl: revealChessReviewUrl,
  reasonPhrase: revealChessReasonPhrase,
  disabledTitle: 'Reveal Chess disabled',
  disabledBody: 'This client build has the room renderer off.',
  rejectedBody: 'This Reveal Chess room is not active. Create a new invite to start a game.',
  spectatorBody: 'Watching without private information.',
  selectInstruction: 'Select one of your pieces, then choose a destination.',
};

const client = createTenantLiveClient<RevealChessColor, RevealChessWireView, RevealChessMove>({
  tenant: revealChessWebTenant,
  gameSpecId: 'reveal-chess',
  defaultRoomId: 'rc_dev',
  boardClass: 'reveal-chess-live-board',
  chrome: {
    forfeitDeadline: () => forfeitDeadline,
    roomMode: () => roomMode,
    variantDetail: () => revealChessLiveTimeControlLabel(core?.state.timeControl ?? null),
  },
  playAgainRequestBody: (state) =>
    revealChessLivePlayAgainRequestBody(state.timeControl, {
      mode: roomMode,
      pveEngineId,
      seat: state.seat,
    }),
  onFrame: (frame) => {
    if (frame.roomMode === 'pve' || frame.roomMode === 'pvp') roomMode = frame.roomMode;
    if (typeof frame.pveEngineId === 'string') pveEngineId = frame.pveEngineId;
    forfeitDeadline = typeof frame.forfeitDeadline === 'number' ? frame.forfeitDeadline : null;
  },
  onSnapshotApplied: () => {
    if (core) maybePlayRevealChessSnapshotSound(core.state.view, core.state.seat);
  },
  onEventApplied: () => {
    if (core) maybePlayRevealChessSnapshotSound(core.state.view, core.state.seat);
  },
  resetSounds: resetRevealChessSoundState,
  resetState: () => {
    selectedSquare = null;
    draggingFrom = null;
    pendingPromotion = null;
  },
  renderBoard,
  renderExtras: (refs, view) => renderCapturedPools(refs, view),
  onDisabled: (refs) => {
    // renderCapturedPools ran before the enabled guard in the original, so it
    // paints even when the flag is off; then the selection clears.
    renderCapturedPools(refs, core?.displayedView() ?? null);
    selectedSquare = null;
    draggingFrom = null;
    pendingPromotion = null;
  },
  setup: (ctx) => {
    core = ctx;
    setBoardFamily('chess');
    installRevealChessBoardInteraction(ctx.refs);
    installSelectionClickAway({
      roots: () => [core?.refs.board],
      hasSelection: () => pendingPromotion === null && selectedSquare !== null,
      clearSelection: () => {
        selectedSquare = null;
        draggingFrom = null;
        if (core) renderBoard(core.refs, core.displayedView());
      },
    });
    window.addEventListener(boardAppearanceChangedEvent, ctx.renderAll);
  },
  moveList: {
    rowClass: 'move-row reveal-chess-move-row',
    cellPrefix: 'reveal-chess-move-row',
    listClass: 'reveal-chess-move-list',
    masked: false,
    notate: uci,
    isMoveEvent: isRevealChessMoveEvent,
  },
  replayCapture: {
    positionKey: replayPositionKey,
    // No fog to redact: capture every distinct server view. Ply from moveNumber +
    // turn (white moves first); on a finished position, advance by one when the
    // last move is newly visible.
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

export function bootstrapRevealChessLiveRoom(): void {
  client.bootstrap();
}

export function revealChessReasonPhrase(reason: string): string {
  switch (reason) {
    case 'checkmate':
      return 'checkmate';
    case 'stalemate':
      return 'stalemate';
    case 'no-progress-clock':
    case 'progress-clock':
      return 'no progress';
    case 'threefold-repetition':
    case 'repetition':
      return 'repetition';
    case 'timeout':
      return 'timeout';
    case 'resignation':
      return 'resignation';
    case 'abandonment':
      return 'abandonment';
    case 'king-captured':
      return 'king capture';
    default:
      return 'the game rules';
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderBoard(liveRefs: LiveRefs, view: RevealChessWireView | null): void {
  liveRefs.board.className = 'board reveal-chess-live-board';
  liveRefs.board.setAttribute('aria-label', 'Reveal Chess board');
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }

  const perspective = orientationFor(view);
  const drawn = drawnBoardOverlays<RevealChessSquare>(annotations?.shapes() ?? []);
  liveRefs.board.innerHTML = renderRevealChessBoardSvg(view, {
    arrows: drawn.arrows,
    markers: drawn.markers,
    perspective,
    interactive: (core?.replay.isLive() ?? false) && !pendingPromotion,
    selected: selectedSquare,
    targets: selectedSquare ? legalTargets(view, selectedSquare) : [],
    lastMove: view.lastMove ?? null,
    draggingFrom,
  });
  // Click + drag are delegated to the persistent board container once at mount
  // (installRevealChessBoardInteraction), so they survive these innerHTML
  // re-renders.
  if (pendingPromotion) renderPromotionPicker(liveRefs, view, pendingPromotion);
}

// Click + drag, delegated to the persistent board container once at mount so they
// survive every innerHTML re-render. Click is the existing select/move (untouched);
// drag lifts one of your pieces (face-down or revealed) and drops it on a legal
// target, routing a known-pawn promotion through the SAME picker as click-to-move.
// A tap that never crosses the movement threshold falls through to the click
// handler.
function installRevealChessBoardInteraction(liveRefs: LiveRefs): void {
  annotations = installBoardAnnotations({
    board: liveRefs.board,
    gameId: () => annotationOwner(core?.state.view),
    repaint: () => {
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
  });
  installBoardDrag({
    board: liveRefs.board,
    ghostSizePx: REVEAL_CHESS_PIECE_PX,
    onSquareClick: (square) => {
      const view = core?.state.view;
      if (!view) return;
      handleSquareClick(view, square as RevealChessSquare);
    },
    canDragFrom: (square) => canDragRevealChessPiece(square as RevealChessSquare),
    ghostHtml: (square) => {
      const entry = core?.state.view?.board[square as RevealChessSquare];
      if (!entry) return null;
      return revealChessPieceGhostSvg(entry);
    },
    onDragStart: (from) => {
      selectedSquare = from as RevealChessSquare;
      draggingFrom = from as RevealChessSquare;
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
    onDrop: (from, to) =>
      dropRevealChessPiece(liveRefs, from as RevealChessSquare, to as RevealChessSquare | null),
  });
}

// Any of your pieces (face-down or revealed) can be lifted on your turn — a
// face-down piece moves AND reveals (like jieqi), so it is draggable. It snaps
// back if dropped somewhere it cannot move. Mirrors canSelect's gate minus the
// has-a-legal-move requirement, so a piece with no move still lifts and snaps
// back.
function canDragRevealChessPiece(square: RevealChessSquare): boolean {
  const view = core?.state.view;
  if (!core || !view || !core.replay.isLive() || core.connection() !== 'connected') return false;
  if (pendingPromotion) return false;
  if (!canInteract(view)) return false;
  const entry = view.board[square];
  return !!entry && entry.color === core.state.seat;
}

function dropRevealChessPiece(
  liveRefs: LiveRefs,
  from: RevealChessSquare,
  to: RevealChessSquare | null,
): void {
  draggingFrom = null;
  const view = core?.state.view;
  const move = to && view ? view.legalMoves.find((m) => m.from === from && m.to === to) : undefined;
  if (move && view) {
    // Take the exact click-to-move path for from→to, including the promotion
    // picker (submitMove opens it for a known-pawn promotion instead of sending,
    // and clears selectedSquare + re-renders in both branches).
    submitMove(view, move.from, move.to);
    return;
  }
  selectedSquare = null;
  if (core?.state.view) renderBoard(liveRefs, core.state.view);
}

function legalTargets(view: RevealChessWireView, from: RevealChessSquare): RevealChessSquare[] {
  return view.legalMoves.filter((move) => move.from === from).map((move) => move.to);
}

function handleSquareClick(view: RevealChessWireView, square: RevealChessSquare): void {
  if (!core) return;
  if (pendingPromotion) return;
  if (!core.replay.isLive() || core.connection() !== 'connected') return;
  if (!canInteract(view)) return;

  if (selectedSquare === null) {
    if (canSelect(view, square)) {
      selectedSquare = square;
      renderBoard(core.refs, view);
    }
    return;
  }
  if (selectedSquare === square) {
    selectedSquare = null;
    renderBoard(core.refs, view);
    return;
  }
  const move = view.legalMoves.find((m) => m.from === selectedSquare && m.to === square);
  if (move) {
    submitMove(view, move.from, move.to);
    return;
  }
  // Clicked elsewhere: reselect if the new square is selectable, else clear.
  selectedSquare = canSelect(view, square) ? square : null;
  renderBoard(core.refs, view);
}

// A move from a KNOWN pawn onto its far rank needs a promotion choice (queen /
// rook / bishop / knight). A FACE-DOWN piece reaching the far rank promotes
// automatically server-side (the kernel defaults to queen), so no picker for it.
function submitMove(
  view: RevealChessWireView,
  from: RevealChessSquare,
  to: RevealChessSquare,
): void {
  if (!core) return;
  if (isKnownPawnPromotion(view, from, to)) {
    pendingPromotion = { from, to };
    selectedSquare = null;
    renderBoard(core.refs, view);
    return;
  }
  selectedSquare = null;
  if (core.send({ type: 'move', from, to })) {
    playSound(soundForOwnRevealChessMove(view, { from, to }));
  }
  renderBoard(core.refs, view);
}

function isKnownPawnPromotion(
  view: RevealChessWireView,
  from: RevealChessSquare,
  to: RevealChessSquare,
): boolean {
  const piece = view.board[from];
  if (!piece || piece.faceDown || piece.role !== 'pawn') return false;
  const farRank = piece.color === 'white' ? 8 : 1;
  return Number(to.slice(1)) === farRank;
}

function canInteract(view: RevealChessWireView): boolean {
  return (
    view.status.type === 'playing' &&
    isRevealChessColor(core?.state.seat) &&
    view.status.turn === core?.state.seat
  );
}

function canSelect(view: RevealChessWireView, square: RevealChessSquare): boolean {
  if (!canInteract(view)) return false;
  const entry = view.board[square];
  if (!entry || entry.color !== core?.state.seat) return false;
  return view.legalMoves.some((move) => move.from === square);
}

// ── Promotion picker ──────────────────────────────────────────────────────────

const PROMOTION_ROLES: readonly RevealChessPromotionRole[] = ['queen', 'rook', 'bishop', 'knight'];

function renderPromotionPicker(
  liveRefs: LiveRefs,
  view: RevealChessWireView,
  promotion: { from: RevealChessSquare; to: RevealChessSquare },
): void {
  const piece = view.board[promotion.from];
  const color: RevealChessColor = piece && !piece.faceDown ? piece.color : orientationFor(view);

  const overlay = document.createElement('div');
  overlay.className = 'reveal-chess-promotion';
  const heading = document.createElement('p');
  heading.className = 'reveal-chess-promotion__title';
  heading.textContent = 'Promote to';
  const choices = document.createElement('div');
  choices.className = 'reveal-chess-promotion__choices';
  for (const role of PROMOTION_ROLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reveal-chess-promotion__choice';
    button.setAttribute('aria-label', `Promote to ${role}`);
    button.dataset.role = role;
    button.innerHTML = `<svg viewBox="0 0 45 45" width="44" height="44" aria-hidden="true">${promotionGlyph(color, role)}</svg>`;
    button.addEventListener('click', () => {
      const move = promotion;
      pendingPromotion = null;
      if (core?.send({ type: 'move', from: move.from, to: move.to, promotion: role })) {
        playSound(soundForOwnRevealChessMove(core.state.view, { from: move.from, to: move.to }));
      }
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    });
    choices.append(button);
  }
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'reveal-chess-promotion__cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    pendingPromotion = null;
    if (core?.state.view) renderBoard(liveRefs, core.state.view);
  });
  const card = document.createElement('div');
  card.className = 'reveal-chess-promotion__card';
  card.append(heading, choices, cancel);
  overlay.append(card);
  liveRefs.board.append(overlay);
}

// ── Captured pool ─────────────────────────────────────────────────────────────

// Lichess convention: a player's captured material sits next to that player.
// The bottom strip is the viewer's side, so it shows the pieces the viewer has
// captured (the opponent's lost pieces); the top strip is the opponent's side.
// fillCapturedPool filters by former owner, so top filters the viewer's color
// and bottom filters the opponent's color. A null role (a dark piece the viewer
// did not capture, so cannot identify) renders the face-down "?" disc.
function renderCapturedPools(liveRefs: LiveRefs, view: RevealChessWireView | null): void {
  liveRefs.capturesTop.replaceChildren();
  liveRefs.capturesBottom.replaceChildren();
  if (!view) return;
  const viewer = orientationFor(view);
  const opponent = viewer === 'white' ? 'black' : 'white';
  fillCapturedPool(liveRefs.capturesTop, view.captured, viewer);
  fillCapturedPool(liveRefs.capturesBottom, view.captured, opponent);
}

// Exported for unit testing the captured-pool data path (revealed identity vs
// an unidentifiable "?" dark piece) without a live socket — same extraction
// rationale as the jieqi room's fillCapturedPool.
export function fillCapturedPool(
  host: HTMLElement,
  captured: readonly RevealChessWireCaptured[],
  owner: RevealChessColor,
): void {
  const mine = captured.filter((entry) => entry.owner === owner);
  host.classList.toggle('has-captures', mine.length > 0);
  if (mine.length === 0) return;
  const row = document.createElement('div');
  row.className = 'captures-row reveal-chess-captures-row';
  for (const entry of mine) {
    const span = document.createElement('span');
    span.className = 'reveal-chess-capture-piece';
    if (entry.role === null) {
      span.setAttribute('aria-label', `${owner} hidden piece`);
      span.innerHTML = `<svg viewBox="0 0 44 44" width="26" height="26" aria-hidden="true">${revealChessFacedownDisc(owner, 0, 0, 44)}</svg>`;
    } else {
      span.setAttribute('aria-label', `${owner} ${entry.role}`);
      span.innerHTML = `<svg viewBox="0 0 45 45" width="26" height="26" aria-hidden="true">${promotionGlyph(owner, entry.role)}</svg>`;
    }
    row.append(span);
  }
  host.append(row);
}

// ── Move list (positions are public, so every move shows) ────────────────────
// The core renders the live two-column list from state.events + notate; this
// pure grouping helper stays exported for the unit test's data-path coverage.

export function visibleMoveRows(
  moves: readonly RevealChessMoveEvent[],
  plyCount: number,
): RevealChessVisibleMoveRow[] {
  const rows = new Map<number, RevealChessVisibleMoveRow>();
  for (let fullMove = 1; fullMove <= Math.ceil(plyCount / 2); fullMove += 1) {
    rows.set(fullMove, { fullMove });
  }
  moves.forEach((event, index) => {
    const ply = eventPly(event, index);
    if (ply > plyCount) return;
    const fullMove = Math.floor((ply - 1) / 2) + 1;
    const row = rows.get(fullMove) ?? { fullMove };
    row[event.color] = uci(event.move);
    rows.set(fullMove, row);
  });
  return [...rows.values()].sort((a, b) => a.fullMove - b.fullMove);
}

function eventPly(event: RevealChessMoveEvent, fallbackIndex: number): number {
  return Number.isInteger(event.ply) && event.ply && event.ply > 0 ? event.ply : fallbackIndex + 1;
}

// ── Replay capture (no fog to redact; capture every distinct server view) ─────

function replayPositionKey(view: RevealChessWireView): string {
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

// ── Helpers ────────────────────────────────────────────────────────────────

export type RevealChessLivePlayAgainOptions = {
  mode?: 'pvp' | 'pve';
  pveEngineId?: string | null;
  seat?: RevealChessColor | 'spectator' | null;
};

export function revealChessLivePlayAgainRequestBody(
  timeControl: RevealChessLiveTimeControl | null,
  options: RevealChessLivePlayAgainOptions = {},
): {
  mode: 'pvp' | 'pve';
  gameSpecId: 'reveal-chess';
  preferredColor: 'white' | 'black' | 'random';
  timeControl?: RevealChessLiveTimeControl;
  engineId?: string;
} {
  const mode = options.mode === 'pve' ? 'pve' : 'pvp';
  const preferredColor =
    mode === 'pve' && options.seat === 'white'
      ? 'black'
      : mode === 'pve' && options.seat === 'black'
        ? 'white'
        : 'random';
  return {
    mode,
    gameSpecId: 'reveal-chess',
    preferredColor,
    ...(timeControl ? { timeControl } : {}),
    ...(mode === 'pve' && options.pveEngineId ? { engineId: options.pveEngineId } : {}),
  };
}

export function revealChessLiveTimeControlLabel(
  timeControl: RevealChessLiveTimeControl | null,
): string | null {
  if (!timeControl) return null;
  const minutes = Math.round(timeControl.initialMs / 60_000);
  const incrementSeconds = Math.round(timeControl.incrementMs / 1000);
  return incrementSeconds > 0 ? `${minutes}+${incrementSeconds}` : `${minutes}+0`;
}

export function revealChessReviewUrl(roomId: string): string {
  return `/reveal-chess/game/${encodeURIComponent(roomId)}`;
}

function orientationFor(view: RevealChessWireView | null): RevealChessColor {
  const seat = core?.state.seat;
  if (isRevealChessColor(seat)) return seat;
  return view?.perspective ?? 'white';
}

function uci(move: RevealChessMove): string {
  return `${move.from}${move.to}${move.promotion ? move.promotion[0].toUpperCase() : ''}`;
}

function isRevealChessColor(value: unknown): value is RevealChessColor {
  return value === 'white' || value === 'black';
}

function isRevealChessMoveEvent(event: TenantLiveEvent): event is RevealChessMoveEvent {
  const move = (event as { move?: unknown }).move;
  return (
    event.type === 'move-played' &&
    isRevealChessColor((event as { color?: unknown }).color) &&
    typeof move === 'object' &&
    move !== null &&
    typeof (move as { from?: unknown }).from === 'string' &&
    typeof (move as { to?: unknown }).to === 'string'
  );
}

// The cburnett glyph inner body for a revealed piece, used by the promotion
// picker and the captured pool. Reveal Chess uses the standard white/black set.
function promotionGlyph(color: RevealChessColor, role: RevealChessPieceRole): string {
  const raw = PIECE_SVGS[`${color}:${role}`];
  if (!raw) return '';
  // Strip the outer <svg ...> open tag and the trailing </svg> so the inner
  // paint can be embedded in a caller-sized <svg viewBox="0 0 45 45">.
  return raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}
