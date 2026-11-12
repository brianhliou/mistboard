import {
  type BanqiSeat,
  FFQ_BANQI_SPEC_ID,
  type FFQBanqiMove,
  type FFQBanqiPlayerView,
  type FFQBanqiStatus,
} from '@mistboard/game';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import './live-xiangqi.css';
import './landing.css';
import './game-route.css';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { banqiOutcome } from './banqi-result-label.js';
import { ffqBanqiEnabled } from './feature-flags.js';
import { ffqBanqiSquare } from './ffq-banqi-board.js';
import { installBanqiBoardStyles } from './live-banqi-render.js';
import { reviewSeatProfiles } from './profile-link.js';
import { mountFFQBanqiReview } from './review/ffq-banqi-review.js';
import type { FFQBanqiReviewSnapshot } from './review/ffq-banqi-tree-adapter.js';
import { fetchCachedGameAnalysis, requestGameAnalysis } from './review/game-analysis.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import { reviewMoveClocks } from './review/move-clocks.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav } from './site-shell.js';

// Finished replay uses only server-projected masked frames.

export type FFQBanqiPostgameResponse = {
  game: {
    roomId: string;
    variant: typeof FFQ_BANQI_SPEC_ID;
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
    players?: Array<{
      color: string;
      name: string;
      rating: number | null;
      kind: 'account' | 'guest' | 'engine';
    }>;
  };
  state: {
    status: FFQBanqiStatus;
    moveNumber: number;
    clock?: unknown;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: BanqiSeat;
    move?: FFQBanqiMove;
    ply?: number;
    winner?: BanqiSeat;
    reason?: string;
  }>;
  view: FFQBanqiPlayerView;
  history: { truth: FFQBanqiReviewSnapshot[] };
};

type LoadResult =
  | { ok: true; postgame: FFQBanqiPostgameResponse }
  | { ok: false; status: number; error: string };

const VARIANT = FFQ_BANQI_SPEC_ID;

export function mountFFQBanqiPostgame(root: HTMLElement, roomId: string): void {
  // The private HTTP boundary closes favorites as well as chat.
  delete root.dataset.favoriteGameId;
  root.classList.add('landing-page', 'game-route');
  installBanqiBoardStyles();
  root.replaceChildren(buildNav(), loadingView());
  if (!ffqBanqiEnabled()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel(VARIANT) }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadFFQBanqiPostgame(roomId)
    .then((result) => {
      if (result.ok) {
        if (new URLSearchParams(window.location.search).get('watch') === '1') {
          const host = document.createElement('main');
          host.className = 'game-shell';
          root.replaceChildren(buildNav(), host);
          void import('./watch-ffq-banqi-replay.js')
            .then(({ mountFFQBanqiWatchReplay }) =>
              mountFFQBanqiWatchReplay(host, roomId, { autoplay: true }),
            )
            .catch(() =>
              renderError(root, t('replay.postgameUnavailable'), t('replay.gameCouldNotBeLoaded')),
            );
        } else renderPostgame(root, result.postgame);
        return;
      }
      renderError(root, errorTitle(result.status), errorBody(result));
    })
    .catch(() => {
      renderError(root, t('replay.postgameUnavailable'), t('replay.gameCouldNotBeLoaded'));
    });
}

export async function loadFFQBanqiPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(ffqBanqiPostgameApiUrl(roomId));
  if (!response.ok) {
    const body = await safeJson(response);
    return {
      ok: false,
      status: response.status,
      error: typeof body?.error === 'string' ? body.error : 'request_failed',
    };
  }
  return { ok: true, postgame: (await response.json()) as FFQBanqiPostgameResponse };
}

export function ffqBanqiPostgameApiUrl(roomId: string): string {
  return `/api/ffq-banqi/games/${encodeURIComponent(roomId)}`;
}

