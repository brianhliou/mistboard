import type {
  StandardXiangqiPlayerView,
  XiangqiBroadcastBoardStatus,
  XiangqiBroadcastGameDetails,
  XiangqiBroadcastPlayerTag,
  XiangqiBroadcastResult,
  XiangqiBroadcastRound,
  XiangqiBroadcastTour,
  XiangqiColor,
  XiangqiGameStatus,
  XiangqiMove,
} from '@mistboard/game';
import {
  broadcastRecordsCredit,
  broadcastSourcePageHref,
  formatXiangqiMoves,
  xiangqiMoveToFsfUci,
} from '@mistboard/game';
import './live-xiangqi.css';
import './seat-disc-ink.css';
import './xiangqi-broadcast.css';
import { track } from './analytics.js';
import { t } from './i18n/catalog.js';
import { currentLocale } from './i18n/locale.js';
import { renderXiangqiBoardSvg } from './live-xiangqi.js';
import { playerTitleFor } from './players/player-title.js';
import type { CevalLine } from './review/engine/ceval-types.js';
import { engineArrowsFromLines } from './review/engine/engine-arrows.js';
import { createEvalBar } from './review/engine/eval-bar.js';
import { formatEval, winProbRed } from './review/engine/eval-format.js';
import { buildBroadcastChat } from './review/spectator-chat.js';
import { formatXiangqiEngineMove } from './review/xiangqi-review.js';
import { buildXiangqiReplayFromMoves } from './review/xiangqi-review-model.js';
import { buildLoadingState, buildNav, buildNotice } from './site-shell.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { animateXiangqiBoardMove } from './xiangqi-board.js';
import {
  formatPoints,
  groupRoundByMatch,
  leagueRulesFor,
  type MatchTeam,
  matchBoards,
  matchFormatOf,
  type TeamMatch,
  teamStandings,
} from './xiangqi-broadcast-matches.js';
import {
  type BroadcastCalendarResponse,
  type BroadcastPlayerRef,
  broadcastSectionLayout,
  calendarEventRow,
  fetchBroadcastCalendar,
  mountXiangqiBroadcastAbout,
  mountXiangqiBroadcastCalendar,
  topBroadcastPlayers,
} from './xiangqi-broadcast-pages.js';
import { mountBroadcastBoardReview } from './xiangqi-broadcast-review.js';
import { broadcastStandings, formatStandingsScore } from './xiangqi-broadcast-standings.js';
import {
  formatEventDateRange,
  formatEventDateTime,
  formatEventDay,
  formatEventOffset,
} from './xiangqi-broadcast-time.js';
import { currentXiangqiNotationStyle, xiangqiNotationChangedEvent } from './xiangqi-notation.js';

type BroadcastMoveTimelineEntry = {
  type: 'move-played';
  color: XiangqiColor;
  move: XiangqiMove;
  ply: number;
};

type BroadcastHistorySnapshot = {
  ply: number;
  view: StandardXiangqiPlayerView;
};

type BroadcastBoardSummary = {
  id: string;
  tourSlug: string;
  roundId: string;
  sourceBoardId: string;
  boardNumber: number;
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  status: XiangqiBroadcastBoardStatus;
  result: XiangqiBroadcastResult;
  plyCount?: number;
  moves?: XiangqiMove[];
  sourceUrl?: string;
  details?: XiangqiBroadcastGameDetails;
  /** Red-POV eval for the grid gauge: a finished game's stored analysis at its
   *  final position, or the live engine layer's read of a live one. */
  evaluation?: { cp: number | null; mate: number | null; source: 'analysis' | 'live' };
  createdAt?: string;
  updatedAt?: string;
};

// The server's Pikafish read of a LIVE board's head position, Red POV, moves
// in our square notation (`h3e3`, the browser engine's dialect). Present only
// while the board is live and only once the server has searched this ply.
type BroadcastLiveEvalLine = {
  move: string;
  cp: number | null;
  mate: number | null;
  pv: string[];
};

type BroadcastLiveEval = {
  ply: number;
  nodes: number;
  depth: number;
  cp: number | null;
  mate: number | null;
  lines: BroadcastLiveEvalLine[];
};

type BroadcastBoardResponse = {
  board: BroadcastBoardSummary & {
    finalStatus?: XiangqiGameStatus;
  };
  state: {
    status: XiangqiGameStatus;
    moveNumber: number;
  };
  timeline: BroadcastMoveTimelineEntry[];
  view: StandardXiangqiPlayerView;
  views: { truth: StandardXiangqiPlayerView };
  history: { truth: BroadcastHistorySnapshot[] };
  liveEval?: BroadcastLiveEval;
  /** Each side's player page, when the player has one. */
  playerSlugs?: { red: string | null; black: string | null };
};

// Per-round board counts computed by the server; they drive the status icons
// on tour rows and the markers in the round switcher. Optional so older or
// partial payloads degrade to the "upcoming" phase instead of breaking.
type BroadcastRoundStats = {
  boardCount: number;
  liveBoardCount: number;
  completeBoardCount: number;
  scheduledBoardCount: number;
};

type BroadcastRoundWithStats = XiangqiBroadcastRound & Partial<BroadcastRoundStats>;

type BroadcastTourResponse = {
  /** Who to credit for the records; derived server-side from the boards. */
  recordsSource?: { host: string; href: string } | null;
  tour: XiangqiBroadcastTour;
  rounds: BroadcastRoundWithStats[];
};

type BroadcastRoundResponse = {
  tour: XiangqiBroadcastTour;
  round: XiangqiBroadcastRound;
  boards: BroadcastBoardSummary[];
  rounds?: BroadcastRoundWithStats[];
  /** Player page slugs by Chinese name (the round endpoint only; stream pushes
   *  leave them out, so the page keeps what it has). */
  playerSlugs?: Record<string, string>;
};

type BroadcastSyncLogSummary = {
  severity: 'info' | 'warning' | 'error';
  kind: string;
  createdAt: string;
};

// The server's index thumbnail pick: the most recently updated live board,
// else the latest complete one, shipped as a final position (no move list).
type BroadcastFeaturedBoard = {
  id: string;
  roundId: string;
  boardNumber: number;
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  status: XiangqiBroadcastBoardStatus;
  result: XiangqiBroadcastResult;
  plyCount: number;
  updatedAt: string;
  view: StandardXiangqiPlayerView;
};

type BroadcastIndexEntry = {
  tour: XiangqiBroadcastTour;
  roundCount: number;
  boardCount: number;
  liveBoardCount: number;
  completeBoardCount: number;
  scheduledBoardCount: number;
  totalPlies: number;
  updatedAt: string | null;
  featuredBoard?: BroadcastFeaturedBoard | null;
  /** The latest round with games and the next seeded one, for the status line. */
  latestRound?: BroadcastIndexRound | null;
  nextRound?: BroadcastIndexRound | null;
  /** Who played, for the card's top-players line. */
  players?: BroadcastPlayerRef[];
  lastSyncLog: BroadcastSyncLogSummary | null;
};

type BroadcastIndexRound = {
  id: string;
  name: string;
  nameEn?: string;
  startsAt: string | null;
  live: boolean;
};

type BroadcastIndexResponse = {
  tours: BroadcastIndexEntry[];
};

type BroadcastStreamEnvelope<T> = {
  version: string;
  payload: T;
};

// One `broadcast_opened` per mount, fired once the page has data to describe
// itself with. SSE repaints and the appearance refresh never fire it again, and
// a live board that finishes hands off to the review page, which fires its own
// `review_opened`; this event is not repeated there.
type BroadcastOpenedProps = {
  surface: 'index' | 'tour' | 'round' | 'board';
  tour_slug?: string;
  round_id?: string;
  board_status?: XiangqiBroadcastBoardStatus;
};

function trackBroadcastOpened(props: BroadcastOpenedProps): void {
  track('broadcast_opened', { ...props, locale: currentLocale() });
}

export async function mountXiangqiBroadcastIndex(root: HTMLElement): Promise<void> {
  const signal = setBroadcastRoot(root, t('broadcast.loadingBroadcasts'));
  try {
    const [data, calendar] = await Promise.all([
      fetchJson<BroadcastIndexResponse>('/api/xiangqi/broadcasts'),
      fetchBroadcastCalendar(),
    ]);
    if (signal.aborted) return;
    trackBroadcastOpened({ surface: 'index' });
    const paint = (): void => root.replaceChildren(buildNav(), renderIndex(data, calendar));
    paint();
    installBroadcastAppearanceRefresh(paint);
  } catch (err) {
    renderError(root, err);
  }
}

// The tour URL and a round URL are the same page (lichess: one event page with
// a round selector and Boards / Overview / Players tabs). The tour URL is the
// one an outside link points at, so it opens on the round a visitor most wants:
// the live one, else the latest with games, else the first.
export async function mountXiangqiBroadcastTour(
  root: HTMLElement,
  tourSlug: string,
): Promise<void> {
  const signal = setBroadcastRoot(root, t('broadcast.loadingBroadcast'));
  try {
    const data = await fetchJson<BroadcastTourResponse>(
      `/api/xiangqi/broadcasts/${encodeURIComponent(tourSlug)}`,
    );
    if (signal.aborted) return;
    const round = defaultRound(data.rounds);
    if (!round) {
      trackBroadcastOpened({ surface: 'tour', tour_slug: tourSlug });
      const paint = (): void =>
        root.replaceChildren(
          buildNav(),
          renderEvent(eventWithoutRounds(data), undefined, { tab: 'overview' }),
        );
      paint();
      installBroadcastAppearanceRefresh(paint);
      return;
    }
    await mountRoundPage(root, tourSlug, round.id, 'tour');
  } catch (err) {
    renderError(root, err);
  }
}

export async function mountXiangqiBroadcastRound(
  root: HTMLElement,
  tourSlug: string,
  roundId: string,
): Promise<void> {
  beginEventPage(root, `${tourSlug}/${roundId}`, t('broadcast.loadingRound'));
  try {
    await mountRoundPage(root, tourSlug, roundId, 'round');
  } catch (err) {
    renderError(root, err);
  }
}

function defaultRound(rounds: BroadcastRoundWithStats[]): BroadcastRoundWithStats | null {
  const live = rounds.find((round) => (round.liveBoardCount ?? 0) > 0);
  if (live) return live;
  const withBoards = rounds.filter((round) => (round.boardCount ?? 0) > 0);
  return withBoards[withBoards.length - 1] ?? rounds[0] ?? null;
}

// A tour seeded with no rounds still gets the event page; the round-shaped
// payload it renders from simply has nothing in it.
function eventWithoutRounds(data: BroadcastTourResponse): BroadcastRoundResponse {
  return {
    tour: data.tour,
    round: { schema: data.tour.schema, id: '', tourSlug: data.tour.slug, name: '' },
    boards: [],
    rounds: data.rounds,
  };
}

type EventTab = 'boards' | 'overview' | 'players' | 'teams';

function eventTabFromUrl(): EventTab | null {
  const raw = new URLSearchParams(window.location.search).get('tab');
  return raw === 'overview' || raw === 'players' || raw === 'teams' || raw === 'boards'
    ? raw
    : null;
}

/** No round of the event has a game yet: it opens on the Overview, where its
 *  facts are, rather than an empty grid. */
function eventHasNoGames(data: BroadcastRoundResponse): boolean {
  return data.boards.length === 0 && (data.rounds ?? []).every((round) => !round.boardCount);
}

type EventPageState = {
  tab: EventTab;
  setTab?: (tab: EventTab) => void;
  /** Every round's boards, for the standings; fetched once when the tab opens. */
  standingsBoards?: BroadcastBoardSummary[] | null;
  /** A team event's Boards filter: one team's games, or every game (null). */
  team?: string | null;
  setTeam?: (team: string | null) => void;
  /** The Boards tab's page, from 0; a team or page-size change resets it. */
  page?: number;
  setPage?: (page: number) => void;
  /** Player page slugs by Chinese name, gathered from every round read. */
  playerSlugs?: Map<string, string>;
  loadStandings?: () => void;
};

async function mountRoundPage(
  root: HTMLElement,
  tourSlug: string,
  roundId: string,
  surface: 'tour' | 'round',
): Promise<void> {
  const signal = currentPageSignal();
  let data = await fetchJson<BroadcastRoundResponse>(
    `/api/xiangqi/broadcasts/${encodeURIComponent(tourSlug)}/rounds/${encodeURIComponent(roundId)}`,
  );
  if (signal?.aborted) return;
  rememberRound(data);
  trackBroadcastOpened({ surface, tour_slug: tourSlug, round_id: roundId });
  // Every stream push repaints the whole round, and a card is expensive:
  // boardCard replays its game from move one and builds a board SVG. Twenty
  // boards is ~1,700 plies, so rebuilding all of them per push blocks the
  // main thread for hundreds of milliseconds on exactly the rounds that push
  // most. Cards survive across paints and only the changed ones are rebuilt.
  const cards: BoardCardCache = new Map();
  const state: EventPageState = {
    tab: eventTabFromUrl() ?? (eventHasNoGames(data) ? 'overview' : 'boards'),
    playerSlugs: new Map(),
  };
  const addSlugs = (slugs: Record<string, string> | undefined): void => {
    for (const [name, slug] of Object.entries(slugs ?? {})) state.playerSlugs?.set(name, slug);
  };
  addSlugs(data.playerSlugs);
  state.setTab = (tab) => {
    state.tab = tab;
    const url = new URL(window.location.href);
    if (tab === 'boards') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    if (tab === 'players' || tab === 'teams') state.loadStandings?.();
    paint();
  };
  state.setTeam = (team) => {
    state.team = team;
    state.page = 0;
    paint();
  };
  state.setPage = (page) => {
    state.page = page;
    paint();
  };
  // The standings need every round's games, and the round payload carries only
  // its own, so the other rounds are fetched the first time the tab opens.
  // `null` while loading; the current round's boards are always live data.
  state.loadStandings = () => {
    if (state.standingsBoards !== undefined) return;
    state.standingsBoards = null;
    const others = (data.rounds ?? []).filter((round) => round.id !== data.round.id);
    Promise.all(
      others.map((round) =>
        fetchJson<BroadcastRoundResponse>(
          `/api/xiangqi/broadcasts/${encodeURIComponent(tourSlug)}/rounds/${encodeURIComponent(
            round.id,
          )}`,
        )
          .then((response) => {
            addSlugs(response.playerSlugs);
            return response.boards;
          })
          .catch(() => [] as BroadcastBoardSummary[]),
      ),
    ).then((rounds) => {
      state.standingsBoards = rounds.flat();
      paint();
    });
  };
  const paint = (): void =>
    keepRailScroll(root, () => root.replaceChildren(buildNav(), renderEvent(data, cards, state)));
  if (state.tab === 'players' || state.tab === 'teams') state.loadStandings();
  paint();
  // A skin or layout change rewrites every board SVG, so no cached card
  // survives it.
  installBroadcastAppearanceRefresh(() => {
    cards.clear();
    paint();
  });
  connectRoundStream(tourSlug, roundId, roundVersion(data), (next) => {
    data = next;
    rememberRound(next);
    paint();
  });
}

