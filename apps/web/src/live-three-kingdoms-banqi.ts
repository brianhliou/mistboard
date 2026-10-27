// Live room client for Three Kingdoms banqi (三國暗棋, #628): a LOCAL PLAYTEST
// ONLY, behind VITE_THREE_KINGDOMS_BANQI_ENABLED (off by default). Built on the
// generic live-client core like live-jungle-flip.ts, which it follows closely:
// symmetric hidden identity (the server sends both seats the same masked board),
// seats are move order and the ink binds on the opening flip (view.firstColor),
// so there is no fog and the move list is unmasked.
//
// What is its own: the 9x5 intersection board (three-kingdoms-banqi-diagrams.ts),
// the score race to 100 and the no-progress count shown under the board, and a
// plain move notation. No postgame page, review page, watch channel or sounds of
// its own; whether it gets any is the 10-31 checkpoint's call.

import type {
  BanqiColor,
  BanqiPieceRole,
  BanqiSeat,
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiSquare,
  ThreeKingdomsBanqiStatus,
} from '@mistboard/game';
import {
  THREE_KINGDOMS_BANQI_NO_PROGRESS_LIMIT,
  THREE_KINGDOMS_BANQI_SCORE_TARGET,
} from '@mistboard/game';
import './live-xiangqi.css';
import { threeKingdomsBanqiEnabled } from './feature-flags.js';
import { flipSeatInk } from './flip-seat-ink.js';
import { placeHiddenPoolUnderBoard } from './hidden-pool-placement.js';
import { banqiPieceGhostSvg, banqiRevealFlipSquare } from './live-banqi-render.js';
import { playSound } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import {
  animateThreeKingdomsBanqiBoardMove,
  animateThreeKingdomsBanqiReveal,
  renderThreeKingdomsBanqiLiveBoardSvg,
  TK_LIVE_BOARD_VIEW,
  type TkLiveBoardEntry,
} from './three-kingdoms-banqi-diagrams.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
} from './variant-tenant/live-client.js';
import { adoptLiveHistory } from './variant-tenant/live-history.js';
import type {
  TenantReasonKey,
  TenantSeatKey,
  WebVariantTenant,
} from './variant-tenant/room-chrome.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';

type Square = ThreeKingdomsBanqiSquare;

// ── Wire shape (mirror ThreeKingdomsBanqiPlayerView) ──────────────────────────

export type ThreeKingdomsBanqiWireView = {
  id: string;
  perspective: BanqiSeat;
  board: Partial<Record<Square, TkLiveBoardEntry>>;
  status: ThreeKingdomsBanqiStatus;
  ply: number;
  moveNumber: number;
  firstColor: BanqiColor | null;
  scores: Record<BanqiSeat, number>;
  noProgressClock: number;
  captured: { owner: BanqiColor; role: BanqiPieceRole }[];
  legalMoves: ThreeKingdomsBanqiMove[];
  lastMove?: ThreeKingdomsBanqiMove;
};

type TkMoveEvent = TenantMovePlayed<BanqiSeat, ThreeKingdomsBanqiMove>;

// ── Interaction/render state ──────────────────────────────────────────────────

let core: TenantLiveClientContext<BanqiSeat, ThreeKingdomsBanqiWireView> | null = null;
let selectedSquare: Square | null = null;
let draggingFrom: Square | null = null;
let roomMode: 'pve' | 'pvp' = 'pvp';

function isSeat(value: unknown): value is BanqiSeat {
  return value === 'red' || value === 'black';
}

function seatInk(seat: BanqiSeat, view: ThreeKingdomsBanqiWireView | null): BanqiColor | null {
  return flipSeatInk(seat, view?.firstColor ?? null);
}

function liveSeatInk(seat: BanqiSeat): BanqiColor | null {
  return seatInk(seat, core?.state.view ?? null);
}

function seatLabel(seat: BanqiSeat): TenantSeatKey {
  const ink = liveSeatInk(seat);
  if (ink) return ink === 'red' ? 'setup.red' : 'setup.black';
  return seat === 'red' ? 'setup.first' : 'setup.second';
}

// The side that made the last move: the seat that is NOT to move now (ply parity
// once finished), read off the seat so a flip that turned up the other ink is
// still washed in the mover's own.
function lastMoverInk(view: ThreeKingdomsBanqiWireView): BanqiColor | null {
  if (!view.lastMove || view.ply === 0) return null;
  const mover: BanqiSeat = (view.ply - 1) % 2 === 0 ? 'red' : 'black';
  return seatInk(mover, view);
}

function reasonPhrase(reason: string): TenantReasonKey {
  switch (reason) {
    case 'score':
      return 'result.onPoints';
    case 'no-progress':
      return 'result.noProgress';
    case 'no-legal-move':
      return 'result.noLegalMove';
    case 'timeout':
      return 'result.timeout';
    case 'resignation':
      return 'result.resignation';
    case 'abandonment':
      return 'result.abandonment';
    default:
      return 'result.gameRules';
  }
}

