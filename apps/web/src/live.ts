import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './app-base.css';
import './board-fog.css';
import './live-xiangqi.css';
import './styles.css';
import './game-shell.css';
import './site-shell.css';
import type { GameEvent, PlayerView } from '@mistboard/game';
import {
  initRender,
  reconcileInteractionState,
  render,
  tickClockTimers,
  updateAbortCountdown,
} from './live-render.js';
import { handleReplayKeyboard } from './live-replay.js';
import { gameSpecIdForRoomBootstrap } from './live-room-bootstrap.js';
import { connectSocket, initSocket, reconnectNow, sendSocket } from './live-socket.js';
import { maybePlaySnapshotSound } from './live-sound.js';
import {
  type ConnectionState,
  clearSeatTokenForRoom,
  clientIdForRoom,
  type DevViews,
  deviceIdForBrowser,
  liveState,
  resolveWebSocketBaseUrl,
} from './live-state.js';
import { currentView } from './live-view.js';
import { roomIdFromPath } from './room-url.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { activeLiveShellTenant } from './variant-tenant/live-shell.js';

declare global {
  interface Window {
    __MISTBOARD_DEBUG__?: () => DebugSnapshot;
    webkitAudioContext?: typeof AudioContext;
  }
}

type DebugSnapshot = {
  clientCount: number;
  currentView: PlayerView | null;
  connectionState: typeof liveState.connectionState;
  devViews: DevViews | null;
  events: GameEvent[];
  seat: typeof liveState.seat;
  solo: boolean;
  state: PlayerView | null;
};

// Boot the live room into #app. Called both on a fresh document load (main.ts
// route dispatch) and from an in-app SPA transition (landing -> room) so the
// starting click's user activation carries into the room and the engine's
// opening move can sound without a fresh in-room gesture. Reads the room from
// the current URL, so callers pushState the room URL before invoking it.
export function bootstrapLiveRoom(): void {
  // ── Page setup ──────────────────────────────────────────────────────────────

  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('missing #app');

  const pageParams = new URLSearchParams(window.location.search);
  const pathRoom = roomIdFromPath(window.location.pathname);
  const room = pathRoom ?? pageParams.get('room') ?? 'dev-room';
  const soloRequested = pageParams.get('dev') === 'solo';
  const engineRequested =
    pageParams.get('dev') === 'engine' || pageParams.get('engine') === 'random';
  const allViewsRequested = pageParams.get('views') === 'all';
  const debugRequested = engineRequested || allViewsRequested;
  const variantRequested = pageParams.get('variant');
  const gameSpecIdRequested = gameSpecIdForRoomBootstrap(room, pageParams.get('gameSpecId'));

  if (pageParams.get('reset') === '1') {
    clearSeatTokenForRoom(room);
    pageParams.delete('reset');
    const nextSearch = pageParams.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`,
    );
  }

  const socketParams = new URLSearchParams({ room });
  socketParams.set('client', clientIdForRoom(room));
  const deviceId = deviceIdForBrowser();
  if (deviceId) socketParams.set('device', deviceId);
  if (soloRequested) socketParams.set('dev', 'solo');
  if (engineRequested) socketParams.set('dev', 'engine');
  if (allViewsRequested) socketParams.set('views', 'all');
  if (variantRequested) socketParams.set('variant', variantRequested);
  if (gameSpecIdRequested) socketParams.set('gameSpecId', gameSpecIdRequested);

  // ── Populate shared state ───────────────────────────────────────────────────

  liveState.room = room;
  liveState.socketUrl = `${resolveWebSocketBaseUrl()}?${socketParams}`;
  liveState.engineRequested = engineRequested;
  liveState.debugRequested = debugRequested;
  liveState.variantRequested = variantRequested;
  liveState.gameSpecId = gameSpecIdRequested;
  liveState.solo = soloRequested;
  liveState.roomMode = engineRequested ? 'pve' : 'pvp';

  // ── Initialize render + socket modules ─────────────────────────────────────

  initRender(app, { sendSocket, reconnectNow });
  initSocket({
    render,
    reconcileInteractionState,
    maybePlaySnapshotSound,
  });

  // ── Dev-only: ?conn= override for static visual checks of connection states ──

  const CONN_OVERRIDE_STATES: readonly ConnectionState[] = [
    'connecting',
    'connected',
    'disconnected',
    'reconnecting',
    'displaced',
    'rejected',
  ];
  const connParam = pageParams.get('conn');
  const connOverride =
    connParam && (CONN_OVERRIDE_STATES as readonly string[]).includes(connParam)
      ? (connParam as ConnectionState)
      : null;

  if (connOverride) {
    liveState.connectionState = connOverride;
    liveState.clientId = liveState.clientId || 'dev-client';
    if (connOverride === 'reconnecting' || connOverride === 'disconnected') {
      liveState.reconnectAttempt = Number(pageParams.get('attempt') ?? '3');
      // The override bypasses connectSocket, so the staged-reconnect timers never
      // run. Pin the tier to 'banner' so the dev preview shows the full notice
      // (the whole point of the override) rather than the silent grace state.
      liveState.connectionNoticeTier = 'banner';
    }
    if (connOverride === 'rejected') {
      liveState.closeReason = pageParams.get('reason') ?? '';
    }
  }

  // ── Start ───────────────────────────────────────────────────────────────────

  if (!connOverride) connectSocket();
  window.addEventListener('keydown', handleLiveReplayKeyboard);
  // The xiangqi board renders pieces as inline SVG, so a piece-set change needs a
  // re-render (the chess board picks up its set via CSS and does not).
  window.addEventListener(xiangqiAppearanceChangedEvent, () => render());

  if (!connOverride) {
    window.setInterval(() => {
      void sendSocket({ type: 'ping', at: Date.now() });
    }, 5_000);
  }

  window.setInterval(() => {
    const shellTenant = activeLiveShellTenant();
    if (shellTenant?.tickClocks) {
      shellTenant.tickClocks();
      shellTenant.tickCountdowns?.();
    } else {
      const view = currentView();
      if (view?.clock) tickClockTimers(view);
      updateAbortCountdown();
    }
  }, 100);

  window.__MISTBOARD_DEBUG__ = () => ({
    clientCount: liveState.clientCount,
    connectionState: liveState.connectionState,
    currentView: currentView(),
    devViews: liveState.devViews,
    events: liveState.events,
    gameSpecId: liveState.gameSpecId,
    roomRegion: liveState.roomRegion,
    seat: liveState.seat,
    solo: liveState.solo,
    state: liveState.state,
  });

  render();
}

function handleLiveReplayKeyboard(event: KeyboardEvent): void {
  const shellTenant = activeLiveShellTenant();
  if (shellTenant?.handleReplayKeyboard) {
    shellTenant.handleReplayKeyboard(event);
    return;
  }
  handleReplayKeyboard(event);
}