export async function mountXiangqiBroadcastBoard(
  root: HTMLElement,
  boardId: string,
): Promise<void> {
  // Opened from its own round's page, the board takes over the content column
  // while the header and the game list stay where they are.
  // The cached round is used only when its page is the one on screen: a
  // board opened any other way fetches its round fresh.
  const shownKey = root.querySelector<HTMLElement>('.xqb-event')?.dataset.roundKey;
  const known =
    lastRound &&
    roundKey(lastRound) === shownKey &&
    lastRound.boards.some((board) => board.id === boardId)
      ? lastRound
      : null;
  const signal = beginEventPage(root, known ? roundKey(known) : null, t('broadcast.loadingBoard'));
  try {
    let data = await fetchJson<BroadcastBoardResponse>(
      `/api/xiangqi/broadcasts/boards/${encodeURIComponent(boardId)}`,
    );
    let context =
      known && known.round.id === data.board.roundId
        ? known
        : await fetchBoardRoundContext(data.board.tourSlug, data.board.roundId);
    if (signal.aborted) return;
    if (context) rememberRound(context);
    trackBroadcastOpened({
      surface: 'board',
      tour_slug: data.board.tourSlug,
      round_id: data.board.roundId,
      board_status: data.board.status,
    });
    // A finished game is a game to study, so it gets the same review surface as
    // an archive game (engine, chart, notation, share); a live one keeps the
    // streaming replay, which follows the head as moves arrive.
    // A finished board's review owns an engine worker and page-wide
    // listeners. Every repaint (a stream push, a notation or piece-set change)
    // used to mount a new review over the old one and leave the old one's
    // worker running; the previous one is destroyed first now, and the last
    // one goes when the page does.
    let review: { destroy(): void } | null = null;
    signal.addEventListener('abort', () => review?.destroy(), { once: true });
    const body = document.createElement('div');
    body.className = 'xqb-board-view';
    const state: EventPageState = {
      tab: 'boards',
      setTab: (tab) => navigateBroadcast(roundHref(data.board.tourSlug, data.board.roundId, tab)),
    };
    const paintShell = (): void => {
      if (!context) {
        root.replaceChildren(buildNav(), body);
        return;
      }
      const shellContext = context;
      keepRailScroll(root, () =>
        root.replaceChildren(
          buildNav(),
          renderEventShell(shellContext, state, body, data.board.id),
        ),
      );
    };
    const paintBoard = (animateHeadAdvance = false): void => {
      review?.destroy();
      review = null;
      const embedded = context !== null;
      if (data.board.status === 'complete') {
        review = mountBroadcastBoardReview(body, data, { context, embedded });
        return;
      }
      const replay = renderBoardReplay(data, context, { animateHeadAdvance, embedded });
      if (embedded) body.replaceChildren(replay);
      else body.replaceChildren(buildNav(), replay);
    };
    paintShell();
    paintBoard();
    installBroadcastAppearanceRefresh(() => {
      paintShell();
      paintBoard();
    });
    connectBoardStream(boardId, boardVersion(data), data.timeline.length, (next, animate) => {
      data = next;
      paintBoard(animate);
    });
    // The game list and the header follow the round while a board is open.
    if (context) {
      connectRoundStream(data.board.tourSlug, data.board.roundId, roundVersion(context), (next) => {
        context = next;
        rememberRound(next);
        paintShell();
      });
    }
  } catch (err) {
    renderError(root, err);
  }
}

// Sibling boards + rounds feed the side rail and the round switcher on the
// board page. A context fetch failure never blocks the board itself.
async function fetchBoardRoundContext(
  tourSlug: string,
  roundId: string,
): Promise<BroadcastRoundResponse | null> {
  try {
    return await fetchJson<BroadcastRoundResponse>(
      `/api/xiangqi/broadcasts/${encodeURIComponent(tourSlug)}/rounds/${encodeURIComponent(
        roundId,
      )}`,
    );
  } catch {
    return null;
  }
}

function setBroadcastRoot(root: HTMLElement, loadingLabel: string): AbortSignal {
  const signal = beginBroadcastPage(root);
  root.classList.add('landing-page', 'xiangqi-broadcast-route');
  root.replaceChildren(buildNav(), buildLoadingState(loadingLabel));
  return signal;
}

/**
 * Start an event page. When the same round's shell is already on screen (a
 * board opened from its round, or the way back), only the content column
 * shows the loading state; the header and the game list stay put.
 */
function beginEventPage(root: HTMLElement, key: string | null, loadingLabel: string): AbortSignal {
  const shell = key ? root.querySelector<HTMLElement>('.xqb-event') : null;
  const body = shell?.dataset.roundKey === key ? shell?.querySelector('.xqb-event-body') : null;
  if (!body) return setBroadcastRoot(root, loadingLabel);
  const signal = beginBroadcastPage(root);
  body.replaceChildren(buildLoadingState(loadingLabel));
  return signal;
}

// The last round an event page showed, kept fresh by its stream: a board
// opened from it paints inside the same shell without fetching the round again.
let lastRound: BroadcastRoundResponse | null = null;

function rememberRound(data: BroadcastRoundResponse): void {
  if (data.round.id !== '') lastRound = data;
}

/**
 * Repaint without moving the game list: its scroll position survives when the
 * same round is still on screen, as long as the open board stays in view.
 */
function keepRailScroll(root: HTMLElement, repaint: () => void): void {
  const before = root.querySelector<HTMLElement>('.xqb-rail-list');
  const beforeKey = before?.closest<HTMLElement>('.xqb-event')?.dataset.roundKey;
  const top = before?.scrollTop ?? 0;
  repaint();
  const list = root.querySelector<HTMLElement>('.xqb-rail-list');
  if (!before || !list || list.closest<HTMLElement>('.xqb-event')?.dataset.roundKey !== beforeKey) {
    return;
  }
  const restore = (): void => {
    list.scrollTop = top;
    const row = list.querySelector<HTMLElement>('.xqb-rail-row-current');
    if (!row) return;
    const rowTop = row.offsetTop - list.scrollTop;
    if (rowTop < 0 || rowTop + row.offsetHeight > list.clientHeight) {
      list.scrollTop = Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2);
    }
  };
  // After sideRail's own centring, which runs a frame later too.
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restore);
  else restore();
}

// ---------------------------------------------------------------------------
// In-place navigation, lichess's: moving between the index, an event and a
// board swaps the page without loading a new one. A broadcast page owns what
// it starts (its event stream, its listeners, a board's review and engine
// worker) through one signal; the next page aborts it first. Before this each
// click was a full load, and the only cleanup anything had was `pagehide`.

let pageAbort: AbortController | null = null;

/** Abort the previous broadcast page's work and start this one's. */
function beginBroadcastPage(root: HTMLElement): AbortSignal {
  pageAbort?.abort();
  pageAbort = new AbortController();
  // A board review adds its own route classes; the next page must not keep
  // them.
  root.classList.remove('xiangqi-postgame-route', 'xqb-review-route');
  return pageAbort.signal;
}

function currentPageSignal(): AbortSignal | undefined {
  return pageAbort?.signal;
}

const BROADCAST_ROOT_PATH = '/broadcast/xiangqi';
// Section pages and the operator console: never read as a tour slug. The
// console is not a reader page and keeps its own full load.
const NON_TOUR_SEGMENTS = new Set(['board', 'calendar', 'about', 'ops']);

type BroadcastPage = (root: HTMLElement) => Promise<void> | void;

/** The broadcast page a path opens, or null for anything else. */
export function broadcastPageForPath(path: string): BroadcastPage | null {
  if (path === BROADCAST_ROOT_PATH) return (root) => mountXiangqiBroadcastIndex(root);
  if (path === `${BROADCAST_ROOT_PATH}/calendar`) {
    return (root) => {
      beginBroadcastPage(root);
      return mountXiangqiBroadcastCalendar(root);
    };
  }
  if (path === `${BROADCAST_ROOT_PATH}/about`) {
    return (root) => {
      beginBroadcastPage(root);
      mountXiangqiBroadcastAbout(root);
    };
  }
  const board = path.match(/^\/broadcast\/xiangqi\/board\/([^/]+)$/);
  if (board) return (root) => mountXiangqiBroadcastBoard(root, decodeURIComponent(board[1]!));
  const round = path.match(/^\/broadcast\/xiangqi\/([^/]+)\/round\/([^/]+)$/);
  if (round && !NON_TOUR_SEGMENTS.has(round[1]!)) {
    return (root) =>
      mountXiangqiBroadcastRound(
        root,
        decodeURIComponent(round[1]!),
        decodeURIComponent(round[2]!),
      );
  }
  const tour = path.match(/^\/broadcast\/xiangqi\/([^/]+)$/);
  if (tour && !NON_TOUR_SEGMENTS.has(tour[1]!)) {
    return (root) => mountXiangqiBroadcastTour(root, decodeURIComponent(tour[1]!));
  }
  return null;
}

let routerRoot: HTMLElement | null = null;
let pushedInPlace = false;

/**
 * Take over links between broadcast pages: a same-origin click to another
 * broadcast page swaps the page in place and pushes the URL; Back and Forward
 * swap it back. Anything else (another section, a new tab, a modified click)
 * is left to the browser. Installed once, by main.ts, on a broadcast load.
 */
export function installBroadcastNavigation(root: HTMLElement): void {
  if (routerRoot) return;
  routerRoot = root;
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a[href]');
    if (!(link instanceof HTMLAnchorElement)) return;
    if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (!broadcastPageForPath(url.pathname)) return;
    event.preventDefault();
    navigateBroadcast(`${url.pathname}${url.search}${url.hash}`);
  });
  window.addEventListener('popstate', () => {
    const page = broadcastPageForPath(window.location.pathname);
    if (page) {
      void swapBroadcastPage(page);
    } else if (pushedInPlace) {
      // Back past the first broadcast page to another section: that page was
      // never mounted here, so load it.
      window.location.reload();
    }
  });
}

/** Open a broadcast path in place when the router is installed, else load it. */
export function navigateBroadcast(href: string): void {
  const url = new URL(href, window.location.href);
  const page = routerRoot ? broadcastPageForPath(url.pathname) : null;
  if (!page) {
    window.location.assign(href);
    return;
  }
  if (`${url.pathname}${url.search}` === `${window.location.pathname}${window.location.search}`) {
    return;
  }
  window.history.pushState({ broadcast: true }, '', `${url.pathname}${url.search}${url.hash}`);
  pushedInPlace = true;
  window.scrollTo(0, 0);
  void swapBroadcastPage(page);
}

