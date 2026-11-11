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
import { readDisplayPreferences } from './display-preferences.js';
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
let pendingPreview: { move: GomokuMove; id: string; ply: number; color: GomokuColor } | null = null;

function confirmsTouchMoves(): boolean {
  return (
    window.matchMedia?.('(pointer: coarse)').matches === true &&
    readDisplayPreferences().confirmMovesOnTouch
  );
}

function clearPreview(): void {
  if (!pendingPreview) return;
  pendingPreview = null;
  if (core?.refs.board.isConnected) core.renderAll();
}

function boardSvg(view: GomokuPlayerView, enabled: boolean): string {
  // Recorded spectator views deliberately have no playable moves. Validate
  // engine ink against the public kernel's turn without enabling placement.
  const marked =
    recordingMarkers.length && view.status.type === 'playing'
      ? getGomokuPlayerView(view, view.status.turn)
      : view;
  if (
    pendingPreview &&
    (!enabled ||
      !confirmsTouchMoves() ||
      view.id !== pendingPreview.id ||
      view.ply !== pendingPreview.ply ||
      view.perspective !== pendingPreview.color ||
      !view.legalMoves.some((move) => move.to === pendingPreview?.move.to))
  )
    pendingPreview = null;
  return gomokuBoardSvg(marked, enabled, recordingMarkers, pendingPreview?.move.to ?? null);
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted) core?.renderAll();
});
window.addEventListener('mistboard:display-preferences-change', () => {
  if (core?.refs.board.isConnected) core.renderAll();
});
window.addEventListener(
  'click',
  (event) => {
    // Check before placement repaints and detaches the tapped SVG node. Happy
    // DOM recomputes composedPath() from the current DOM during bubbling.
    if (core?.refs.board.isConnected && !event.composedPath().includes(core.refs.board))
      clearPreview();
  },
  { capture: true },
);

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
    if (
      pendingPreview &&
      (frame.state.id !== pendingPreview.id ||
        frame.state.ply !== pendingPreview.ply ||
        frame.state.status.type !== 'playing' ||
        frame.state.status.turn !== pendingPreview.color)
    )
      pendingPreview = null;
  },
  resetState: () => {
    roomMode = 'pvp';
    recordingPosition = null;
    recordingMarkers = [];
    pendingPreview = null;
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
      hovered =
        event.target
          .closest('[data-square]')
          ?.querySelector('.gomoku-ghost:not(.gomoku-preview)') ?? null;
      hovered?.setAttribute('visibility', 'visible');
    };
    ctx.refs.board.addEventListener('pointerover', hover);
    ctx.refs.board.addEventListener('pointermove', hover);
    for (const event of ['pointerout', 'pointerleave', 'pointerdown', 'pointercancel'])
      ctx.refs.board.addEventListener(event, clearHover);
    const place = (event: Event) => {
      if (!ctx.canActNow() || ctx.connection() !== 'connected') {
        clearPreview();
        return;
      }
      // The shared replay handler returns to live and repaints first. Its old
      // target must not place a stone on the new position with that same tap.
      if (!(event.target instanceof Element) || !ctx.refs.board.contains(event.target)) return;
      const square = (event.target as Element)
        .closest('[data-square]')
        ?.getAttribute('data-square');
      const move = square ? parseGomokuMove(square) : null;
      const view = ctx.state.view;
      if (!move || !view?.legalMoves.some((legal) => legal.to === move.to)) {
        clearPreview();
        return;
      }
      // Keyboard activation retains immediate placement, including on hybrids.
      if (event.type === 'click' && confirmsTouchMoves()) {
        if (
          pendingPreview?.move.to !== move.to ||
          pendingPreview.id !== view.id ||
          pendingPreview.ply !== view.ply ||
          pendingPreview.color !== view.perspective
        ) {
          pendingPreview = { move, id: view.id, ply: view.ply, color: view.perspective };
          ctx.renderAll();
          return;
        }
      }
      const hadPreview = pendingPreview !== null;
      pendingPreview = null;
      clearHover();
      ctx.send({ type: 'move', to: move.to });
      if (hadPreview) ctx.renderAll();
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
