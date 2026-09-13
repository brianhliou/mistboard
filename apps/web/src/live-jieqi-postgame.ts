import {
  type JieqiColor,
  type JieqiGameStatus,
  type JieqiMove,
  type JieqiPlayerView,
  jieqiStateToDealtFen,
  jieqiStateToPikafishFen,
} from '@mistboard/game';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import './live-xiangqi.css';
import './landing.css';
import './game-route.css';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { jieqiEnabled } from './feature-flags.js';
import { installJieqiBoardStyles } from './live-jieqi-render.js';
import { reviewSeatProfiles } from './profile-link.js';
import { crosstableConfig } from './review/crosstable.js';
import { fetchCachedGameAnalysis, requestGameAnalysis } from './review/game-analysis.js';
import { gameExportShareExtra } from './review/game-export-links.js';
import {
  buildReviewMeta,
  reviewOutcomeLine,
  reviewResultLabel,
} from './review/game-review-meta.js';
import {
  fetchCachedJieqiDecisions,
  type JieqiDecisionSummary,
  requestJieqiDecisions,
} from './review/jieqi-decisions.js';
import { mountJieqiReview } from './review/jieqi-review.js';
import { recoverJieqiDeal } from './review/jieqi-tree-adapter.js';
import { formatJieqiBestMove } from './review/move-advice.js';
import { analysisHref, editorHref } from './review/position-links.js';
import type { DecisionOverlay } from './review/tree-review.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav } from './site-shell.js';

// Postgame review for Jieqi. Jieqi hides piece IDENTITIES
// symmetrically (positions are public), so there is a single review board. As of the
// review standardization it rides the shared interactive tree (mountJieqiReview →
// mountTreeReview): the deal is reconstructed from the fully-revealed `history.truth`
// stream (jieqi's spoiler key is 'truth'), baked into the truth, and the client
// replays the move list + lets you branch. The board renders MASKED as-played; a
// dark piece reveals when a move in a line moves it. The server per-ply snapshots are
// used only by the watch adapter (postgameViewAtPly below).

// 'red' | 'black' are the review payload's per-color views; 'truth' is the fully
// revealed board (and the deal seed the review reconstructs from); 'masked' is the
// as-played board the TV/watch payload carries, where a never-moved piece is still
// face-down. Unlike the jungle-flip watch adapter — where 'truth' IS the mask —
// jieqi keeps 'truth' meaning fully revealed, because the review payload and
// recoverJieqiDeal already depend on that meaning.
export type JieqiPostgameViewKey = JieqiColor | 'truth' | 'masked';

export type JieqiPostgameResponse = {
  game: {
    roomId: string;
    variant: 'jieqi';
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
    status: JieqiGameStatus;
    moveNumber: number;
    clock?: unknown;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: JieqiColor;
    move?: JieqiMove;
    ply?: number;
    winner?: JieqiColor;
    reason?: string;
  }>;
  view: JieqiPlayerView;
  views?: Partial<Record<JieqiPostgameViewKey, JieqiPlayerView>>;
  history?: Partial<Record<JieqiPostgameViewKey, Array<{ ply: number; view: JieqiPlayerView }>>>;
};

type LoadResult =
  | { ok: true; postgame: JieqiPostgameResponse }
  | { ok: false; status: number; error: string };

export function mountJieqiPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  installJieqiBoardStyles();
  root.replaceChildren(buildNav(), loadingView());
  if (!jieqiEnabled()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel('jieqi') }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadJieqiPostgame(roomId)
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

export async function loadJieqiPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(jieqiPostgameApiUrl(roomId));
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
    postgame: (await response.json()) as JieqiPostgameResponse,
  };
}

export function jieqiPostgameApiUrl(roomId: string): string {
  const url = new URL(`/api/jieqi/games/${encodeURIComponent(roomId)}`, window.location.href);
  return url.pathname;
}

