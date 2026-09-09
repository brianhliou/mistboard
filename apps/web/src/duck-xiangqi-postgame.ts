import type {
  DuckXiangqiColor,
  DuckXiangqiGameStatus,
  DuckXiangqiPlayerView,
  DuckXiangqiTurn,
} from '@mistboard/game';
import { duckXiangqiBoardSvg } from './duck-xiangqi-board.js';
// The xiangqi surface stylesheets, IN THIS ORDER. `live-xiangqi.css` carries the
// board ground, grid, palace and river; `duck-xiangqi.css` only adds the duck and
// the target marks. Without the first, every one of those is drawn and invisible:
// the markup is correct and the page looks broken. This exact defect has already
// cost a session once.
import './live-xiangqi.css';
import './duck-xiangqi.css';
import './landing.css';
import './game-route.css';
import { duckXiangqiEnabled } from './feature-flags.js';
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
import { LIVE_BOARD_SURFACE } from './xiangqi-board.js';
import { xiangqiBoardViewBox } from './xiangqi-board-geometry.js';

// Postgame review for Duck Xiangqi. Perfect information (9x10 xiangqi plus one
// shared blocker), so there is a SINGLE board and no per-seat POV split: the
// server sends one `truth` stream and both seats plus spectators see it.
//
// Unlike the Fortress postgame this replays the server's per-ply snapshots
// instead of reconstructing positions client-side from the move list. That is
// deliberate and it is what makes the duck correct: the duck is not derivable
// from `from`/`to`, it is the third field of the turn, and ply 0 has no duck at
// all (`duck: undefined`). Reading the square off each snapshot means the board
// cannot disagree with the server about where the blocker stood.

type DuckXiangqiViewKey = 'truth';

export type DuckXiangqiPostgameResponse = {
  game: {
    roomId: string;
    variant: 'duck-xiangqi';
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
    status: DuckXiangqiGameStatus;
    moveNumber: number;
    clock?: unknown;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: DuckXiangqiColor;
    move?: DuckXiangqiTurn;
    ply?: number;
    winner?: DuckXiangqiColor;
    reason?: string;
  }>;
  view: DuckXiangqiPlayerView;
  views?: Partial<Record<DuckXiangqiViewKey, DuckXiangqiPlayerView>>;
  history?: Partial<
    Record<DuckXiangqiViewKey, Array<{ ply: number; view: DuckXiangqiPlayerView }>>
  >;
};

type LoadResult =
  | { ok: true; postgame: DuckXiangqiPostgameResponse }
  | { ok: false; status: number; error: string };

/**
 * A turn as the move list writes it: `from-to@duck`.
 *
 * The same grammar the live room uses (`duckTurnLabel` in live-duck-xiangqi.ts),
 * duplicated rather than imported because that module is a live-client entry
 * point and this is a static page. `x…#` is the general capture, the one turn
 * that ends the game before the duck would have moved and so the one turn with
 * no `@` half.
 *
 * Takes the STRUCTURAL shape rather than `DuckXiangqiTurn`, because the watch
 * renderer labels moves straight off the wire, where a square is only a string.
 * Narrowing there would mean casting an untrusted value into the square union.
 */
export function duckXiangqiTurnLabel(turn: {
  from: string;
  to: string;
  duckTo: string | null;
}): string {
  return turn.duckTo === null
    ? `${turn.from}x${turn.to}#`
    : `${turn.from}-${turn.to}@${turn.duckTo}`;
}

export function mountDuckXiangqiPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  setBoardFamily('xiangqi');
  root.replaceChildren(buildNav(), loadingView());
  if (!duckXiangqiEnabled()) {
    renderError(
      root,
      t('replay.variantUnavailable', { variant: variantDisplayLabel('duck-xiangqi') }),
      t('replay.routeNotEnabled'),
    );
    return;
  }
  void loadDuckXiangqiPostgame(roomId)
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

export async function loadDuckXiangqiPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(duckXiangqiPostgameApiUrl(roomId));
  if (!response.ok) {
    const body = await safeJson(response);
    return {
      ok: false,
      status: response.status,
      error: typeof body?.error === 'string' ? body.error : 'request_failed',
    };
  }
  return { ok: true, postgame: (await response.json()) as DuckXiangqiPostgameResponse };
}

