import {
  type BanqiSeat,
  createThreeKingdomsBanqiStateFromSetup,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiPlayerView,
  type ThreeKingdomsBanqiStatus,
  threeKingdomsBanqiStateToDealtFen,
} from '@mistboard/game';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import './live-xiangqi.css';
import './landing.css';
import './game-route.css';
import { banqiOutcome } from './banqi-result-label.js';
import { installBanqiBoardStyles } from './live-banqi-render.js';
import { reviewSeatProfiles } from './profile-link.js';
import { crosstableConfig } from './review/crosstable.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import { reviewMoveClocks } from './review/move-clocks.js';
import { mountThreeKingdomsBanqiReview } from './review/three-kingdoms-banqi-review.js';
import { recoverThreeKingdomsBanqiDeal } from './review/three-kingdoms-banqi-tree-adapter.js';
import { buildNav } from './site-shell.js';
import { threeKingdomsBanqiOffered } from './three-kingdoms-banqi-access.js';

// Postgame review for Three Kingdoms banqi (#628), on banqi's page
// (live-banqi-postgame.ts). An admin playtest (#684): the page opens only where
// a TK room would (threeKingdomsBanqiOffered), and the API answers only an
// admin session.
//
// The server sends a FINISHED game only, never the deal as such: the client
// reads the deal off the ply-0 revealed board, roots the shared tree there, and
// replays the move list; the board renders masked as played, so a tile stays
// face down until the line flips it. Scores per ply come from the review's own
// material row. No analysis: there is no Three Kingdoms engine for review, and
// no export links (TK games are not exportable during the playtest).

export type ThreeKingdomsBanqiPostgameResponse = {
  game: {
    roomId: string;
    variant: typeof THREE_KINGDOMS_BANQI_SPEC_ID;
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
    status: ThreeKingdomsBanqiStatus;
    moveNumber: number;
    clock?: unknown;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: BanqiSeat;
    move?: ThreeKingdomsBanqiMove;
    ply?: number;
    winner?: BanqiSeat;
    reason?: string;
  }>;
  view: ThreeKingdomsBanqiPlayerView;
  history?: {
    truth?: Array<{ ply: number; view: ThreeKingdomsBanqiPlayerView }>;
    revealed?: Array<{ ply: number; view: ThreeKingdomsBanqiPlayerView }>;
  };
};

type LoadResult =
  | { ok: true; postgame: ThreeKingdomsBanqiPostgameResponse }
  | { ok: false; status: number; error: string };

const VARIANT = THREE_KINGDOMS_BANQI_SPEC_ID;

export function mountThreeKingdomsBanqiPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  installBanqiBoardStyles();
  root.replaceChildren(buildNav(), loadingView());
  if (!threeKingdomsBanqiOffered()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel(VARIANT) }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadThreeKingdomsBanqiPostgame(roomId)
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

export async function loadThreeKingdomsBanqiPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(threeKingdomsBanqiPostgameApiUrl(roomId));
  if (!response.ok) {
    const body = await safeJson(response);
    return {
      ok: false,
      status: response.status,
      error: typeof body?.error === 'string' ? body.error : 'request_failed',
    };
  }
  return { ok: true, postgame: (await response.json()) as ThreeKingdomsBanqiPostgameResponse };
}

export function threeKingdomsBanqiPostgameApiUrl(roomId: string): string {
  return `/api/three-kingdoms-banqi/games/${encodeURIComponent(roomId)}`;
}

/** The tree's root: the recovered deal, face down, as the room dealt it. Throws
 *  when the payload has no complete ply-0 revealed board. */
export function threeKingdomsBanqiPostgameRoot(postgame: ThreeKingdomsBanqiPostgameResponse) {
  const dealt = postgame.history?.revealed?.find((snapshot) => snapshot.ply === 0);
  if (!dealt) {
    throw new Error('three kingdoms banqi postgame: no ply-0 revealed board to read the deal from');
  }
  const deal = recoverThreeKingdomsBanqiDeal(dealt.view);
  const truth = createThreeKingdomsBanqiStateFromSetup(postgame.game.roomId, { deal });
  return { truth, fen: threeKingdomsBanqiStateToDealtFen(truth) };
}

function renderPostgame(root: HTMLElement, postgame: ThreeKingdomsBanqiPostgameResponse): void {
  const start = threeKingdomsBanqiPostgameRoot(postgame);

  const moveEvents = postgame.timeline.filter(
    (entry): entry is typeof entry & { move: ThreeKingdomsBanqiMove } =>
      entry.type === 'move-played' && !!entry.move,
  );
  const moves = moveEvents.map((entry) => entry.move);

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
  const firstColor = postgame.view.firstColor;
  const seatColors = firstColor
    ? ({ red: firstColor, black: firstColor === 'red' ? 'black' : 'red' } as const)
    : undefined;

  const status = reviewOutcomeLine(
    banqiOutcome(postgame.game.result, firstColor),
    postgame.game.termination,
  );
  const variantName = variantDisplayLabel(VARIANT);
  const { metaCard, details } = buildReviewMeta({
    gameSpecId: VARIANT,
    variantName,
    game: postgame.game,
    status,
    seatColors,
  });

  root.replaceChildren(buildNav());
  mountThreeKingdomsBanqiReview(root, {
    root: start,
    pageClassName: 'banqi-review',
    ariaLabel: variantName,
    title: variantName,
    summary: `${status} · ${postgame.game.plyCount} plies`,
    metaCard,
    details,
    phoneInfoSheet: true,
    moves,
    moveTimes: hasMoveTimes ? moveTimes : undefined,
    moveClocks: hasMoveTimes ? reviewMoveClocks(postgame) : undefined,
    seatLabels: true,
    players: playerNames,
    playerProfiles: reviewSeatProfiles(gamePlayers),
    seatColors,
    // Seats are move-order slots; the opening flip decides the ink.
    seatInkBindsOnFlip: true,
    ...crosstableConfig(postgame.game.roomId, postgame.game.players),
    // No Three Kingdoms review engine, so no analysis tier.
    analysis: null,
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