async function swapBroadcastPage(page: BroadcastPage): Promise<void> {
  if (!routerRoot) return;
  // A page load counts one pageview (main.ts); a swap is a page too.
  track('$pageview', { path: window.location.pathname });
  await page(routerRoot);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) throw new Error(t('broadcast.notFound'));
    throw new Error(`Broadcast API failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

// These counts render as bare English on surfaces the catalog does not cover,
// so "1 boards" reaches the page. Chinese needs no plural form, which is why
// only the English catalog entry gains a singular sibling.
function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function renderError(root: HTMLElement, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  root.replaceChildren(buildNav(), buildNotice(t('broadcast.unavailable'), message));
}

function connectRoundStream(
  tourSlug: string,
  roundId: string,
  initialVersion: string,
  onRound: (data: BroadcastRoundResponse) => void,
): void {
  if (!('EventSource' in window)) return;
  const source = new EventSource(
    `/api/xiangqi/broadcasts/${encodeURIComponent(tourSlug)}/rounds/${encodeURIComponent(
      roundId,
    )}/events`,
  );
  let lastVersion = initialVersion;
  source.addEventListener('round', (event) => {
    const envelope = parseStreamEnvelope<BroadcastRoundResponse>(event);
    if (!envelope || envelope.version === lastVersion) return;
    lastVersion = envelope.version;
    onRound(envelope.payload);
  });
  closeStreamOnPageExit(source);
}

function connectBoardStream(
  boardId: string,
  initialVersion: string,
  initialPlyCount: number,
  onBoard: (data: BroadcastBoardResponse, animateHeadAdvance: boolean) => void,
): void {
  if (!('EventSource' in window)) return;
  const source = new EventSource(
    `/api/xiangqi/broadcasts/boards/${encodeURIComponent(boardId)}/events`,
  );
  let lastVersion = initialVersion;
  let lastPlyCount = initialPlyCount;
  source.addEventListener('board', (event) => {
    const envelope = parseStreamEnvelope<BroadcastBoardResponse>(event);
    if (!envelope || envelope.version === lastVersion) return;
    lastVersion = envelope.version;
    // Head-advance glide: only when the viewer was AT the head (a head cursor
    // keeps the URL free of ?ply, see renderCursor) and this update appended a
    // new ply. A scrubbed-back viewer re-renders discretely at their ply.
    const nextPlyCount = envelope.payload.timeline.length;
    const headAdvance =
      nextPlyCount > lastPlyCount && !new URLSearchParams(window.location.search).get('ply');
    lastPlyCount = nextPlyCount;
    onBoard(envelope.payload, headAdvance);
  });
  closeStreamOnPageExit(source);
}

function closeStreamOnPageExit(source: EventSource): void {
  window.addEventListener('pagehide', () => source.close(), { once: true });
  // The page swapped in place: this stream belongs to the page that left.
  const signal = currentPageSignal();
  if (signal?.aborted) source.close();
  else signal?.addEventListener('abort', () => source.close(), { once: true });
}

function installBroadcastAppearanceRefresh(paint: () => void): void {
  const signal = currentPageSignal();
  if (signal?.aborted) return;
  const options = signal ? { signal } : undefined;
  window.addEventListener(xiangqiNotationChangedEvent, () => paint(), options);
  window.addEventListener(xiangqiAppearanceChangedEvent, paint, options);
  window.addEventListener(
    'pagehide',
    () => window.removeEventListener(xiangqiAppearanceChangedEvent, paint),
    { once: true },
  );
}

function parseStreamEnvelope<T>(event: Event): BroadcastStreamEnvelope<T> | null {
  if (!(event instanceof MessageEvent)) return null;
  try {
    return JSON.parse(event.data) as BroadcastStreamEnvelope<T>;
  } catch {
    return null;
  }
}

// Two zones: tours with a live board first, everything else below. Each zone
// is a card grid with a featured-board thumbnail per tour.
// lichess's broadcast index: the section rail on the left, and in a centred
// panel the featured event (live, else the latest), then live, upcoming and
// past events, and the next few events on the calendar.
function renderIndex(
  data: BroadcastIndexResponse,
  calendar: BroadcastCalendarResponse | null,
): HTMLElement {
  const heading = document.createElement('h1');
  heading.className = 'xqb-section-title';
  heading.textContent = t('broadcast.tournamentBroadcasts');

  const now = Date.now();
  const live = data.tours.filter((entry) => entry.liveBoardCount > 0);
  const upcoming = data.tours.filter(
    (entry) => entry.liveBoardCount === 0 && isAfter(entry.tour.startsAt, now),
  );
  // Started but not over, with no board moving right now (the women's league
  // between rounds): ongoing, not past.
  const started = data.tours.filter(
    (entry) => entry.liveBoardCount === 0 && !isAfter(entry.tour.startsAt, now),
  );
  const ongoing = started.filter((entry) => isAfter(entry.tour.endsAt, now));
  const past = started.filter((entry) => !isAfter(entry.tour.endsAt, now));
  const featured =
    sortByFreshness(live)[0] ??
    sortByEventDate(ongoing)[0] ??
    [...upcoming].sort((a, b) => dateMs(a.tour.startsAt) - dateMs(b.tour.startsAt))[0] ??
    sortByEventDate(past)[0] ??
    null;
  const without = (entries: BroadcastIndexEntry[]) => entries.filter((entry) => entry !== featured);

  const content: HTMLElement[] = [heading];
  if (featured) content.push(featuredTourCard(featured));
  if (without(live).length > 0) {
    content.push(tourZone(t('broadcast.liveNow'), sortByFreshness(without(live)), true));
  }
  if (without(ongoing).length > 0) {
    content.push(tourZone(t('broadcast.ongoing'), sortByEventDate(without(ongoing)), false));
  }
  const comingUp = comingUpSection(calendar, data.tours);
  if (comingUp) content.push(comingUp);
  if (without(upcoming).length > 0) {
    content.push(tourZone(t('broadcast.upcoming'), without(upcoming), false));
  }
  if (without(past).length > 0) {
    content.push(tourZone(t('broadcast.past'), sortByEventDate(without(past)), false));
  }
  if (data.tours.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'xqb-empty';
    empty.textContent = t('broadcast.noneAvailable');
    content.push(empty);
  }
  return broadcastSectionLayout('broadcasts', ...content);
}

function dateMs(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function isAfter(value: string | null | undefined, now: number): boolean {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) && ms > now;
}

/**
 * The card's status line, lichess's "Round 8 · in 11 hours": live, else the
 * next seeded round, else a start date still ahead, else the latest round
 * with games and when it was played. Never our import time.
 */
function tourStatusLine(entry: BroadcastIndexEntry): { text: string; live: boolean } | null {
  const latest = entry.latestRound ?? null;
  if (entry.liveBoardCount > 0) {
    const round = latest ? primaryName(latest) : null;
    return {
      text: round ? t('broadcast.roundLive', { round }) : t('broadcast.statusLive'),
      live: true,
    };
  }
  const next = entry.nextRound ?? null;
  if (next?.startsAt) {
    return {
      text: t('broadcast.roundOn', {
        round: primaryName(next),
        date: formatEventDay(next.startsAt) ?? '',
      }),
      live: false,
    };
  }
  if (isAfter(entry.tour.startsAt, Date.now())) {
    return {
      text: t('broadcast.startsOn', { date: formatEventDay(entry.tour.startsAt) ?? '' }),
      live: false,
    };
  }
  if (latest) {
    const date = formatEventDay(latest.startsAt ?? undefined);
    return {
      text: date
        ? t('broadcast.roundOn', { round: primaryName(latest), date })
        : primaryName(latest),
      live: false,
    };
  }
  return null;
}

function statusLineEl(entry: BroadcastIndexEntry): HTMLElement | null {
  const status = tourStatusLine(entry);
  if (!status) return null;
  const el = document.createElement('span');
  el.className = status.live ? 'xqb-tour-status xqb-tour-status-live' : 'xqb-tour-status';
  el.textContent = status.text;
  return el;
}

function topPlayersEl(entry: BroadcastIndexEntry, count: number): HTMLElement | null {
  const names = topBroadcastPlayers(entry.players ?? [], count);
  if (names.length === 0) return null;
  const el = document.createElement('span');
  el.className = 'xqb-tour-players';
  el.textContent = names.join(', ');
  return el;
}

/** The featured event, large: the board beside the event, lichess's hero card. */
function featuredTourCard(entry: BroadcastIndexEntry): HTMLElement {
  const card = tourCard(entry, { featured: true });
  return card;
}

/** The next few events on the calendar that we do not have a page for yet. */
function comingUpSection(
  calendar: BroadcastCalendarResponse | null,
  tours: readonly BroadcastIndexEntry[],
): HTMLElement | null {
  if (!calendar) return null;
  const relayed = new Set(tours.map((entry) => entry.tour.slug));
  const events = calendar.events
    .filter(
      (event) => event.status !== 'finished' && !(event.tourSlug && relayed.has(event.tourSlug)),
    )
    .slice(0, 4);
  if (events.length === 0) return null;
  const section = document.createElement('section');
  section.className = 'xqb-section xqb-coming-up';
  const head = document.createElement('div');
  head.className = 'xqb-coming-up-head';
  const title = document.createElement('h2');
  title.textContent = t('broadcast.comingUp');
  const all = document.createElement('a');
  all.className = 'xqb-link';
  all.href = '/broadcast/xiangqi/calendar';
  all.textContent = t('broadcast.fullCalendar');
  head.append(title, all);
  const list = document.createElement('ul');
  list.className = 'xqb-cal-list';
  for (const event of events) list.append(calendarEventRow(event));
  section.append(head, list);
  return section;
}

function sortByFreshness(entries: BroadcastIndexEntry[]): BroadcastIndexEntry[] {
  return [...entries].sort(
    (a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0),
  );
}

/** Newest event first, by when it started; an undated one last. Past events
 *  were sorted by their last sync, so a backfilled spring event sat above
 *  September's. */
function sortByEventDate(entries: BroadcastIndexEntry[]): BroadcastIndexEntry[] {
  const at = (entry: BroadcastIndexEntry): number => {
    const ms = entry.tour.startsAt ? Date.parse(entry.tour.startsAt) : Number.NaN;
    return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
  };
  return [...entries].sort((a, b) => at(b) - at(a));
}

function tourZone(title: string, entries: BroadcastIndexEntry[], liveZone: boolean): HTMLElement {
  const section = document.createElement('section');
  section.className = liveZone ? 'xqb-section xqb-zone-live' : 'xqb-section';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'xqb-tour-grid';
  for (const entry of entries) grid.append(tourCard(entry));
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'xqb-empty';
    empty.textContent = t('broadcast.noneAvailable');
    grid.append(empty);
  }
  section.append(heading, grid);
  return section;
}

// The event page: one hero for the tour, a round selector, and the three tabs
// lichess gives a broadcast (Boards, Overview, Players). Boards is the default
// because a visitor who lands here from a link wants to see games, and the old
// tour page made them click into a round before it showed one.
function renderEvent(
  data: BroadcastRoundResponse,
  cards: BoardCardCache | undefined,
  state: EventPageState,
): HTMLElement {
  const hasRound = data.round.id !== '';
  document.title = hasRound
    ? `${primaryName(data.round)} · ${primaryName(data.tour)} · Mistboard`
    : `${primaryName(data.tour)} · Mistboard`;
  let body: HTMLElement;
  if (state.tab === 'overview') body = renderOverviewTab(data, state);
  else if (state.tab === 'players') body = renderPlayersTab(data, state);
  else if (state.tab === 'teams' && isTeamEvent(data)) body = renderTeamsTab(data, state);
  else body = renderBoardsTab(data, cards, state);
  return renderEventShell(data, state, body, '');
}

// A team event is one whose games form team matches: the league names its
// matches, a team championship's are the pairs of teams its games state.
function isTeamEvent(data: BroadcastRoundResponse): boolean {
  return (groupRoundByMatch(data.boards, leagueRulesFor(data.tour))?.matches.length ?? 0) > 0;
}

/** Which event page a shell shows: a later page for the same round keeps it. */
function roundKey(data: { tour: { slug: string }; round: { id: string } }): string {
  return `${data.tour.slug}/${data.round.id}`;
}

function roundHref(tourSlug: string, roundId: string, tab: EventTab = 'boards'): string {
  const base = `/broadcast/xiangqi/${encodeURIComponent(tourSlug)}/round/${encodeURIComponent(roundId)}`;
  return tab === 'boards' ? base : `${base}?tab=${tab}`;
}

/**
 * The event page around whatever the content column shows: the header, the
 * section tabs and the round's game list. The boards grid, the other tabs and
 * an open board all render inside it, so moving between them changes the
 * content column and nothing else (lichess's relay: a board replaces the
 * right three quarters of the page). `body` is moved in, not rebuilt, so a
 * repaint of the header or the list keeps a mounted board as it is.
 */
function renderEventShell(
  data: BroadcastRoundResponse,
  state: EventPageState,
  body: HTMLElement,
  currentBoardId: string,
): HTMLElement {
  const hasRound = data.round.id !== '';
  const boardOpen = currentBoardId !== '';
  const main = broadcastShell();
  main.classList.add('xqb-event');
  if (boardOpen) main.classList.add('xqb-event-board-open');
  main.dataset.roundKey = roundKey(data);

  const layout = document.createElement('div');
  layout.className = 'xqb-event-layout';
  applyStoredToggles(layout);
  const content = document.createElement('section');
  content.className = 'xqb-section xqb-event-content';
  body.classList.add('xqb-event-body');
  // An open board takes the whole column, header and tabs included, so it
  // fills the height of the screen; the game list's back arrow returns.
  if (boardOpen) content.append(body);
  else content.append(eventHeader(data), eventTabs(data, state), body);
  layout.append(content);
  // The round's pairings, lichess's left column: scan the round without the
  // thumbnails, and jump straight to a board from any tab. The same list on
  // every page of the round, the open board marked.
  const rail = hasRound ? sideRail(data, currentBoardId) : null;
  if (rail) {
    layout.classList.add('xqb-event-layout-with-rail');
    // The list and the event's chat room, lichess's left column. It never
    // moves while the page scrolls: pinned where it first sits, it fills the
    // height below that, the list taking what the chat leaves.
    const side = document.createElement('div');
    side.className = 'xqb-event-side';
    side.append(rail, eventChat(data.tour.slug));
    layout.append(side);
    pinEventSide(side);
  }
  main.append(layout);
  return main;
}

// One chat panel per event, reused across repaints and in-place moves between
// the event's pages, so its lines, its scroll and a half-typed message
// survive them. A panel that has been detached (a loading screen replaced the
// page) has stopped its polling, so it is rebuilt instead.
let eventChatPanel: { slug: string; el: HTMLElement } | null = null;

function eventChat(slug: string): HTMLElement {
  if (eventChatPanel?.slug === slug && eventChatPanel.el.isConnected) return eventChatPanel.el;
  const wrap = document.createElement('div');
  wrap.className = 'xqb-event-chat';
  wrap.append(buildBroadcastChat(slug));
  eventChatPanel = { slug, el: wrap };
  return wrap;
}

// Sticky at the offset it sits at before any scroll, so it stays exactly
// there instead of riding up to the top edge and then stopping. Measured once
// the shell is on the page: the offset is the site nav and the page padding.
// Read off the grid it sits in, never the column itself: a sticky element
// reports where it is stuck, so measuring it on a page that is already
// scrolled (a restored scroll, a repaint mid-scroll) pinned it far down the
// page, and on prod it sat 1,645px from the top.
function pinEventSide(side: HTMLElement): void {
  const pin = (): void => {
    const layout = side.parentElement;
    if (!side.isConnected || !layout) return;
    const top = Math.max(0, Math.round(layout.getBoundingClientRect().top + window.scrollY));
    side.style.setProperty('--xqb-side-top', `${top}px`);
  };
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(pin);
  else pin();
}

// The event's header, at the top of the content column beside the game list
// (lichess's relay): the name, one line of facts, the round and the source.
// One line of facts rather than an eyebrow, a subtitle and a meta row, so the
// boards start near the top of the screen.
function eventHeader(data: BroadcastRoundResponse): HTMLElement {
  const rounds = data.rounds ?? [];
  const liveCount = data.boards.filter((board) => board.status === 'live').length;
  // No Source button: the records credit under the boards and the Overview
  // tab name the source, and the header keeps to what lichess's does.
  const header = heroSection({
    eyebrow: '',
    title: primaryName(data.tour),
    meta: [
      secondaryName(data.tour),
      data.tour.location,
      formatEventDateRange(data.tour.startsAt, data.tour.endsAt),
      countLabel(rounds.length, 'round', 'rounds'),
      liveCount > 0 ? `${liveCount} live` : null,
    ].filter(Boolean) as string[],
    switcher: data.round.id !== '' ? roundSwitcher(data.tour.slug, rounds, data.round.id) : null,
  });
  header.classList.add('xqb-event-header');
  // lichess's banner on the header's right.
  header.append(eventArt(data.tour));
  return header;
}

// A placeholder for an event's art (lichess shows the broadcaster's image):
// the event's Chinese name large over a faint board, the English name, the
// city and the year, in one of a few inks picked from the event's slug so
// events tell apart. Drawn in HTML and CSS, so there is no file to host and
// no right to clear; real art replaces it where it sits.
const EVENT_ART_INKS = ['#a63328', '#237960', '#3b4f8f', '#9a6419', '#7a3b69'] as const;

function eventArt(tour: {
  slug: string;
  name: string;
  nameEn?: string;
  location?: string;
  startsAt?: string;
}): HTMLElement {
  const art = document.createElement('div');
  art.className = 'xqb-event-art';
  art.setAttribute('aria-hidden', 'true');
  let hash = 0;
  for (const char of tour.slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  art.style.setProperty('--xqb-art-ink', EVENT_ART_INKS[hash % EVENT_ART_INKS.length]!);
  const year = tour.startsAt?.slice(0, 4) ?? tour.name.match(/^(\d{4})/)?.[1] ?? null;
  const zh = document.createElement('span');
  zh.className = 'xqb-event-art-zh';
  zh.textContent = tour.name.replace(/^\d{4}\s*年?/, '');
  art.append(zh);
  if (tour.nameEn) {
    const en = document.createElement('span');
    en.className = 'xqb-event-art-en';
    en.textContent = tour.nameEn.replace(/^\d{4}\s*/, '');
    art.append(en);
  }
  const meta = [tour.location, year].filter(Boolean).join(' · ');
  if (meta) {
    const line = document.createElement('span');
    line.className = 'xqb-event-art-meta';
    line.textContent = meta;
    art.append(line);
  }
  return art;
}

function eventTabs(data: BroadcastRoundResponse, state: EventPageState): HTMLElement {
  // A team event gets a Teams tab: the league table is the story of 象甲, and
  // the Players tab alone reads it as individuals.
  const teamEvent = isTeamEvent(data);
  const tab = state.tab === 'teams' && !teamEvent ? 'boards' : (state.tab ?? 'boards');
  const tabs = document.createElement('nav');
  tabs.className = 'xqb-tabs';
  tabs.setAttribute('aria-label', t('broadcast.eventSections'));
  // lichess's order: Overview first. Boards stays the tab an event opens on.
  const tabDefs: Array<{ id: EventTab; label: string }> = [
    { id: 'overview', label: t('broadcast.overview') },
    { id: 'boards', label: t('broadcast.boards') },
    ...(teamEvent ? [{ id: 'teams' as const, label: t('broadcast.teams') }] : []),
    { id: 'players', label: t('broadcast.players') },
  ];
  for (const def of tabDefs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = def.id === tab ? 'xqb-tab xqb-tab-active' : 'xqb-tab';
    button.textContent = def.label;
    button.setAttribute('aria-selected', def.id === tab ? 'true' : 'false');
    button.addEventListener('click', () => state.setTab?.(def.id));
    tabs.append(button);
  }
  return tabs;
}

function renderBoardsTab(
  data: BroadcastRoundResponse,
  cards?: BoardCardCache,
  state?: EventPageState,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'xqb-tab-panel';
  if (data.round.id === '') {
    wrap.append(emptyState(t('broadcast.noRoundsYet')));
    return wrap;
  }
  const liveCount = data.boards.filter((board) => board.status === 'live').length;
  // No round heading: the round is named in the header's switcher and at the
  // top of the game list. Its facts and the toggles share one line (lichess's
  // boards bar), so the grid starts right under the tabs.
  const head = document.createElement('div');
  head.className = 'xqb-boards-head';
  const meta = document.createElement('p');
  meta.className = 'xqb-round-meta';
  meta.textContent = [
    formatEventDateTime(roundPlayedAt(data.boards) ?? data.round.startsAt),
    countLabel(data.boards.length, 'board', 'boards'),
    liveCount > 0 ? `${liveCount} live` : null,
  ]
    .filter(Boolean)
    .join(' / ');
  head.append(meta);
  wrap.append(head);

  if (data.boards.length === 0) {
    // Records for a dpxq-relayed round arrive when the operator uploads them,
    // which is after the round and on no fixed delay; say so rather than show
    // a bare zero, and point at where they will come from.
    const empty = emptyState(
      // "Not started" only for a round dated in the future: an undated round
      // of a running event may well have been played already.
      roundPhase(roundStatsFor(data)) === 'upcoming' &&
        data.round.startsAt !== undefined &&
        !roundHasStarted(data.round)
        ? t('broadcast.roundNotStarted')
        : t('broadcast.noGamesYet'),
    );
    const source = broadcastSourcePageHref(data.round.sourceUrl ?? data.tour.sourceUrl);
    if (source) {
      const link = document.createElement('a');
      link.className = 'xqb-link';
      link.href = source;
      link.rel = 'noreferrer';
      link.textContent = t('broadcast.checkSource');
      empty.append(link);
    }
    wrap.append(empty);
    return wrap;
  }

  // Only once the round is over: while it is running, freshness is the more
  // useful thing in that slot and the round date is the same on every card.
  const roundPlayedOn = data.boards.every((board) => board.status !== 'live')
    ? formatEventDay(roundPlayedAt(data.boards) ?? data.round.startsAt)
    : null;
  head.prepend(boardsToolbar(wrap, data.boards));
  // Playing with nothing live: say so rather than show an empty page.
  if (!data.boards.some((board) => board.status === 'live')) {
    const none = document.createElement('p');
    none.className = 'xqb-empty xqb-live-empty';
    none.textContent = t('broadcast.noLiveGames');
    wrap.append(none);
  }
  // Live boards lead the grid; within a status band the pairing order holds.
  const boards = [...data.boards].sort(
    (a, b) =>
      Number(a.status !== 'live') - Number(b.status !== 'live') || a.boardNumber - b.boardNumber,
  );
  const grid = (list: readonly BroadcastBoardSummary[]): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'xqb-board-grid';
    for (const board of list) el.append(boardCardFor(board, cards, roundPlayedOn));
    return el;
  };
  // A team league round is one grid too, lichess's: each match's games stay
  // together (its tables, slow then blitz), and a team filter narrows the
  // grid to one team. The matches and their scores are the Teams tab's.
  // The pager row (lichess's): page buttons, the team filter, the page size.
  const nav = document.createElement('div');
  nav.className = 'xqb-boards-nav';
  head.before(nav);
  let list: BroadcastBoardSummary[] = boards;
  const byMatch = groupRoundByMatch(boards, leagueRulesFor(data.tour));
  if (byMatch) {
    const team = state?.team ?? null;
    const matches = team
      ? byMatch.matches.filter((match) => match.teams.some((side) => side.name === team))
      : byMatch.matches;
    nav.append(teamFilter(byMatch.matches, team, state));
    // The filtered team's match heads its games, so its score is on screen.
    for (const match of team ? matches : []) wrap.append(matchSummary(match));
    const ordered = [
      ...matches.flatMap((match) => matchBoards(match)),
      ...(team ? [] : byMatch.other),
    ];
    // Live games still lead, the match order held within each band.
    ordered.sort((a, b) => Number(a.status !== 'live') - Number(b.status !== 'live'));
    list = ordered;
  }
  // lichess's pages: a pager, then the page's boards; the page size is the
  // reader's and persists. Sizes are rows of four, so a page ends on a full row.
  const perPage = readBoardsPerPage();
  const pageCount = perPage ? Math.max(1, Math.ceil(list.length / perPage)) : 1;
  const page = Math.min(Math.max(0, state?.page ?? 0), pageCount - 1);
  const shown = perPage ? list.slice(page * perPage, (page + 1) * perPage) : list;
  nav.prepend(boardsPager(page, pageCount, list.length, perPage, state));
  nav.append(perPageSelect(perPage, state));
  wrap.append(grid(shown));

  // Boards that left the round entirely must not pin their cards in memory.
  if (cards) {
    const live = new Set(boards.map((board) => board.id));
    for (const id of [...cards.keys()]) if (!live.has(id)) cards.delete(id);
  }
  const credit = recordsCreditLine(data.boards);
  if (credit) wrap.append(credit);
  return wrap;
}

// lichess's board toolbar: Playing (live games only), Results (off hides
// every score, so a round can be watched later without spoilers), and the
// Evaluation gauge. Each is one class on the panel, remembered per browser,
// so flipping one rebuilds no card.
type BoardsToggle = {
  key: string;
  /** The panel class that applies when the toggle is in its non-default state. */
  offClass: string;
  label: Parameters<typeof t>[0];
  /** Checked means the default (results shown, gauges shown, all games). */
  defaultOn: boolean;
};

const BOARDS_TOGGLES: readonly BoardsToggle[] = [
  {
    key: 'mistboard.broadcast.liveOnly',
    offClass: 'xqb-live-only',
    label: 'broadcast.playing',
    defaultOn: false,
  },
  {
    key: 'mistboard.broadcast.results',
    offClass: 'xqb-results-off',
    label: 'broadcast.results',
    defaultOn: true,
  },
  {
    key: 'mistboard.broadcast.evalGauge',
    offClass: 'xqb-gauges-off',
    label: 'broadcast.evalGauge',
    defaultOn: true,
  },
];

function readToggle(toggle: BoardsToggle): boolean {
  try {
    const stored = window.localStorage.getItem(toggle.key);
    return stored === null ? toggle.defaultOn : stored === 'on';
  } catch {
    return toggle.defaultOn;
  }
}

function applyToggle(panel: HTMLElement, toggle: BoardsToggle, on: boolean): void {
  // Playing is the one that adds a filter when ON; the other two remove
  // something when OFF.
  const active = toggle.defaultOn ? !on : on;
  panel.classList.toggle(toggle.offClass, active);
}

function boardsToolbar(panel: HTMLElement, boards: readonly BroadcastBoardSummary[]): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'xqb-boards-toolbar';
  const hasEval = boards.some((board) => board.evaluation);
  for (const toggle of BOARDS_TOGGLES) {
    if (toggle.offClass === 'xqb-gauges-off' && !hasEval) continue;
    const on = readToggle(toggle);
    applyToggle(panel, toggle, on);
    const label = document.createElement('label');
    label.className = 'xqb-gauge-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = on;
    input.addEventListener('change', () => {
      // The event layout, so the left list's scores follow the Results toggle.
      applyToggle(toggleTarget(panel), toggle, input.checked);
      try {
        window.localStorage.setItem(toggle.key, input.checked ? 'on' : 'off');
      } catch {
        // Storage refused (private mode): the toggle still works for this view.
      }
    });
    label.append(input, document.createTextNode(` ${t(toggle.label)}`));
    bar.append(label);
  }
  return bar;
}

function toggleTarget(panel: HTMLElement): HTMLElement {
  return panel.closest<HTMLElement>('.xqb-event-layout') ?? panel;
}

/** The stored toggles, applied to the event layout at render. */
function applyStoredToggles(target: HTMLElement): void {
  for (const toggle of BOARDS_TOGGLES) applyToggle(target, toggle, readToggle(toggle));
}

/** When a round was played, from its games: the earliest start a game states.
 *  The seeded schedule is a guess made before the event (the 2026 league was
 *  seeded one round a day at 14:30; it played two a day, 13:00 and 19:00), so
 *  the games' own dates win whenever they carry one. */
function roundPlayedAt(boards: readonly BroadcastBoardSummary[]): string | undefined {
  let earliest: string | undefined;
  for (const board of boards) {
    const at = board.details?.playedAt;
    if (at && (!earliest || Date.parse(at) < Date.parse(earliest))) earliest = at;
  }
  return earliest;
}

// One match's line: the two teams and the score, the match name, the slow and
// blitz split. The Teams tab lists the round's matches this way, and the
// Boards grid heads a filtered team's games with it.
function teamLabel(team: MatchTeam): string {
  return team.nameEn ?? team.name;
}

function matchSummary(match: TeamMatch<BroadcastBoardSummary>): HTMLElement {
  const section = document.createElement('section');
  section.className = 'xqb-match';
  const header = document.createElement('div');
  header.className = 'xqb-match-header';
  const side = (team: MatchTeam, index: 0 | 1): HTMLElement => {
    const el = document.createElement('span');
    el.className = `xqb-match-team${match.winner === index ? ' xqb-match-team-won' : ''}`;
    el.textContent = team.nameEn ?? team.name;
    if (team.nameEn) el.title = team.name;
    return el;
  };
  // Game points, the league's 2 a win and 1 a draw, slow and blitz together:
  // the number that decides the match.
  const score = document.createElement('span');
  score.className = 'xqb-match-score';
  score.textContent = `${formatPoints(match.score[0])} – ${formatPoints(match.score[1])}`;
  header.append(side(match.teams[0], 0), score, side(match.teams[1], 1));
  section.append(header);
  const names = [match.nameEn ? match.nameEn.replace('-', ' vs ') : null, match.name].filter(
    Boolean,
  );
  // What settled it, in words: the score above is the tables' points, and a
  // level match is decided by one more blitz game. The slow and blitz point
  // split this line used to show counted the two games at a table separately
  // and read as a second, different score.
  const winnerName = match.winner === null ? null : teamLabel(match.teams[match.winner]);
  const scores = [
    match.decider && winnerName && (match.format !== 'womens-league' || match.wonOnPlayoff)
      ? t('broadcast.deciderWon', { team: winnerName })
      : null,
    match.deciderDrawn ? t('broadcast.deciderDrawn') : null,
    match.finished && !match.complete ? t('broadcast.recordMissing') : null,
  ].filter(Boolean);
  const subline = document.createElement('p');
  subline.className = 'xqb-match-sub';
  subline.textContent = names.join(' · ');
  // The split is a result too, so the Results toggle hides it with the score.
  if (scores.length > 0) {
    const splitEl = document.createElement('span');
    splitEl.className = 'xqb-match-split';
    splitEl.textContent = ` · ${scores.join(' · ')}`;
    subline.append(splitEl);
  }
  section.append(subline);
  return section;
}

const BOARDS_PER_PAGE_KEY = 'mistboard.broadcast.perPage';
// Rows of four (the grid's widest), lichess's 12 by default.
const BOARDS_PER_PAGE_OPTIONS = [12, 24, 48] as const;
const DEFAULT_BOARDS_PER_PAGE = 12;

/** The reader's page size; 0 is every board on one page. */
function readBoardsPerPage(): number {
  try {
    const raw = window.localStorage.getItem(BOARDS_PER_PAGE_KEY);
    if (raw === 'all') return 0;
    const n = Number(raw);
    if ((BOARDS_PER_PAGE_OPTIONS as readonly number[]).includes(n)) return n;
  } catch {
    // Storage refused (private mode): the default holds.
  }
  return DEFAULT_BOARDS_PER_PAGE;
}

function boardsPager(
  page: number,
  pageCount: number,
  total: number,
  perPage: number,
  state?: EventPageState,
): HTMLElement {
  const pager = document.createElement('div');
  pager.className = 'xqb-pager';
  const button = (label: string, icon: string, target: number, disabled: boolean): void => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'xqb-pager-button';
    el.setAttribute('aria-label', label);
    el.title = label;
    el.innerHTML = icon;
    el.disabled = disabled;
    el.addEventListener('click', () => state?.setPage?.(target));
    pager.append(el);
  };
  const atStart = page === 0;
  const atEnd = page >= pageCount - 1;
  button(t('broadcast.pageFirst'), PAGER_FIRST, 0, atStart);
  button(t('broadcast.pagePrev'), PAGER_PREV, page - 1, atStart);
  const count = document.createElement('span');
  count.className = 'xqb-pager-count';
  const from = total === 0 ? 0 : perPage ? page * perPage + 1 : 1;
  const to = perPage ? Math.min(total, (page + 1) * perPage) : total;
  count.textContent = `${from}-${to} / ${total}`;
  pager.append(count);
  button(t('broadcast.pageNext'), PAGER_NEXT, page + 1, atEnd);
  button(t('broadcast.pageLast'), PAGER_LAST, pageCount - 1, atEnd);
  return pager;
}

function perPageSelect(perPage: number, state?: EventPageState): HTMLElement {
  const select = document.createElement('select');
  select.className = 'xqb-round-select xqb-per-page';
  select.setAttribute('aria-label', t('broadcast.boardsPerPage'));
  for (const n of [...BOARDS_PER_PAGE_OPTIONS, 0]) {
    const option = document.createElement('option');
    option.value = n ? String(n) : 'all';
    option.textContent = n ? t('broadcast.perPage', { n }) : t('broadcast.allOnOnePage');
    option.selected = n === perPage;
    select.append(option);
  }
  select.addEventListener('change', () => {
    try {
      window.localStorage.setItem(BOARDS_PER_PAGE_KEY, select.value);
    } catch {
      // Storage refused: the choice holds for this view only.
    }
    state?.setPage?.(0);
  });
  return select;
}

const PAGER_ATTRS =
  'viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"';
const PAGER_FIRST = `<svg ${PAGER_ATTRS}><path d="M6 5h2v14H6zM19 5v14l-9-7z"/></svg>`;
const PAGER_PREV = `<svg ${PAGER_ATTRS}><path d="M7 5h2v14H7zM18 5v14l-8-7z"/></svg>`;
const PAGER_NEXT = `<svg ${PAGER_ATTRS}><path d="M15 5h2v14h-2zM6 5v14l8-7z"/></svg>`;
const PAGER_LAST = `<svg ${PAGER_ATTRS}><path d="M16 5h2v14h-2zM5 5v14l9-7z"/></svg>`;

// lichess's "All teams" select above a team event's boards.
function teamFilter(
  matches: readonly TeamMatch<BroadcastBoardSummary>[],
  team: string | null,
  state?: EventPageState,
): HTMLElement {
  const select = document.createElement('select');
  select.className = 'xqb-round-select xqb-team-filter';
  select.setAttribute('aria-label', t('broadcast.teamFilter'));
  const all = document.createElement('option');
  all.value = '';
  all.textContent = t('broadcast.allTeams');
  select.append(all);
  const teams = matches
    .flatMap((match) => match.teams)
    .sort((a, b) => (a.nameEn ?? a.name).localeCompare(b.nameEn ?? b.name));
  for (const side of teams) {
    const option = document.createElement('option');
    option.value = side.name;
    option.textContent = side.nameEn ?? side.name;
    option.selected = side.name === team;
    select.append(option);
  }
  select.addEventListener('change', () => state?.setTeam?.(select.value || null));
  return select;
}

function renderTeamsTab(data: BroadcastRoundResponse, state: EventPageState): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'xqb-tab-panel';
  // The round's matches first (the fixtures a round is made of), each with a
  // way to its games, then the league table they add up to.
  const byMatch = groupRoundByMatch(data.boards, leagueRulesFor(data.tour));
  if (byMatch && byMatch.matches.length > 0) {
    const heading = document.createElement('h3');
    heading.className = 'xqb-teams-heading';
    heading.textContent = t('broadcast.roundMatches');
    const list = document.createElement('div');
    list.className = 'xqb-match-list';
    for (const match of byMatch.matches) {
      const row = matchSummary(match);
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'xqb-match-open';
      open.textContent = t('broadcast.matchBoards');
      open.addEventListener('click', () => {
        state.team = match.teams[0].name;
        state.page = 0;
        state.setTab?.('boards');
      });
      row.append(open);
      list.append(row);
    }
    const tableHeading = document.createElement('h3');
    tableHeading.className = 'xqb-teams-heading';
    tableHeading.textContent = t('broadcast.leagueTable');
    wrap.append(heading, list, tableHeading);
  }
  const note = document.createElement('p');
  note.className = 'xqb-note';
  const format = matchFormatOf(data.boards, leagueRulesFor(data.tour));
  note.textContent =
    format === 'championship'
      ? t('broadcast.teamsNoteChampionship')
      : format === 'womens-league' || leagueRulesFor(data.tour) === 'womens-league'
        ? t('broadcast.teamsNoteWomensLeague')
        : t('broadcast.teamsNote');
  wrap.append(note);
  if (state.standingsBoards === null) {
    wrap.append(emptyState(t('broadcast.loadingStandings')));
    return wrap;
  }
  const rows = teamStandings(
    [...(state.standingsBoards ?? []), ...data.boards],
    leagueRulesFor(data.tour),
  );
  if (rows.length === 0) {
    wrap.append(emptyState(t('broadcast.noGamesYet')));
    return wrap;
  }
  const table = document.createElement('table');
  table.className = 'xqb-standings';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of [
    '#',
    t('broadcast.team'),
    t('broadcast.matches'),
    t('broadcast.winsDrawsLosses'),
    t('broadcast.matchPoints'),
    t('broadcast.gamePoints'),
  ]) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    const rank = document.createElement('td');
    rank.className = 'xqb-standings-rank';
    rank.textContent = String(index + 1);
    const team = document.createElement('td');
    team.className = 'xqb-standings-player';
    const name = document.createElement('strong');
    name.textContent = row.team.nameEn ?? row.team.name;
    team.append(name);
    if (row.team.nameEn) {
      const zh = document.createElement('span');
      zh.className = 'xqb-standings-sub';
      zh.textContent = row.team.name;
      team.append(zh);
    }
    const matches = document.createElement('td');
    matches.textContent = String(row.matches);
    const wdl = document.createElement('td');
    wdl.textContent = `${row.wins}-${row.draws}-${row.losses}`;
    const matchPoints = document.createElement('td');
    matchPoints.className = 'xqb-standings-score';
    matchPoints.textContent = formatPoints(row.matchPoints);
    const gamePoints = document.createElement('td');
    gamePoints.textContent = formatPoints(row.gamePoints);
    tr.append(rank, team, matches, wdl, matchPoints, gamePoints);
    body.append(tr);
  });
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

function roundStatsFor(data: BroadcastRoundResponse): Partial<BroadcastRoundStats> {
  return {
    boardCount: data.boards.length,
    liveBoardCount: data.boards.filter((board) => board.status === 'live').length,
    completeBoardCount: data.boards.filter((board) => board.status === 'complete').length,
    scheduledBoardCount: data.boards.filter((board) => board.status === 'scheduled').length,
  };
}

function roundHasStarted(round: XiangqiBroadcastRound): boolean {
  if (!round.startsAt) return false;
  const at = new Date(round.startsAt).getTime();
  return Number.isFinite(at) && at <= Date.now();
}

function emptyState(text: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'xqb-empty';
  const copy = document.createElement('p');
  copy.textContent = text;
  box.append(copy);
  return box;
}

// Overview: the facts lichess puts in its header strip (dates, venue, format,
// source) plus the schedule, which is where the old tour page's round list
// went. The share block is the tour URL and the round URL, copyable.
function renderOverviewTab(data: BroadcastRoundResponse, state?: EventPageState): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'xqb-tab-panel';
  // lichess's overview: one strip of the event's facts and its links, then the
  // share box. The schedule is the round select's, and the facts no longer sit
  // in a table of labels.
  const strip = document.createElement('div');
  strip.className = 'xqb-overview-strip';
  const item = (icon: string, text: string | null): void => {
    if (!text) return;
    const el = document.createElement('span');
    el.className = 'xqb-overview-item';
    const glyph = document.createElement('span');
    glyph.className = 'xqb-overview-icon';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = icon;
    el.append(glyph, text);
    strip.append(el);
  };
  const clock = formatEventOffset(data.round.startsAt ?? data.tour.startsAt);
  item(
    ICON_CALENDAR,
    [formatEventDateRange(data.tour.startsAt, data.tour.endsAt), clock ? `(${clock})` : null]
      .filter(Boolean)
      .join(' '),
  );
  const rounds = data.rounds ?? [];
  const teamEvent = isTeamEvent(data);
  item(
    ICON_TROPHY,
    [
      teamEvent ? t('broadcast.teamLeague') : null,
      rounds.length > 0 ? countLabel(rounds.length, 'round', 'rounds') : null,
    ]
      .filter(Boolean)
      .join(' · ') || null,
  );
  item(ICON_CLOCK, eventTimeControls(data.boards));
  item(ICON_PIN, data.tour.location ?? null);
  const source = broadcastSourcePageHref(data.tour.sourceUrl);
  if (source) {
    const link = document.createElement('a');
    link.className = 'xqb-overview-link';
    link.href = source;
    link.rel = 'noreferrer';
    link.textContent = t('broadcast.source');
    strip.append(link);
  }
  if (rounds.length > 0) {
    const standings = document.createElement('button');
    standings.type = 'button';
    standings.className = 'xqb-overview-link';
    standings.textContent = t('broadcast.standingsLink');
    standings.addEventListener('click', () => state?.setTab?.(teamEvent ? 'teams' : 'players'));
    strip.append(standings);
  }
  wrap.append(strip);
  if (eventHasNoGames(data)) {
    // Before the first record: how the event is played, when we know its
    // rules, and when its games will appear.
    const note = document.createElement('div');
    note.className = 'xqb-overview-pending';
    if (leagueRulesFor(data.tour) === 'womens-league') {
      const format = document.createElement('p');
      format.textContent = t('broadcast.formatWomensLeague');
      note.append(format);
    }
    const when = document.createElement('p');
    when.className = 'xqb-note';
    when.textContent = t('broadcast.noGamesInEvent');
    note.append(when);
    wrap.append(note);
  }

  const share = document.createElement('details');
  share.className = 'xqb-share xqb-overview-share';
  share.open = true;
  // lichess's share box: its title is a tab on the box's top edge, with a
  // chevron that turns as it opens and closes.
  const summary = document.createElement('summary');
  summary.className = 'xqb-share-tab';
  summary.append(t('broadcast.shareByUrl'));
  const chevron = document.createElement('span');
  chevron.className = 'xqb-share-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = CARET_DOWN;
  summary.append(chevron);
  share.append(summary);
  const origin = window.location.origin;
  share.append(
    shareRow(
      primaryName(data.tour),
      `${origin}/broadcast/xiangqi/${encodeURIComponent(data.tour.slug)}`,
    ),
  );
  if (data.round.id !== '') {
    share.append(
      shareRow(
        `${primaryName(data.tour)} | ${primaryName(data.round)}`,
        `${origin}/broadcast/xiangqi/${encodeURIComponent(data.tour.slug)}/round/${encodeURIComponent(
          data.round.id,
        )}`,
      ),
    );
  }
  const credit = broadcastRecordsCredit(data.boards);
  if (credit) {
    const line = document.createElement('p');
    line.className = 'xqb-records-credit';
    line.append(`${t('broadcast.gameRecords')}: `);
    const link = document.createElement('a');
    link.href = credit.href;
    link.rel = 'noreferrer';
    link.textContent = credit.host;
    line.append(link);
    wrap.append(share, line);
  } else {
    wrap.append(share);
  }
  return wrap;
}

// "40分＋20秒" is dpxq's; lichess writes "90 min + 30 sec / move". A team
// league plays a slow and a blitz game at each table, so it gets both.
function eventTimeControls(boards: readonly BroadcastBoardSummary[]): string | null {
  const format = (raw: string | undefined): string | null => {
    const match = raw?.match(/(\d+)\s*分\s*[＋+]\s*(\d+)\s*秒/);
    return match ? t('broadcast.timeControlMinSec', { m: match[1]!, s: match[2]! }) : null;
  };
  const slow = boards.find(
    (board) => board.details?.kind !== 'blitz' && board.details?.timeControl,
  );
  const blitz = boards.find(
    (board) => board.details?.kind === 'blitz' && board.details?.timeControl,
  );
  const slowText = format(slow?.details?.timeControl);
  const blitzText = format(blitz?.details?.timeControl);
  if (slowText && blitzText) {
    return `${t('broadcast.slow')} ${slowText} · ${t('broadcast.blitz')} ${blitzText}`;
  }
  return slowText ?? blitzText;
}

const ICON_ATTRS =
  'viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICON_CALENDAR = `<svg ${ICON_ATTRS}><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;
const ICON_TROPHY = `<svg ${ICON_ATTRS}><path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/></svg>`;
const ICON_CLOCK = `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`;
const ICON_PIN = `<svg ${ICON_ATTRS}><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>`;

function shareRow(label: string, url: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'xqb-share-row';
  const name = document.createElement('span');
  name.className = 'xqb-share-label';
  name.textContent = label;
  const field = document.createElement('input');
  field.type = 'text';
  field.readOnly = true;
  field.value = url;
  field.className = 'xqb-share-url';
  field.setAttribute('aria-label', label);
  field.addEventListener('focus', () => field.select());
  // The copy button is joined to the field (lichess's clipboard tab); it
  // shows a check for a moment once the link is on the clipboard.
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'xqb-share-copy';
  copy.setAttribute('aria-label', t('broadcast.copy'));
  copy.title = t('broadcast.copy');
  copy.innerHTML = CLIPBOARD_ICON;
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(url).then(() => {
      copy.innerHTML = CHECK_MARK;
      copy.title = t('broadcast.copied');
      copy.classList.add('xqb-share-copied');
      window.setTimeout(() => {
        copy.innerHTML = CLIPBOARD_ICON;
        copy.title = t('broadcast.copy');
        copy.classList.remove('xqb-share-copied');
      }, 1500);
    });
  });
  const joined = document.createElement('div');
  joined.className = 'xqb-share-field';
  joined.append(field, copy);
  row.append(name, joined);
  return row;
}

