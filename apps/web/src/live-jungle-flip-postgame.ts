import {
  JUNGLE_FLIP_SPEC_ID,
  type JungleFlipGameStatus,
  type JungleFlipMove,
  type JungleFlipPlayerView,
  type JungleFlipSeat,
  jungleFlipStateToDealtFen,
  jungleFlipStateToEngineFen,
} from '@mistboard/game';
import './live-xiangqi.css';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import './landing.css';
import './game-route.css';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { jungleFlipEnabled } from './feature-flags.js';
import { jungleFlipOutcome, jungleFlipSeatInk } from './jungle-flip-result-label.js';
import { reviewSeatProfiles } from './profile-link.js';
import { crosstableConfig } from './review/crosstable.js';
import { fetchCachedGameAnalysis, requestGameAnalysis } from './review/game-analysis.js';
import { gameExportShareExtra } from './review/game-export-links.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import {
  fetchCachedJungleFlipDecisions,
  type JungleFlipDecisionSummary,
  requestJungleFlipDecisions,
} from './review/jungle-flip-decisions.js';
import { mountJungleFlipReview } from './review/jungle-flip-review.js';
import { recoverJungleFlipDeal } from './review/jungle-flip-tree-adapter.js';
import { analysisHref, editorHref } from './review/position-links.js';
import type { DecisionOverlay } from './review/tree-review.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav } from './site-shell.js';

// Postgame review for Flip Jungle. Flip Jungle is SYMMETRIC hidden-identity (the
// banqi pattern on 16 animals): a face-down tile is hidden from both seats equally,
// so there is a single review board and no sides to flip. As of the review
// standardization it rides the shared interactive tree (mountJungleFlipReview →
// mountTreeReview): the deal is reconstructed from the fully-revealed history
// (history.revealed), baked into the truth, and the client replays the move list +
// lets you branch. The board renders MASKED as-played; flipping a tile in a line
// reveals what the fixed deal placed there. The server per-ply snapshots are used
// only by the watch adapter (viewAtPly below).

type ViewKey = 'truth' | 'revealed';

export type JungleFlipPostgameResponse = {
  game: {
    roomId: string;
    variant: 'jungle-flip';
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
    status: JungleFlipGameStatus;
    moveNumber: number;
    clock?: unknown;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: JungleFlipSeat;
    move?: JungleFlipMove;
    ply?: number;
    winner?: JungleFlipSeat;
    reason?: string;
  }>;
  view: JungleFlipPlayerView;
  history?: Partial<Record<ViewKey, Array<{ ply: number; view: JungleFlipPlayerView }>>>;
};

type LoadResult =
  | { ok: true; postgame: JungleFlipPostgameResponse }
  | { ok: false; status: number; error: string };

export function mountJungleFlipPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  root.replaceChildren(buildNav(), loadingView());
  if (!jungleFlipEnabled()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel('jungle-flip') }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadJungleFlipPostgame(roomId)
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

export async function loadJungleFlipPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(jungleFlipPostgameApiUrl(roomId));
  if (!response.ok) {
    const body = await safeJson(response);
    return {
      ok: false,
      status: response.status,
      error: typeof body?.error === 'string' ? body.error : 'request_failed',
    };
  }
  return { ok: true, postgame: (await response.json()) as JungleFlipPostgameResponse };
}

export function jungleFlipPostgameApiUrl(roomId: string): string {
  return new URL(`/api/jungle-flip/games/${encodeURIComponent(roomId)}`, window.location.href)
    .pathname;
}

