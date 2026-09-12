import {
  type FortressXiangqiColor,
  type FortressXiangqiMove,
  type FortressXiangqiPlayerView,
  fortressXiangqiEngineFen,
} from '@mistboard/game';
import { reviewSeatProfiles } from './profile-link.js';
import { analysisHref, editorHref } from './review/position-links.js';
import './drop-reserve.css';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import './landing.css';
import './game-route.css';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { fortressXiangqiEnabled } from './feature-flags.js';
import { installFortressXiangqiBoardStyles } from './fortress-xiangqi-render.js';
import { crosstableConfig } from './review/crosstable.js';
import { mountFortressXiangqiReview } from './review/fortress-xiangqi-review.js';
import { fetchCachedGameAnalysis, requestGameAnalysis } from './review/game-analysis.js';
import { gameExportShareExtra } from './review/game-export-links.js';
import {
  buildReviewMeta,
  reviewOutcomeLine,
  reviewResultLabel,
} from './review/game-review-meta.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav } from './site-shell.js';
import { setBoardFamily } from './theme.js';

// Postgame review for Fortress Xiangqi. Perfect-information board (7 files x 8
// ranks). Per-seat drop RESERVES are NOT shown on this surface (product call —
// drops replay in the mainline); the live room shows them in its right rail. The
// shared review layout owns the shell, scrubber, keyboard, flip, and viewport-fill
// sizing; this module supplies the board host + move list.

type FortressXiangqiViewKey = 'truth';

export type FortressXiangqiPostgameResponse = {
  game: {
    roomId: string;
    variant: 'fortress-xiangqi';
    mode: string;
    redName?: string | null;
    blackName?: string | null;
    result: string;
    termination: string;
    plyCount: number;
    startedAt: string;
    endedAt: string;
    rated: boolean;
    visibility: string;
    initialMs: number | null;
    incrementMs: number | null;
    pveEngineId?: string | null;
    players?: Array<{
      color: string;
      name: string;
      rating: number | null;
      kind: 'account' | 'guest' | 'engine';
    }>;
  };
  state: {
    status: { type: string; winner?: FortressXiangqiColor | null; reason?: string };
    moveNumber: number;
    clock?: unknown;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: FortressXiangqiColor;
    move?: FortressXiangqiMove;
    ply?: number;
    winner?: FortressXiangqiColor;
    reason?: string;
  }>;
  view: FortressXiangqiPlayerView;
  views?: Partial<Record<FortressXiangqiViewKey, FortressXiangqiPlayerView>>;
  history?: Partial<
    Record<FortressXiangqiViewKey, Array<{ ply: number; view: FortressXiangqiPlayerView }>>
  >;
};

type LoadResult =
  | { ok: true; postgame: FortressXiangqiPostgameResponse }
  | { ok: false; status: number; error: string };

export function mountFortressXiangqiPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  setBoardFamily('xiangqi');
  installFortressXiangqiBoardStyles();
  root.replaceChildren(buildNav(), loadingView());
  if (!fortressXiangqiEnabled()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel('fortress-xiangqi') }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadFortressXiangqiPostgame(roomId)
    .then((result) => {
      if (result.ok) {
        renderPostgame(root, result.postgame);
        return;
      }
      renderError(root, errorTitle(result.status), errorBody(result));
    })
    .catch(() => {
      renderError(root, t('replay.postgameUnavailable'), t('replay.gameCouldNotBeLoaded'));
    });
}

export async function loadFortressXiangqiPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(fortressXiangqiPostgameApiUrl(roomId));
  if (!response.ok) {
    const body = await safeJson(response);
    return {
      ok: false,
      status: response.status,
      error: typeof body?.error === 'string' ? body.error : 'request_failed',
    };
  }
  return { ok: true, postgame: (await response.json()) as FortressXiangqiPostgameResponse };
}

