import {
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjMove,
  type XmjPlayerView,
  type XmjRoomStatus,
  type XmjSeat,
} from '@mistboard/game';
import { shouldShowFinalClockTenths } from './account-preferences.js';
import { attachBoardResizeGrip, restoreBoardScale } from './board-resize.js';
import { applyClockEmphasis, setClockFace } from './clock-emphasis.js';
import { variantDisplayLabel } from './game-display.js';
import { createGameTable, moveListScroller } from './game-table.js';
import { t } from './i18n/catalog.js';
import './landing.css';
import './game-route.css';
import { xiangqiMahjongEnabled } from './feature-flags.js';
import { createMoveNavBar } from './move-nav-bar.js';
import { handlePostgameReplayKeyboard } from './postgame-keyboard.js';
import { type ProfileIdentity, playerNameEl, profileTargetFor } from './profile-link.js';
import { buildReviewMeta } from './review/game-review-meta.js';
import { createReviewShell } from './review/review-shell.js';
import { buildNav } from './site-shell.js';
import { formatClock } from './web-utils.js';
import './xiangqi-mahjong.css';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import { xmjHandLog } from './xiangqi-mahjong-log.js';
import {
  xiangqiMahjongTableHtml,
  xmjFeltFromSearch,
  xmjHandsTableHtml,
  xmjLogHtml,
  xmjResultLine,
  xmjTileLookFromSearch,
} from './xiangqi-mahjong-table.js';

// Review page for a finished Xiangqi Mahjong match: every hand, move by move,
// with both hands and each drawn tile face up. The server answers only once the
// match is finished (apps/server/src/routes/xiangqi-mahjong-games.ts), so this
// page never holds a live match's concealed tiles. It is a replay and nothing
// more: no engine, no discard advice. The table is the room's own renderer.

/** Each seat's time left after a ply, as recorded then, and the seat on the
 *  clock. Absent for an untimed match (and from servers older than the field). */
export type XmjPostgameClock = { remainingMs: Record<XmjSeat, number>; active: XmjSeat | null };

export type XmjPostgameSnapshot = { ply: number; view: XmjPlayerView; clock?: XmjPostgameClock };

export type XmjPostgameResponse = {
  game: {
    roomId: string;
    variant: typeof XIANGQI_MAHJONG_SPEC_ID;
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
    players?: Array<
      ProfileIdentity & {
        color: string;
        name: string;
        rating: number | null;
        kind: 'account' | 'guest' | 'engine';
      }
    >;
  };
  state: {
    status: XmjRoomStatus;
    moveNumber: number;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  timeline: Array<{ type: string; at: number; color?: XmjSeat; move?: XmjMove; ply?: number }>;
  view: XmjPlayerView;
  history: XmjPostgameSnapshot[];
};

type LoadResult =
  | { ok: true; postgame: XmjPostgameResponse }
  | { ok: false; status: number; error: string };

export function mountXiangqiMahjongPostgame(root: HTMLElement, roomId: string): void {
  root.classList.add('landing-page', 'game-route');
  root.replaceChildren(buildNav(), messageView(t('replay.loadingGame')));
  const variant = variantDisplayLabel(XIANGQI_MAHJONG_SPEC_ID);
  if (!xiangqiMahjongEnabled()) {
    renderError(root, t('replay.variantUnavailable', { variant }), t('replay.routeNotEnabled'));
    return;
  }
  void loadXiangqiMahjongPostgame(roomId)
    .then((result) => {
      if (result.ok) {
        renderPostgame(root, result.postgame);
        return;
      }
      if (result.status === 404) {
        renderError(
          root,
          t('replay.gameNotFound'),
          t('replay.variantGameUnavailable', { variant }),
        );
      } else if (result.status === 503) {
        renderError(root, t('replay.postgameUnavailable'), t('replay.postgameServiceUnavailable'));
      } else {
        renderError(root, t('replay.postgameUnavailable'), result.error);
      }
    })
    .catch(() =>
      renderError(root, t('replay.postgameUnavailable'), t('replay.gameCouldNotBeLoaded')),
    );
}

export async function loadXiangqiMahjongPostgame(roomId: string): Promise<LoadResult> {
  const response = await fetch(`/api/xiangqi-mahjong/games/${encodeURIComponent(roomId)}`);
  if (!response.ok) {
    let error = 'request_failed';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body?.error === 'string') error = body.error;
    } catch {
      // Not JSON: keep the generic error.
    }
    return { ok: false, status: response.status, error };
  }
  return { ok: true, postgame: (await response.json()) as XmjPostgameResponse };
}

