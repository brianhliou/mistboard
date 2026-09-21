import {
  ATOMIC_XIANGQI_SPEC_ID,
  type AtomicXiangqiColor,
  type AtomicXiangqiGameStatus,
  type AtomicXiangqiMove,
  type AtomicXiangqiPlayerView,
  atomicXiangqiFen,
} from '@mistboard/game';
import './landing.css';
import './game-route.css';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { atomicXiangqiEnabled } from './feature-flags.js';
import { gameOutcome, variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { reviewSeatProfiles } from './profile-link.js';
import { mountAtomicXiangqiReview } from './review/atomic-xiangqi-review.js';
import { crosstableConfig } from './review/crosstable.js';
import { fetchCachedGameAnalysis, requestGameAnalysis } from './review/game-analysis.js';
import { gameExportShareExtra } from './review/game-export-links.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import { analysisHref, editorHref } from './review/position-links.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav } from './site-shell.js';
import { setBoardFamily } from './theme.js';

// Postgame review for Atomic Xiangqi: the atomic tree review (branching board,
// local engine, annotations, share and export) over the game's move list, the
// surface Fortress Xiangqi has. Perfect information, one board, no per-seat
// POV split.

type AtomicXiangqiViewKey = 'truth';

export type AtomicXiangqiPostgameResponse = {
  game: {
    roomId: string;
    variant: 'atomic-xiangqi';
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
    status: AtomicXiangqiGameStatus;
    moveNumber: number;
    clock?: unknown;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: AtomicXiangqiColor;
    move?: AtomicXiangqiMove;
    ply?: number;
    winner?: AtomicXiangqiColor;
    reason?: string;
  }>;
  view: AtomicXiangqiPlayerView;
  views?: Partial<Record<AtomicXiangqiViewKey, AtomicXiangqiPlayerView>>;
  history?: Partial<
    Record<AtomicXiangqiViewKey, Array<{ ply: number; view: AtomicXiangqiPlayerView }>>
  >;
};

type LoadResult =
  | { ok: true; postgame: AtomicXiangqiPostgameResponse }
  | { ok: false; status: number; error: string };

export function mountAtomicXiangqiPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  setBoardFamily('xiangqi');
  root.replaceChildren(buildNav(), loadingView());
  if (!atomicXiangqiEnabled()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel('atomic-xiangqi') }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadAtomicXiangqiPostgame(roomId)
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

export async function loadAtomicXiangqiPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(atomicXiangqiPostgameApiUrl(roomId));
  if (!response.ok) {
    const body = await safeJson(response);
    return {
      ok: false,
      status: response.status,
      error: typeof body?.error === 'string' ? body.error : 'request_failed',
    };
  }
  return { ok: true, postgame: (await response.json()) as AtomicXiangqiPostgameResponse };
}

export function atomicXiangqiPostgameApiUrl(roomId: string): string {
  const url = new URL(
    `/api/atomic-xiangqi/games/${encodeURIComponent(roomId)}`,
    window.location.href,
  );
  return url.pathname;
}

function renderPostgame(root: HTMLElement, postgame: AtomicXiangqiPostgameResponse): void {
  // Perfect information: the tree reconstructs every position from the move
  // list client-side through the atomic kernel, aftermath included (the review
  // board rings what each explosion took, atomic-xiangqi-review.ts). The
  // server per-ply snapshots are used only by the watch adapter
  // (postgameViewAtPly below).
  const moveEvents = postgame.timeline.filter(
    (entry) => entry.type === 'move-played' && entry.move,
  );
  const moves = moveEvents.map((entry) => entry.move as AtomicXiangqiMove);

  // Per-ply elapsed time from consecutive event timestamps (the server persists
  // no per-move clock, so the first ply's delta is measured from the earliest
  // event).
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

  const status = reviewOutcomeLine(gameOutcome(postgame.game.result), postgame.game.termination);
  const { metaCard, details } = buildReviewMeta({
    markerId: 'atomic-xiangqi',
    variantName: variantDisplayLabel(ATOMIC_XIANGQI_SPEC_ID),
    game: postgame.game,
    status,
  });

  root.replaceChildren(buildNav());
  mountAtomicXiangqiReview(root, {
    pageClassName: 'atomic-xiangqi-review',
    ariaLabel: 'Atomic Xiangqi postgame',
    title: 'Atomic Xiangqi',
    summary: `${status} · ${postgame.game.plyCount} plies`,
    metaCard,
    details,
    moves,
    moveTimes: hasMoveTimes ? moveTimes : undefined,
    // Name the seats at the board. The meta card carries the pairing too, but
    // it sits below the fold on a normal viewport, so without these a reader
    // sees a board and has to scroll past it to learn who is playing.
    seatLabels: true,
    players: playerNames,
    playerProfiles: reviewSeatProfiles(gamePlayers),
    ...crosstableConfig(postgame.game.roomId, postgame.game.players),
    // Position hand-offs: continue this node on /analysis, or open it in the editor.
    analyseFromHere: (truth) => analysisHref('atomic-xiangqi', atomicXiangqiFen(truth)),
    boardEditorHref: (truth) => editorHref('atomic-xiangqi', atomicXiangqiFen(truth)),
    ...gameExportShareExtra('atomic-xiangqi', postgame.game.roomId),
    // Server whole-game analysis on the patched Fairy-Stockfish, DB-cached: an
    // already-analysed game loads from cache on open (a GET that never
    // computes). Requesting a fresh compute is account-gated (the server
    // rejects anon POSTs), so a signed-out visitor gets a sign-in CTA instead
    // of a request that would 401.
    analysis: {
      requestLabel: isLikelySignedIn()
        ? t('replay.requestComputerAnalysis')
        : t('replay.signInToRequestAnalysis'),
      requestHref: isLikelySignedIn() ? undefined : loginHrefForCurrentPage(),
      fetchCached: () => fetchCachedGameAnalysis('atomic-xiangqi', postgame.game.roomId),
      run: () => requestGameAnalysis('atomic-xiangqi', postgame.game.roomId),
    },
  });
}

export function postgameReplayMaxPly(postgame: AtomicXiangqiPostgameResponse): number {
  const history = Object.values(postgame.history ?? {}).flat();
  return Math.max(postgame.game.plyCount, ...history.map((snapshot) => snapshot.ply), 0);
}

export function postgameViewAtPly(
  postgame: AtomicXiangqiPostgameResponse,
  key: AtomicXiangqiViewKey,
  ply: number,
): AtomicXiangqiPlayerView | null {
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
    return t('replay.variantGameUnavailable', {
      variant: variantDisplayLabel('atomic-xiangqi'),
    });
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
