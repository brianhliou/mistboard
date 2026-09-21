import {
  BANQI_SPEC_ID,
  type BanqiColor,
  type BanqiGameStatus,
  type BanqiMove,
  type BanqiPlayerView,
  banqiStateToDealtFen,
  banqiStateToEngineFen,
} from '@mistboard/game';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import './live-xiangqi.css';
import './landing.css';
import './game-route.css';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { banqiOutcome } from './banqi-result-label.js';
import { banqiEnabled } from './feature-flags.js';
import { installBanqiBoardStyles } from './live-banqi-render.js';
import { reviewSeatProfiles } from './profile-link.js';
import {
  type BanqiDecisionSummary,
  fetchCachedBanqiDecisions,
  requestBanqiDecisions,
} from './review/banqi-decisions.js';
import { mountBanqiReview } from './review/banqi-review.js';
import { recoverBanqiDeal } from './review/banqi-tree-adapter.js';
import { crosstableConfig } from './review/crosstable.js';
import { fetchCachedGameAnalysis, requestGameAnalysis } from './review/game-analysis.js';
import { gameExportShareExtra } from './review/game-export-links.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import { analysisHref, editorHref } from './review/position-links.js';
import type { DecisionOverlay } from './review/tree-review.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav } from './site-shell.js';

// Postgame review for Banqi. Banqi is a SYMMETRIC hidden-deal
// variant: a face-down tile is hidden from both seats equally, so there is a single
// review board. As of the review standardization it rides the shared interactive
// tree (mountBanqiReview → mountTreeReview): the deal is reconstructed from the
// fully-revealed history (history.revealed), baked into the truth, and the client
// replays the move list + lets you branch. The board renders MASKED as-played;
// flipping a tile in a line reveals what the fixed deal placed there. The server
// per-ply snapshots are used only by the watch adapter (postgameViewAtPly below).

export type BanqiPostgameViewKey = BanqiColor | 'truth' | 'revealed';

export type BanqiPostgameResponse = {
  game: {
    roomId: string;
    variant: 'banqi';
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
    status: BanqiGameStatus;
    moveNumber: number;
    clock?: unknown;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: BanqiColor;
    move?: BanqiMove;
    ply?: number;
    winner?: BanqiColor;
    reason?: string;
  }>;
  view: BanqiPlayerView;
  views?: Partial<Record<BanqiPostgameViewKey, BanqiPlayerView>>;
  history?: Partial<Record<BanqiPostgameViewKey, Array<{ ply: number; view: BanqiPlayerView }>>>;
};

type LoadResult =
  | { ok: true; postgame: BanqiPostgameResponse }
  | { ok: false; status: number; error: string };

export function mountBanqiPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  installBanqiBoardStyles();
  root.replaceChildren(buildNav(), loadingView());
  if (!banqiEnabled()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel('banqi') }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadBanqiPostgame(roomId)
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

export async function loadBanqiPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(banqiPostgameApiUrl(roomId));
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
    postgame: (await response.json()) as BanqiPostgameResponse,
  };
}

export function banqiPostgameApiUrl(roomId: string): string {
  const url = new URL(`/api/banqi/games/${encodeURIComponent(roomId)}`, window.location.href);
  return url.pathname;
}

