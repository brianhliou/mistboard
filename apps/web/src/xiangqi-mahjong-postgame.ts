import {
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjMove,
  type XmjPlayerView,
  type XmjRoomStatus,
  type XmjSeat,
} from '@mistboard/game';
import { reviewOpenedProps, track } from './analytics.js';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import './landing.css';
import './game-route.css';
import { xiangqiMahjongEnabled } from './feature-flags.js';
import { bootstrapXiangqiMahjongRecording } from './live-xiangqi-mahjong.js';
import type { ProfileIdentity } from './profile-link.js';
import { buildNav } from './site-shell.js';
import type { TenantLiveFrame } from './variant-tenant/live-client.js';

// Review page for a finished Xiangqi Mahjong match: every hand, move by move,
// with both hands and each drawn tile face up. The server answers only once the
// match is finished (apps/server/src/routes/xiangqi-mahjong-games.ts), so this
// page never holds a live match's concealed tiles. It is a replay and nothing
// more: no engine, no discard advice.
//
// It is the room itself (live-xiangqi-mahjong.ts) played back from a recording
// rather than a socket: the same layout, table, move list, clocks and resize
// grip, so a change to the room reaches the review with no second copy. This
// module only loads the match and turns it into the room's one hello frame.

/** Each seat's time left after a ply, as recorded then, and the seat on the
 *  clock. Absent for an untimed match (and from servers older than the field). */
export type XmjPostgameClock = { remainingMs: Record<XmjSeat, number>; active: XmjSeat | null };

export type XmjPostgameSnapshot = { ply: number; view: XmjPlayerView; clock?: XmjPostgameClock };

export type XmjPostgameResponse = {
  game: {
    roomId: string;
    variant: typeof XIANGQI_MAHJONG_SPEC_ID;
    mode: string;
    result: string;
    termination: string;
    plyCount: number;
    startedAt: string;
    endedAt: string;
    rated: boolean;
    visibility: string;
    initialMs: number | null;
    incrementMs: number | null;
    players?: Array<
      ProfileIdentity & {
        color: string;
        name: string;
        rating: number | null;
        kind: 'account' | 'guest' | 'engine';
      }
    >;
  };
  state: {
    status: XmjRoomStatus;
    moveNumber: number;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{ type: string; at: number; color?: XmjSeat; move?: XmjMove; ply?: number }>;
  view: XmjPlayerView;
  history: XmjPostgameSnapshot[];
};

type LoadResult =
  | { ok: true; postgame: XmjPostgameResponse }
  | { ok: false; status: number; error: string };

export function mountXiangqiMahjongPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  root.replaceChildren(buildNav(), messageView(t('replay.loadingGame')));
  const variant = variantDisplayLabel(XIANGQI_MAHJONG_SPEC_ID);
  if (!xiangqiMahjongEnabled()) {
    renderError(root, t('replay.variantUnavailable', { variant }), t('replay.routeNotEnabled'));
    return;
  }
  void loadXiangqiMahjongPostgame(roomId)
    .then((result) => {
      if (result.ok) {
        mountRecording(root, result.postgame);
        return;
      }
      if (result.status === 404) {
        renderError(
          root,
          t('replay.gameNotFound'),
          t('replay.variantGameUnavailable', { variant }),
        );
      } else if (result.status === 503) {
        renderError(root, t('replay.postgameUnavailable'), t('replay.postgameServiceUnavailable'));
      } else {
        renderError(root, t('replay.postgameUnavailable'), result.error);
      }
    })
    .catch(() =>
      renderError(root, t('replay.postgameUnavailable'), t('replay.gameCouldNotBeLoaded')),
    );
}

export async function loadXiangqiMahjongPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(`/api/xiangqi-mahjong/games/${encodeURIComponent(roomId)}`);
  if (!response.ok) {
    let error = 'request_failed';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body?.error === 'string') error = body.error;
    } catch {
      // Not JSON: keep the generic error.
    }
    return { ok: false, status: response.status, error };
  }
  return { ok: true, postgame: (await response.json()) as XmjPostgameResponse };
}

