// Hidden FFQ live client. Both build and server flags are explicit opt-ins;
// the server admits admins only. Fixed red/black seats; finished views stay masked.
import {
  type BanqiColor,
  type BanqiSquare,
  FFQ_BANQI_SPEC_ID,
  type FFQBanqiMove,
  type FFQBanqiPlayerView,
} from '@mistboard/game';
import './live-xiangqi.css';
import './live-ffq-banqi.css';
import { seatPanelBlock, seatPanelLine, seatPanelPieces } from './banqi-seat-panel.js';
import { pieceFlipDurationMs } from './board-anim.js';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { ffqBanqiEnabled } from './feature-flags.js';
import { ffqBanqiClickResult, ffqBanqiIndex, ffqBanqiSquare } from './ffq-banqi-board.js';
import { createFFQBanqiHpMeter } from './ffq-banqi-hp.js';
import { variantDisplayLabel } from './game-display.js';
import { placeHiddenPoolUnderBoard } from './hidden-pool-placement.js';
import { t } from './i18n/catalog.js';
import {
  type BanqiChaseBubble,
  createBanqiChaseBubble,
  noticeReadMs,
} from './live-banqi-chase-bubble.js';
import {
  animateBanqiBoardMove,
  animateBanqiReveal,
  BANQI_PIECE_PX,
  banqiPieceGhostSvg,
  installBanqiBoardStyles,
} from './live-banqi-render.js';
import { renderFFQBanqiBoardSvg } from './live-ffq-banqi-render.js';
import type { LiveRefs } from './live-state.js';
import { fillCapturedPoolWith } from './review/captured-pool.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
} from './variant-tenant/live-client.js';
import { adoptLiveHistory } from './variant-tenant/live-history.js';
import type { TenantReasonKey, WebVariantTenant } from './variant-tenant/room-chrome.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';

export type FFQBanqiWireView = FFQBanqiPlayerView;
type MoveEvent = TenantMovePlayed<BanqiColor, FFQBanqiMove>;
let core: TenantLiveClientContext<BanqiColor, FFQBanqiWireView> | null = null;
let roomMode: 'pve' | 'pvp' = 'pvp';
let pveEngineId: string | null = null;
let selectedSquare: BanqiSquare | null = null;
let draggingFrom: BanqiSquare | null = null;
let chaseBubble: BanqiChaseBubble | null = null;
let chaseNoticeTimer: ReturnType<typeof setTimeout> | null = null;

function isSeat(value: unknown): value is BanqiColor {
  return value === 'red' || value === 'black';
}