function renderPostgame(root: HTMLElement, postgame: BanqiPostgameResponse): void {
  // Reconstruct the fixed deal from the earliest fully-revealed snapshot, then let
  // the tree replay the move list + branch client-side. If the revealed stream is
  // missing/incomplete, recoverBanqiDeal throws and the outer .catch renders an
  // error rather than a wrong board.
  const revealedHistory = postgame.history?.revealed ?? [];
  const earliestRevealed = revealedHistory.reduce<{ ply: number; view: BanqiPlayerView } | null>(
    (best, snapshot) => (!best || snapshot.ply < best.ply ? snapshot : best),
    null,
  );
  if (!earliestRevealed) {
    throw new Error('banqi postgame: no revealed history to reconstruct the deal');
  }
  const deal = recoverBanqiDeal(earliestRevealed.view);

  const moveEvents = postgame.timeline.filter(
    (entry): entry is typeof entry & { move: BanqiMove } =>
      entry.type === 'move-played' && !!entry.move,
  );
  const moves: BanqiMove[] = moveEvents.map((entry) => entry.move);

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
  const firstColor = postgame.view.firstColor;
  const seatColors = firstColor
    ? ({
        red: firstColor,
        black: firstColor === 'red' ? 'black' : 'red',
      } as const)
    : undefined;

  const status = reviewOutcomeLine(
    banqiOutcome(postgame.game.result, firstColor),
    postgame.game.termination,
  );
  const { metaCard, details } = buildReviewMeta({
    markerId: 'banqi',
    variantName: variantDisplayLabel(BANQI_SPEC_ID),
    game: postgame.game,
    status,
    seatColors,
  });

  root.replaceChildren(buildNav());
  mountBanqiReview(root, postgame.game.roomId, deal, {
    pageClassName: 'banqi-review',
    ariaLabel: 'Banqi postgame',
    title: 'Banqi',
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
    analyseFromHere: (truth) => analysisHref('banqi', banqiStateToDealtFen(truth)),
    boardEditorHref: (truth) => editorHref('banqi', banqiStateToEngineFen(truth)),
    ...gameExportShareExtra('banqi', postgame.game.roomId),
    // Server-side MistyBanqi whole-game analysis, DB-cached: an already-analysed game
    // loads straight from cache on open (a GET that never computes). Requesting a fresh
    // compute is account-gated (the server rejects anon POSTs), so a signed-out visitor
    // gets a sign-in CTA instead of a request that would 401.
    analysis: {
      requestLabel: isLikelySignedIn()
        ? t('replay.requestComputerAnalysis')
        : t('replay.signInToRequestAnalysis'),
      requestHref: isLikelySignedIn() ? undefined : loginHrefForCurrentPage(),
      fetchCached: () => fetchCachedGameAnalysis('banqi', postgame.game.roomId),
      run: () => requestGameAnalysis('banqi', postgame.game.roomId),
    },
    // Decision-vs-luck decomposition: flip plies get a decision-quality glyph + per-move luck
    // readout + a two-number summary. Computed on top of the basic analysis (heavier, so it runs
    // as the follow-on pass), or on a decisions cache miss under an already-cached analysis (a
    // game analysed before the decomposition shipped). The POST is account-gated, so canRun keeps
    // signed-out viewers on the base summary instead of a 401.
    decisions: {
      fetchCached: () =>
        fetchCachedBanqiDecisions(postgame.game.roomId).then((summary) =>
          summary ? toDecisionOverlay(summary) : null,
        ),
      canRun: isLikelySignedIn(),
      run: () => requestBanqiDecisions(postgame.game.roomId).then(toDecisionOverlay),
    },
  });
}

// Adapt the banqi-specific decomposition summary to the review's variant-agnostic overlay shape.
function toDecisionOverlay(summary: BanqiDecisionSummary): DecisionOverlay {
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

// Banqi is symmetric, so the review reduces to the single truth surface. Exported
// for the watch-replay surface to reuse the per-ply view selection, mirroring the
// jieqi postgame module's exported helpers.
export function postgameViewEntries(
  postgame: BanqiPostgameResponse,
): Array<{ key: BanqiPostgameViewKey; label: string; view: BanqiPlayerView }> {
  return [{ key: 'truth', label: t('replay.serverTruth'), view: postgame.view }];
}

export function postgameReplayMaxPly(postgame: BanqiPostgameResponse): number {
  const history = Object.values(postgame.history ?? {}).flat();
  return Math.max(postgame.game.plyCount, ...history.map((snapshot) => snapshot.ply), 0);
}

export function postgameViewAtPly(
  postgame: BanqiPostgameResponse,
  key: BanqiPostgameViewKey,
  ply: number,
): BanqiPlayerView | null {
  const history = postgame.history?.[key];
  if (!history || history.length === 0) return null;
  let selected = history[0] ?? null;
  for (const snapshot of history) {
    if (snapshot.ply > ply) break;
    selected = snapshot;
  }
  return selected?.view ?? null;
}

export function banqiInitialPlyFromSearch(search: string): number | null {
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
    return t('replay.variantGameUnavailable', { variant: variantDisplayLabel('banqi') });
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
