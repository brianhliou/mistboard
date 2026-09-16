import type {
  AtomicXiangqiColor,
  AtomicXiangqiGameStatus,
  AtomicXiangqiMove,
  AtomicXiangqiPlayerView,
} from '@mistboard/game';
// The xiangqi surface stylesheet first (ground, grid, palace, river), then the
// atomic marks. Without the first, the board is drawn and invisible.
import './live-xiangqi.css';
import './atomic-xiangqi.css';
import './landing.css';
import './game-route.css';
import {
  animateAtomicXiangqiCapture,
  atomicXiangqiBlastKey,
  atomicXiangqiBlastMarkers,
  atomicXiangqiCaptureAnimates,
  markAtomicXiangqiBlastHost,
} from './atomic-xiangqi-board.js';
import { atomicXiangqiEnabled } from './feature-flags.js';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import {
  buildReviewMeta,
  reviewOutcomeLine,
  reviewResultLabel,
} from './review/game-review-meta.js';
import { createMoveList, type MoveListEntry } from './review/move-list.js';
import { mountReviewLayout } from './review/review-layout.js';
import { buildNav } from './site-shell.js';
import { setBoardFamily } from './theme.js';
import { LIVE_BOARD_SURFACE, xiangqiBoardSvg } from './xiangqi-board.js';
import { xiangqiBoardViewBox } from './xiangqi-board-geometry.js';

// Postgame review for Atomic Xiangqi. Perfect information, one board, no
// per-seat POV split. It replays the server's per-ply snapshots rather than
// reconstructing positions client-side: every snapshot carries its move's
// aftermath (`lastBlast`), so the board rings what each explosion took without
// re-deriving the blast here.

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

// No coordinate labels on the review board, so no gutter: read the viewBox the
// renderer will use rather than hardcoding it (the host clips on a mismatch).
const BOARD_VIEWBOX = xiangqiBoardViewBox('intersection', {
  ...LIVE_BOARD_SURFACE.geo,
  coordGutter: 0,
});

function renderPostgame(root: HTMLElement, postgame: AtomicXiangqiPostgameResponse): void {
  const boardHost = document.createElement('div');
  boardHost.className = 'atomic-xiangqi-postgame__board review-board-host';
  boardHost.setAttribute('aria-label', 'Atomic Xiangqi board');
  boardHost.style.width = '100%';
  boardHost.style.aspectRatio = `${BOARD_VIEWBOX.width} / ${BOARD_VIEWBOX.height}`;

  const moveList = createMoveList(moveEntries(postgame), { title: 'Moves' });
  // The ply whose explosion has played; stepping onto a ply detonates it once.
  let detonatedKey: string | null = null;
  let cancelCapture: (() => void) | null = null;

  const status = reviewOutcomeLine(
    reviewResultLabel(postgame.game.result),
    postgame.game.termination,
  );
  const { metaCard, details } = buildReviewMeta({
    markerId: 'xiangqi',
    variantName: 'Atomic Xiangqi',
    game: postgame.game,
    status,
  });

  root.replaceChildren(buildNav());
  mountReviewLayout(root, {
    pageClassName: 'atomic-xiangqi-review',
    ariaLabel: 'Atomic Xiangqi postgame',
    title: 'Atomic Xiangqi',
    summary: `${status} · ${postgame.game.plyCount} plies`,
    metaCard,
    details,
    moves: moveList.el,
    boards: [{ key: 'truth', el: boardHost, tier: 'primary' }],
    boardAspect: BOARD_VIEWBOX.width / BOARD_VIEWBOX.height,
    boardCols: 9,
    maxPly: postgameReplayMaxPly(postgame),
    renderBoards({ ply, flipped }) {
      const perspective: AtomicXiangqiColor = flipped ? 'black' : 'red';
      const view = postgameViewAtPly(postgame, 'truth', ply) ?? postgame.view;
      const key = atomicXiangqiBlastKey(view);
      const fresh = key !== detonatedKey;
      detonatedKey = key;
      if (fresh) {
        cancelCapture?.();
        cancelCapture = null;
      }
      markAtomicXiangqiBlastHost(boardHost, view);
      boardHost.innerHTML = xiangqiBoardSvg(view, perspective, {
        interactive: false,
        selectedSquare: null,
        draggingFrom: null,
        coordinates: false,
        markers: atomicXiangqiBlastMarkers(view, { fresh }),
      });
      if (fresh && atomicXiangqiCaptureAnimates(view)) {
        cancelCapture = animateAtomicXiangqiCapture(boardHost, view, perspective);
      }
    },
    renderMoves({ ply }, jump) {
      moveList.update(ply, jump);
    },
  });
}

function moveEntries(postgame: AtomicXiangqiPostgameResponse): MoveListEntry[] {
  return postgame.timeline
    .filter(
      (entry): entry is typeof entry & { move: AtomicXiangqiMove; ply: number } =>
        entry.type === 'move-played' && !!entry.move && typeof entry.ply === 'number',
    )
    .map((entry) => ({ ply: entry.ply, label: `${entry.move.from}-${entry.move.to}` }));
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
