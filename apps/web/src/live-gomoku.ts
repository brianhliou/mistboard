import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  GOMOKU_SPEC_ID,
  type GomokuColor,
  type GomokuMove,
  type GomokuPlayerView,
  getGomokuPlayerView,
  isGomokuColor,
  parseGomokuMove,
} from '@mistboard/game';
import { type GomokuBoardMarker, gomokuBoardSvg } from './gomoku-board.js';
import './gomoku-board.css';
import './live-xiangqi.css';
import { t } from './i18n/catalog.js';
import type { LiveRefs } from './live-state.js';
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
  type TenantRecording,
} from './variant-tenant/live-client.js';
import type { WebVariantTenant } from './variant-tenant/room-chrome.js';

let core: TenantLiveClientContext<GomokuColor, GomokuPlayerView> | null = null;
let roomMode: 'pvp' | 'pve' = 'pvp';
let recordingPosition: ((ply: number, view: GomokuPlayerView) => void) | null = null;
let recordingMarkers: readonly GomokuBoardMarker[] = [];

function boardSvg(view: GomokuPlayerView, enabled: boolean): string {
  // Recorded spectator views deliberately have no playable moves. Validate
  // engine ink against the public kernel's turn without enabling placement.
  const marked =
    recordingMarkers.length && view.status.type === 'playing'
      ? getGomokuPlayerView(view, view.status.turn)
      : view;
  return gomokuBoardSvg(marked, enabled, recordingMarkers);
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted) core?.renderAll();
});
window.addEventListener('mistboard:display-preferences-change', () => {
  if (core?.refs.board.isConnected) core.renderAll();
});

const tenant: WebVariantTenant<GomokuColor> = {
  displayName: 'variant.gomoku.name',
  // The shared move list's columns follow move order. A dealt odd-stone
  // opening starts with White; stone colour and seat ownership stay fixed.
  get colors() {
    return core?.state.view?.opening?.turn === 'white'
      ? (['white', 'black'] as const)
      : (['black', 'white'] as const);
  },
  isColor: isGomokuColor,
  oppositeColor: (color) => (color === 'black' ? 'white' : 'black'),
  seatMarker: (color) => {
    const stone = document.createElement('span');
    stone.className = `clock-seat-stone ${color}`;
    stone.setAttribute('aria-hidden', 'true');
    return stone;
  },
  // Admission is enforced by the server, including admin playtests while hidden.
  enabled: () => true,
  reviewUrl: (roomId) => `/gomoku/game/${encodeURIComponent(roomId)}`,
  reasonPhrase: (reason) => {
    switch (reason) {
      case 'five':
        return 'result.five';
      case 'board-full':
        return 'result.boardFull';
      case 'agreement':
        return 'result.agreement';
      case 'timeout':
        return 'result.timeout';
      case 'resignation':
        return 'result.resignation';
      case 'abandonment':
        return 'result.abandonment';
      default:
        return 'result.gameRules';
    }
  },
  spectatorBody: 'live.spectatorFullBoard',
  selectInstruction: 'live.gomokuPlace',
};

function isMoveEvent(event: TenantLiveEvent): event is TenantMovePlayed<GomokuColor, GomokuMove> {
  if (event.type !== 'move-played' || !isGomokuColor(event.color)) return false;
  const move = event.move as { to?: unknown } | undefined;
  return typeof move?.to === 'string' && parseGomokuMove(move.to) !== null;
}