/** The last ply the history holds. */
export function xmjPostgameLastPly(postgame: Pick<XmjPostgameResponse, 'history'>): number {
  return postgame.history.reduce((max, snapshot) => Math.max(max, snapshot.ply), 0);
}

/**
 * The clocks to show at `ply`: the latest snapshot clock at or before it. When
 * the log kept no clocks at all (an untimed match, or an older server), null;
 * the page then shows no clock rather than a made-up one.
 */
export function xmjPostgameClockAt(
  postgame: Pick<XmjPostgameResponse, 'history'>,
  ply: number,
): XmjPostgameClock | null {
  let selected: XmjPostgameClock | null = null;
  for (const snapshot of postgame.history) {
    if (snapshot.ply > ply) break;
    if (snapshot.clock) selected = snapshot.clock;
  }
  return selected;
}

/** `?ply=N` as a ply to open on, clamped to the match; the end otherwise. */
export function xmjInitialPly(search: string, lastPly: number): number {
  const raw = new URLSearchParams(search).get('ply');
  if (raw === null || !/^\d+$/.test(raw)) return lastPly;
  return Math.min(Number.parseInt(raw, 10), lastPly);
}

/** The finished room as the hello frame a spectator of it would get. */
export function xmjRecordingFrame(
  postgame: XmjPostgameResponse,
): TenantLiveFrame<XmjSeat, XmjPlayerView> {
  const players = postgame.game.players ?? [];
  const seatDisplayNames: Partial<Record<XmjSeat, string>> = {};
  const seatProfiles: Partial<Record<XmjSeat, ProfileIdentity>> = {};
  for (const player of players) {
    if (player.color !== 'east' && player.color !== 'west') continue;
    // A guest has no name of its own: the room's guest word stands in.
    if (player.kind === 'guest' && player.name === 'Guest') continue;
    seatDisplayNames[player.color] = player.name;
    seatProfiles[player.color] = player;
  }
  const { initialMs, incrementMs } = postgame.game;
  const timeControl =
    postgame.state.timeControl ??
    (typeof initialMs === 'number' ? { initialMs, incrementMs: incrementMs ?? 0 } : null);
  return {
    type: 'hello',
    seat: 'spectator',
    seats: {},
    seatDisplayNames,
    seatProfiles,
    state: postgame.view,
    clock: null,
    timeControl,
    // Only the moves: one per ply, as the history files them.
    events: postgame.timeline.filter((entry) => entry.type === 'move-played' && entry.move),
    liveHistory: postgame.history.map(({ ply, view }) => ({ ply, view })),
    rated: postgame.game.rated,
    roomMode: postgame.game.mode,
  };
}

function mountRecording(root: HTMLElement, postgame: XmjPostgameResponse): void {
  // The room lays out its own page, nav included.
  root.classList.remove('landing-page', 'game-route');
  root.replaceChildren();
  bootstrapXiangqiMahjongRecording({
    room: postgame.game.roomId,
    // The router hands over #app, a div; anything else falls back to #app.
    ...(root instanceof HTMLDivElement ? { root } : {}),
    frame: xmjRecordingFrame(postgame),
    initialPly: xmjInitialPly(window.location.search, xmjPostgameLastPly(postgame)),
    clockAt: (ply) => xmjPostgameClockAt(postgame, ply),
  });
  // This recording uses the live room instead of the shared review scaffold.
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
}

function messageView(text: string): HTMLElement {
  const shell = document.createElement('main');
  shell.className = 'game-shell';
  const heading = document.createElement('h1');
  heading.textContent = text;
  shell.append(heading);
  return shell;
}

function renderError(root: HTMLElement, titleText: string, bodyText: string): void {
  const shell = messageView(titleText);
  const body = document.createElement('p');
  body.textContent = bodyText;
  shell.append(body);
  root.replaceChildren(buildNav(), shell);
}