/** The last ply the history holds. */
export function xmjPostgameLastPly(postgame: Pick<XmjPostgameResponse, 'history'>): number {
  return postgame.history.reduce((max, snapshot) => Math.max(max, snapshot.ply), 0);
}

/** The view at `ply`: the latest snapshot at or before it. */
export function xmjPostgameViewAt(
  postgame: Pick<XmjPostgameResponse, 'history' | 'view'>,
  ply: number,
): XmjPlayerView {
  let selected: XmjPlayerView | null = null;
  for (const snapshot of postgame.history) {
    if (snapshot.ply > ply) break;
    selected = snapshot.view;
  }
  return selected ?? postgame.view;
}

/**
 * The clocks to show at `ply`: the latest snapshot clock at or before it. When
 * the log kept no clocks at all (an untimed match, or an older server), null;
 * the page then shows no clock rather than a made-up one.
 */
export function xmjPostgameClockAt(
  postgame: Pick<XmjPostgameResponse, 'history'>,
  ply: number,
): XmjPostgameClock | null {
  let selected: XmjPostgameClock | null = null;
  for (const snapshot of postgame.history) {
    if (snapshot.ply > ply) break;
    if (snapshot.clock) selected = snapshot.clock;
  }
  return selected;
}

/** `?ply=N` as a ply to open on, clamped to the match; the end otherwise. */
export function xmjInitialPly(search: string, lastPly: number): number {
  const raw = new URLSearchParams(search).get('ply');
  if (raw === null || !/^\d+$/.test(raw)) return lastPly;
  return Math.min(Number.parseInt(raw, 10), lastPly);
}

/** Each seat's name: the player's handle, else the room's guest word. */
export function xmjPostgameNames(
  players: XmjPostgameResponse['game']['players'],
): Record<XmjSeat, string> {
  const name = (seat: XmjSeat): string => {
    const player = players?.find((each) => each.color === seat);
    if (!player || (player.kind === 'guest' && player.name === 'Guest')) {
      return t('live.xmj.guest');
    }
    return player.name;
  };
  return { east: name('east'), west: name('west') };
}

/**
 * The meta card's result line, worded as the room words it (xmjResultLine):
 * the winner by name ("brianhliou wins on points"), never a bare "Won". The
 * review has no viewer seat, so nobody reads as "You".
 */
export function xmjPostgameStatusLine(
  game: Pick<XmjPostgameResponse['game'], 'result' | 'termination'>,
  names: Readonly<Record<XmjSeat, string>>,
): string {
  const winner: XmjSeat | null =
    game.result === 'east-wins' ? 'east' : game.result === 'west-wins' ? 'west' : null;
  // The record stores a level match as 'draw'; the room's reason for it is 'tie'.
  const reason = game.termination === 'draw' ? 'tie' : game.termination;
  return xmjResultLine(winner, reason, null, (seat) => names[seat]);
}

