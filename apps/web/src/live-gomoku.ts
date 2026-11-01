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
import { Rapfi, type RapfiLevel, type RapfiPosition } from './engine/rapfi.js';
import { gomokuBoardSvg } from './gomoku-board.js';
import './gomoku-board.css';
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
let engineId: string | null = null;
let rapfi: Rapfi | null = null;
let generation = 0;
let pendingKey: string | null = null;
let submittedKey: string | null = null;
let botFailed = false;
let botPaused = false;
let roomPaused = false;

function stopBot(): void {
  generation += 1;
  rapfi?.stop();
  rapfi = null;
  pendingKey = null;
  submittedKey = null;
}

function botLevel(): RapfiLevel | null {
  return engineId && /^rapfi-level-[1-5]$/.test(engineId) && engineId.length === 13
    ? (Number(engineId.at(-1)) as RapfiLevel)
    : null;
}

function syncBot(): void {
  const ctx = core;
  const view = ctx?.state.view;
  const level = botLevel();
  if (
    !ctx ||
    !view ||
    ctx.state.rated ||
    roomMode !== 'pve' ||
    !level ||
    !isGomokuColor(ctx.state.seat) ||
    view.status.type !== 'playing' ||
    ctx.connection() !== 'connected' ||
    !ctx.replay.isLive() ||
    roomPaused
  ) {
    stopBot();
    return;
  }
  const turn = view.status.turn;
  if (turn === ctx.state.seat || ctx.state.seats[turn] !== engineId) {
    if (pendingKey) stopBot();
    return;
  }
  const key = `${view.id}:${view.ply}:${engineId}`;
  if (pendingKey === key || submittedKey === key || botFailed || botPaused) return;
  if (pendingKey) stopBot();
  else generation += 1;
  const ticket = generation;
  pendingKey = key;
  const position: RapfiPosition = {
    turn: turn === 'black' ? 1 : 2,
    stones: view.board.flatMap((color, index) =>
      color
        ? [
            {
              x: index % 15,
              y: Math.floor(index / 15),
              player: color === 'black' ? (1 as const) : (2 as const),
            },
          ]
        : [],
    ),
  };
  rapfi ??= new Rapfi();
  void rapfi
    .chooseMove(position, level)
    .then(({ move }) => {
      if (generation !== ticket) return;
      pendingKey = null;
      const current = ctx.state.view;
      // Never submit a result against an old frame, replay, closed socket or room.
      if (
        !current ||
        current.id !== view.id ||
        current.ply !== view.ply ||
        current.status.type !== 'playing' ||
        current.status.turn !== turn ||
        ctx.connection() !== 'connected' ||
        !ctx.replay.isLive() ||
        roomPaused
      ) {
        stopBot();
        return;
      }
      const placement = parseGomokuMove(`${String.fromCharCode(97 + move.x)}${move.y + 1}`);
      if (!placement || applyGomokuRoomMove(current, placement) === current)
        throw new Error('Rapfi returned an illegal placement');
      submittedKey = key;
      if (
        !ctx.send({
          type: 'move',
          to: placement.to,
          browserBot: true,
          roomId: view.id,
          expectedPly: view.ply - (view.opening?.stones.length ?? 0),
        })
      )
        throw new Error('Rapfi reply disconnected');
      ctx.renderAll();
    })
    .catch(() => {
      if (generation !== ticket) return;
      stopBot();
      botFailed = true;
      ctx.renderAll();
    });
}

function renderBotPanel(refs: LiveRefs): void {
  syncBot();
  if (roomMode !== 'pve' || !botLevel()) return;
  const panel = document.createElement('div');
  panel.dataset.gomokuBot = engineId ?? '';
  const label = document.createElement('p');
  label.setAttribute('role', 'status');
  label.textContent = botFailed
    ? t('live.gomokuBotFailed')
    : botPaused
      ? t('live.gomokuBotPaused')
      : pendingKey
        ? t('live.gomokuBotThinking')
        : `Rapfi Level ${botLevel()}`;
  panel.append(label);
  if (
    core?.state.seat !== 'spectator' &&
    core?.state.view?.status.type === 'playing' &&
    (pendingKey || botFailed || botPaused)
  ) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.gomokuBotAction = pendingKey ? 'cancel' : 'retry';
    button.textContent = pendingKey ? t('setup.cancel') : t('live.gomokuBotRetry');
    button.addEventListener('click', () => {
      botPaused = pendingKey !== null;
      botFailed = false;
      stopBot();
      core?.renderAll();
    });
    panel.append(button);
  }
  const license = document.createElement('a');
  license.href = '/engine/rapfi/GPL-3.0.txt';
  license.textContent = 'Rapfi © dhbloo — GPL-3.0';
  const source = document.createElement('a');
  source.href = 'https://github.com/dhbloo/rapfi/archive/1387d11312.tar.gz';
  source.textContent = t('live.gomokuBotSource');
  panel.append(license, document.createTextNode(' · '), source);
  refs.hiddenPool.append(panel);
}

window.addEventListener('pagehide', stopBot);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) core?.renderAll();
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
  // Like Three Kingdoms banqi, bootstrap even before the cosmetic admin hint
  // resolves. Every socket is account-gated by the server; only an admitted
  // room's hello can start Rapfi, including when the public flag is off.
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
  flippable: true,
  chrome: { roomMode: () => roomMode },
  onFrame: (frame) => {
    if (frame.type === 'hello') {
      stopBot();
      botFailed = false;
      botPaused = false;
    }
    if (frame.roomMode === 'pvp' || frame.roomMode === 'pve') roomMode = frame.roomMode;
    if ('pveEngineId' in frame)
      engineId = typeof frame.pveEngineId === 'string' ? frame.pveEngineId : null;
    if (typeof frame.browserBotPaused === 'boolean') roomPaused = frame.browserBotPaused;
  },
  resetState: () => {
    stopBot();
    roomMode = 'pvp';
    engineId = null;
    botFailed = false;
    botPaused = false;
    roomPaused = false;
  },
  onDisabled: () => stopBot(),
  renderExtras: renderBotPanel,
  playAgainRequestBody: (state) => ({
    mode: roomMode,
    gameSpecId: GOMOKU_SPEC_ID,
    preferredColor: isGomokuColor(state.seat) ? state.seat : 'random',
    rated: false,
    opening: state.view?.opening?.stones.length === 0 ? 'free' : 'balanced',
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
): void {
  client.bootstrap(recording);
}