const tkWebTenant: WebVariantTenant<BanqiSeat> = {
  displayName: 'variant.threeKingdomsBanqi.name',
  colors: ['red', 'black'],
  isColor: isSeat,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  enabled: threeKingdomsBanqiEnabled,
  // No review page yet: the Review link reopens the room, whose move list steps
  // through the finished game.
  reviewUrl: (roomId) => `/room/${encodeURIComponent(roomId)}`,
  reasonPhrase,
  spectatorBody: 'live.spectatorWatchingGame',
  selectInstruction: 'live.selectBanqi',
  seatLabel,
  seatInk: liveSeatInk,
  showPregameTurn: true,
};

const client = createTenantLiveClient<
  BanqiSeat,
  ThreeKingdomsBanqiWireView,
  ThreeKingdomsBanqiMove
>({
  tenant: tkWebTenant,
  gameSpecId: 'three-kingdoms-banqi',
  defaultRoomId: 'tkb_dev',
  boardClass: 'tk-banqi-live-board',
  chrome: {
    roomMode: () => roomMode,
  },
  playAgainRequestBody: (state) => ({
    mode: roomMode,
    gameSpecId: 'three-kingdoms-banqi',
    preferredColor: isSeat(state.seat) ? (state.seat === 'red' ? 'black' : 'red') : 'random',
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onFrame: (frame) => {
    if (frame.roomMode === 'pve' || frame.roomMode === 'pvp') roomMode = frame.roomMode;
  },
  resetState: () => {
    selectedSquare = null;
    draggingFrom = null;
    roomMode = 'pvp';
  },
  renderBoard,
  // Banqi's glides (pieceAnimation pref), live and on scrubs. Unlike banqi,
  // the room's own moves glide too: nothing draws a move before the server
  // echoes it (a dropped piece snaps back to its origin until then), so the
  // echo is the first time the piece moves and gliding it is not a replay.
  animateBoard: (liveRefs, view, takePendingAnimation) => {
    if (!view || draggingFrom) return;
    const pending = takePendingAnimation();
    if (!pending) return;
    if (pending.kind === 'live') {
      const flipped = banqiRevealFlipSquare(pending, view.board);
      if (flipped) {
        animateThreeKingdomsBanqiReveal(liveRefs.board, flipped);
        return;
      }
      animateThreeKingdomsBanqiBoardMove(liveRefs.board, pending.move);
      return;
    }
    if (pending.direction === 'forward') {
      if (view.lastMove) animateThreeKingdomsBanqiBoardMove(liveRefs.board, view.lastMove);
      return;
    }
    const undone = pending.prevView?.lastMove;
    if (undone) animateThreeKingdomsBanqiBoardMove(liveRefs.board, undone, { reverse: true });
  },
  renderExtras: (refs, view) => renderScores(refs, view),
  onDisabled: (refs) => {
    renderScores(refs, core?.displayedView() ?? null);
    selectedSquare = null;
  },
  setup: (ctx) => {
    core = ctx;
    installInteraction(ctx.refs);
    placeHiddenPoolUnderBoard(ctx.refs);
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
    notate: (move) => notate(move, undefined),
    notateWithView: (move, viewAfter) => notate(move, viewAfter?.board),
    isMoveEvent,
  },
  replayCapture: {
    positionKey: (view) =>
      JSON.stringify({
        board: view.board,
        lastMove: view.lastMove ?? null,
        status: view.status,
        ply: view.ply,
        scores: view.scores,
      }),
    plyForView: (view) => view.ply,
  },
  // The deal is a server secret, so the client never replays the log: the
  // hello carries this viewer's per-ply masked views (live and finished).
  replayHistory: {
    rebuild: ({ events, view, frame }) =>
      adoptLiveHistory(frame.liveHistory, view, events.filter(isMoveEvent).length, {
        finished: true,
      }),
  },
});

export function bootstrapThreeKingdomsBanqiLiveRoom(): void {
  client.bootstrap();
}

// ── Notation ──────────────────────────────────────────────────────────────────

const ROLE_LETTER: Record<BanqiPieceRole, string> = {
  general: 'K',
  advisor: 'A',
  elephant: 'E',
  chariot: 'R',
  horse: 'H',
  cannon: 'C',
  soldier: 'P',
};

// "c2-c4", a capture "c2xc4", and a flip names what it turned up: "c2(H)".
function notate(
  move: ThreeKingdomsBanqiMove,
  boardAfter: Partial<Record<Square, TkLiveBoardEntry>> | undefined,
): string {
  if (move.from === move.to) {
    const entry = boardAfter?.[move.to];
    return entry && !entry.faceDown ? `${move.to}(${ROLE_LETTER[entry.role]})` : `${move.to}()`;
  }
  return `${move.from}-${move.to}`;
}

// ── Scores ────────────────────────────────────────────────────────────────────

// The race to 100 and the no-progress count, as one line under the board.
function renderScores(liveRefs: LiveRefs, view: ThreeKingdomsBanqiWireView | null): void {
  const pool = liveRefs.hiddenPool;
  if (!view) {
    pool.replaceChildren();
    return;
  }
  pool.hidden = false;
  const line = document.createElement('p');
  line.className = 'tk-banqi-scores';
  const side = (seat: BanqiSeat) => {
    const ink = seatInk(seat, view);
    const name = ink ? (ink === 'red' ? 'Red' : 'Black') : seat === 'red' ? 'First' : 'Second';
    return `${name} ${view.scores[seat]}`;
  };
  line.textContent = `${side('red')}, ${side('black')} (first to ${THREE_KINGDOMS_BANQI_SCORE_TARGET}). Quiet moves: ${view.noProgressClock}/${THREE_KINGDOMS_BANQI_NO_PROGRESS_LIMIT}.`;
  pool.replaceChildren(line);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderBoard(liveRefs: LiveRefs, view: ThreeKingdomsBanqiWireView | null): void {
  liveRefs.board.className = 'board tk-banqi-live-board';
  liveRefs.board.setAttribute('aria-label', 'Three Kingdoms banqi board');
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }
  const targets = selectedSquare
    ? view.legalMoves.filter((m) => m.from === selectedSquare && m.to !== m.from).map((m) => m.to)
    : [];
  liveRefs.board.innerHTML = renderThreeKingdomsBanqiLiveBoardSvg(view.board, {
    selected: selectedSquare,
    targets,
    draggingFrom,
    lastMove: view.lastMove ?? null,
    lastMoveInk: lastMoverInk(view),
  });
}

// ── Interaction ───────────────────────────────────────────────────────────────

function installInteraction(liveRefs: LiveRefs): void {
  installBoardDrag({
    board: liveRefs.board,
    ghostSizePx: () => {
      const width = liveRefs.board.getBoundingClientRect().width;
      return width > 0
        ? (width * TK_LIVE_BOARD_VIEW.cell) / TK_LIVE_BOARD_VIEW.width
        : TK_LIVE_BOARD_VIEW.cell;
    },
    onSquareClick: (square) => {
      const view = core?.state.view;
      if (!view) return;
      handleSquareClick(view, square as Square);
      renderBoard(liveRefs, view);
    },
    canDragFrom: (square) => canDrag(square as Square),
    ghostHtml: (square) => {
      const entry = core?.state.view?.board[square as Square];
      return entry && !entry.faceDown ? banqiPieceGhostSvg(entry) : null;
    },
    onDragStart: (from) => {
      selectedSquare = from as Square;
      draggingFrom = from as Square;
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
    onDrop: (from, to) => drop(liveRefs, from as Square, to as Square | null),
  });
}

function myTurn(view: ThreeKingdomsBanqiWireView): BanqiSeat | null {
  if (!core?.replay.isLive() || core.connection() !== 'connected') return null;
  const seat = core.state.seat;
  if (!isSeat(seat) || view.status.type !== 'playing' || view.status.turn !== seat) return null;
  return seat;
}

function canDrag(square: Square): boolean {
  const view = core?.state.view;
  if (!view) return false;
  const seat = myTurn(view);
  if (!seat) return false;
  const entry = view.board[square];
  const ink = seatInk(seat, view);
  return !!entry && !entry.faceDown && !!ink && entry.color === ink;
}

function sendMove(view: ThreeKingdomsBanqiWireView, move: ThreeKingdomsBanqiMove): void {
  selectedSquare = null;
  core?.send({ type: 'move', from: move.from, to: move.to });
  playSound(move.from === move.to ? 'flip' : view.board[move.to] ? 'capture' : 'move');
}

function drop(liveRefs: LiveRefs, from: Square, to: Square | null): void {
  draggingFrom = null;
  const view = core?.state.view;
  const move =
    to && view
      ? view.legalMoves.find((m) => m.from === from && m.to === to && m.to !== m.from)
      : undefined;
  if (move && view) sendMove(view, move);
  else selectedSquare = null;
  if (core?.state.view) renderBoard(liveRefs, core.state.view);
}

function handleSquareClick(view: ThreeKingdomsBanqiWireView, square: Square): void {
  const seat = myTurn(view);
  if (!seat) {
    selectedSquare = null;
    return;
  }
  const entry = view.board[square];
  if (entry?.faceDown) {
    const flip = view.legalMoves.find((m) => m.from === square && m.to === square);
    if (flip) sendMove(view, flip);
    else selectedSquare = null;
    return;
  }
  const ink = seatInk(seat, view);
  if (entry && !entry.faceDown && ink && entry.color === ink) {
    selectedSquare = square;
    return;
  }
  if (selectedSquare) {
    const move = view.legalMoves.find(
      (m) => m.from === selectedSquare && m.to === square && m.to !== m.from,
    );
    if (move) {
      sendMove(view, move);
      return;
    }
  }
  selectedSquare = null;
}

function isMoveEvent(event: TenantLiveEvent): event is TkMoveEvent {
  const move = (event as { move?: unknown }).move;
  return (
    event.type === 'move-played' &&
    isSeat((event as { color?: unknown }).color) &&
    typeof move === 'object' &&
    move !== null &&
    typeof (move as { from?: unknown }).from === 'string' &&
    typeof (move as { to?: unknown }).to === 'string'
  );
}
