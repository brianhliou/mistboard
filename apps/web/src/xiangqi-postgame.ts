// Postgame review for standard Xiangqi — OPEN INFORMATION, so there is a single
// truth board (no red/truth/black fog triptych). Rides the shared review layout
// (mountReviewLayout) like every other variant; the board comes from
// renderXiangqiBoardSvg with no fog mask.

import {
  type StandardXiangqiPlayerView,
  standardXiangqiFen,
  XIANGQI_SPEC_ID,
  type XiangqiColor,
  type XiangqiMove,
} from '@mistboard/game';
import { reviewSeatProfiles } from './profile-link.js';
import { analysisHref, editorHref } from './review/position-links.js';
import { DEFAULT_STUDY_VARIANT } from './study-catalog.js';
import './game-shell.css';
import './live-xiangqi.css';
import { gameOutcome, variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
// Reuse the shared dxq-postgame scaffold (.dxq-postgame__*) the other variants ride.
import './dark-xiangqi-postgame.css';
import './xiangqi-postgame.css';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { xiangqiEnabled } from './feature-flags.js';
import { crosstableConfig } from './review/crosstable.js';
import { fetchCachedGameAnalysis, requestGameAnalysis } from './review/game-analysis.js';
import { gameExportShareExtra } from './review/game-export-links.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import { mountXiangqiReview } from './review/xiangqi-review.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav } from './site-shell.js';

// Open information: the only meaningful board is the shared truth board.
export type XiangqiPostgameViewKey = 'truth';

export type XiangqiPostgameResponse = {
  game: {
    roomId: string;
    variant: 'xiangqi';
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
    /** Persisted participants (server includes them for persisted games). */
    players?: Array<{
      color: string;
      name: string;
      rating: number | null;
      kind: 'account' | 'guest' | 'engine';
    }>;
  };
  state: {
    status: StandardXiangqiPlayerView['status'];
    moveNumber: number;
    clock?: unknown;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: XiangqiColor;
    move?: XiangqiMove;
    ply?: number;
    winner?: XiangqiColor;
    reason?: string;
  }>;
  view: StandardXiangqiPlayerView;
  views?: Partial<Record<XiangqiPostgameViewKey, StandardXiangqiPlayerView>>;
  history?: Partial<
    Record<XiangqiPostgameViewKey, Array<{ ply: number; view: StandardXiangqiPlayerView }>>
  >;
};

type LoadResult =
  | { ok: true; postgame: XiangqiPostgameResponse }
  | { ok: false; status: number; error: string };

export function mountXiangqiPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'xiangqi-postgame-route');
  root.replaceChildren(buildNav(), loadingView());
  if (!xiangqiEnabled()) {
    renderError(root, 'Xiangqi unavailable', 'This route is not enabled in this build.');
    return;
  }
  void loadXiangqiPostgame(roomId)
    .then((result) => {
      if (result.ok) {
        renderPostgame(root, result.postgame);
        return;
      }
      renderError(root, errorTitle(result.status), errorBody(result));
    })
    .catch(() => {
      renderError(root, 'Postgame unavailable', 'The game could not be loaded.');
    });
}

export async function loadXiangqiPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(xiangqiPostgameApiUrl(roomId));
  if (!response.ok) {
    const body = await safeJson(response);
    return {
      ok: false,
      status: response.status,
      error: typeof body?.error === 'string' ? body.error : 'request_failed',
    };
  }
  return {
    ok: true,
    postgame: (await response.json()) as XiangqiPostgameResponse,
  };
}

export function xiangqiPostgameApiUrl(roomId: string): string {
  const url = new URL(`/api/xiangqi/games/${encodeURIComponent(roomId)}`, window.location.href);
  return url.pathname;
}