function renderPostgame(root: HTMLElement, postgame: JungleFlipPostgameResponse): void {
  const firstColor = postgame.view.firstColor;

  // Reconstruct the fixed deal from the earliest fully-revealed snapshot, then let
  // the tree replay the move list + branch client-side. If the revealed stream is
  // missing/incomplete, recoverJungleFlipDeal throws and the outer .catch renders an
  // error rather than a wrong board.
  const revealedHistory = postgame.history?.revealed ?? [];
  const earliestRevealed = revealedHistory.reduce<{
    ply: number;
    view: JungleFlipPlayerView;
  } | null>((best, snapshot) => (!best || snapshot.ply < best.ply ? snapshot : best), null);
  if (!earliestRevealed) {
    throw new Error('jungle-flip postgame: no revealed history to reconstruct the deal');
  }
  const deal = recoverJungleFlipDeal(earliestRevealed.view);

  const moveEvents = postgame.timeline.filter(
    (entry): entry is typeof entry & { move: JungleFlipMove } =>
      entry.type === 'move-played' && !!entry.move,
  );
  const moves: JungleFlipMove[] = moveEvents.map((entry) => entry.move);

  // Per-ply elapsed time from consecutive event timestamps (no per-move clock is persisted,
  // so the first ply's delta is measured from the earliest event).
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
  const seatColors = {
    red: jungleFlipSeatInk('red', firstColor) ?? 'red',
    black: jungleFlipSeatInk('black', firstColor) ?? 'black',
  } as const;

  const status = reviewOutcomeLine(
    jungleFlipOutcome(postgame.game.result, firstColor),
    postgame.game.termination,
  );
  const { metaCard, details } = buildReviewMeta({
    markerId: 'jungle-flip',
    variantName: variantDisplayLabel(JUNGLE_FLIP_SPEC_ID),
    game: postgame.game,
    status,
    seatColors,
  });

  root.replaceChildren(buildNav());
  mountJungleFlipReview(root, postgame.game.roomId, deal, {
    pageClassName: 'jungle-flip-review',
    ariaLabel: 'Flip Jungle postgame',
    title: 'Flip Jungle',
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
    seatColors,
    // Seats here are move-order slots; the opening flip decides the ink.
    seatInkBindsOnFlip: true,
    ...crosstableConfig(postgame.game.roomId, postgame.game.players),
    // Position hand-offs. The analysis link carries the DEALT fen (the exact
    // reveals of this game continue there); the editor link carries only the
    // public fen (it edits what is visible).
    analyseFromHere: (truth) => analysisHref('jungle-flip', jungleFlipStateToDealtFen(truth)),
    boardEditorHref: (truth) => editorHref('jungle-flip', jungleFlipStateToEngineFen(truth)),
    ...gameExportShareExtra('jungle-flip', postgame.game.roomId),
    // Server-side MistyJungleFlip whole-game analysis, DB-cached: an already-analysed game
    // loads straight from cache on open (a GET that never computes). Requesting a fresh
    // compute is account-gated (the server rejects anon POSTs), so a signed-out visitor gets
    // a sign-in CTA instead of a request that would 401.
    analysis: {
      requestLabel: isLikelySignedIn()
        ? t('replay.requestComputerAnalysis')
        : t('replay.signInToRequestAnalysis'),
      requestHref: isLikelySignedIn() ? undefined : loginHrefForCurrentPage(),
      fetchCached: () => fetchCachedGameAnalysis('jungle-flip', postgame.game.roomId),
      run: () => requestGameAnalysis('jungle-flip', postgame.game.roomId),
    },
    // Decision-vs-luck decomposition: flip plies get a decision-quality glyph + per-move luck
    // readout + a two-number summary. Computed on top of the basic analysis (heavier, so it runs
    // as the follow-on pass), or on a decisions cache miss under an already-cached analysis (a
    // game analysed before the decomposition shipped). The POST is account-gated, so canRun keeps
    // signed-out viewers on the base summary instead of a 401.
    decisions: {
      fetchCached: () =>
        fetchCachedJungleFlipDecisions(postgame.game.roomId).then((summary) =>
          summary ? toDecisionOverlay(summary) : null,
        ),
      canRun: isLikelySignedIn(),
      run: () => requestJungleFlipDecisions(postgame.game.roomId).then(toDecisionOverlay),
    },
  });
}

// Adapt the flip-jungle decomposition summary to the review's variant-agnostic overlay shape.
function toDecisionOverlay(summary: JungleFlipDecisionSummary): DecisionOverlay {
  return {
    byPly: new Map(
      [...summary.byPly].map(([ply, view]) => [
        ply,
        {
          judgment: view.judgment,
          accuracy: view.accuracy,
          luck: view.luck,
          playedRank: view.playedRank,
        },
      ]),
    ),
    red: { reveals: summary.red.reveals, decisionAccuracy: summary.red.decisionAccuracy },
    black: { reveals: summary.black.reveals, decisionAccuracy: summary.black.decisionAccuracy },
  };
}

export function replayMaxPly(postgame: JungleFlipPostgameResponse): number {
  const history = Object.values(postgame.history ?? {}).flat();
  return Math.max(postgame.game.plyCount, ...history.map((snapshot) => snapshot.ply), 0);
}

export function viewAtPly(
  postgame: JungleFlipPostgameResponse,
  key: ViewKey,
  ply: number,
): JungleFlipPlayerView | null {
  const history = postgame.history?.[key];
  if (!history || history.length === 0) return null;
  let selected = history[0] ?? null;
  for (const snapshot of history) {
    if (snapshot.ply > ply) break;
    selected = snapshot;
  }
  return selected?.view ?? null;
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
    return t('replay.variantGameUnavailable', { variant: variantDisplayLabel('jungle-flip') });
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