function renderPostgame(root: HTMLElement, postgame: XmjPostgameResponse): void {
  const names = xmjPostgameNames(postgame.game.players);
  const status = xmjPostgameStatusLine(postgame.game, names);
  const { metaCard, details } = buildReviewMeta({
    gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
    variantName: variantDisplayLabel(XIANGQI_MAHJONG_SPEC_ID),
    game: postgame.game,
    status,
  });

  const search = window.location.search;
  const look = xmjTileLookFromSearch(search);
  const felt = xmjFeltFromSearch(search);
  const pieceSet = readStoredXiangqiPieceSet();

  const board = document.createElement('div');
  board.className = `board xiangqi-mahjong-live-board${felt === 'green' ? '' : ` xmj-felt--${felt}`}${look === 'jade' ? '' : ` xmj-tiles--${look}`}`;
  const handsUnder = document.createElement('section');
  handsUnder.className = 'xmj-hands-under';
  // The board's innerHTML is redrawn every step, so the resize grip hangs off
  // a positioned stage around it, as the room hangs it off its .board-stage.
  const stage = document.createElement('div');
  stage.className = 'xmj-review__stage';
  stage.append(board);
  const center = document.createElement('div');
  center.className = 'review-center-column';
  center.append(stage, handsUnder);

  // The right column is the room's own game table (game-table.ts): seat rows
  // and clocks above and below, the move-nav bar, the hand-grouped move list.
  // West sits on top and east below, as on the board.
  const table = createGameTable({ navMenu: false });
  table.el.classList.add('xmj-review__table');
  const log = table.refs.moveList;
  log.classList.add('xmj-log');
  if (look !== 'jade') log.classList.add(`xmj-tiles--${look}`);
  const right = document.createElement('div');
  right.className = 'xmj-review__moves';
  right.append(table.el);
  const seatRows = mountXmjReviewSeats(table.refs, names, postgame.game.players);
  const initialMs = postgame.state.timeControl?.initialMs ?? postgame.game.initialMs ?? null;

  const lastPly = xmjPostgameLastPly(postgame);
  let ply = xmjInitialPly(search, lastPly);
  const hands = xmjHandLog(
    postgame.timeline
      .filter((entry) => entry.type === 'move-played' && entry.move && entry.ply)
      .map((entry) => ({ move: entry.move as XmjMove, ply: entry.ply as number })),
  );
  const openHands = new Set<number>();

  const controls = createMoveNavBar({
    menu: false,
    menuPlacement: 'down',
    onFirst: () => go(0),
    onPrev: () => go(ply - 1),
    onNext: () => go(ply + 1),
    onLast: () => go(lastPly),
  });
  controls.el.dataset.replayControls = '';
  table.refs.replayControlsRoot.replaceWith(controls.el);

  function renderLog(): void {
    log.innerHTML = xmjLogHtml(hands, {
      names,
      viewer: null,
      results: postgame.view.results,
      activePly: ply,
      expanded: openHands,
      hasPly: (each) => each >= 0 && each <= lastPly,
      pieceSet,
      tileLook: look,
    });
    // Keep the row on show in view inside the list, never scrolling the page.
    const active = log.querySelector<HTMLElement>('.xmj-log__row.active');
    const scroller = moveListScroller(log);
    if (active && scroller.scrollHeight > scroller.clientHeight) {
      const box = scroller.getBoundingClientRect();
      const row = active.getBoundingClientRect();
      if (row.top < box.top) scroller.scrollTop += row.top - box.top;
      else if (row.bottom > box.bottom) scroller.scrollTop += row.bottom - box.bottom;
    }
  }

  function render(): void {
    const view = xmjPostgameViewAt(postgame, ply);
    board.innerHTML = xiangqiMahjongTableHtml(view, {
      canAct: false,
      names,
      now: Date.now(),
      pieceSet,
      tileLook: look,
    });
    // Settled, as the room redraws a result already on screen.
    board.querySelector('.xmj-result')?.classList.add('xmj-result--settled');
    handsUnder.innerHTML = xmjHandsTableHtml(view, names);
    paintXmjReviewClocks(seatRows, xmjPostgameClockAt(postgame, ply), initialMs, ply >= lastPly);
    renderLog();
    controls.setBounds({ atStart: ply <= 0, atEnd: ply >= lastPly });
  }

  function go(next: number): void {
    const clamped = Math.max(0, Math.min(lastPly, next));
    if (clamped === ply) return;
    ply = clamped;
    const url = new URL(window.location.href);
    if (ply === lastPly) url.searchParams.delete('ply');
    else url.searchParams.set('ply', String(ply));
    window.history.replaceState(window.history.state, '', url);
    render();
  }

  log.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-xmj-ply], [data-xmj-hand]',
    );
    if (!target) return;
    const hand = Number(target.dataset.xmjHand);
    if (Number.isInteger(hand) && hand > 0) {
      if (openHands.has(hand)) openHands.delete(hand);
      else openHands.add(hand);
      renderLog();
      return;
    }
    const row = Number(target.dataset.xmjPly);
    if (Number.isInteger(row) && row > 0) go(row);
  });

  const keys = new AbortController();
  document.addEventListener(
    'keydown',
    (event) => {
      if (!root.isConnected) {
        keys.abort();
        return;
      }
      handlePostgameReplayKeyboard(event, {
        first: () => go(0),
        previous: () => go(ply - 1),
        next: () => go(ply + 1),
        last: () => go(lastPly),
      });
    },
    { signal: keys.signal },
  );

  // Board zoom: the room's grip and its one stored scale (board-resize.ts), so
  // a size set on either page holds on the other.
  restoreBoardScale();
  attachBoardResizeGrip(stage, board);

  root.classList.add('live-route--xiangqi-mahjong', 'xmj-review');
  root.replaceChildren(
    buildNav(),
    createReviewShell({
      left: details ? [metaCard, details] : metaCard,
      center,
      right,
      ariaLabel: t('variant.xiangqiMahjong.name'),
      pageClassName: 'xmj-review-page',
    }),
  );
  render();
}