function renderPostgame(root: HTMLElement, postgame: XiangqiPostgameResponse): void {
  const moveEvents = postgame.timeline.filter((item) => item.type === 'move-played' && item.move);
  const moves = moveEvents.map((item) => item.move as XiangqiMove);

  // Per-ply elapsed time from consecutive event timestamps (the server persists no
  // per-move clock, so the first ply's delta is measured from the earliest event).
  let prevAt = postgame.timeline[0]?.at ?? moveEvents[0]?.at ?? 0;
  const moveTimes = moveEvents.map((item) => {
    const delta = Math.max(0, item.at - prevAt);
    prevAt = item.at;
    return delta;
  });
  const hasMoveTimes = moveTimes.some((ms) => ms > 0);

  const gamePlayers = postgame.game.players ?? [];
  const playerNames = {
    red: gamePlayers.find((p) => p.color === 'red')?.name,
    black: gamePlayers.find((p) => p.color === 'black')?.name,
  };

  const status = reviewOutcomeLine(gameOutcome(postgame.game.result), postgame.game.termination);
  const { metaCard, details } = buildReviewMeta({
    markerId: 'xiangqi',
    variantName: variantDisplayLabel(XIANGQI_SPEC_ID),
    game: postgame.game,
    status,
  });

  root.replaceChildren(buildNav());
  mountXiangqiReview(root, {
    pageClassName: 'xiangqi-review',
    ariaLabel: 'Xiangqi postgame',
    title: 'Xiangqi',
    summary: `${status} · ${postgame.game.plyCount} plies`,
    metaCard,
    details,
    // The tree reconstructs positions from the move list client-side (open info,
    // so it matches the server truth); the server per-ply snapshots are unused.
    moves,
    moveTimes: hasMoveTimes ? moveTimes : undefined,
    // Name the seats at the board. The meta card carries the pairing too, but it
    // sits below the fold on a normal viewport, so without these a reader sees a
    // board and has to scroll past it to learn who is playing.
    seatLabels: true,
    players: playerNames,
    playerProfiles: reviewSeatProfiles(gamePlayers),
    result: { score: resultScore(postgame.game.result), label: status },
    // A link can name a move (?ply=34), for a creator's video description (#454).
    urlPly: true,
    ...crosstableConfig(postgame.game.roomId, postgame.game.players),
    // Position hand-offs: continue this node on /analysis, or open it in the editor.
    analyseFromHere: (truth) => analysisHref('xiangqi', standardXiangqiFen(truth)),
    boardEditorHref: (truth) => editorHref('xiangqi', standardXiangqiFen(truth)),
    ...gameExportShareExtra('xiangqi', postgame.game.roomId),
    // "Study" in the review menu: one click turns the game you are looking at
    // into a private study you can annotate. Same path /analysis/xiangqi has
    // used since it shipped; the game surfaces were just never given it.
    studyExport: {
      variant: DEFAULT_STUDY_VARIANT,
      name: studyName(playerNames.red, playerNames.black),
    },
    // Server Pikafish whole-game analysis, DB-cached: an already-analysed game
    // loads straight from cache on open (a GET that never computes). Requesting a
    // fresh compute is account-gated (the server rejects anon POSTs), so a
    // signed-out visitor gets a sign-in CTA instead of a request that would 401.
    analysis: {
      requestLabel: isLikelySignedIn()
        ? t('replay.requestComputerAnalysis')
        : t('replay.signInToRequestAnalysis'),
      requestHref: isLikelySignedIn() ? undefined : loginHrefForCurrentPage(),
      fetchCached: () => fetchCachedGameAnalysis('xiangqi', postgame.game.roomId),
      run: () => requestGameAnalysis('xiangqi', postgame.game.roomId),
    },
  });
}

export function postgameViewEntries(
  postgame: XiangqiPostgameResponse,
): Array<{ key: XiangqiPostgameViewKey; label: string; view: StandardXiangqiPlayerView }> {
  const truth = postgame.views?.truth ?? postgame.view;
  return [{ key: 'truth', label: 'Final position', view: truth }];
}

export function postgameReplayMaxPly(postgame: XiangqiPostgameResponse): number {
  const history = Object.values(postgame.history ?? {}).flat();
  return Math.max(postgame.game.plyCount, ...history.map((snapshot) => snapshot.ply), 0);
}

export function postgameViewAtPly(
  postgame: XiangqiPostgameResponse,
  key: XiangqiPostgameViewKey,
  ply: number,
): StandardXiangqiPlayerView | null {
  const history = postgame.history?.[key];
  if (!history || history.length === 0) return null;
  let selected = history[0] ?? null;
  for (const snapshot of history) {
    if (snapshot.ply > ply) break;
    selected = snapshot;
  }
  return selected?.view ?? null;
}

/** Scoreline for the move list's terminal result block. Red moves first, so the
 *  Red result takes the first slot (chess "1-0" convention). */
function resultScore(result: string): string {
  if (result === 'red-wins') return '1-0';
  if (result === 'black-wins') return '0-1';
  if (result === 'draw') return '½-½';
  return '*';
}

function loadingView(): HTMLElement {
  const shell = document.createElement('main');
  shell.className = 'dxq-postgame__notice';
  const heading = document.createElement('h1');
  heading.textContent = t('replay.loadingGame');
  shell.append(heading);
  return shell;
}

function renderError(root: HTMLElement, titleText: string, bodyText: string): void {
  const shell = document.createElement('main');
  shell.className = 'dxq-postgame__error';
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
    return t('replay.variantGameUnavailable', { variant: variantDisplayLabel('xiangqi') });
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

/** Name a study made from a game after its players, the way a reader would
 *  name it. Falls back to the variant when a seat has no name (a guest game). */
function studyName(red: string | undefined, black: string | undefined): string {
  return red && black ? `${red} vs ${black}` : 'Xiangqi game';
}