const CLIPBOARD_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3.5h5v1M9 10h6M9 14h6"/></svg>';

// Players: standings from the broadcast games, the way lichess computes its
// Players tab, with the same caveat that they may differ from the official
// table. The current round's boards are live data; the rest were fetched once.
function renderPlayersTab(data: BroadcastRoundResponse, state: EventPageState): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'xqb-tab-panel';
  const note = document.createElement('p');
  note.className = 'xqb-note';
  note.textContent = t('broadcast.standingsNote');
  wrap.append(note);
  if (state.standingsBoards === null) {
    wrap.append(emptyState(t('broadcast.loadingStandings')));
    return wrap;
  }
  const rows = broadcastStandings([...(state.standingsBoards ?? []), ...data.boards]);
  if (rows.length === 0) {
    wrap.append(emptyState(t('broadcast.noGamesYet')));
    return wrap;
  }
  const table = document.createElement('table');
  table.className = 'xqb-standings';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of [
    '#',
    t('broadcast.player'),
    t('broadcast.games'),
    t('broadcast.winsDrawsLosses'),
    t('broadcast.score'),
  ]) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    const rank = document.createElement('td');
    rank.className = 'xqb-standings-rank';
    rank.textContent = String(index + 1);
    const player = document.createElement('td');
    player.className = 'xqb-standings-player';
    // The name opens the player's page (lichess's Players tab opens a player),
    // with the title tag the game list shows.
    const slug = state.playerSlugs?.get(row.player.name);
    const name = document.createElement(slug ? 'a' : 'strong');
    name.className = 'xqb-standings-name';
    if (slug && name instanceof HTMLAnchorElement)
      name.href = `/players/${encodeURIComponent(slug)}`;
    const title =
      row.player.title ?? playerTitleFor({ name: row.player.name, nameEn: row.player.nameEn });
    if (title) {
      const tag = document.createElement('span');
      tag.className = 'xqb-player-title';
      tag.textContent = title;
      name.append(tag, ' ');
    }
    name.append(primaryName(row.player));
    player.append(name);
    const zh = playerNameZh(row.player);
    const team = primaryFederation(row.player);
    const sub = [zh, team].filter(Boolean).join(' · ');
    if (sub) {
      const subline = document.createElement('span');
      subline.className = 'xqb-standings-sub';
      subline.textContent = sub;
      player.append(subline);
    }
    const games = document.createElement('td');
    games.textContent = String(row.games);
    const wdl = document.createElement('td');
    wdl.textContent = `${row.wins}-${row.draws}-${row.losses}`;
    const score = document.createElement('td');
    score.className = 'xqb-standings-score';
    score.textContent = formatStandingsScore(row.score);
    tr.append(rank, player, games, wdl, score);
    body.append(tr);
  });
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

