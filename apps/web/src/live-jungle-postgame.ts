import {
  JUNGLE_SPEC_ID,
  type JungleColor,
  type JungleGameStatus,
  type JungleMove,
  type JunglePlayerView,
  type JungleSquare,
  jungleStateToEngineFen,
} from '@mistboard/game';
import { reviewSeatProfiles } from './profile-link.js';
import { analysisHref, editorHref } from './review/position-links.js';
import './live-xiangqi.css';
import { gameOutcome, variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import './landing.css';
import './game-route.css';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { jungleEnabled } from './feature-flags.js';
import { crosstableConfig } from './review/crosstable.js';
import { fetchCachedGameAnalysis, requestGameAnalysis } from './review/game-analysis.js';
import { gameExportShareExtra } from './review/game-export-links.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import { mountJungleReview } from './review/jungle-review.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav } from './site-shell.js';

// Postgame review for Jungle. Jungle is PERFECT-INFORMATION: the board was always
// fully visible, so there is one review surface and one per-ply history (no
// masked/revealed split, no reveal toggle). Left info rail, one center board, right
// moves panel; arrow keys + first/prev/next/last scrub the replay, `f` flips.

type JungleSnapshot = { ply: number; view: JunglePlayerView };

export type JunglePostgameResponse = {
  game: {
    roomId: string;
    variant: 'jungle';
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
    status: JungleGameStatus;
    moveNumber: number;
    clock?: unknown;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: JungleColor;
    move?: JungleMove;
    ply?: number;
    winner?: JungleColor;
    reason?: string;
  }>;
  view: JunglePlayerView;
  history: JungleSnapshot[];
};

type LoadResult =
  | { ok: true; postgame: JunglePostgameResponse }
  | { ok: false; status: number; error: string };

export function mountJunglePostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  root.replaceChildren(buildNav(), loadingView());
  if (!jungleEnabled()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel('jungle') }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadJunglePostgame(roomId)
    .then((result) => {
      if (result.ok) {
        renderPostgame(root, result.postgame);
        return;
      }
      renderError(root, errorTitle(result.status), errorBody(result));
    })
    .catch(() =>
      renderError(root, t('replay.postgameUnavailable'), t('replay.gameCouldNotBeLoaded')),
    );
}

export async function loadJunglePostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(junglePostgameApiUrl(roomId));
  if (!response.ok) {
    const body = await safeJson(response);
    return {
      ok: false,
      status: response.status,
      error: typeof body?.error === 'string' ? body.error : 'request_failed',
    };
  }
  return { ok: true, postgame: (await response.json()) as JunglePostgameResponse };
}

export function junglePostgameApiUrl(roomId: string): string {
  return new URL(`/api/jungle/games/${encodeURIComponent(roomId)}`, window.location.href).pathname;
}

function renderPostgame(root: HTMLElement, postgame: JunglePostgameResponse): void {
  // Jungle is perfect-information, so the tree reconstructs every position from the
  // move list client-side (it matches the server truth). The server per-ply
  // snapshots are used only by the watch adapter (junglePostgameViewAtPly below).
  const moveEvents = postgame.timeline.filter(
    (entry): entry is typeof entry & { move: JungleMove } =>
      entry.type === 'move-played' && !!entry.move,
  );
  const moves = moveEvents.map((entry) => entry.move);

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
    gameOutcome(postgame.game.result, 'jungle'),
    postgame.game.termination,
  );
  const { metaCard, details } = buildReviewMeta({
    markerId: 'jungle',
    variantName: variantDisplayLabel(JUNGLE_SPEC_ID),
    game: postgame.game,
    status,
  });

  root.replaceChildren(buildNav());
  mountJungleReview(root, {
    pageClassName: 'jungle-review',
    ariaLabel: 'Jungle postgame',
    title: 'Jungle Chess',
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
    analyseFromHere: (truth) => analysisHref('jungle', jungleStateToEngineFen(truth)),
    boardEditorHref: (truth) => editorHref('jungle', jungleStateToEngineFen(truth)),
    ...gameExportShareExtra('jungle', postgame.game.roomId),
    // Server-side MistyJungle whole-game analysis, DB-cached: an already-analysed
    // game loads straight from cache on open (a GET that never computes). Requesting
    // a fresh compute is account-gated (the server rejects anon POSTs), so a
    // signed-out visitor gets a sign-in CTA instead of a request that would 401.
    analysis: {
      requestLabel: isLikelySignedIn()
        ? t('replay.requestComputerAnalysis')
        : t('replay.signInToRequestAnalysis'),
      requestHref: isLikelySignedIn() ? undefined : loginHrefForCurrentPage(),
      fetchCached: () => fetchCachedGameAnalysis('jungle', postgame.game.roomId),
      run: () => requestGameAnalysis('jungle', postgame.game.roomId),
    },
  });
}

// Exported for the Mistboard TV watch adapter (watch-jungle-replay.ts), which
// reuses the same single per-ply history lookup.
export function junglePostgameViewAtPly(
  postgame: JunglePostgameResponse,
  ply: number,
): JunglePlayerView | null {
  const history = postgame.history;
  if (!history || history.length === 0) return null;
  let selected = history[0] ?? null;
  for (const snapshot of history) {
    if (snapshot.ply > ply) break;
    selected = snapshot;
  }
  return selected?.view ?? null;
}

export function junglePostgameMaxPly(postgame: JunglePostgameResponse): number {
  return Math.max(postgame.game.plyCount, ...postgame.history.map((s) => s.ply), 0);
}

export function initialPlyFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('ply');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
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
    return t('replay.variantGameUnavailable', { variant: variantDisplayLabel('jungle') });
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

// Referenced to keep the JungleSquare import meaningful for downstream typing of
// move coordinates in the timeline payload.
export type JunglePostgameSquare = JungleSquare;
