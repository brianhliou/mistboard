import {
  BANQI_SPEC_ID,
  type BanqiMove,
  type BanqiPlayerView,
  banqiRulesFromView,
} from '@mistboard/game';
import {
  type BanqiPostgameResponse,
  type BanqiPostgameLoadResult as LoadResult,
  loadBanqiPostgame,
} from './banqi-postgame-data.js';
import { variantDisplayLabel } from './game-display.js';

export {
  type BanqiPostgameResponse,
  type BanqiPostgameViewKey,
  banqiPostgameApiUrl,
  loadBanqiPostgame,
  postgameReplayMaxPly,
  postgameViewAtPly,
  postgameViewEntries,
} from './banqi-postgame-data.js';

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
  banqiDecisionOverlay,
  fetchCachedBanqiDecisions,
  requestBanqiDecisions,
} from './review/banqi-decisions.js';
import { mountBanqiReview } from './review/banqi-review.js';
import { recoverBanqiDeal } from './review/banqi-tree-adapter.js';
import { crosstableConfig } from './review/crosstable.js';
import { fetchCachedGameAnalysis, requestGameAnalysis } from './review/game-analysis.js';
import { gameExportShareExtra } from './review/game-export-links.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import { reviewMoveClocks } from './review/move-clocks.js';
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
    .then(async (result) => {
      if (result.ok) {
        await renderPostgame(root, result.postgame);
        return;
      }
      renderError(root, errorTitle(result.status), errorBody(result));
    })
    .catch(() => {
      renderError(root, t('replay.postgameUnavailable'), t('replay.gameCouldNotBeLoaded'));
    });
}

async function renderPostgame(root: HTMLElement, postgame: BanqiPostgameResponse): Promise<void> {
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
    if (postgame.game.visibility !== 'private' || !postgame.history?.truth?.length) {
      throw new Error('banqi postgame: no recorded history to replay');
    }
    // Private worker tests retain only the recorded public views. Reuse the
    // as-played viewer without reconstructing a deal or offering new branches.
    const shell = document.createElement('main');
    shell.className = 'game-shell';
    const title = document.createElement('h1');
    title.textContent = variantDisplayLabel('banqi');
    const replay = document.createElement('div');
    shell.append(title, replay);
    root.replaceChildren(buildNav(), shell);
    const { mountBanqiWatchReplay } = await import('./watch-banqi-replay.js');
    await mountBanqiWatchReplay(replay, postgame.game.roomId, {
      autoplay: false,
      followEnd: true,
      loadPostgameOverride: async () => ({ ok: true, postgame }),
    });
    return;
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
    BANQI_SPEC_ID,
  );
  const { metaCard, details } = buildReviewMeta({
    gameSpecId: BANQI_SPEC_ID,
    variantName: variantDisplayLabel(BANQI_SPEC_ID),
    game: postgame.game,
    status,
    seatColors,
  });

  root.replaceChildren(buildNav());
  // The final view says whether the game was played under the 長捉 rule (absent:
  // a game from before it, replayed with the rule off as it was played).
  const start = { deal, rules: banqiRulesFromView(postgame.view) };
  mountBanqiReview(root, postgame.game.roomId, start, {
    // A finished game: what the still-face-down pieces were, on hover and
    // from the menu (#824). The payload already carries the whole deal.
    showFaceDown: true,
    pageClassName: 'banqi-review',
    ariaLabel: 'Banqi postgame',
    title: 'Banqi',
    summary: `${status} · ${postgame.game.plyCount} plies`,
    metaCard,
    details,
    // Phone: board, bar and a move strip; card, chart and chat in a sheet (#619).
    phoneInfoSheet: true,
    moves,
    moveTimes: hasMoveTimes ? moveTimes : undefined,
    moveClocks: hasMoveTimes ? reviewMoveClocks(postgame) : undefined,
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
      fetchCached: (options) => fetchCachedGameAnalysis('banqi', postgame.game.roomId, options),
      run: (_progress, signal, onStatus) =>
        requestGameAnalysis('banqi', postgame.game.roomId, { signal, onStatus }),
    },
    // Decision-vs-luck decomposition: flip plies get a decision-quality glyph + per-move luck
    // readout + a two-number summary. Computed on top of the basic analysis (heavier, so it runs
    // as the follow-on pass), or on a decisions cache miss under an already-cached analysis (a
    // game analysed before the decomposition shipped). The POST is account-gated, so canRun keeps
    // signed-out viewers on the base summary instead of a 401.
    decisions: {
      fetchCached: (options) =>
        fetchCachedBanqiDecisions(postgame.game.roomId, options).then((summary) =>
          summary ? banqiDecisionOverlay(summary) : null,
        ),
      canRun: isLikelySignedIn(),
      run: (options) =>
        requestBanqiDecisions(postgame.game.roomId, options).then(banqiDecisionOverlay),
    },
  });
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