type RoundPhase = 'live' | 'finished' | 'upcoming';

// Live beats finished beats upcoming; a round with no boards yet, or one
// whose stats are unavailable, reads as upcoming.
function roundPhase(stats: Partial<BroadcastRoundStats>): RoundPhase {
  const boards = stats.boardCount ?? 0;
  if ((stats.liveBoardCount ?? 0) > 0) return 'live';
  if (boards > 0 && (stats.completeBoardCount ?? 0) === boards) return 'finished';
  return 'upcoming';
}

// Native select styled to match the hero links; hops between sibling rounds
// without a trip back to the tour page. Idempotent per render: the selected
// option is derived from the payload, so SSE re-renders keep the current
// round selected.
// lichess's round selector: a wide pill naming the round and where it stands
// (Finished, Live, "in 27 minutes"), opening a panel of every round with its
// start and status. A native <select> drew the system menu, one line per
// round with no date, and a check mark doubled by the platform's own.
function roundSwitcher(
  tourSlug: string,
  rounds: BroadcastRoundWithStats[],
  currentRoundId: string,
): HTMLElement | null {
  if (rounds.length === 0) return null;
  const current = rounds.find((round) => round.id === currentRoundId) ?? rounds[0]!;
  const picker = document.createElement('div');
  picker.className = 'xqb-round-picker';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'xqb-round-picker-button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', `${t('broadcast.switchRound')}: ${primaryName(current)}`);
  const name = document.createElement('span');
  name.className = 'xqb-round-picker-name';
  name.textContent = primaryName(current);
  const caret = document.createElement('span');
  caret.className = 'xqb-round-picker-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.innerHTML = CARET_DOWN;
  button.append(name, roundStatusEl(current, { withLabel: true }), caret);

  const panel = document.createElement('div');
  panel.className = 'xqb-round-picker-panel';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;
  for (const round of rounds) {
    const option = document.createElement('a');
    option.className =
      round.id === current.id ? 'xqb-round-option xqb-round-option-current' : 'xqb-round-option';
    option.href = roundHref(tourSlug, round.id);
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', round.id === current.id ? 'true' : 'false');
    const label = document.createElement('span');
    label.className = 'xqb-round-option-name';
    label.textContent = primaryName(round);
    const when = document.createElement('span');
    when.className = 'xqb-round-option-when';
    when.textContent = formatEventDateTime(round.startsAt) ?? '';
    option.append(label, when, roundStatusEl(round, { withLabel: false }));
    option.addEventListener('click', () => close());
    panel.append(option);
  }

  const signal = currentPageSignal();
  const open = (): void => {
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    panel
      .querySelector<HTMLElement>('.xqb-round-option-current')
      ?.scrollIntoView?.({ block: 'nearest' });
  };
  const close = (): void => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => (panel.hidden ? open() : close()));
  // Outside a click or on Escape the panel closes; the listeners go with the page.
  document.addEventListener(
    'click',
    (event) => {
      if (!panel.hidden && !picker.contains(event.target as Node)) close();
    },
    { signal },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        close();
        button.focus();
      }
    },
    { signal },
  );
  picker.append(button, panel);
  return picker;
}

