// Live multiplayer room client for Duck Xiangqi — an OPEN-INFORMATION tenant on
// the generic live-client core (variant-tenant/live-client.ts owns bootstrap,
// frame application, the renderAll skeleton, replay capture and the move list).
//
// What is genuinely this variant's, and lives here: the TWO-PHASE TURN. A turn
// is a piece move and then a duck placement, and only the completed pair is
// sent. Nothing about the first half reaches the server, so a player who
// disconnects between the two halves has made no move at all.

import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  DUCK_XIANGQI_SPEC_ID,
  type DuckXiangqiColor,
  type DuckXiangqiPlayerView,
  type DuckXiangqiSquare,
  type DuckXiangqiTurn,
  duckXiangqiDuckDestinations,
  getDuckXiangqiPlayerView,
} from '@mistboard/game';
import {
  type DuckXiangqiBoardPhase,
  duckXiangqiBoardSvg,
  duckXiangqiClickResult,
} from './duck-xiangqi-board.js';
// The xiangqi surface stylesheets. WITHOUT THESE the board ground, palace
// diagonals and river label are all drawn and all invisible — the markup is
// correct and the page looks broken.
import './live-xiangqi.css';
import './duck-xiangqi.css';
import { duckXiangqiEnabled } from './feature-flags.js';
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
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
} from './variant-tenant/live-client.js';
import type { WebVariantTenant } from './variant-tenant/room-chrome.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';

type DuckMoveEvent = TenantMovePlayed<DuckXiangqiColor, DuckXiangqiTurn>;

let core: TenantLiveClientContext<DuckXiangqiColor, DuckXiangqiPlayerView> | null = null;
// The whole two-phase turn, in one variable. `piece` is the ordinary state;
// `duck` means a piece move is chosen, shown optimistically, and NOT yet sent.
let phase: DuckXiangqiBoardPhase = { kind: 'piece', selected: null };
let annotations: BoardAnnotations | null = null;
let roomMode: 'pvp' | 'pve' = 'pvp';
let forfeitDeadline: number | null = null;
let lastStatusType: string | null = null;

function isDuckColor(value: unknown): value is DuckXiangqiColor {
  return value === 'red' || value === 'black';
}

const duckWebTenant: WebVariantTenant<DuckXiangqiColor> = {
  displayName: 'Duck Xiangqi',
  metaGlyph: '🦆',
  colors: ['red', 'black'],
  isColor: isDuckColor,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  enabled: duckXiangqiEnabled,
  // Must match `gameRouteBase` in the web tenant registry. Left pointing at the
  // bare `/game/:id` shell, a player who just finished a game lands on the CHESS
  // postgame, which 403s on a tenant event log.
  reviewUrl: (roomId) => `/duck-xiangqi/game/${encodeURIComponent(roomId)}`,
  reasonPhrase: duckReasonPhrase,
  disabledTitle: 'Duck Xiangqi disabled',
  disabledBody: 'This client build has the room renderer off.',
  rejectedBody: 'This Duck Xiangqi room is not active. Create a new invite to start a game.',
  spectatorBody: 'Watching the full board.',
  selectInstruction: 'Move a piece, then place the duck on any empty point.',
};