export function fortressXiangqiPostgameApiUrl(roomId: string): string {
  const url = new URL(
    `/api/fortress-xiangqi/games/${encodeURIComponent(roomId)}`,
    window.location.href,
  );
  return url.pathname;
}

function renderPostgame(root: HTMLElement, postgame: FortressXiangqiPostgameResponse): void {
  // Perfect-information: the tree reconstructs every position (including drops) from
  // the move list client-side. The server per-ply snapshots are used only by the
  // watch adapter (postgameViewAtPly below).
  const moveEvents = postgame.timeline.filter(
    (entry) => entry.type === 'move-played' && entry.move,
  );
  const moves = moveEvents.map((entry) => entry.move as FortressXiangqiMove);

  // Per-ply elapsed time from consecutive event timestamps (the server persists no
  // per-move clock, so the first ply's delta is measured from the earliest event).
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
    reviewResultLabel(postgame.game.result),
    postgame.game.termination,
  );
  const { metaCard, details } = buildReviewMeta({
    markerId: 'fortress-xiangqi',
    variantName: 'Fortress Xiangqi',
    game: postgame.game,
    status,
  });

  root.replaceChildren(buildNav());
  mountFortressXiangqiReview(root, {
    pageClassName: 'fortress-xiangqi-review',
    ariaLabel: 'Fortress postgame',
    title: 'Fortress Xiangqi',
    summary: `${status} · ${postgame.game.plyCount} plies`,
    metaCard,
    details,
    moves,
    moveTimes: hasMoveTimes ? moveTimes : undefined,
    // Name the seats at the board. The meta card carries the pairing too, but it
    // sits below the fold on a normal viewport, so without these a reader sees a
    // board and has to scroll past it to learn who is playing.
    seatLabels: true,
    players: playerNames,
    playerProfiles: reviewSeatProfiles(gamePlayers),
    ...crosstableConfig(postgame.game.roomId, postgame.game.players),
    // Position hand-offs: continue this node on /analysis, or open it in the editor.
    analyseFromHere: (truth) => analysisHref('fortress-xiangqi', fortressXiangqiEngineFen(truth)),
    boardEditorHref: (truth) => editorHref('fortress-xiangqi', fortressXiangqiEngineFen(truth)),
    ...gameExportShareExtra('fortress-xiangqi', postgame.game.roomId),
    // Server whole-game FSF analysis, DB-cached: an already-analysed game loads from
    // cache on open (a GET that never computes). Requesting a fresh compute is
    // account-gated (the server rejects anon POSTs), so a signed-out visitor gets a
    // sign-in CTA instead of a request that would 401.
    analysis: {
      requestLabel: isLikelySignedIn()
        ? t('replay.requestComputerAnalysis')
        : t('replay.signInToRequestAnalysis'),
      requestHref: isLikelySignedIn() ? undefined : loginHrefForCurrentPage(),
      fetchCached: () => fetchCachedGameAnalysis('fortress-xiangqi', postgame.game.roomId),
      run: () => requestGameAnalysis('fortress-xiangqi', postgame.game.roomId),
    },
  });
}

export function postgameReplayMaxPly(postgame: FortressXiangqiPostgameResponse): number {
  const history = Object.values(postgame.history ?? {}).flat();
  return Math.max(postgame.game.plyCount, ...history.map((snapshot) => snapshot.ply), 0);
}

export function postgameViewAtPly(
  postgame: FortressXiangqiPostgameResponse,
  key: FortressXiangqiViewKey,
  ply: number,
): FortressXiangqiPlayerView | null {
  const history = postgame.history?.[key];
  if (!history || history.length === 0) return null;
  let selected = history[0] ?? null;
  for (const snapshot of history) {
    if (snapshot.ply > ply) break;
    selected = snapshot;
  }
  return selected?.view ?? null;
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
    return t('replay.variantGameUnavailable', { variant: variantDisplayLabel('fortress-xiangqi') });
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