/** Where a round stands: a check once finished, a live mark, or when it
 *  starts ("in 27 minutes"), lichess's wording. */
function roundStatusEl(round: BroadcastRoundWithStats, opts: { withLabel: boolean }): HTMLElement {
  const el = document.createElement('span');
  const phase = roundPhase(round);
  el.className = `xqb-round-status xqb-round-status-${phase}`;
  if (phase === 'finished') {
    if (opts.withLabel) el.append(t('broadcast.finished'), ' ');
    const check = document.createElement('span');
    check.className = 'xqb-round-status-check';
    check.setAttribute('aria-hidden', 'true');
    check.innerHTML = CHECK_MARK;
    el.append(check);
    if (!opts.withLabel) el.setAttribute('aria-label', t('broadcast.finished'));
  } else if (phase === 'live') {
    // lichess's "Ongoing", a red dot before it.
    const dot = document.createElement('span');
    dot.className = 'xqb-round-status-dot';
    dot.setAttribute('aria-hidden', 'true');
    el.append(dot, t('broadcast.ongoing'));
  } else {
    // An undated round says nothing: the source gave no time, and "Upcoming"
    // was wrong for the rounds of a running event already played.
    const at = round.startsAt ? new Date(round.startsAt).getTime() : Number.NaN;
    el.textContent = !round.startsAt
      ? ''
      : Number.isFinite(at) && at > Date.now()
        ? relativeFromNow(at)
        : roundHasStarted(round)
          ? t('broadcast.awaitingRecords')
          : t('broadcast.upcoming');
  }
  return el;
}