function renderPostgame(root: HTMLElement, postgame: JieqiPostgameResponse): void {
  // Reconstruct the fixed deal from the earliest fully-revealed truth snapshot, then
  // let the tree replay the move list + branch client-side. If the truth stream is
  // missing/incomplete, recoverJieqiDeal throws and the outer .catch renders an
  // error rather than a wrong board.
  const truthHistory = postgame.history?.truth ?? [];
  const earliestTruth = truthHistory.reduce<{ ply: number; view: JieqiPlayerView } | null>(
    (best, snapshot) => (!best || snapshot.ply < best.ply ? snapshot : best),
    null,
  );
  const truthSeed = earliestTruth?.view ?? postgame.views?.truth ?? null;
  if (!truthSeed) {
    throw new Error('jieqi postgame: no truth history to reconstruct the deal');
  }
  const deal = recoverJieqiDeal(truthSeed);

  const moveEvents = postgame.timeline.filter(
    (entry): entry is typeof entry & { move: JieqiMove } =>
      entry.type === 'move-played' && !!entry.move,
  );
  const moves: JieqiMove[] = moveEvents.map((entry) => entry.move);

  // Per-ply elapsed time from consecutive event timestamps (no per-move clock is persisted, so
  // the first ply's delta is measured from the earliest event).
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
    markerId: 'jieqi',
    variantName: 'Jieqi',
    game: postgame.game,
    status,
  });

  root.replaceChildren(buildNav());
  mountJieqiReview(root, postgame.game.roomId, deal, {
    pageClassName: 'jieqi-review',
    ariaLabel: 'Jieqi postgame',
    title: 'Jieqi',
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
    // Position hand-offs. The analysis link carries the DEALT fen (the exact
    // reveals of this game continue there); the editor link carries only the
    // public fen (it edits what is visible).
    analyseFromHere: (truth) => analysisHref('jieqi', jieqiStateToDealtFen(truth)),
    boardEditorHref: (truth) => editorHref('jieqi', jieqiStateToPikafishFen(truth)),
    ...gameExportShareExtra('jieqi', postgame.game.roomId),
    // Server-side PikaJieQi whole-game analysis, DB-cached: an already-analysed game loads
    // straight from cache on open (a GET that never computes). Requesting a fresh compute is
    // account-gated (the server rejects anon POSTs), so a signed-out visitor gets a sign-in CTA
    // instead of a request that would 401. REVEAL plies are returned unjudged (their swing mixes
    // decision with the random reveal) until the decision-vs-luck decomposition lands.
    analysis: {
      requestLabel: isLikelySignedIn()
        ? t('replay.requestComputerAnalysis')
        : t('replay.signInToRequestAnalysis'),
      requestHref: isLikelySignedIn() ? undefined : loginHrefForCurrentPage(),
      fetchCached: () => fetchCachedGameAnalysis('jieqi', postgame.game.roomId),
      run: () => requestGameAnalysis('jieqi', postgame.game.roomId),
    },
    // Decision-vs-luck decomposition: reveal plies get a decision-quality glyph + per-move luck
    // readout + a two-number summary. Computed on top of the basic analysis (heavier, so it runs
    // as the follow-on pass), or on a decisions cache miss under an already-cached analysis (a
    // game analysed before the decomposition shipped). The POST is account-gated, so canRun keeps
    // signed-out viewers on the base summary instead of a 401.
    decisions: {
      fetchCached: () =>
        fetchCachedJieqiDecisions(postgame.game.roomId).then((summary) =>
          summary ? toDecisionOverlay(summary) : null,
        ),
      canRun: isLikelySignedIn(),
      run: () => requestJieqiDecisions(postgame.game.roomId).then(toDecisionOverlay),
    },
  });
}

// Adapt the jieqi-specific decomposition summary to the review's variant-agnostic overlay shape.
function toDecisionOverlay(summary: JieqiDecisionSummary): DecisionOverlay {
  return {
    byPly: new Map(
      [...summary.byPly].map(([ply, view]) => [
        ply,
        {
          judgment: view.judgment,
          accuracy: view.accuracy,
          luck: view.luck,
          playedRank: view.playedRank,
          // Format at the variant seam: the review layer is variant-agnostic and must never
          // see engine UCI. Same formatter the "… was best." advice line uses.
          ...(view.candidates?.length
            ? {
                candidates: view.candidates.map((candidate) => ({
                  label: formatJieqiBestMove(candidate.move),
                  win: candidate.win,
                  ...(candidate.played ? { played: true } : {}),
                })),
              }
            : {}),
        },
      ]),
    ),
    red: { reveals: summary.red.reveals, decisionAccuracy: summary.red.decisionAccuracy },
    black: { reveals: summary.black.reveals, decisionAccuracy: summary.black.decisionAccuracy },
  };
}

// Exported for the watch-replay surface to reuse the per-ply view selection,
// mirroring the other tenant postgame modules' exported helpers.
export function postgameViewEntries(
  postgame: JieqiPostgameResponse,
): Array<{ key: JieqiPostgameViewKey; label: string; view: JieqiPlayerView }> {
  const views = postgame.views;
  if (views?.red && views.truth && views.black) {
    return [
      { key: 'red', label: t('replay.redView'), view: views.red },
      { key: 'truth', label: t('replay.serverTruth'), view: views.truth },
      { key: 'black', label: t('replay.blackView'), view: views.black },
    ];
  }
  return [{ key: 'truth', label: t('replay.serverTruth'), view: postgame.view }];
}

export function postgameReplayMaxPly(postgame: JieqiPostgameResponse): number {
  const history = Object.values(postgame.history ?? {}).flat();
  return Math.max(postgame.game.plyCount, ...history.map((snapshot) => snapshot.ply), 0);
}

export function postgameViewAtPly(
  postgame: JieqiPostgameResponse,
  key: JieqiPostgameViewKey,
  ply: number,
): JieqiPlayerView | null {
  const history = postgame.history?.[key];
  if (!history || history.length === 0) return null;
  let selected = history[0] ?? null;
  for (const snapshot of history) {
    if (snapshot.ply > ply) break;
    selected = snapshot;
  }
  return selected?.view ?? null;
}

export function jieqiInitialPlyFromSearch(search: string): number | null {
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
    return t('replay.variantGameUnavailable', { variant: variantDisplayLabel('jieqi') });
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