function reasonPhrase(reason: string): TenantReasonKey {
  switch (reason) {
    case 'hp':
      return 'result.hp';
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

const tenant: WebVariantTenant<BanqiColor> = {
  displayName: 'variant.ffqBanqi.name',
  colors: ['red', 'black'],
  isColor: isSeat,
  oppositeColor: (seat) => (seat === 'red' ? 'black' : 'red'),
  enabled: ffqBanqiEnabled,
  reviewUrl: (room) => `/ffq-banqi/game/${encodeURIComponent(room)}`,
  reasonPhrase,
  rejectedBodyByReason: { 'game spec disabled': 'live.ffq.adminOnly' },
  spectatorBody: 'live.spectatorWatchingGame',
  selectInstruction: 'live.selectBanqi',
  showPregameTurn: true,
};

const client = createTenantLiveClient<BanqiColor, FFQBanqiWireView, FFQBanqiMove>({
  tenant,
  gameSpecId: FFQ_BANQI_SPEC_ID,
  defaultRoomId: 'ffq_dev',
  boardClass: 'banqi-live-board',
  chrome: { roomMode: () => roomMode },
  onFrame: (frame) => {
    if (frame.roomMode === 'pve' || frame.roomMode === 'pvp') roomMode = frame.roomMode;
    if (typeof frame.pveEngineId === 'string') pveEngineId = frame.pveEngineId;
  },
  playAgainRequestBody: (state) => ({
    gameSpecId: FFQ_BANQI_SPEC_ID,
    mode: roomMode,
    ...(roomMode === 'pve' && pveEngineId ? { engineId: pveEngineId } : {}),
    rated: false,
    preferredColor: isSeat(state.seat) ? state.seat : 'random',
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  resetState: () => {
    roomMode = 'pvp';
    pveEngineId = null;
    clearChaseNotice();
    selectedSquare = null;
    draggingFrom = null;
  },
  // A new view may revoke the selection's moves, including a turn change.
  onSnapshotApplied: () => {
    clearChaseNotice();
    selectedSquare = null;
    draggingFrom = null;
  },
  onEventApplied: () => {
    clearChaseNotice();
    selectedSquare = null;
    draggingFrom = null;
  },
  renderBoard,
  renderExtras: renderSeatPanel,
  animateBoard: (refs, view, takePending) => {
    if (!view || draggingFrom) return;
    const pending = takePending();
    if (!pending) return;
    const move =
      pending.kind === 'live'
        ? pending.move
        : pending.direction === 'forward'
          ? view.lastMove
          : pending.prevView?.lastMove;
    if (!move) return;
    if (move.from === move.to) {
      if (pending.kind === 'live' || pending.direction === 'forward') {
        animateBanqiReveal(refs.board, ffqBanqiSquare(move.to));
        return pieceFlipDurationMs();
      }
    } else {
      animateBanqiBoardMove(
        refs.board,
        { from: ffqBanqiSquare(move.from), to: ffqBanqiSquare(move.to) },
        { reverse: pending.kind === 'scrub' && pending.direction === 'back' },
      );
    }
  },
  setup: (ctx) => {
    core = ctx;
    chaseBubble = createBanqiChaseBubble(ctx.refs.board);
    installBanqiBoardStyles();
    placeHiddenPoolUnderBoard(ctx.refs);
    installBoardDrag({
      board: ctx.refs.board,
      ghostSizePx: BANQI_PIECE_PX,
      onSquareClick: (square) => {
        const view = core?.state.view;
        if (!view || !canInteract()) return;
        const result = ffqBanqiClickResult(
          view,
          core?.state.seat,
          selectedSquare,
          square as BanqiSquare,
        );
        if (result.kind === 'forbidden') {
          showChaseNotice(result.move.to);
          return;
        }
        if (result.kind !== 'noop') clearChaseNotice();
        if (result.kind === 'select') selectedSquare = result.square;
        else if (result.kind === 'clear') selectedSquare = null;
        else if (result.kind === 'move') {
          selectedSquare = null;
          core?.send({
            type: 'move',
            from: ffqBanqiIndex(result.move.from),
            to: ffqBanqiIndex(result.move.to),
          });
        }
        renderBoard(ctx.refs, view);
      },
      canDragFrom: (square) => {
        const view = core?.state.view;
        if (!view || !canInteract()) return false;
        const index = ffqBanqiIndex(square);
        const entry = view.board[index];
        return (
          !!entry &&
          !entry.faceDown &&
          entry.color === core?.state.seat &&
          [...view.legalMoves, ...(view.forbiddenMoves ?? [])].some(
            (m) => m.from === index && m.to !== index,
          )
        );
      },
      ghostHtml: (square) => {
        const entry = core?.state.view?.board[ffqBanqiIndex(square)];
        return entry && !entry.faceDown ? banqiPieceGhostSvg(entry) : null;
      },
      onDragStart: (square) => {
        clearChaseNotice();
        selectedSquare = draggingFrom = square as BanqiSquare;
        renderBoard(ctx.refs, core?.state.view ?? null);
      },
      onDrop: (from, to) => {
        const view = core?.state.view;
        clearChaseNotice();
        if (view && to && canInteract()) {
          const forbidden = view.forbiddenMoves?.find(
            (m) => m.from === ffqBanqiIndex(from) && m.to === ffqBanqiIndex(to),
          );
          if (forbidden) {
            selectedSquare = from as BanqiSquare;
            draggingFrom = null;
            renderBoard(ctx.refs, view);
            showChaseNotice(to as BanqiSquare);
            return;
          }
          const move = view.legalMoves.find(
            (m) => m.from === ffqBanqiIndex(from) && m.to === ffqBanqiIndex(to) && m.from !== m.to,
          );
          if (move) core?.send({ type: 'move', ...move });
        }
        selectedSquare = draggingFrom = null;
        renderBoard(ctx.refs, view ?? null);
      },
    });
    window.addEventListener(xiangqiAppearanceChangedEvent, ctx.renderAll);
    installSelectionClickAway({
      roots: () => [ctx.refs.board],
      hasSelection: () => selectedSquare !== null,
      clearSelection: () => {
        clearChaseNotice();
        selectedSquare = draggingFrom = null;
        renderBoard(ctx.refs, ctx.displayedView());
      },
    });
  },
  moveList: {
    rowClass: 'move-row xiangqi-move-row',
    cellPrefix: 'xiangqi-move-row',
    listClass: 'xiangqi-move-list',
    masked: false,
    notate: (m) =>
      m.from === m.to
        ? `${ffqBanqiSquare(m.to)}↻`
        : `${ffqBanqiSquare(m.from)}-${ffqBanqiSquare(m.to)}`,
    isMoveEvent,
  },
  replayCapture: {
    positionKey: (view) => JSON.stringify(view),
    plyForView: (view) => view.ply,
  },
  // Adopt only the viewer's masked snapshots, live or finished. Never recover
  // the deal or run standard banqi's finished-board reveal/reconstruction.
  replayHistory: {
    rebuild: ({ frame, view }) =>
      adoptLiveHistory(frame.liveHistory, view, view.ply, { finished: true }),
  },
});

export function bootstrapFFQBanqiLiveRoom(): void {
  client.bootstrap();
}

function canInteract(): boolean {
  const view = core?.state.view;
  return (
    ffqBanqiEnabled() &&
    !!core &&
    !!view &&
    core.replay.isLive() &&
    core.connection() === 'connected' &&
    isSeat(core.state.seat) &&
    view.status.type === 'playing' &&
    view.status.turn === core.state.seat
  );
}

function renderBoard(refs: LiveRefs, view: FFQBanqiWireView | null): void {
  refs.board.className = 'board banqi-live-board';
  refs.board.setAttribute('aria-label', variantDisplayLabel(FFQ_BANQI_SPEC_ID));
  if (!view) {
    clearChaseNotice();
    refs.board.replaceChildren();
    return;
  }
  const selectedIndex = selectedSquare ? ffqBanqiIndex(selectedSquare) : null;
  refs.board.innerHTML = renderFFQBanqiBoardSvg(view, {
    interactive: true,
    selectedSquare,
    forbiddenMoves: selectedSquare
      ? (view.forbiddenMoves ?? [])
          .filter((move) => move.from === selectedIndex)
          .map((move) => ({ from: ffqBanqiSquare(move.from), to: ffqBanqiSquare(move.to) }))
      : [],
    draggingFrom,
    coordinates: boardCoordinatesEnabled(),
  });
  if (!canInteract()) clearChaseNotice();
  chaseBubble?.sync();
}

function showChaseNotice(square: BanqiSquare): void {
  clearChaseNotice();
  const text = t('live.ffq.chaseForbidden');
  chaseBubble?.show(square, selectedSquare, text);
  chaseNoticeTimer = setTimeout(clearChaseNotice, noticeReadMs(text));
}

function clearChaseNotice(): void {
  if (chaseNoticeTimer) clearTimeout(chaseNoticeTimer);
  chaseNoticeTimer = null;
  chaseBubble?.clear();
}

// The seat panel under the board, Three Kingdoms banqi's layout
// (banqi-seat-panel.ts): one block per seat, the top seat's first like the
// board, its name and HP bar where Three Kingdoms shows points, then the pieces
// it took. Every capture is public in Fanfanqi, a covered one included, and
// the panel reads only the viewer's view, never the deal. A cannon can
// take a covered piece of its own colour, so a seat's line can hold both inks;
// a covered capture is shaded as banqi shades one. The no-progress and chase
// counts stay rules, not readouts: the chase limit shows as a cross and a
// bubble on the board when a move would break it.
function renderSeatPanel(refs: LiveRefs, view: FFQBanqiWireView | null): void {
  const host = refs.hiddenPool;
  host.replaceChildren();
  if (!view) return;
  const bottom: BanqiColor = core?.orientation() ?? 'red';
  const top: BanqiColor = bottom === 'red' ? 'black' : 'red';
  for (const side of [top, bottom]) host.append(seatBlock(view, side));
}

function seatBlock(view: FFQBanqiWireView, side: BanqiColor): HTMLElement {
  const block = seatPanelBlock({
    name: t(side === 'red' ? 'setup.red' : 'setup.black'),
    score: createFFQBanqiHpMeter(view, side),
    seat: side,
    ink: side,
    className: 'tk-seat--hp',
  });
  const taken = view.captured
    .filter((capture) => capture.capturedBy === side)
    .map((capture) => ({
      owner: capture.owner,
      role: capture.role,
      takenFaceDown: capture.wasFaceDown,
    }));
  const pieces = document.createElement('div');
  for (const owner of [tenant.oppositeColor(side), side])
    fillCapturedPoolWith(pieces, taken, owner, banqiPieceGhostSvg);
  block.append(seatPanelLine('captured', t('live.tk.captured'), seatPanelPieces(pieces)));
  return block;
}

function isMoveEvent(event: TenantLiveEvent): event is MoveEvent {
  const e = event as Partial<MoveEvent>;
  const square = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 32;
  return (
    e.type === 'move-played' &&
    isSeat(e.color) &&
    !!e.move &&
    square(e.move.from) &&
    square(e.move.to)
  );
}
