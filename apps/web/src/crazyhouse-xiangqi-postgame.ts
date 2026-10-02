import {
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiGameStatus,
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
} from '@mistboard/game';
import './landing.css';
import './game-route.css';
import './live-xiangqi.css';
import './drop-reserve.css';
import './crazyhouse-xiangqi.css';
import {
  crazyhouseXiangqiBoardView,
  crazyhouseXiangqiLastDrop,
  crazyhouseXiangqiMoveLabel,
  fillCrazyhouseXiangqiReserve,
} from './crazyhouse-xiangqi-view.js';
import { crazyhouseXiangqiEnabled } from './feature-flags.js';
import { gameOutcome, variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { buildReviewMeta, reviewOutcomeLine } from './review/game-review-meta.js';
import { buildNav } from './site-shell.js';
import { setBoardFamily } from './theme.js';
import { xiangqiBoardSvg } from './xiangqi-board.js';

// Postgame for Crazyhouse Xiangqi: a replay of the server's own per-ply
// snapshots (board AND both hands at every ply), a move list, and the meta
// card. Deliberately not the branching tree review the launched xiangqi
// variants have: the admin playtest has no review engine, and the tree review
// would need a drop-aware tree adapter it does not have yet. Perfect
// information, one view for everyone.

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
  const moves = postgame.timeline
    .filter((entry) => entry.type === 'move-played' && entry.move)
    .map((entry) => entry.move as CrazyhouseXiangqiMove);
  const maxPly = Math.max(0, ...(postgame.history?.truth ?? []).map((snapshot) => snapshot.ply));
  const status = reviewOutcomeLine(gameOutcome(postgame.game.result), postgame.game.termination);
  const { metaCard, details } = buildReviewMeta({
    markerId: 'xiangqi',
    variantName: variantDisplayLabel(CRAZYHOUSE_XIANGQI_SPEC_ID),
    game: postgame.game,
    status,
  });

  // Red at the bottom; the flip button turns it.
  let orientation: CrazyhouseXiangqiColor = 'red';
  let ply = maxPly;

  const shell = document.createElement('main');
  shell.className = 'game-shell chx-postgame';
  shell.setAttribute('aria-label', 'Crazyhouse Xiangqi postgame');

  const heading = document.createElement('h1');
  heading.textContent = variantDisplayLabel(CRAZYHOUSE_XIANGQI_SPEC_ID);
  const summary = document.createElement('p');
  summary.className = 'chx-postgame__summary';
  summary.textContent = `${status} · ${postgame.game.plyCount} plies`;

  const layout = document.createElement('div');
  layout.className = 'chx-postgame__layout';

  const boardColumn = document.createElement('section');
  boardColumn.className = 'chx-postgame__board-column board-shell';
  const handTop = document.createElement('div');
  handTop.className = 'chx-postgame__hand';
  const board = document.createElement('div');
  board.className = 'chx-postgame__board board xiangqi-live-board';
  const handBottom = document.createElement('div');
  handBottom.className = 'chx-postgame__hand';
  const controls = document.createElement('div');
  controls.className = 'chx-postgame__controls';
  const plyLabel = document.createElement('span');
  plyLabel.className = 'chx-postgame__ply';

  const button = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'secondary-button';
    el.textContent = label;
    el.title = title;
    el.setAttribute('aria-label', title);
    el.addEventListener('click', onClick);
    return el;
  };
  controls.append(
    button('|<', t('watch.firstMove'), () => go(0)),
    button('<', t('watch.previousMove'), () => go(ply - 1)),
    plyLabel,
    button('>', t('watch.nextMove'), () => go(ply + 1)),
    button('>|', t('watch.lastMove'), () => go(maxPly)),
    button('⇅', t('review.flipBoard'), () => {
      orientation = orientation === 'red' ? 'black' : 'red';
      paint();
    }),
  );
  boardColumn.append(handTop, board, handBottom, controls);

  const side = document.createElement('aside');
  side.className = 'chx-postgame__side';
  const moveList = document.createElement('ol');
  moveList.className = 'chx-postgame__moves';
  moves.forEach((move, index) => {
    const item = document.createElement('li');
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'chx-postgame__move';
    link.dataset.ply = String(index + 1);
    link.textContent = crazyhouseXiangqiMoveLabel(move);
    link.addEventListener('click', () => go(index + 1));
    item.append(link);
    moveList.append(item);
  });
  side.append(metaCard, moveList);
  if (details) side.append(details);

  layout.append(boardColumn, side);
  shell.append(heading, summary, layout);
  root.replaceChildren(buildNav(), shell);

  function go(next: number): void {
    ply = Math.max(0, Math.min(maxPly, next));
    paint();
  }

  function paint(): void {
    const view = postgameViewAtPly(postgame, ply);
    board.innerHTML = xiangqiBoardSvg(crazyhouseXiangqiBoardView(view), orientation, {
      interactive: false,
      selectedSquare: null,
      draggingFrom: null,
      lastDropSquare: crazyhouseXiangqiLastDrop(view),
    });
    const top = orientation === 'red' ? 'black' : 'red';
    fillCrazyhouseXiangqiReserve(handTop, view, top);
    fillCrazyhouseXiangqiReserve(handBottom, view, orientation);
    plyLabel.textContent = `${ply} / ${maxPly}`;
    for (const el of moveList.querySelectorAll<HTMLElement>('.chx-postgame__move')) {
      el.classList.toggle('is-current', Number(el.dataset.ply) === ply);
    }
  }

  document.addEventListener('keydown', (event) => {
    if (!shell.isConnected) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return;
    if (event.key === 'ArrowLeft') go(ply - 1);
    else if (event.key === 'ArrowRight') go(ply + 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(maxPly);
    else return;
    event.preventDefault();
  });

  paint();
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
