import {
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiGameStatus,
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
  exportFormatsForVariant,
} from '@mistboard/game';
import './landing.css';
import './game-route.css';
import { crazyhouseXiangqiEnabled } from './feature-flags.js';
import { gameOutcome, variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { reviewSeatProfiles } from './profile-link.js';
import {
  type CrazyhouseXiangqiReviewConfig,
  mountCrazyhouseXiangqiReview,
} from './review/crazyhouse-xiangqi-review.js';
import { crosstableConfig } from './review/crosstable.js';
import { gameExportLinks, gameImageLink } from './review/game-export-links.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import { downloadRow } from './review/underboard-tabs.js';
import { buildNav } from './site-shell.js';
import { setBoardFamily } from './theme.js';

// Postgame review for Crazyhouse Xiangqi: the crazyhouse tree review
// (review/crazyhouse-xiangqi-review.ts) over the game's move list, the surface
// Fortress and Atomic Xiangqi have: branching board, both pockets at every ply,
// annotations, share and export. It opens on the final position. There is no
// engine for this variant in the browser or behind a whole-game analysis
// route, so the review carries no eval gauge, engine panel or analysis button.

type CrazyhouseXiangqiViewKey = 'truth';

export type CrazyhouseXiangqiPostgameResponse = {
  game: {
    roomId: string;
    variant: 'crazyhouse-xiangqi';
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
    status: CrazyhouseXiangqiGameStatus;
    moveNumber: number;
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: CrazyhouseXiangqiColor;
    move?: CrazyhouseXiangqiMove;
    ply?: number;
    winner?: CrazyhouseXiangqiColor;
    reason?: string;
  }>;
  view: CrazyhouseXiangqiPlayerView;
  views?: Partial<Record<CrazyhouseXiangqiViewKey, CrazyhouseXiangqiPlayerView>>;
  history?: Partial<
    Record<CrazyhouseXiangqiViewKey, Array<{ ply: number; view: CrazyhouseXiangqiPlayerView }>>
  >;
};

type LoadResult =
  | { ok: true; postgame: CrazyhouseXiangqiPostgameResponse }
  | { ok: false; status: number; error: string };

export function mountCrazyhouseXiangqiPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  setBoardFamily('xiangqi');
  root.replaceChildren(buildNav(), messageView(t('replay.loadingGame')));
  if (!crazyhouseXiangqiEnabled()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel(CRAZYHOUSE_XIANGQI_SPEC_ID) }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadCrazyhouseXiangqiPostgame(roomId)
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

export async function loadCrazyhouseXiangqiPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(`/api/crazyhouse-xiangqi/games/${encodeURIComponent(roomId)}`);
  if (!response.ok) {
    const body = await safeJson(response);
    return {
      ok: false,
      status: response.status,
      error: typeof body?.error === 'string' ? body.error : 'request_failed',
    };
  }
  return { ok: true, postgame: (await response.json()) as CrazyhouseXiangqiPostgameResponse };
}

/** The snapshot at or before `ply` (ply 0 is the start). */
export function postgameViewAtPly(
  postgame: CrazyhouseXiangqiPostgameResponse,
  ply: number,
): CrazyhouseXiangqiPlayerView {
  const history = postgame.history?.truth ?? [];
  let selected: CrazyhouseXiangqiPlayerView = history[0]?.view ?? postgame.view;
  for (const snapshot of history) {
    if (snapshot.ply > ply) break;
    selected = snapshot.view;
  }
  return selected;
}

function renderPostgame(root: HTMLElement, postgame: CrazyhouseXiangqiPostgameResponse): void {
  root.replaceChildren(buildNav());
  mountCrazyhouseXiangqiReview(root, crazyhouseXiangqiReviewConfig(postgame));
}

/** The review mount for a finished game: the mainline from the timeline, the
 *  meta card, seats, crosstable and the share/export panel. */
export function crazyhouseXiangqiReviewConfig(
  postgame: CrazyhouseXiangqiPostgameResponse,
): CrazyhouseXiangqiReviewConfig {
  // Perfect information: the tree rebuilds every position from the move list
  // through the kernel. The server's per-ply snapshots stay on the response
  // for postgameViewAtPly below.
  const moveEvents = postgame.timeline.filter(
    (entry) => entry.type === 'move-played' && entry.move,
  );
  const moves = moveEvents.map((entry) => entry.move as CrazyhouseXiangqiMove);

  // Per-ply elapsed time from consecutive event timestamps (the server keeps no
  // per-move clock, so the first ply is measured from the earliest event).
  let prevAt = postgame.timeline[0]?.at ?? moveEvents[0]?.at ?? 0;
  const moveTimes = moveEvents.map((entry) => {
    const delta = Math.max(0, entry.at - prevAt);
    prevAt = entry.at;
    return delta;
  });
  const hasMoveTimes = moveTimes.some((ms) => ms > 0);

  const gamePlayers = postgame.game.players ?? [];
  const status = reviewOutcomeLine(gameOutcome(postgame.game.result), postgame.game.termination);
  const { metaCard, details } = buildReviewMeta({
    markerId: 'xiangqi',
    variantName: variantDisplayLabel(CRAZYHOUSE_XIANGQI_SPEC_ID),
    game: postgame.game,
    status,
  });

  return {
    pageClassName: 'crazyhouse-xiangqi-review',
    ariaLabel: 'Crazyhouse Xiangqi postgame',
    title: variantDisplayLabel(CRAZYHOUSE_XIANGQI_SPEC_ID),
    summary: `${status} · ${postgame.game.plyCount} plies`,
    metaCard,
    details,
    moves,
    moveTimes: hasMoveTimes ? moveTimes : undefined,
    // The magnifier in the finished room lands here: open on the result, not
    // on an empty board the reader has to fast-forward through.
    initialPosition: 'end',
    seatLabels: true,
    players: {
      red: gamePlayers.find((p) => p.color === 'red')?.name,
      black: gamePlayers.find((p) => p.color === 'black')?.name,
    },
    playerProfiles: reviewSeatProfiles(gamePlayers),
    ...crosstableConfig(postgame.game.roomId, postgame.game.players),
    // Downloads and the board image. No Embed row: /embed/game does not draw
    // this variant yet, so the iframe code would embed "could not be loaded".
    shareExtra: [
      downloadRow([
        ...gameExportLinks(
          postgame.game.roomId,
          exportFormatsForVariant(CRAZYHOUSE_XIANGQI_SPEC_ID),
        ),
        gameImageLink(postgame.game.roomId),
      ]),
    ],
    // No whole-game analysis route exists for this variant.
    analysis: null,
  };
}

function messageView(text: string): HTMLElement {
  const shell = document.createElement('main');
  shell.className = 'game-shell';
  const heading = document.createElement('h1');
  heading.textContent = text;
  shell.append(heading);
  return shell;
}

function renderError(root: HTMLElement, titleText: string, bodyText: string): void {
  const shell = messageView(titleText);
  const body = document.createElement('p');
  body.textContent = bodyText;
  shell.append(body);
  root.replaceChildren(buildNav(), shell);
}

function errorTitle(status: number): string {
  if (status === 404) return t('replay.gameNotFound');
  return t('replay.postgameUnavailable');
}

function errorBody(result: Extract<LoadResult, { ok: false }>): string {
  if (result.status === 404)
    return t('replay.variantGameUnavailable', {
      variant: variantDisplayLabel(CRAZYHOUSE_XIANGQI_SPEC_ID),
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