export function duckXiangqiPostgameApiUrl(roomId: string): string {
  const url = new URL(
    `/api/duck-xiangqi/games/${encodeURIComponent(roomId)}`,
    window.location.href,
  );
  return url.pathname;
}

// The board draws no coordinate labels, so it reserves no gutter — the same
// swap `duck-xiangqi-board.ts` makes internally. Reading the viewBox rather than
// hardcoding 552/612 keeps the host box and the SVG from ever disagreeing (the
// host clips, so a mismatch eats the outer rank).
const DUCK_BOARD_VIEWBOX = xiangqiBoardViewBox('intersection', {
  ...LIVE_BOARD_SURFACE.geo,
  coordGutter: 0,
});

function renderPostgame(root: HTMLElement, postgame: DuckXiangqiPostgameResponse): void {
  const boardHost = document.createElement('div');
  boardHost.className = 'duck-xiangqi-postgame__board review-board-host';
  boardHost.setAttribute('aria-label', 'Duck Xiangqi board');
  boardHost.style.width = '100%';
  boardHost.style.aspectRatio = `${DUCK_BOARD_VIEWBOX.width} / ${DUCK_BOARD_VIEWBOX.height}`;

  const moveList = createMoveList(moveEntries(postgame), { title: 'Moves' });

  const status = reviewOutcomeLine(
    reviewResultLabel(postgame.game.result),
    postgame.game.termination,
  );
  // Glyph, not markerId: `VariantMiniId` has no 'duck-xiangqi' member yet, and a
  // marker id that is not in that union is a compile error rather than a missing
  // tile. The duck stands in until a mini board exists.
  const { metaCard, details } = buildReviewMeta({
    glyph: '🦆',
    variantName: 'Duck Xiangqi',
    game: postgame.game,
    status,
  });

  root.replaceChildren(buildNav());
  mountReviewLayout(root, {
    pageClassName: 'duck-xiangqi-review',
    ariaLabel: 'Duck Xiangqi postgame',
    title: 'Duck Xiangqi',
    summary: `${status} · ${postgame.game.plyCount} plies`,
    metaCard,
    details,
    moves: moveList.el,
    boards: [{ key: 'truth', el: boardHost, tier: 'primary' }],
    boardAspect: DUCK_BOARD_VIEWBOX.width / DUCK_BOARD_VIEWBOX.height,
    boardCols: 9,
    maxPly: postgameReplayMaxPly(postgame),
    renderBoards({ ply, flipped }) {
      const perspective: DuckXiangqiColor = flipped ? 'black' : 'red';
      const view = postgameViewAtPly(postgame, 'truth', ply) ?? postgame.view;
      // Non-interactive: no click layer, no targets, and the piece phase with
      // nothing selected. The duck layer is unconditional, so it draws wherever
      // this ply's snapshot puts the duck and draws nothing at ply 0.
      boardHost.innerHTML = duckXiangqiBoardSvg(view, perspective, {
        interactive: false,
        phase: { kind: 'piece', selected: null },
        targets: [],
      });
    },
    // Jump-to-ply routes through the layout's own `go`, the same path the
    // control bar and the keyboard use.
    renderMoves({ ply }, jump) {
      moveList.update(ply, jump);
    },
  });
}

function moveEntries(postgame: DuckXiangqiPostgameResponse): MoveListEntry[] {
  return postgame.timeline
    .filter(
      (entry): entry is typeof entry & { move: DuckXiangqiTurn; ply: number } =>
        entry.type === 'move-played' && !!entry.move && typeof entry.ply === 'number',
    )
    .map((entry) => ({ ply: entry.ply, label: duckXiangqiTurnLabel(entry.move) }));
}

export function postgameReplayMaxPly(postgame: DuckXiangqiPostgameResponse): number {
  const history = Object.values(postgame.history ?? {}).flat();
  return Math.max(postgame.game.plyCount, ...history.map((snapshot) => snapshot.ply), 0);
}

export function postgameViewAtPly(
  postgame: DuckXiangqiPostgameResponse,
  key: DuckXiangqiViewKey,
  ply: number,
): DuckXiangqiPlayerView | null {
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
    return t('replay.variantGameUnavailable', { variant: variantDisplayLabel('duck-xiangqi') });
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