function relativeFromNow(at: number): string {
  const minutes = Math.round((at - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(currentLocaleTag(), { numeric: 'always' });
  if (minutes < 60) return format.format(Math.max(1, minutes), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 36) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
}

function currentLocaleTag(): string {
  const lang = document.documentElement.lang;
  return lang || 'en';
}

const CARET_DOWN =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6 9l6 6 6-6z"/></svg>';
const CHECK_MARK =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// A rendered card plus the inputs it was built from. Keyed by board id.
type BoardCardCache = Map<string, { signature: string; el: HTMLElement }>;

// Deliberately the same inputs roundVersion feeds the stream gate, plus the
// small fields the card paints. That coupling is the point: a change the gate
// cannot see never arrives as a push, so a card the gate would not fire for is
// a card that genuinely has not moved. If roundVersion ever grows a field,
// grow this one with it.
function boardCardSignature(board: BroadcastBoardSummary, playedOn?: string | null): string {
  return JSON.stringify([
    playedOn ?? null,
    board.updatedAt ?? null,
    board.plyCount ?? board.moves?.length ?? 0,
    board.status,
    board.result,
    board.boardNumber,
    board.red,
    board.black,
    board.details ?? null,
    board.evaluation ?? null,
  ]);
}

function boardCardFor(
  board: BroadcastBoardSummary,
  cache?: BoardCardCache,
  playedOn?: string | null,
): HTMLElement {
  if (!cache) return boardCard(board, playedOn);
  const signature = boardCardSignature(board, playedOn);
  const cached = cache.get(board.id);
  // Appending an element that is already in the DOM moves it, so a reused card
  // reorders (live boards lead the grid) without being rebuilt.
  if (cached && cached.signature === signature) return cached.el;
  const el = boardCard(board, playedOn);
  cache.set(board.id, { signature, el });
  return el;
}

export { broadcastRecordsCredit };

function recordsCreditLine(boards: readonly { sourceUrl?: string }[]): HTMLElement | null {
  return creditLineFrom(broadcastRecordsCredit(boards));
}

function creditLineFrom(
  credit: { host: string; href: string } | null | undefined,
): HTMLElement | null {
  if (!credit) return null;
  const line = document.createElement('p');
  line.className = 'xqb-records-credit';
  const link = document.createElement('a');
  link.href = credit.href;
  link.rel = 'noreferrer';
  link.textContent = credit.host;
  const [before, after] = t('broadcast.recordsFrom').split('{source}');
  line.append(document.createTextNode(before ?? ''), link, document.createTextNode(after ?? ''));
  return line;
}

function renderBoardReplay(
  data: BroadcastBoardResponse,
  context: BroadcastRoundResponse | null = null,
  opts: { animateHeadAdvance?: boolean; embedded?: boolean } = {},
): HTMLElement {
  const main = broadcastShell();
  const frames = data.history.truth.length > 0 ? data.history.truth : [{ ply: 0, view: data.view }];
  const maxPly = frames.length - 1;
  const moveByPly = new Map(data.timeline.map((entry) => [entry.ply, entry.move]));
  let cursor = clamp(initialPlyFromUrl(), 0, maxPly);
  // The server eval is for the HEAD position only. A stale one (the payload
  // gained a ply the engine has not searched yet) says nothing about the
  // board on screen, so it is dropped until the next push carries a fresh one.
  const liveEval =
    data.board.status !== 'complete' && data.liveEval && data.liveEval.ply === maxPly
      ? data.liveEval
      : null;
  const liveArrows = liveEval ? engineArrowsFromLines(cevalLinesFromLiveEval(liveEval)) : [];

  document.title = `${playerName(data.board.red)} vs ${playerName(data.board.black)} · Mistboard`;
  const redZh = playerNameZh(data.board.red);
  const blackZh = playerNameZh(data.board.black);
  const hero = heroSection({
    eyebrow: `Board ${data.board.boardNumber}`,
    title: `${playerName(data.board.red)} vs ${playerName(data.board.black)}`,
    subtitle:
      redZh || blackZh
        ? `${redZh ?? data.board.red.name} vs ${blackZh ?? data.board.black.name}`
        : null,
    href: data.board.sourceUrl,
    meta: [
      resultLabel(data.board),
      `${data.timeline.length} plies`,
      statusLabel(data.state.status),
    ],
    backHref: `/broadcast/xiangqi/${encodeURIComponent(
      data.board.tourSlug,
    )}/round/${encodeURIComponent(data.board.roundId)}`,
    backLabel: t('broadcast.backToRound'),
    switcher: context
      ? roundSwitcher(data.board.tourSlug, context.rounds ?? [], data.board.roundId)
      : null,
  });

  const layout = document.createElement('section');
  layout.className = 'xqb-board-layout';

  const boardPanel = document.createElement('div');
  boardPanel.className = 'xqb-board-panel';
  const boardFrame = document.createElement('div');
  boardFrame.className = 'xqb-board-frame xiangqi-live-board';
  boardFrame.setAttribute('aria-label', t('broadcast.boardAriaLabel'));
  // The board sits in a stage so the eval gauge can take a column beside it
  // (the review's gauge mode: a flow child, not an overlay to align).
  const boardStage = document.createElement('div');
  boardStage.className = 'xqb-board-stage';
  if (liveEval) {
    const gauge = document.createElement('div');
    gauge.className = 'xqb-eval-gauge';
    const bar = createEvalBar();
    bar.setEval(liveEval.cp, liveEval.mate);
    gauge.append(bar.el);
    boardStage.classList.add('xqb-board-stage-with-gauge');
    boardStage.append(gauge);
  }
  boardStage.append(boardFrame);

  const controls = document.createElement('div');
  controls.className = 'xqb-controls';
  const first = controlButton(t('broadcast.first'), () => setCursor(0));
  const prev = controlButton(t('broadcast.prev'), () => setCursor(cursor - 1));
  const next = controlButton(t('broadcast.next'), () => setCursor(cursor + 1));
  const last = controlButton(t('broadcast.live'), () => setCursor(maxPly));
  const plyLabel = document.createElement('span');
  plyLabel.className = 'xqb-ply-label';
  controls.append(first, prev, plyLabel, next, last);

  const boardMeta = document.createElement('div');
  boardMeta.className = 'xqb-board-meta';
  boardMeta.append(playerPanel(t('setup.red'), data.board.red, data.board.result === '1-0'));
  boardMeta.append(playerPanel(t('setup.black'), data.board.black, data.board.result === '0-1'));
  boardPanel.append(boardStage, controls, boardMeta);

  const movesPanel = document.createElement('aside');
  movesPanel.className = 'xqb-moves-panel';
  // Engine lines above the moves, where lichess keeps its ceval: every viewer
  // reads the same server numbers, and a viewer scrolled back is told they
  // belong to the live position rather than the one on screen.
  const enginePanel = liveEval ? renderLiveEnginePanel(liveEval) : null;
  if (enginePanel) movesPanel.append(enginePanel.el);
  const moveHeading = document.createElement('h2');
  moveHeading.textContent = t('broadcast.moves');
  const moveList = document.createElement('div');
  moveList.className = 'xqb-move-grid';
  const actions = document.createElement('div');
  actions.className = 'xqb-board-actions';
  const analysisHref = analysisDeeplink(data.timeline);
  if (analysisHref) actions.append(analyseLink(analysisHref));
  actions.append(exportLink(data.board.id));
  movesPanel.append(moveHeading, moveList, actions);

  layout.append(boardPanel, movesPanel);
  // Embedded in the event page, whose header and game list are already there.
  const rail = context && !opts.embedded ? sideRail(context, data.board.id) : null;
  if (rail) {
    // Grid areas place the rail in the left column on wide viewports while it
    // stays last in DOM order, so narrow layouts stack it below the moves.
    layout.classList.add('xqb-board-layout-with-rail');
    layout.append(rail);
  }
  main.append(hero, layout);
  const view = opts.embedded ? layout : main;

  const moveButtons = renderMoveButtons(moveList, data.timeline, setCursor);

  function setCursor(nextPly: number): void {
    const fromPly = cursor;
    cursor = clamp(nextPly, 0, maxPly);
    renderCursor();
    animateCursorStep(fromPly, cursor);
  }

  // Adjacent scrub steps glide (pieceAnimation pref): forward animates the
  // stepped-into ply's move, back reverse-animates the undone ply's move. The
  // moves come from the broadcast timeline payload; jumps render discretely.
  function animateCursorStep(fromPly: number, toPly: number): void {
    if (toPly === fromPly + 1) {
      const move = moveByPly.get(toPly);
      if (move) animateXiangqiBoardMove(boardFrame, move, 'red');
    } else if (toPly === fromPly - 1) {
      const move = moveByPly.get(fromPly);
      if (move) animateXiangqiBoardMove(boardFrame, move, 'red', { reverse: true });
    }
  }

  function renderCursor(): void {
    const frame = frames[cursor] ?? frames[frames.length - 1]!;
    // Engine arrows belong to the head position; a viewer scrolled back sees
    // the plain board, and the panel's live tag says the numbers are the head's.
    const atHead = cursor === maxPly;
    boardFrame.innerHTML = renderXiangqiBoardSvg(frame.view, 'red', {
      arrows: atHead ? liveArrows : [],
    });
    enginePanel?.setAtHead(atHead);
    plyLabel.textContent = `${cursor} / ${maxPly}`;
    first.disabled = cursor === 0;
    prev.disabled = cursor === 0;
    next.disabled = cursor === maxPly;
    last.disabled = cursor === maxPly;
    for (const button of moveButtons) {
      button.classList.toggle('active', Number(button.dataset.ply) === cursor);
      if (Number(button.dataset.ply) === cursor) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    const url = new URL(window.location.href);
    if (cursor === maxPly) url.searchParams.delete('ply');
    else url.searchParams.set('ply', String(cursor));
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  renderCursor();
  // SSE head-advance: a new ply just arrived while the viewer sat at the head;
  // glide the newest move so live boards read as motion, not teleports. Runs a
  // frame later because the caller attaches `main` right after this returns
  // (same deferral idiom as scheduleRailScroll).
  if (opts.animateHeadAdvance && maxPly > 0 && cursor === maxPly) {
    const move = moveByPly.get(maxPly);
    if (move) {
      const glide = () => animateXiangqiBoardMove(boardFrame, move, 'red');
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(glide);
      else glide();
    }
  }
  return view;
}

// The arrow builder ranks lines by how much each gives up against the best,
// which only works in the mover's POV: in Red POV the best line for Black to
// move is the LOWEST number and every alternate would be dropped as "better
// than PV1". Red moves first, so Black is to move after an odd ply.
function cevalLinesFromLiveEval(evaluation: BroadcastLiveEval): CevalLine[] {
  const sign = evaluation.ply % 2 === 0 ? 1 : -1;
  return evaluation.lines.map((line, index) => ({
    multipv: index + 1,
    depth: evaluation.depth,
    scoreCp: line.cp == null ? null : line.cp * sign,
    mate: line.mate == null ? null : line.mate * sign,
    pvUci: line.pv,
  }));
}

// Chip tone by who is ahead, Red POV, the engine panel's palette.
function liveEvalTone(cp: number | null, mate: number | null): string {
  const value = mate != null ? (mate > 0 ? 1 : -1) : (cp ?? 0) / 100;
  if (value > 0.15) return 'is-red';
  if (value < -0.15) return 'is-black';
  return 'is-even';
}

type LiveEnginePanel = {
  el: HTMLElement;
  /** Show the "live" tag when the viewer is NOT at the head: the numbers are
   *  the live position's, not the one on screen. */
  setAtHead(atHead: boolean): void;
};

// A compact, read-only cousin of the review's engine panel: headline eval,
// engine name and depth, then the ranked lines. No switch, no settings: the
// search ran on the server and every viewer sees the same result.
function renderLiveEnginePanel(evaluation: BroadcastLiveEval): LiveEnginePanel {
  const el = document.createElement('section');
  el.className = 'xqb-engine';
  el.setAttribute('aria-label', t('broadcast.engine'));

  const head = document.createElement('div');
  head.className = 'xqb-engine-head';
  const headline = document.createElement('span');
  headline.className = `xqb-engine-eval ${liveEvalTone(evaluation.cp, evaluation.mate)}`;
  headline.textContent = formatEval(evaluation.cp, evaluation.mate);
  const id = document.createElement('span');
  id.className = 'xqb-engine-id';
  const name = document.createElement('strong');
  name.textContent = t('broadcast.engine');
  const sub = document.createElement('span');
  sub.className = 'xqb-engine-sub';
  sub.textContent = t('broadcast.engineDepth', { name: 'Pikafish', depth: evaluation.depth });
  id.append(name, sub);
  const liveTag = document.createElement('span');
  liveTag.className = 'xqb-engine-live-tag';
  liveTag.textContent = t('broadcast.engineLivePosition');
  liveTag.hidden = true;
  head.append(headline, id, liveTag);

  const lines = document.createElement('ol');
  lines.className = 'xqb-engine-lines';
  for (const line of evaluation.lines) {
    const item = document.createElement('li');
    item.className = 'xqb-engine-line';
    const score = document.createElement('span');
    score.className = `xqb-engine-line-eval ${liveEvalTone(line.cp, line.mate)}`;
    score.textContent = formatEval(line.cp, line.mate);
    const pv = document.createElement('span');
    pv.className = 'xqb-engine-line-pv';
    pv.textContent = line.pv.slice(0, 8).map(formatXiangqiEngineMove).join(' ');
    item.append(score, pv);
    lines.append(item);
  }
  el.append(head, lines);
  return {
    el,
    setAtHead(atHead) {
      liveTag.hidden = atHead;
      el.classList.toggle('xqb-engine-behind-head', !atHead);
    },
  };
}

function broadcastShell(): HTMLElement {
  const main = document.createElement('main');
  main.className = 'xqb-shell';
  return main;
}

function heroSection(input: {
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  meta: string[];
  href?: string;
  backHref?: string;
  backLabel?: string;
  switcher?: HTMLElement | null;
}): HTMLElement {
  const section = document.createElement('section');
  section.className = 'xqb-hero';
  const copy = document.createElement('div');
  copy.className = 'xqb-hero-copy';

  if (input.eyebrow) {
    const eyebrow = document.createElement('p');
    eyebrow.className = 'xqb-eyebrow';
    eyebrow.textContent = input.eyebrow;
    copy.append(eyebrow);
  }
  const title = document.createElement('h1');
  title.textContent = input.title;
  copy.append(title);

  if (input.subtitle) {
    const subtitle = document.createElement('p');
    subtitle.className = 'xqb-hero-zh';
    subtitle.textContent = input.subtitle;
    copy.append(subtitle);
  }

  if (input.meta.length > 0) {
    const meta = document.createElement('p');
    meta.className = 'xqb-hero-meta';
    meta.textContent = input.meta.join(' / ');
    copy.append(meta);
  }

  const actions = document.createElement('div');
  actions.className = 'xqb-hero-actions';
  if (input.switcher) actions.append(input.switcher);
  if (input.backHref && input.backLabel) {
    const back = document.createElement('a');
    back.className = 'xqb-link';
    back.href = input.backHref;
    back.textContent = input.backLabel;
    actions.append(back);
  }
  if (input.href) {
    const source = document.createElement('a');
    source.className = 'xqb-link xqb-link-primary';
    source.href = input.href;
    source.rel = 'noreferrer';
    source.textContent = t('broadcast.source');
    actions.append(source);
  }
  section.append(copy, actions);
  return section;
}

// Index card: featured-board thumbnail + tour identity + counts + freshness.
// Tours without a featured board (nothing live or complete yet) fall back to
// the initial position so every card keeps the same silhouette.
function tourCard(entry: BroadcastIndexEntry, opts: { featured?: boolean } = {}): HTMLElement {
  const live = entry.liveBoardCount > 0;
  const card = document.createElement('a');
  card.className = [
    'xqb-tour-card',
    live ? 'xqb-tour-card-live' : null,
    opts.featured ? 'xqb-tour-card-featured' : null,
  ]
    .filter(Boolean)
    .join(' ');
  card.href = `/broadcast/xiangqi/${encodeURIComponent(entry.tour.slug)}`;

  // The event's art, lichess's card image; a drawn placeholder until events
  // have art of their own (eventArt).
  const boardEl = eventArt(entry.tour);

  const copy = document.createElement('div');
  copy.className = 'xqb-tour-card-copy';
  // lichess's card order: where the event stands, its name, then who is
  // playing. The status line replaced "Updated 12m ago", which was our import.
  const status = statusLineEl(entry);
  if (status) copy.append(status);
  const name = document.createElement('strong');
  name.className = 'xqb-tour-card-name';
  name.textContent = primaryName(entry.tour);
  copy.append(name);
  const tourZh = zhSubline(secondaryName(entry.tour));
  if (tourZh) copy.append(tourZh);
  const place = [entry.tour.location, formatEventDateRange(entry.tour.startsAt, entry.tour.endsAt)]
    .filter(Boolean)
    .join(' / ');
  if (place) {
    const placeLine = document.createElement('span');
    placeLine.className = 'xqb-tour-card-meta';
    placeLine.textContent = place;
    copy.append(placeLine);
  }
  const players = topPlayersEl(entry, opts.featured ? 6 : 3);
  if (players) copy.append(players);
  if (opts.featured) {
    const counts = document.createElement('span');
    counts.className = 'xqb-tour-card-meta';
    counts.textContent = [
      countLabel(entry.roundCount, 'round', 'rounds'),
      countLabel(entry.boardCount, 'game', 'games'),
    ].join(' / ');
    copy.append(counts);
  }

  card.append(boardEl, copy);
  return card;
}

// A scannable mini-board card: the current position rebuilt from the board's
// move list (broadcasts are open truth, so the red-perspective truth view is
// safe to render), plus pairing + result/status. Links to the full board page.
// lichess's board card: the players on the board's own sides (Black above,
// Red below, as the board is drawn), each with their score, and nothing else.
// A team game keeps one small label naming its table and game, which the
// match header above it needs; a live game says so there too.
function boardCard(board: BroadcastBoardSummary, _playedOn?: string | null): HTMLElement {
  const card = document.createElement('a');
  card.className = `xqb-board-card xqb-board-card-${board.status}`;
  card.href = `/broadcast/xiangqi/board/${encodeURIComponent(board.id)}`;

  const table = board.details?.table;
  const label = table
    ? board.details?.game
      ? t('broadcast.tableGame', { n: table, g: board.details.game })
      : t('broadcast.table', { n: table })
    : null;
  // The table rides in the tooltip: lichess's cards are the two players and
  // the board, and the game list and the open board both carry the table.
  if (label) card.title = label;

  const boardEl = document.createElement('div');
  boardEl.className = 'xqb-card-board xiangqi-live-board';
  boardEl.setAttribute('aria-hidden', 'true');
  const replay = buildXiangqiReplayFromMoves(board.moves ?? []);
  const view = replay.views[replay.maxPly] ?? replay.views[0]!;
  // Card thumbnail, aria-hidden and about a hundred pixels across. Coordinates
  // are noise at that size, and the card is framed by hand, so the reserved
  // gutter would change the silhouette every card shares.
  boardEl.innerHTML = renderXiangqiBoardSvg(view, 'red', { coordinates: false });

  // lichess's "Evaluation gauge": a thin bar beside the board, the review's
  // own bar and colours, filled by the same win-probability curve. Rendered
  // whenever there is an eval; the panel's toggle hides them. Not the review's
  // gauge-column class: review-shell.css hides that outside the review layout,
  // and the card board collapsed to nothing beside it in prod.
  // Every card keeps the gauge's column, filled or not, so every board in the
  // grid is the same size (a board without an eval yet was a gauge wider).
  const gauge = document.createElement('div');
  gauge.className = 'xqb-card-gauge';
  const share = gaugeShare(board);
  if (share) gauge.append(evalBarEl(share.red));
  else gauge.classList.add('xqb-card-gauge-empty');
  if (share) gauge.title = share.label;
  const boardSlot = document.createElement('div');
  boardSlot.className = 'xqb-card-board-row';
  // Right of the board, where lichess puts it.
  boardSlot.append(boardEl, gauge);
  // A live game shows who is to move where a finished one shows its score:
  // lichess runs that side's clock there in orange. The source has no clocks,
  // so the mark is the turn alone.
  const mover = board.status === 'live' ? sideToMove(board) : null;
  const topSeat = cardSeat('black', board.black, seatScore(board, 'black'), {
    toMove: mover === 'black',
  });
  card.append(
    topSeat,
    boardSlot,
    cardSeat('red', board.red, seatScore(board, 'red'), { toMove: mover === 'red' }),
  );
  return card;
}

/** Whose turn it is in a game: Red moves first, so Red after an even ply. */
function sideToMove(board: Pick<BroadcastBoardSummary, 'plyCount' | 'moves'>): XiangqiColor {
  const plies = board.plyCount ?? board.moves?.length ?? 0;
  return plies % 2 === 0 ? 'red' : 'black';
}

/** A side's score for the game: 1, 0 or ½ once it is over, else nothing. */
function seatScore(
  board: Pick<BroadcastBoardSummary, 'status' | 'result'>,
  color: XiangqiColor,
): string {
  if (board.status !== 'complete') return '';
  if (board.result === '1/2-1/2') return '½';
  if (board.result === '1-0') return color === 'red' ? '1' : '0';
  if (board.result === '0-1') return color === 'black' ? '1' : '0';
  return '';
}

/** One side of a card or a list row: the seat's ink, the name, the score. The
 *  Chinese name and the team ride the tooltip, where lichess keeps the flag. */
function cardSeat(
  color: XiangqiColor,
  player: XiangqiBroadcastPlayerTag,
  score: string,
  opts: { resultInk?: boolean; toMove?: boolean } = {},
): HTMLElement {
  const row = document.createElement('span');
  row.className = `xqb-card-seat xqb-card-seat-${color}${score === '1' ? ' xqb-card-seat-winner' : ''}`;
  const disc = document.createElement('span');
  disc.className = 'xqb-card-seat-disc';
  const name = document.createElement('span');
  name.className = 'xqb-card-seat-name';
  // The title before the name, in its own ink (lichess's GM, FM): the feed's
  // tag when it has one, else the official list's.
  const title = player.title ?? playerTitleFor({ name: player.name, nameEn: player.nameEn });
  if (title) {
    const tag = document.createElement('span');
    tag.className = 'xqb-player-title';
    tag.textContent = title;
    name.append(tag, ' ');
  }
  name.append(primaryName(player));
  name.title = [playerNameZh(player), primaryFederation(player)].filter(Boolean).join(' · ');
  const points = document.createElement('span');
  points.className = 'xqb-score';
  // The game list colours a result (lichess): the winner's 1 green, the
  // loser's 0 red, a draw plain.
  if (opts.resultInk && (score === '1' || score === '0')) {
    points.classList.add(score === '1' ? 'xqb-score-win' : 'xqb-score-loss');
  }
  points.textContent = score;
  if (opts.toMove) {
    points.classList.add('xqb-to-move');
    points.textContent = '';
    points.title = t('broadcast.toMove');
    points.setAttribute('aria-label', t('broadcast.toMove'));
  }
  row.append(disc, name, points);
  return row;
}

// lichess's game-list gauge: a small pill beside the pair, Black's share on
// top and Red's below, filled from the stored evaluation by the same curve as
// the board gauge. A game with no evaluation yet keeps an empty pill, so the
// names stay in line.
function railGauge(board: BroadcastBoardSummary): HTMLElement {
  const gauge = document.createElement('span');
  gauge.className = 'xqb-rail-gauge';
  gauge.setAttribute('aria-hidden', 'true');
  const share = gaugeShare(board);
  if (!share) {
    gauge.classList.add('xqb-rail-gauge-empty');
    return gauge;
  }
  gauge.append(evalBarEl(share.red));
  gauge.title = share.label;
  return gauge;
}

/**
 * What a board's gauge shows: the stored evaluation of its last position, or,
 * for a finished draw not analysed yet, level (a drawn game ends even, and a
 * blank pill beside ½-½ read as broken). A decisive game with no evaluation
 * yet stays empty until the sweep reaches it.
 */
function gaugeShare(board: BroadcastBoardSummary): { red: number; label: string } | null {
  const evaluation = board.evaluation;
  if (evaluation) {
    return {
      red: winProbRed(evaluation.cp, evaluation.mate),
      label: formatEval(evaluation.cp, evaluation.mate),
    };
  }
  if (board.status === 'complete' && board.result === '1/2-1/2') return { red: 0.5, label: '½-½' };
  return null;
}

function evalBarEl(redShare: number): HTMLElement {
  const bar = document.createElement('span');
  bar.className = 'review-eval-bar';
  bar.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('span');
  fill.className = 'review-eval-bar__fill';
  fill.style.height = `${(redShare * 100).toFixed(1)}%`;
  bar.classList.toggle('review-eval-bar--red-ahead', redShare >= 0.5);
  bar.append(fill);
  return bar;
}

// The relay-games analog: every board in the same round, current pairing
// highlighted, so users hop between games without going back to the round
// page. Rebuilt from the mount-time round context on each render, so it is
// idempotent across SSE re-renders.
// The round's pairings as a list: the board page's left column, and the event
// page's. An empty currentBoardId highlights nothing. The optional header slot
// takes the round switcher on the board page, where the review shell owns the
// rest of the chrome and the rail is the only way back to the round.
function sideRail(
  context: BroadcastRoundResponse,
  currentBoardId: string,
  header?: HTMLElement | null,
): HTMLElement | null {
  const grouped = groupRoundByMatch(context.boards, leagueRulesFor(context.tour));
  const boards = grouped
    ? [...grouped.matches.flatMap((match) => matchBoards(match)), ...grouped.other]
    : [...context.boards].sort((a, b) => a.boardNumber - b.boardNumber);
  const rail = document.createElement('aside');
  rail.className = 'xqb-side-rail';
  const heading = document.createElement('h2');
  if (header) {
    heading.append(header);
  } else {
    const back = document.createElement('a');
    back.href = `/broadcast/xiangqi/${encodeURIComponent(
      context.tour.slug,
    )}/round/${encodeURIComponent(context.round.id)}`;
    // With a board open, the heading is the way back to the round's boards
    // (lichess's arrow beside the round name).
    if (currentBoardId) {
      back.className = 'xqb-rail-back';
      back.title = t('broadcast.boards');
      const arrow = document.createElement('span');
      arrow.className = 'xqb-rail-back-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '‹';
      back.append(arrow);
    }
    back.append(primaryName(context.round));
    heading.append(back);
  }
  const list = document.createElement('div');
  list.className = 'xqb-rail-list';
  // A round with no games keeps the column (the page keeps its shape, and
  // the chat its place) and says so where the games will appear.
  if (boards.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'xqb-rail-empty';
    empty.textContent = t('broadcast.railNoGames');
    list.append(empty);
  }
  let currentRow: HTMLElement | null = null;
  for (const [index, board] of boards.entries()) {
    const current = board.id === currentBoardId;
    const row = document.createElement('a');
    row.className = current ? 'xqb-rail-row xqb-rail-row-current' : 'xqb-rail-row';
    row.href = `/broadcast/xiangqi/board/${encodeURIComponent(board.id)}`;
    if (current) row.setAttribute('aria-current', 'page');

    // lichess's game list: the row's place in the list, then both players
    // stacked with their scores. A team game's table and game ride in the
    // tooltip: numbered by table, every match restarted at 1 and the blitz
    // games needed a "b", so the column read as noise.
    const number = document.createElement('span');
    number.className = 'xqb-rail-no';
    number.textContent = String(index + 1);
    const table = board.details?.table;
    if (table) {
      const where = board.details?.game
        ? t('broadcast.tableGame', { n: table, g: board.details.game })
        : t('broadcast.table', { n: table });
      row.title = board.details?.kind === 'blitz' ? `${where} · ${t('broadcast.blitz')}` : where;
    }
    const rowMover = board.status === 'live' ? sideToMove(board) : null;
    const players = document.createElement('span');
    players.className = 'xqb-rail-players';
    players.append(
      cardSeat('red', board.red, seatScore(board, 'red'), {
        resultInk: true,
        toMove: rowMover === 'red',
      }),
      cardSeat('black', board.black, seatScore(board, 'black'), {
        resultInk: true,
        toMove: rowMover === 'black',
      }),
    );
    row.append(number, railGauge(board), players);
    if (board.status === 'live') row.classList.add('xqb-rail-row-live');
    list.append(row);
    if (current) currentRow = row;
  }
  rail.append(heading, list);
  scheduleRailScroll(list, currentRow);
  return rail;
}

// Scroll the rail (not the page) so the current pairing is centered once the
// rail is attached; render runs before replaceChildren, so defer a frame.
// Guarded so happy-dom's partial layout support stays harmless.
function scheduleRailScroll(list: HTMLElement, row: HTMLElement | null): void {
  if (!row) return;
  const scroll = () => {
    list.scrollTop = Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2);
  };
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(scroll);
  else scroll();
}

function playerPanel(
  labelText: string,
  player: XiangqiBroadcastPlayerTag,
  won: boolean,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = won ? 'xqb-player xqb-player-winner' : 'xqb-player';
  const label = document.createElement('span');
  label.textContent = labelText;
  const name = document.createElement('strong');
  name.textContent = playerName(player);
  panel.append(label, name);
  const zh = zhSubline(playerNameZh(player));
  if (zh) panel.append(zh);
  return panel;
}

function renderMoveButtons(
  container: HTMLElement,
  timeline: BroadcastMoveTimelineEntry[],
  onSelect: (ply: number) => void,
): HTMLButtonElement[] {
  const byPly = new Map(timeline.map((entry) => [entry.ply, entry]));
  // The reader's notation preference (coordinate / WXF / Chinese), the same
  // one the review and study boards honour; raw `c4-c5` was the only spelling
  // this list knew. Formatted by replaying the line, so an entry whose move is
  // illegal at its turn falls back to coordinates from there on.
  const ordered = [...timeline].sort((a, b) => a.ply - b.ply);
  const labels = new Map(
    formatXiangqiMoves(
      ordered.map((entry) => entry.move),
      currentXiangqiNotationStyle(),
    ).map((label, index) => [ordered[index]!.ply, label]),
  );
  const buttons: HTMLButtonElement[] = [];
  const moveCount = Math.ceil(timeline.length / 2);
  for (let moveNumber = 1; moveNumber <= moveCount; moveNumber++) {
    const label = document.createElement('span');
    label.className = 'xqb-move-number';
    label.textContent = `${moveNumber}.`;
    container.append(label);
    for (const ply of [moveNumber * 2 - 1, moveNumber * 2]) {
      const entry = byPly.get(ply);
      if (!entry) {
        const spacer = document.createElement('span');
        spacer.className = 'xqb-move-empty';
        container.append(spacer);
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `xqb-move xqb-move-${entry.color}`;
      button.dataset.ply = String(entry.ply);
      button.textContent = labels.get(entry.ply) ?? moveLabel(entry.move);
      button.addEventListener('click', () => onSelect(entry.ply));
      buttons.push(button);
      container.append(button);
    }
  }
  return buttons;
}

function controlButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'xqb-control';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

// Serialize a broadcast timeline to the canonical coordinate move list the
// analysis board expects at `/analysis/xiangqi?moves=`. Each move is our square
// notation concatenated (= Fairy-Stockfish xiangqi UCI, e.g. `h3e3`), which the
// analysis importer round-trips back to the same moves. Exported for the
// round-trip test that guards this seam against a format drift on either side.
export function serializeBroadcastMovesForAnalysis(timeline: BroadcastMoveTimelineEntry[]): string {
  return [...timeline]
    .sort((a, b) => a.ply - b.ply)
    .map((entry) => xiangqiMoveToFsfUci(entry.move))
    .join(',');
}

function analysisDeeplink(timeline: BroadcastMoveTimelineEntry[]): string | null {
  if (timeline.length === 0) return null;
  return `/analysis/xiangqi?moves=${encodeURIComponent(serializeBroadcastMovesForAnalysis(timeline))}`;
}

// Opens in a new tab so a live broadcast keeps streaming behind the analysis board.
function analyseLink(href: string): HTMLElement {
  const link = document.createElement('a');
  link.className = 'xqb-export-link xqb-link-primary';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = t('broadcast.analyseWithEngine');
  return link;
}

function exportLink(boardId: string): HTMLElement {
  const link = document.createElement('a');
  link.className = 'xqb-export-link';
  link.href = `/api/xiangqi/broadcasts/boards/${encodeURIComponent(boardId)}/export`;
  link.textContent = t('broadcast.exportJson');
  return link;
}

// Ingestion caches an English form (nameEn) next to the original Chinese
// name on tours, rounds, and player tags. Viewers render English primary and
// keep the Chinese as a subtle secondary line when the two differ.
function primaryName(entity: { name: string; nameEn?: string }): string {
  const en = entity.nameEn?.trim();
  return en && en.length > 0 ? en : entity.name;
}

function secondaryName(entity: { name: string; nameEn?: string }): string | null {
  const en = entity.nameEn?.trim();
  return en && en.length > 0 && en !== entity.name ? entity.name : null;
}

function zhSubline(text: string | null, className = 'xqb-name-zh'): HTMLElement | null {
  if (!text) return null;
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

// Team affiliations get the same English-primary treatment as names: a team
// event is most of top-level xiangqi, so an untranslated team beside a
// romanized player would leave half of every label in Chinese.
function primaryFederation(player: XiangqiBroadcastPlayerTag): string | undefined {
  const en = player.federationEn?.trim();
  return en && en.length > 0 ? en : player.federation;
}

function playerName(player: XiangqiBroadcastPlayerTag): string {
  const prefix = player.title ? `${player.title} ` : '';
  const federation = primaryFederation(player);
  const suffix = federation ? ` (${federation})` : '';
  return `${prefix}${primaryName(player)}${suffix}`;
}

function playerNameZh(player: XiangqiBroadcastPlayerTag): string | null {
  return secondaryName(player);
}

function resultLabel(board: Pick<BroadcastBoardSummary, 'result' | 'status'>): string {
  if (board.result === '1-0') return t('broadcast.redWins');
  if (board.result === '0-1') return t('broadcast.blackWins');
  if (board.result === '1/2-1/2') return t('broadcast.draw');
  if (board.status === 'live') return t('broadcast.live');
  if (board.status === 'scheduled') return t('broadcast.scheduled');
  return t('broadcast.inProgress');
}

function statusLabel(status: XiangqiGameStatus): string {
  if (status.type === 'playing') return `${capitalize(status.turn)} to move`;
  if (status.type === 'finished') {
    const result = status.winner
      ? t('broadcast.colorWins', {
          color: status.winner === 'red' ? t('setup.red') : t('setup.black'),
        })
      : t('broadcast.draw');
    return `${result} by ${status.reason}`;
  }
  return `Aborted: ${status.reason}`;
}

// Lightweight relative-time labels for card freshness: 'just now', '3m ago',
// '2h ago', then a short date ('Jul 8', with the year once it differs).
// Locale is pinned so the label is deterministic under test. Exported for
// unit tests.
export function formatBroadcastFreshness(
  value: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!value) return null;
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return null;
  const diffMs = Math.max(0, now.getTime() - then.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(then);
}

// Mirrors the server's board stream version key, so the stream's first event
// (the same snapshot the page fetched) is recognised as already painted.
function boardVersion(data: BroadcastBoardResponse): string {
  return streamVersion([
    data.board.id,
    data.board.updatedAt,
    data.board.plyCount,
    data.board.status,
    data.board.result,
    data.state.status.type,
    data.liveEval?.ply,
    data.liveEval?.nodes,
  ]);
}

function roundVersion(data: BroadcastRoundResponse): string {
  return streamVersion([
    timestamp(data.tour),
    timestamp(data.round),
    ...data.boards.map((board) =>
      streamVersion([board.id, board.updatedAt, board.plyCount, board.status, board.result]),
    ),
  ]);
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
  return typeof updatedAt === 'string' ? updatedAt : undefined;
}

function streamVersion(values: Array<string | number | null | undefined>): string {
  return values.map((value) => value ?? '').join('|');
}

function moveLabel(move: XiangqiMove): string {
  return `${move.from}-${move.to}`;
}

function initialPlyFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('ply');
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