function renderPostgame(root: HTMLElement, postgame: FFQBanqiPostgameResponse): void {
  const moveEvents = postgame.timeline.filter(
    (entry): entry is typeof entry & { move: FFQBanqiMove } =>
      entry.type === 'move-played' && !!entry.move,
  );
  const moves = moveEvents.map(({ move }) => ({
    from: ffqBanqiSquare(move.from),
    to: ffqBanqiSquare(move.to),
  }));

  // Per-ply elapsed time from consecutive event timestamps, as banqi.
  let prevAt = postgame.timeline[0]?.at ?? moveEvents[0]?.at ?? 0;
  const moveTimes = moveEvents.map((entry) => {
    const delta = Math.max(0, entry.at - prevAt);
    prevAt = entry.at;
    return delta;
  });
  const hasMoveTimes = moveTimes.some((ms) => ms > 0);

  const gamePlayers = postgame.game.players ?? [];
  const playerNames = {
    red: gamePlayers.find((p) => p.color === 'red')?.name,
    black: gamePlayers.find((p) => p.color === 'black')?.name,
  };
  const status = reviewOutcomeLine(
    banqiOutcome(postgame.game.result, 'red'),
    postgame.game.termination,
  );
  const variantName = variantDisplayLabel(VARIANT);
  const { metaCard, details } = buildReviewMeta({
    gameSpecId: VARIANT,
    variantName,
    game: postgame.game,
    status,
    spectatorChat: false,
  });

  // The as-played replay sits with the share links, so the left column keeps
  // the meta card alone, as banqi's and Three Kingdoms' review pages do.
  const watchRow = document.createElement('div');
  watchRow.className = 'review-share__row review-share__row--downloads';
  const watchLabel = document.createElement('span');
  watchLabel.className = 'review-share__label';
  watchLabel.textContent = t('nav.watch');
  const watch = document.createElement('a');
  watch.className = 'review-share__copy review-share__download';
  watch.href = `/ffq-banqi/game/${encodeURIComponent(postgame.game.roomId)}?watch=1`;
  watch.textContent = t('replay.watchAsPlayed');
  const watchGroup = document.createElement('div');
  watchGroup.className = 'review-share__downloads';
  watchGroup.append(watch);
  watchRow.append(watchLabel, watchGroup);
  root.replaceChildren(buildNav());
  mountFFQBanqiReview(root, postgame.history.truth, {
    pageClassName: 'banqi-review',
    ariaLabel: variantName,
    title: variantName,
    summary: `${status} · ${postgame.game.plyCount} plies`,
    metaCard,
    details,
    shareExtra: [watchRow],
    phoneInfoSheet: true,
    moves,
    moveTimes: hasMoveTimes ? moveTimes : undefined,
    moveClocks: hasMoveTimes ? reviewMoveClocks(postgame) : undefined,
    seatLabels: true,
    players: playerNames,
    playerProfiles: reviewSeatProfiles(gamePlayers),
    urlPly: true,
    analysis: {
      requestLabel: isLikelySignedIn()
        ? t('replay.requestComputerAnalysis')
        : t('replay.signInToRequestAnalysis'),
      requestHref: isLikelySignedIn() ? undefined : loginHrefForCurrentPage(),
      fetchCached: (options) => fetchCachedGameAnalysis(VARIANT, postgame.game.roomId, options),
      run: (_progress, signal, onStatus) =>
        requestGameAnalysis(VARIANT, postgame.game.roomId, { signal, onStatus }),
    },
  });
}

function loadingView(): HTMLElement {
  const shell = document.createElement('main');
  shell.className = 'game-shell';
  const heading = document.createElement('h1');
  heading.textContent = t('replay.loadingGame');
  shell.append(heading);
  return shell;
}

function renderError(root: HTMLElement, titleText: string, bodyText: string): void {
  const shell = document.createElement('main');
  shell.className = 'game-shell';
  const title = document.createElement('h1');
  title.textContent = titleText;
  const body = document.createElement('p');
  body.textContent = bodyText;
  shell.append(title, body);
  root.replaceChildren(buildNav(), shell);
}

function errorTitle(status: number): string {
  if (status === 404) return t('replay.gameNotFound');
  return t('replay.postgameUnavailable');
}

function errorBody(result: Extract<LoadResult, { ok: false }>): string {
  if (result.status === 404)
    return t('replay.variantGameUnavailable', { variant: variantDisplayLabel(VARIANT) });
  if (result.status === 503) return t('replay.postgameServiceUnavailable');
  return result.error;
}

async function safeJson(response: Response): Promise<{ error?: unknown } | null> {
  try {
    return (await response.json()) as { error?: unknown };
  } catch {
    return null;
  }
}
