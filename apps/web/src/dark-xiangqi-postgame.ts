import {
  DARK_XIANGQI_SPEC_ID,
  standardXiangqiFen,
  type XiangqiColor,
  type XiangqiGameStatus,
  type XiangqiMove,
} from '@mistboard/game';
import { gameOutcome, variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { reviewSeatProfiles } from './profile-link.js';
import { analysisHref, editorHref } from './review/position-links.js';
import './game-shell.css';
import './live-xiangqi.css';
import './dark-xiangqi-postgame.css';
import { darkXiangqiEnabled } from './feature-flags.js';
import type { DarkXiangqiWireView } from './live-dark-xiangqi.js';
import { crosstableConfig } from './review/crosstable.js';
import { mountDarkXiangqiReview } from './review/dark-xiangqi-review.js';
import { gameExportShareExtra } from './review/game-export-links.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import { buildNav } from './site-shell.js';

export type DarkXiangqiPostgameViewKey = XiangqiColor | 'truth';

export type DarkXiangqiPostgameResponse = {
  game: {
    roomId: string;
    variant: 'dark-xiangqi';
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
    status: XiangqiGameStatus;
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
  view: DarkXiangqiWireView;
  views?: Partial<Record<DarkXiangqiPostgameViewKey, DarkXiangqiWireView>>;
  history?: Partial<
    Record<DarkXiangqiPostgameViewKey, Array<{ ply: number; view: DarkXiangqiWireView }>>
  >;
};

type LoadResult =
  | { ok: true; postgame: DarkXiangqiPostgameResponse }
  | { ok: false; status: number; error: string };

export function mountDarkXiangqiPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'dark-xiangqi-postgame-route');
  root.replaceChildren(buildNav(), loadingView());
  if (!darkXiangqiEnabled()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel('dark-xiangqi') }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadDarkXiangqiPostgame(roomId)
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

export async function loadDarkXiangqiPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(darkXiangqiPostgameApiUrl(roomId));
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
    postgame: (await response.json()) as DarkXiangqiPostgameResponse,
  };
}

export function darkXiangqiPostgameApiUrl(roomId: string): string {
  const url = new URL(
    `/api/dark-xiangqi/games/${encodeURIComponent(roomId)}`,
    window.location.href,
  );
  return url.pathname;
}

function renderPostgame(root: HTMLElement, postgame: DarkXiangqiPostgameResponse): void {
  // The interactive tree replays + branches on the TRUE move history (a /game
  // postgame reveals by design), reconstructing every position — including each
  // seat's fogged POV — client-side through the fog kernel. The server per-ply
  // snapshots are no longer needed for the postgame board.
  const moveEvents = postgame.timeline.filter((item) => item.type === 'move-played' && item.move);
  const moves = moveEvents.map((item) => item.move as XiangqiMove);

  // Per-ply elapsed time from consecutive event timestamps (no per-move clock is
  // persisted, so the first ply's delta is measured from the earliest event).
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
    markerId: 'dark-xiangqi',
    variantName: variantDisplayLabel(DARK_XIANGQI_SPEC_ID),
    game: postgame.game,
    status,
  });

  root.replaceChildren(buildNav());
  mountDarkXiangqiReview(root, {
    pageClassName: 'dark-xiangqi-review',
    ariaLabel: 'Fog Xiangqi postgame',
    title: 'Fog Xiangqi',
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
    analyseFromHere: (truth) => analysisHref('dark-xiangqi', standardXiangqiFen(truth)),
    boardEditorHref: (truth) => editorHref('dark-xiangqi', standardXiangqiFen(truth)),
    ...gameExportShareExtra('dark-xiangqi', postgame.game.roomId),
    // No client/server whole-game analysis for fog yet (the fog engine is a
    // separate worker piece); the review is the interactive triptych + tree.
    analysis: null,
  });
}

export function postgameViewEntries(
  postgame: DarkXiangqiPostgameResponse,
): Array<{ key: DarkXiangqiPostgameViewKey; label: string; view: DarkXiangqiWireView }> {
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

export function postgameReplayMaxPly(postgame: DarkXiangqiPostgameResponse): number {
  const history = Object.values(postgame.history ?? {}).flat();
  return Math.max(postgame.game.plyCount, ...history.map((snapshot) => snapshot.ply), 0);
}

export function postgameViewAtPly(
  postgame: DarkXiangqiPostgameResponse,
  key: DarkXiangqiPostgameViewKey,
  ply: number,
): DarkXiangqiWireView | null {
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
    return t('replay.variantGameUnavailable', { variant: variantDisplayLabel('dark-xiangqi') });
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