const client = createTenantLiveClient<DuckXiangqiColor, DuckXiangqiPlayerView, DuckXiangqiTurn>({
  tenant: duckWebTenant,
  gameSpecId: DUCK_XIANGQI_SPEC_ID,
  defaultRoomId: 'dkx_dev',
  boardClass: 'duck-xiangqi-live-board',
  chrome: {
    roomMode: () => roomMode,
    forfeitDeadline: () => forfeitDeadline,
  },
  playAgainRequestBody: (state) => ({
    mode: roomMode,
    gameSpecId: DUCK_XIANGQI_SPEC_ID,
    preferredColor: 'random',
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onFrame: (frame) => {
    if (frame.roomMode === 'pve' || frame.roomMode === 'pvp') roomMode = frame.roomMode;
    forfeitDeadline = typeof frame.forfeitDeadline === 'number' ? frame.forfeitDeadline : null;
    const event = frame.event;
    if (
      event &&
      (event as { type?: unknown }).type === 'move-played' &&
      (event as { color?: unknown }).color !== frame.seat
    ) {
      playSound('move');
    }
    maybePlayTerminalSound();
  },
  resetState: () => {
    phase = { kind: 'piece', selected: null };
    roomMode = 'pvp';
    forfeitDeadline = null;
    lastStatusType = null;
  },
  renderBoard: (refs, view) => {
    reconcileInteractionState(core?.state.view ?? null);
    renderBoard(refs, view);
  },
  renderExtras: (refs, view) => renderPhaseNotice(refs, view),
  onDisabled: (refs) => {
    phase = { kind: 'piece', selected: null };
    renderPhaseNotice(refs, null);
  },
  setup: (ctx) => {
    core = ctx;
    setBoardFamily('xiangqi');
    installBoardInteraction(ctx.refs);
    window.addEventListener(xiangqiAppearanceChangedEvent, ctx.renderAll);
    installSelectionClickAway({
      roots: () => [core?.refs.board],
      hasSelection: () => {
        const current = phase;
        return current.kind === 'duck' || current.selected !== null;
      },
      clearSelection: () => {
        // Clicking away in phase two abandons the whole turn. Safe: nothing has
        // been sent, so there is no half-move on the server to unwind.
        phase = { kind: 'piece', selected: null };
        core?.renderAll();
      },
    });
  },
  moveList: {
    rowClass: 'move-row xiangqi-move-row',
    cellPrefix: 'xiangqi-move-row',
    listClass: 'xiangqi-move-list',
    masked: false,
    notate: duckTurnLabel,
    isMoveEvent: isDuckMoveEvent,
  },
  replayCapture: {
    positionKey: replayPositionKey,
    plyForView: (view, ctx) => replayPlyForView(view, ctx.positionChanged, ctx.latestPly),
  },
  // Perfect information: the event log carries every turn unredacted, so the
  // per-ply history is rebuilt through the kernel on mount and after reconnect.
  replayHistory: {
    rebuild: ({ events, view, state }) => {
      const perspective = isDuckColor(state.seat) ? state.seat : view.perspective;
      let gameState = createInitialDuckXiangqiState(view.id);
      const snapshots = [{ ply: 0, view: getDuckXiangqiPlayerView(gameState, perspective) }];
      for (const event of events) {
        if (!isDuckMoveEvent(event)) continue;
        let next: typeof gameState;
        try {
          next = applyDuckXiangqiTurn(gameState, event.move);
        } catch {
          // The kernel throws on an illegal turn rather than returning the same
          // state. Keep the captured history instead of rebuilding a wrong one.
          return null;
        }
        gameState = next;
        snapshots.push({
          ply: snapshots.length,
          view: getDuckXiangqiPlayerView(gameState, perspective),
        });
      }
      return snapshots;
    },
  },
});

export function bootstrapDuckXiangqiLiveRoom(): void {
  client.bootstrap();
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Legal destinations for whichever half of the turn is being collected. */
function targetsForPhase(view: DuckXiangqiPlayerView): DuckXiangqiSquare[] {
  const current = phase;
  if (current.kind === 'duck') {
    return duckXiangqiDuckDestinations(view.board, view.duck, current.move.from, current.move.to);
  }
  if (!current.selected) return [];
  const from = current.selected;
  return view.legalPieceMoves.filter((move) => move.from === from).map((move) => move.to);
}

function renderBoard(liveRefs: LiveRefs, view: DuckXiangqiPlayerView | null): void {
  liveRefs.board.className = 'board duck-xiangqi-live-board';
  liveRefs.board.setAttribute('aria-label', 'Duck Xiangqi board');
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }
  // Right-click arrows and circles. `installBoardAnnotations` below captures the
  // gesture, but the shapes only exist on screen if each render draws them.
  const drawn = drawnBoardOverlays<DuckXiangqiSquare>(annotations?.shapes() ?? []);
  liveRefs.board.innerHTML = duckXiangqiBoardSvg(view, orientationFor(view), {
    interactive: true,
    phase,
    targets: targetsForPhase(view),
    arrows: drawn.arrows,
    markers: drawn.markers,
  });
}

/**
 * Say which half of the turn is pending. A two-action turn is unfamiliar enough
 * that without this a player reads the pause after their piece move as the move
 * having failed, and clicks the piece again.
 */
function renderPhaseNotice(liveRefs: LiveRefs, view: DuckXiangqiPlayerView | null): void {
  // Return WITHOUT clearing when there is nothing to say. The shared room
  // chrome owns this element: it writes "Invite opponent" and "Viewing replay"
  // into it and hides the whole section during normal connected play. Clearing
  // unconditionally here blanked those, and unhiding is what makes this one
  // visible at all - the section is `hidden` in the markup, so appending to it
  // rendered a notice nobody could see. Same shape as the fortress check notice.
  if (!view || phase.kind !== 'duck' || !canInteract(view)) return;
  liveRefs.actionSection.hidden = false;
  liveRefs.actionStatus.replaceChildren();
  const notice = document.createElement('div');
  // The site's own notice card, in the pending tone, rather than a bespoke one:
  // a player has seen this exact card say "Invite opponent" a minute earlier.
  notice.className = 'action-notice pending';
  const strong = document.createElement('strong');
  strong.textContent = 'Now place the duck';
  const body = document.createElement('p');
  body.textContent = 'Any empty point. Your move is not sent until you do.';
  notice.append(strong, body);
  liveRefs.actionStatus.append(notice);
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
    ghostSizePx: 0,
    onSquareClick: (square) => handleSquareClick(square as DuckXiangqiSquare),
    // Click-only while the variant is hidden. Dragging a piece would have to
    // ARM phase two rather than complete a move, which is a different gesture
    // from every other board here; getting that wrong is worse than not having
    // it, and it is purely additive later.
    canDragFrom: () => false,
    ghostHtml: () => null,
    onDragStart: () => {},
    onDrop: () => {},
  });
}

