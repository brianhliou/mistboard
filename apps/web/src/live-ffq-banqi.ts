// Hidden FFQ live client. Both build and server flags are explicit opt-ins;
// the server admits admins only. Fixed red/black seats; finished views stay masked.
import {
  type BanqiColor,
  type BanqiSquare,
  FFQ_BANQI_CHASE_LIMIT,
  FFQ_BANQI_DAMAGE,
  FFQ_BANQI_NO_PROGRESS_LIMIT,
  FFQ_BANQI_SPEC_ID,
  FFQ_BANQI_START_HP,
  type FFQBanqiMove,
  type FFQBanqiPlayerView,
} from '@mistboard/game';
import './live-xiangqi.css';
import './live-ffq-banqi.css';
import { pieceFlipDurationMs } from './board-anim.js';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { ffqBanqiEnabled } from './feature-flags.js';
import { ffqBanqiClickResult, ffqBanqiIndex, ffqBanqiSquare } from './ffq-banqi-board.js';
import { placeHiddenPoolUnderBoard } from './hidden-pool-placement.js';
import { t } from './i18n/catalog.js';
import {
  animateBanqiBoardMove,
  animateBanqiReveal,
  BANQI_PIECE_PX,
  banqiPieceGhostSvg,
  installBanqiBoardStyles,
} from './live-banqi-render.js';
import { renderFFQBanqiBoardSvg } from './live-ffq-banqi-render.js';
import type { LiveRefs } from './live-state.js';
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
let selectedSquare: BanqiSquare | null = null;
let draggingFrom: BanqiSquare | null = null;

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
  reviewUrl: (room) => `/room/${encodeURIComponent(room)}`,
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
  chrome: { roomMode: () => 'pvp' },
  playAgainRequestBody: (state) => ({
    gameSpecId: FFQ_BANQI_SPEC_ID,
    mode: 'pvp',
    preferredColor: isSeat(state.seat) ? state.seat : 'random',
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  resetState: () => {
    selectedSquare = null;
    draggingFrom = null;
  },
  // A new view may revoke the selection's moves, including a turn change.
  onSnapshotApplied: () => {
    selectedSquare = null;
    draggingFrom = null;
  },
  onEventApplied: () => {
    selectedSquare = null;
    draggingFrom = null;
  },
  renderBoard,
  renderExtras: renderProgress,
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
          view.legalMoves.some((m) => m.from === index && m.to !== index)
        );
      },
      ghostHtml: (square) => {
        const entry = core?.state.view?.board[ffqBanqiIndex(square)];
        return entry && !entry.faceDown ? banqiPieceGhostSvg(entry) : null;
      },
      onDragStart: (square) => {
        selectedSquare = draggingFrom = square as BanqiSquare;
        renderBoard(ctx.refs, core?.state.view ?? null);
      },
      onDrop: (from, to) => {
        const view = core?.state.view;
        if (view && to && canInteract()) {
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
  refs.board.setAttribute('aria-label', 'Fanfanqi board');
  if (!view) {
    refs.board.replaceChildren();
    return;
  }
  refs.board.innerHTML = renderFFQBanqiBoardSvg(view, {
    interactive: true,
    selectedSquare,
    draggingFrom,
    coordinates: boardCoordinatesEnabled(),
  });
}

function renderProgress(refs: LiveRefs, view: FFQBanqiWireView | null): void {
  refs.hiddenPool.replaceChildren();
  if (!view) return;
  const panel = document.createElement('div');
  panel.className = 'ffq-banqi-progress';
  for (const side of tenant.colors) {
    const row = document.createElement('div');
    row.className = 'ffq-banqi-hp';
    row.dataset.side = side;
    const name = document.createElement('span');
    name.textContent = t(side === 'red' ? 'setup.red' : 'setup.black');
    const bar = document.createElement('progress');
    bar.max = FFQ_BANQI_START_HP;
    bar.value = view.hp[side];
    bar.setAttribute('aria-label', name.textContent);
    const value = document.createElement('span');
    value.textContent = t('live.ffq.hp', { hp: view.hp[side], max: FFQ_BANQI_START_HP });
    row.append(name, bar, value);
    panel.append(row);
  }
  const counters = document.createElement('div');
  counters.className = 'ffq-banqi-counters';
  counters.textContent = [
    t('live.ffq.noProgress', { count: view.noProgressClock, limit: FFQ_BANQI_NO_PROGRESS_LIMIT }),
    ...tenant.colors.map((side) =>
      t('live.ffq.chase', {
        side: t(side === 'red' ? 'setup.red' : 'setup.black'),
        count: view.chaseCounts[side],
        limit: FFQ_BANQI_CHASE_LIMIT,
      }),
    ),
  ].join(' · ');
  panel.append(counters);
  const captures = document.createElement('ol');
  captures.className = 'ffq-banqi-captures';
  for (const capture of view.captured) {
    if (capture.role === null) continue;
    const entry = document.createElement('li');
    entry.textContent = t('live.ffq.captureDamage', {
      capturer: t(capture.capturedBy === 'red' ? 'setup.red' : 'setup.black'),
      owner: t(capture.owner === 'red' ? 'setup.red' : 'setup.black'),
      piece: t(`review.luckCard.role.${capture.role}`),
      damage: FFQ_BANQI_DAMAGE[capture.role],
    });
    captures.append(entry);
  }
  panel.append(captures);
  refs.hiddenPool.append(panel);
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