const client = createTenantLiveClient<GomokuColor, GomokuPlayerView, GomokuMove>({
  tenant,
  gameSpecId: GOMOKU_SPEC_ID,
  defaultRoomId: 'gmk_dev',
  boardClass: 'gomoku-live-board',
  chrome: { roomMode: () => roomMode },
  onFrame: (frame) => {
    if (frame.roomMode === 'pvp' || frame.roomMode === 'pve') roomMode = frame.roomMode;
  },
  resetState: () => {
    roomMode = 'pvp';
    recordingPosition = null;
    recordingMarkers = [];
  },
  renderExtras: (_refs, view) => {
    if (view) recordingPosition?.(client.replay.activePly() ?? client.replay.latestPly(), view);
  },
  playAgainRequestBody: (state) => ({
    mode: roomMode,
    gameSpecId: GOMOKU_SPEC_ID,
    preferredColor: isGomokuColor(state.seat) ? state.seat : 'random',
    rated: false,
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  renderBoard: (refs: LiveRefs, view) => {
    refs.board.className = 'board gomoku-live-board';
    refs.board.setAttribute('aria-label', t('live.gomokuBoard'));
    refs.board.innerHTML = view
      ? boardSvg(view, (core?.canActNow() ?? false) && core?.connection() === 'connected')
      : '';
  },
  setup: (ctx) => {
    core = ctx;
    let hovered: Element | null = null;
    const clearHover = () => {
      hovered?.setAttribute('visibility', 'hidden');
      hovered = null;
    };
    const hover = (event: PointerEvent) => {
      clearHover();
      if (
        (event.pointerType !== 'mouse' && event.pointerType !== 'pen') ||
        event.buttons !== 0 ||
        !ctx.canActNow() ||
        ctx.connection() !== 'connected' ||
        !(event.target instanceof Element)
      )
        return;
      hovered = event.target.closest('[data-square]')?.querySelector('.gomoku-ghost') ?? null;
      hovered?.setAttribute('visibility', 'visible');
    };
    ctx.refs.board.addEventListener('pointerover', hover);
    ctx.refs.board.addEventListener('pointermove', hover);
    for (const event of ['pointerout', 'pointerleave', 'pointerdown', 'pointercancel'])
      ctx.refs.board.addEventListener(event, clearHover);
    const place = (event: Event) => {
      if (!ctx.canActNow() || ctx.connection() !== 'connected') return;
      // The shared replay handler returns to live and repaints first. Its old
      // target must not place a stone on the new position with that same tap.
      if (!(event.target instanceof Element) || !ctx.refs.board.contains(event.target)) return;
      const square = (event.target as Element)
        .closest('[data-square]')
        ?.getAttribute('data-square');
      const move = square ? parseGomokuMove(square) : null;
      if (move && ctx.state.view?.legalMoves.some((legal) => legal.to === move.to))
        ctx.send({ type: 'move', to: move.to });
    };
    ctx.refs.board.addEventListener('click', place);
    ctx.refs.board.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        place(event);
      }
    });
  },
  moveList: {
    rowClass: 'move-row xiangqi-move-row',
    cellPrefix: 'xiangqi-move-row',
    listClass: 'xiangqi-move-list',
    masked: false,
    notate: (move) => move.to,
    isMoveEvent,
  },
  replayCapture: {
    positionKey: (view) => JSON.stringify(view.board),
    plyForView: (view) => view.ply - (view.opening?.stones.length ?? 0),
  },
  replayHistory: {
    rebuild: ({ events, view, state }) => {
      const perspective = isGomokuColor(state.seat) ? state.seat : 'black';
      let game = createGomokuRoomState(view.id, view.opening);
      const openingPly = game.ply;
      const snapshots = [{ ply: 0, view: getGomokuPlayerView(game, perspective) }];
      for (const event of events) {
        if (!isMoveEvent(event)) continue;
        if (game.status.type !== 'playing' || game.status.turn !== event.color) return null;
        const next = applyGomokuRoomMove(game, event.move);
        if (next === game) return null;
        game = next;
        snapshots.push({
          ply: game.ply - openingPly,
          view: getGomokuPlayerView(game, perspective),
        });
      }
      return snapshots;
    },
  },
});

export function bootstrapGomokuLiveRoom(): void {
  client.bootstrap();
}

export function bootstrapGomokuRecording(
  recording: TenantRecording<GomokuColor, GomokuPlayerView>,
  onPosition?: (ply: number, view: GomokuPlayerView) => void,
) {
  client.bootstrap(recording);
  const owner = onPosition ?? null;
  recordingPosition = owner;
  client.renderAll();
  return {
    jumpToPly(ply: number) {
      if (recordingPosition !== owner) return;
      client.replay.jumpToPly(ply);
      client.renderAll();
    },
    setMarkers(markers: readonly GomokuBoardMarker[]) {
      if (recordingPosition !== owner || !core?.refs.board.isConnected) return;
      recordingMarkers = markers;
      const view = client.replay.currentView(client.state.view);
      core.refs.board.innerHTML = view ? boardSvg(view, false) : '';
    },
    dispose() {
      if (recordingPosition === owner) {
        recordingPosition = null;
        recordingMarkers = [];
      }
    },
  };
}