function handleSquareClick(square: DuckXiangqiSquare): void {
  const view = core?.state.view;
  if (!view || !canInteract(view)) return;

  const result = duckXiangqiClickResult({
    view,
    seat: isDuckColor(core?.state.seat) ? core.state.seat : null,
    phase,
    targets: targetsForPhase(view),
    square,
    capturesGeneral: (_from, to) => {
      const target = view.board[to];
      return !!target && target.role === 'general' && target.color !== core?.state.seat;
    },
  });

  switch (result.kind) {
    case 'select':
      phase = { kind: 'piece', selected: result.square };
      break;
    case 'clear':
      phase = { kind: 'piece', selected: null };
      break;
    case 'await-duck':
      // Phase one. Deliberately silent and unsent: the turn is half-made.
      phase = { kind: 'duck', move: result.move };
      break;
    case 'turn':
      core?.send({
        type: 'move',
        from: result.turn.from,
        to: result.turn.to,
        ...(result.turn.duckTo === null ? {} : { duckTo: result.turn.duckTo }),
      });
      playSound('move');
      phase = { kind: 'piece', selected: null };
      break;
    case 'noop':
      return;
  }
  core?.renderAll();
}

function canInteract(view: DuckXiangqiPlayerView): boolean {
  return (
    !!core &&
    core.replay.isLive() &&
    core.connection() === 'connected' &&
    view.status.type === 'playing' &&
    isDuckColor(core.state.seat) &&
    view.status.turn === core.state.seat
  );
}

/**
 * Drop a half-made turn whenever the frame that arrived invalidates it.
 *
 * This is the failure mode a two-phase turn adds and a one-phase turn cannot
 * have: a reconnect, an opponent move, or the game ending while the duck is
 * pending would otherwise strand `phase` in `duck` pointing at a piece move the
 * server never saw, and the next click would send a turn from a stale position.
 */
function reconcileInteractionState(view: DuckXiangqiPlayerView | null): void {
  if (!view || !canInteract(view)) {
    phase = { kind: 'piece', selected: null };
    return;
  }
  const current = phase;
  if (current.kind === 'duck') {
    // The pending piece move must still be legal in the position we now hold.
    const stillLegal = view.legalPieceMoves.some(
      (move) => move.from === current.move.from && move.to === current.move.to,
    );
    if (!stillLegal) phase = { kind: 'piece', selected: null };
    return;
  }
  const selected = current.selected;
  if (selected && !view.legalPieceMoves.some((move) => move.from === selected)) {
    phase = { kind: 'piece', selected: null };
  }
}

// ── Sound, notation, replay ──────────────────────────────────────────────────

function maybePlayTerminalSound(): void {
  const view = core?.state.view;
  if (!view) return;
  const status = view.status.type;
  if (lastStatusType === 'playing' && status === 'finished') {
    const seat = core?.state.seat;
    const winner = view.status.type === 'finished' ? view.status.winner : null;
    const reason = view.status.type === 'finished' ? view.status.reason : null;
    playTerminalPlan(winner === null ? 'draw' : winner === seat ? 'win' : 'lose', reason);
  }
  lastStatusType = status;
}

function duckTurnLabel(move: DuckXiangqiTurn): string {
  // `x…#` is a general capture, which ends the game and is the one turn with no
  // duck placement.
  return move.duckTo === null
    ? `${move.from}x${move.to}#`
    : `${move.from}-${move.to}@${move.duckTo}`;
}

function isDuckMoveEvent(event: TenantLiveEvent): event is DuckMoveEvent {
  return (event as { type?: unknown }).type === 'move-played';
}

function orientationFor(view: DuckXiangqiPlayerView | null): DuckXiangqiColor {
  const seat = core?.state.seat;
  if (isDuckColor(seat)) return seat;
  return view?.perspective ?? 'red';
}

function replayPlyForView(
  view: DuckXiangqiPlayerView,
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

function replayPositionKey(view: DuckXiangqiPlayerView): string {
  const board = Object.entries(view.board)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([square, piece]) => [square, piece.color, piece.role]);
  // The duck is part of the position: two boards with identical pieces and the
  // duck elsewhere are different positions, and every piece's move set differs.
  return JSON.stringify({ board, duck: view.duck ?? null, moveNumber: view.moveNumber });
}

function duckReasonPhrase(reason: string): string {
  switch (reason) {
    case 'general-captured':
      return 'general captured';
    case 'stalemate':
      return 'no legal turn';
    case 'progress':
      return '60 moves without a capture';
    case 'repetition':
      return 'threefold repetition';
    default:
      return reason.replace(/-/g, ' ');
  }
}
