import {
  GOMOKU_SPEC_ID,
  type GomokuColor,
  type GomokuMove,
  type GomokuPlayerView,
} from '@mistboard/game';
import { reviewOpenedProps, track } from './analytics.js';
import { gomokuEnabled } from './feature-flags.js';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { bootstrapGomokuRecording } from './live-gomoku.js';
import { buildNav } from './site-shell.js';
import { readTenantWebClock, type TenantWebClock } from './variant-tenant/clock-projection.js';
import type { TenantLiveFrame } from './variant-tenant/live-client.js';
import './landing.css';
import './game-route.css';

export type GomokuPostgameResponse = {
  game: {
    roomId: string;
    variant: typeof GOMOKU_SPEC_ID;
    mode: string;
    result: string;
    termination: string;
    plyCount: number;
    rated: boolean;
    initialMs: number | null;
    incrementMs: number | null;
    players?: Array<{ color: string; name: string }>;
  };
  state: {
    status: GomokuPlayerView['status'];
    moveNumber: number;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  view: GomokuPlayerView;
  history: {
    truth: Array<{
      ply: number;
      at: number;
      view: GomokuPlayerView;
      clock?: TenantWebClock<GomokuColor>;
    }>;
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: GomokuColor;
    move?: GomokuMove;
    ply?: number;
  }>;
};

/** A recording uses the server's snapshots, including its stored ply-zero
 * opening. Never deal again: balanced openings are random and the pool changes. */
function recordingFrame(
  postgame: GomokuPostgameResponse,
): TenantLiveFrame<GomokuColor, GomokuPlayerView> {
  return {
    type: 'hello',
    seat: 'spectator',
    seats: {},
    seatDisplayNames: Object.fromEntries(
      (postgame.game.players ?? []).map((player) => [player.color, player.name]),
    ),
    state: postgame.view,
    clock: null,
    timeControl:
      postgame.state.timeControl ??
      (postgame.game.initialMs === null
        ? null
        : {
            initialMs: postgame.game.initialMs,
            incrementMs: postgame.game.incrementMs ?? 0,
          }),
    events: postgame.timeline.filter((entry) => entry.type === 'move-played' && entry.move),
    liveHistory: postgame.history.truth.map(({ ply, view }) => ({ ply, view })),
    roomMode: postgame.game.mode,
    rated: false,
  };
}

export async function mountGomokuPostgame(root: HTMLElement, roomId: string): Promise<void> {
  const variant = variantDisplayLabel(GOMOKU_SPEC_ID);
  const message = (title: string, body?: string): void => {
    const main = document.createElement('main');
    main.className = 'game-shell';
    const heading = document.createElement('h1');
    heading.textContent = title;
    main.append(heading);
    if (body) {
      const detail = document.createElement('p');
      detail.textContent = body;
      main.append(detail);
    }
    root.replaceChildren(buildNav(), main);
  };
  root.classList.add('landing-page', 'game-route');
  if (!gomokuEnabled()) {
    message(t('replay.variantUnavailable', { variant }), t('replay.routeNotEnabled'));
    return;
  }
  message(t('replay.loadingGame'));
  try {
    const response = await fetch(`/api/gomoku/games/${encodeURIComponent(roomId)}`);
    if (!response.ok) {
      message(
        t(response.status === 404 ? 'replay.gameNotFound' : 'replay.postgameUnavailable'),
        response.status === 404
          ? t('replay.variantGameUnavailable', { variant })
          : t('replay.postgameServiceUnavailable'),
      );
      return;
    }
    const postgame = (await response.json()) as GomokuPostgameResponse;
    const history = postgame.history?.truth;
    if (
      postgame.game?.roomId !== roomId ||
      postgame.game.variant !== GOMOKU_SPEC_ID ||
      postgame.game.rated ||
      postgame.view?.status.type !== 'finished' ||
      !Array.isArray(history) ||
      history.length === 0 ||
      !history.every(
        (snapshot, index) => snapshot.ply === index && snapshot.view?.board.length === 225,
      )
    ) {
      throw new Error('invalid gomoku recording');
    }
    const lastPly = history.length - 1;
    const raw = new URLSearchParams(window.location.search).get('ply');
    const initialPly = raw !== null && /^\d+$/.test(raw) ? Math.min(Number(raw), lastPly) : lastPly;
    root.classList.remove('landing-page', 'game-route');
    root.replaceChildren();
    bootstrapGomokuRecording({
      room: roomId,
      ...(root instanceof HTMLDivElement ? { root } : {}),
      frame: recordingFrame(postgame),
      initialPly,
      clockAt: (ply) => {
        const clock = readTenantWebClock(history[ply]?.clock, ['black', 'white'] as const);
        return clock ? { remainingMs: clock.remainingMs, active: clock.activeColor } : null;
      },
    });
    track(
      'review_opened',
      reviewOpenedProps({
        pathname: window.location.pathname,
        referrer: document.referrer,
        origin: window.location.origin,
        reviewSurface: 'game',
        hasAnalysis: false,
      }),
    );
  } catch {
    message(t('replay.postgameUnavailable'), t('replay.gameCouldNotBeLoaded'));
  }
}