type XmjReviewSeatRows = Record<XmjSeat, { line: HTMLElement; row: HTMLElement }>;

// The room's seat rows (room-chrome.ts): a name line inside the table and a
// clock row outside it, west above and east below. No presence dot: nobody is
// connected to a finished match.
function mountXmjReviewSeats(
  refs: ReturnType<typeof createGameTable>['refs'],
  names: Record<XmjSeat, string>,
  players: XmjPostgameResponse['game']['players'],
): XmjReviewSeatRows {
  const mount = (seat: XmjSeat, playerHost: HTMLElement, clockHost: HTMLElement) => {
    const line = document.createElement('span');
    line.className = 'clock-player-line';
    const identity = players?.find((player) => player.color === seat);
    line.append(playerNameEl(names[seat], profileTargetFor(identity), 'clock-name'));
    playerHost.replaceChildren(line);
    const row = document.createElement('div');
    row.className = 'clock-time-row';
    row.dataset.color = seat;
    row.append(document.createElement('strong'));
    clockHost.replaceChildren(row);
    return { line, row };
  };
  return {
    west: mount('west', refs.playerTop, refs.clockTop),
    east: mount('east', refs.playerBottom, refs.clockBottom),
  };
}

/** Paints each seat's time left at the ply on the board; hides the clock rows
 *  when the match kept no clock. A static readout: nothing ticks. */
export function paintXmjReviewClocks(
  rows: XmjReviewSeatRows,
  clock: XmjPostgameClock | null,
  initialMs: number | null,
  atEnd: boolean,
): void {
  for (const seat of ['east', 'west'] as const) {
    const { line, row } = rows[seat];
    row.hidden = clock === null;
    if (!clock) {
      line.classList.remove('active');
      continue;
    }
    const remainingMs = clock.remainingMs[seat];
    const time = row.firstElementChild;
    // The final times keep their tenths, as in the room.
    const tenths = atEnd && remainingMs < 3_600_000 && shouldShowFinalClockTenths();
    if (time instanceof HTMLElement) setClockFace(time, formatClock(remainingMs, tenths));
    applyClockEmphasis(row, remainingMs, initialMs);
    const active = !atEnd && clock.active === seat;
    row.classList.toggle('active', active);
    line.classList.toggle('active', active);
  }
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
