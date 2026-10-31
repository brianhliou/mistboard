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
import { gomokuEnabled } from './feature-flags.js';
import { gomokuBoardSvg } from './gomoku-board.js';
import './gomoku-board.css';
import { t } from './i18n/catalog.js';
import type { LiveRefs } from './live-state.js';
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
} from './variant-tenant/live-client.js';
import type { WebVariantTenant } from './variant-tenant/room-chrome.js';

let core: TenantLiveClientContext<GomokuColor, GomokuPlayerView> | null = null;

const tenant: WebVariantTenant<GomokuColor> = {
  displayName: 'variant.gomoku.name',
  colors: ['black', 'white'],
  isColor: isGomokuColor,
  oppositeColor: (color) => (color === 'black' ? 'white' : 'black'),
  enabled: gomokuEnabled,
  reviewUrl: (roomId) => `/room/${encodeURIComponent(roomId)}`,
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
  flippable: true,
  playAgainRequestBody: (state) => ({
    mode: 'pvp',
    gameSpecId: GOMOKU_SPEC_ID,
    preferredColor: 'random',
    rated: false,
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  renderBoard: (refs: LiveRefs, view) => {
    refs.board.className = 'board gomoku-live-board';
    refs.board.setAttribute('aria-label', t('live.gomokuBoard'));
    refs.board.innerHTML = view
      ? gomokuBoardSvg(view, core?.canActNow() ?? false, core?.orientation() === 'white')
      : '';
  },
  setup: (ctx) => {
    core = ctx;
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
    rowClass: 'move-row',
    cellPrefix: 'gomoku-move-row',
    masked: false,
    notate: (move) => move.to,
    isMoveEvent,
  },
  replayCapture: {
    positionKey: (view) => JSON.stringify(view.board),
    plyForView: (view) => view.ply,
  },
  replayHistory: {
    rebuild: ({ events, view, state }) => {
      const perspective = isGomokuColor(state.seat) ? state.seat : 'black';
      let game = createGomokuRoomState(view.id);
      const snapshots = [{ ply: 0, view: getGomokuPlayerView(game, perspective) }];
      for (const event of events) {
        if (!isMoveEvent(event)) continue;
        if (game.status.type !== 'playing' || game.status.turn !== event.color) return null;
        const next = applyGomokuRoomMove(game, event.move);
        if (next === game) return null;
        game = next;
        snapshots.push({ ply: game.ply, view: getGomokuPlayerView(game, perspective) });
      }
      return snapshots;
    },
  },
});

export function bootstrapGomokuLiveRoom(): void {
  client.bootstrap();
}
