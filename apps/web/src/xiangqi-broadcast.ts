import type {
  StandardXiangqiPlayerView,
  XiangqiBroadcastBoardStatus,
  XiangqiBroadcastPlayerTag,
  XiangqiBroadcastResult,
  XiangqiBroadcastRound,
  XiangqiBroadcastTour,
  XiangqiColor,
  XiangqiGameStatus,
  XiangqiMove,
} from '@mistboard/game';
import { broadcastRecordsCredit, xiangqiMoveToFsfUci } from '@mistboard/game';
import './live-xiangqi.css';
import './xiangqi-broadcast.css';
import { t } from './i18n/catalog.js';
import { renderXiangqiBoardSvg } from './live-xiangqi.js';
import { buildXiangqiReplayFromMoves } from './review/xiangqi-review-model.js';
import { buildLoadingState, buildNav, buildNotice } from './site-shell.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { animateXiangqiBoardMove } from './xiangqi-board.js';

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
  createdAt?: string;
  updatedAt?: string;
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
  lastSyncLog: BroadcastSyncLogSummary | null;
};

type BroadcastIndexResponse = {
  tours: BroadcastIndexEntry[];
};

type BroadcastStreamEnvelope<T> = {
  version: string;
  payload: T;
};

export async function mountXiangqiBroadcastIndex(root: HTMLElement): Promise<void> {
  setBroadcastRoot(root, t('broadcast.loadingBroadcasts'));
  try {
    const data = await fetchJson<BroadcastIndexResponse>('/api/xiangqi/broadcasts');
    const paint = (): void => root.replaceChildren(buildNav(), renderIndex(data));
    paint();
    installBroadcastAppearanceRefresh(paint);
  } catch (err) {
    renderError(root, err);
  }
}

export async function mountXiangqiBroadcastTour(
  root: HTMLElement,
  tourSlug: string,
): Promise<void> {
  setBroadcastRoot(root, t('broadcast.loadingBroadcast'));
  try {
    const data = await fetchJson<BroadcastTourResponse>(
      `/api/xiangqi/broadcasts/${encodeURIComponent(tourSlug)}`,
    );
    const paint = (): void => root.replaceChildren(buildNav(), renderTour(data));
    paint();
    installBroadcastAppearanceRefresh(paint);
  } catch (err) {
    renderError(root, err);
  }
}

export async function mountXiangqiBroadcastRound(
  root: HTMLElement,
  tourSlug: string,
  roundId: string,
): Promise<void> {
  setBroadcastRoot(root, t('broadcast.loadingRound'));
  try {
    let data = await fetchJson<BroadcastRoundResponse>(
      `/api/xiangqi/broadcasts/${encodeURIComponent(tourSlug)}/rounds/${encodeURIComponent(
        roundId,
      )}`,
    );
    // Every stream push repaints the whole round, and a card is expensive:
    // boardCard replays its game from move one and builds a board SVG. Twenty
    // boards is ~1,700 plies, so rebuilding all of them per push blocks the
    // main thread for hundreds of milliseconds on exactly the rounds that push
    // most. Cards survive across paints and only the changed ones are rebuilt.
    const cards: BoardCardCache = new Map();
    const paint = (): void => root.replaceChildren(buildNav(), renderRound(data, cards));
    paint();
    // A skin or layout change rewrites every board SVG, so no cached card
    // survives it.
    installBroadcastAppearanceRefresh(() => {
      cards.clear();
      paint();
    });
    connectRoundStream(tourSlug, roundId, roundVersion(data), (next) => {
      data = next;
      paint();
    });
  } catch (err) {
    renderError(root, err);
  }
}

export async function mountXiangqiBroadcastBoard(
  root: HTMLElement,
  boardId: string,
): Promise<void> {
  setBroadcastRoot(root, t('broadcast.loadingBoard'));
  try {
    let data = await fetchJson<BroadcastBoardResponse>(
      `/api/xiangqi/broadcasts/boards/${encodeURIComponent(boardId)}`,
    );
    const context = await fetchBoardRoundContext(data.board.tourSlug, data.board.roundId);
    const paint = (animateHeadAdvance = false): void => {
      root.replaceChildren(buildNav(), renderBoardReplay(data, context, { animateHeadAdvance }));
    };
    paint();
    installBroadcastAppearanceRefresh(() => paint());
    connectBoardStream(boardId, boardVersion(data), data.timeline.length, (next, animate) => {
      data = next;
      paint(animate);
    });
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

function setBroadcastRoot(root: HTMLElement, loadingLabel: string): void {
  root.classList.add('landing-page', 'xiangqi-broadcast-route');
  root.replaceChildren(buildNav(), buildLoadingState(loadingLabel));
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
}

function installBroadcastAppearanceRefresh(paint: () => void): void {
  window.addEventListener(xiangqiAppearanceChangedEvent, paint);
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
function renderIndex(data: BroadcastIndexResponse): HTMLElement {
  const main = broadcastShell();
  const live = data.tours.filter((entry) => entry.liveBoardCount > 0);
  const past = data.tours.filter((entry) => entry.liveBoardCount === 0);
  main.append(
    heroSection({
      eyebrow: t('broadcast.eyebrow'),
      title: t('broadcast.tournamentBroadcasts'),
      meta: [
        t(data.tours.length === 1 ? 'broadcast.tournamentCountOne' : 'broadcast.tournamentCount', {
          count: data.tours.length,
        }),
        live.length > 0 ? t('broadcast.liveNowCount', { count: live.length }) : null,
      ].filter(Boolean) as string[],
    }),
  );

  if (live.length > 0) main.append(tourZone(t('broadcast.liveNow'), sortByFreshness(live), true));
  if (past.length > 0 || live.length === 0) {
    main.append(
      tourZone(
        live.length > 0 ? t('broadcast.past') : t('broadcast.broadcasts'),
        sortByFreshness(past),
        false,
      ),
    );
  }
  return main;
}

function sortByFreshness(entries: BroadcastIndexEntry[]): BroadcastIndexEntry[] {
  return [...entries].sort(
    (a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0),
  );
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

function renderTour(data: BroadcastTourResponse): HTMLElement {
  document.title = `${primaryName(data.tour)} · Mistboard`;
  const main = broadcastShell();
  main.append(
    heroSection({
      eyebrow: t('broadcast.eyebrow'),
      title: primaryName(data.tour),
      subtitle: secondaryName(data.tour),
      href: data.tour.sourceUrl,
      meta: [
        data.tour.location,
        dateRange(data.tour.startsAt, data.tour.endsAt),
        countLabel(data.rounds.length, 'round', 'rounds'),
      ].filter(Boolean) as string[],
    }),
  );

  const section = document.createElement('section');
  section.className = 'xqb-section';
  const heading = document.createElement('h2');
  heading.textContent = t('broadcast.rounds');
  const list = document.createElement('div');
  list.className = 'xqb-list';
  for (const round of data.rounds) {
    const row = document.createElement('a');
    row.className = 'xqb-row xqb-round-row';
    row.href = `/broadcast/xiangqi/${encodeURIComponent(data.tour.slug)}/round/${encodeURIComponent(
      round.id,
    )}`;

    const phase = roundPhase(round);
    const copy = document.createElement('span');
    copy.className = 'xqb-row-copy';
    const name = document.createElement('strong');
    name.textContent = primaryName(round);
    const meta = document.createElement('span');
    meta.textContent = [
      formatDate(round.startsAt),
      round.boardCount !== undefined ? countLabel(round.boardCount, 'board', 'boards') : null,
      roundPhaseLabel(phase),
    ]
      .filter(Boolean)
      .join(' / ');
    copy.append(name);
    const roundZh = zhSubline(secondaryName(round));
    if (roundZh) copy.append(roundZh);
    copy.append(meta);
    row.append(roundIcon(phase), copy, chevron());
    list.append(row);
  }
  section.append(heading, list);
  main.append(section);
  // The tour page is the one an outside link points at, and it was the only
  // broadcast page that credited nobody: the round pages derive the credit from
  // their own boards, and a tour payload has none.
  const credit = creditLineFrom(data.recordsSource);
  if (credit) main.append(credit);
  return main;
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

function roundPhaseLabel(phase: RoundPhase): string {
  if (phase === 'live') return t('broadcast.live');
  if (phase === 'finished') return t('broadcast.finished');
  return t('broadcast.upcoming');
}

// Text markers stand in for lila's icon font: live disc, finished check,
// upcoming hollow disc. Used by both the tour rows and the round switcher.
const ROUND_PHASE_MARKS: Record<RoundPhase, string> = {
  live: '●',
  finished: '✓',
  upcoming: '○',
};

function roundIcon(phase: RoundPhase): HTMLElement {
  const icon = document.createElement('span');
  icon.className = `xqb-round-icon xqb-round-icon-${phase}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = ROUND_PHASE_MARKS[phase];
  return icon;
}

// Native select styled to match the hero links; hops between sibling rounds
// without a trip back to the tour page. Idempotent per render: the selected
// option is derived from the payload, so SSE re-renders keep the current
// round selected.
function roundSwitcher(
  tourSlug: string,
  rounds: BroadcastRoundWithStats[],
  currentRoundId: string,
): HTMLSelectElement | null {
  if (rounds.length === 0) return null;
  const select = document.createElement('select');
  select.className = 'xqb-round-select';
  select.setAttribute('aria-label', t('broadcast.switchRound'));
  for (const round of rounds) {
    const option = document.createElement('option');
    option.value = round.id;
    option.textContent = `${ROUND_PHASE_MARKS[roundPhase(round)]} ${primaryName(round)}`;
    if (round.id === currentRoundId) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => {
    if (select.value === currentRoundId) return;
    window.location.assign(
      `/broadcast/xiangqi/${encodeURIComponent(tourSlug)}/round/${encodeURIComponent(select.value)}`,
    );
  });
  return select;
}

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

function renderRound(data: BroadcastRoundResponse, cards?: BoardCardCache): HTMLElement {
  document.title = `${primaryName(data.round)} · ${primaryName(data.tour)} · Mistboard`;
  const main = broadcastShell();
  const liveCount = data.boards.filter((board) => board.status === 'live').length;
  main.append(
    heroSection({
      eyebrow: primaryName(data.tour),
      title: primaryName(data.round),
      subtitle: secondaryName(data.round),
      href: data.round.sourceUrl ?? data.tour.sourceUrl,
      meta: [
        formatDate(data.round.startsAt),
        countLabel(data.boards.length, 'board', 'boards'),
        liveCount > 0 ? `${liveCount} live` : null,
      ].filter(Boolean) as string[],
      backHref: `/broadcast/xiangqi/${encodeURIComponent(data.tour.slug)}`,
      backLabel: t('broadcast.backToTournament'),
      switcher: roundSwitcher(data.tour.slug, data.rounds ?? [], data.round.id),
    }),
  );

  // Only once the round is over: while it is running, freshness is the more
  // useful thing in that slot and the round date is the same on every card.
  const roundPlayedOn =
    data.boards.length > 0 && data.boards.every((board) => board.status !== 'live')
      ? formatDate(data.round.startsAt)
      : null;

  const section = document.createElement('section');
  section.className = 'xqb-section';
  const heading = document.createElement('h2');
  heading.textContent = t('broadcast.boards');
  const grid = document.createElement('div');
  grid.className = 'xqb-board-grid';
  // Live boards lead the grid; within a status band the pairing order holds.
  const boards = [...data.boards].sort(
    (a, b) =>
      Number(a.status !== 'live') - Number(b.status !== 'live') || a.boardNumber - b.boardNumber,
  );
  for (const board of boards) {
    grid.append(boardCardFor(board, cards, roundPlayedOn));
  }
  // Boards that left the round entirely must not pin their cards in memory.
  if (cards) {
    const live = new Set(boards.map((board) => board.id));
    for (const id of [...cards.keys()]) if (!live.has(id)) cards.delete(id);
  }
  section.append(heading, grid);
  const credit = recordsCreditLine(data.boards);
  if (credit) section.append(credit);
  main.append(section);
  return main;
}

function renderBoardReplay(
  data: BroadcastBoardResponse,
  context: BroadcastRoundResponse | null = null,
  opts: { animateHeadAdvance?: boolean } = {},
): HTMLElement {
  const main = broadcastShell();
  const frames = data.history.truth.length > 0 ? data.history.truth : [{ ply: 0, view: data.view }];
  const maxPly = frames.length - 1;
  const moveByPly = new Map(data.timeline.map((entry) => [entry.ply, entry.move]));
  let cursor = clamp(initialPlyFromUrl(), 0, maxPly);

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
  boardPanel.append(boardFrame, controls, boardMeta);

  const movesPanel = document.createElement('aside');
  movesPanel.className = 'xqb-moves-panel';
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
  const rail = context ? sideRail(context, data.board.id) : null;
  if (rail) {
    // Grid areas place the rail in the left column on wide viewports while it
    // stays last in DOM order, so narrow layouts stack it below the moves.
    layout.classList.add('xqb-board-layout-with-rail');
    layout.append(rail);
  }
  main.append(hero, layout);

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
    boardFrame.innerHTML = renderXiangqiBoardSvg(frame.view, 'red');
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
  return main;
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

  const eyebrow = document.createElement('p');
  eyebrow.className = 'xqb-eyebrow';
  eyebrow.textContent = input.eyebrow;
  const title = document.createElement('h1');
  title.textContent = input.title;
  copy.append(eyebrow, title);

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
function tourCard(entry: BroadcastIndexEntry): HTMLElement {
  const live = entry.liveBoardCount > 0;
  const card = document.createElement('a');
  card.className = live ? 'xqb-tour-card xqb-tour-card-live' : 'xqb-tour-card';
  card.href = `/broadcast/xiangqi/${encodeURIComponent(entry.tour.slug)}`;

  const boardEl = document.createElement('div');
  boardEl.className = 'xqb-card-board xiangqi-live-board';
  boardEl.setAttribute('aria-hidden', 'true');
  const view = entry.featuredBoard?.view ?? buildXiangqiReplayFromMoves([]).views[0]!;
  // Card thumbnail, aria-hidden and about a hundred pixels across. Coordinates
  // are noise at that size, and the card is framed by hand, so the reserved
  // gutter would change the silhouette every card shares.
  boardEl.innerHTML = renderXiangqiBoardSvg(view, 'red', { coordinates: false });

  const copy = document.createElement('div');
  copy.className = 'xqb-tour-card-copy';
  const name = document.createElement('strong');
  name.textContent = primaryName(entry.tour);
  copy.append(name);
  const tourZh = zhSubline(secondaryName(entry.tour));
  if (tourZh) copy.append(tourZh);
  const place = [entry.tour.location, dateRange(entry.tour.startsAt, entry.tour.endsAt)]
    .filter(Boolean)
    .join(' / ');
  if (place) {
    const placeLine = document.createElement('span');
    placeLine.className = 'xqb-tour-card-meta';
    placeLine.textContent = place;
    copy.append(placeLine);
  }
  const counts = document.createElement('span');
  counts.className = 'xqb-tour-card-meta';
  counts.textContent = [
    countLabel(entry.roundCount, 'round', 'rounds'),
    countLabel(entry.boardCount, 'board', 'boards'),
    live ? `${entry.liveBoardCount} live` : null,
  ]
    .filter(Boolean)
    .join(' / ');
  copy.append(counts);

  const foot = document.createElement('div');
  foot.className = 'xqb-card-foot';
  if (live) {
    foot.append(liveBadge());
  } else {
    const fresh = formatBroadcastFreshness(entry.updatedAt);
    if (fresh) foot.textContent = `Updated ${fresh}`;
  }

  card.append(boardEl, copy, foot);
  return card;
}

function liveBadge(): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'xqb-badge-live';
  badge.textContent = t('broadcast.live');
  return badge;
}

// A scannable mini-board card: the current position rebuilt from the board's
// move list (broadcasts are open truth, so the red-perspective truth view is
// safe to render), plus pairing + result/status. Links to the full board page.
function boardCard(board: BroadcastBoardSummary, playedOn?: string | null): HTMLElement {
  const card = document.createElement('a');
  card.className = `xqb-board-card xqb-board-card-${board.status}`;
  card.href = `/broadcast/xiangqi/board/${encodeURIComponent(board.id)}`;

  const top = document.createElement('div');
  top.className = 'xqb-card-top';
  const number = document.createElement('span');
  number.className = 'xqb-card-number';
  number.textContent = `Board ${board.boardNumber}`;
  // Live boards get the accent badge; finished boards get a neutral result pill.
  const badge =
    board.status === 'live'
      ? ' xqb-badge-live'
      : board.status === 'complete'
        ? ' xqb-badge-result'
        : '';
  const status = document.createElement('span');
  status.className = `xqb-status xqb-status-${board.status}${badge}`;
  status.textContent = resultLabel(board);
  top.append(number, status);

  const boardEl = document.createElement('div');
  boardEl.className = 'xqb-card-board xiangqi-live-board';
  boardEl.setAttribute('aria-hidden', 'true');
  const replay = buildXiangqiReplayFromMoves(board.moves ?? []);
  const view = replay.views[replay.maxPly] ?? replay.views[0]!;
  // Card thumbnail, aria-hidden and about a hundred pixels across. Coordinates
  // are noise at that size, and the card is framed by hand, so the reserved
  // gutter would change the silhouette every card shares.
  boardEl.innerHTML = renderXiangqiBoardSvg(view, 'red', { coordinates: false });

  const players = document.createElement('div');
  players.className = 'xqb-card-players';
  players.append(
    cardPlayer('red', board.red, board.result === '1-0'),
    cardPlayer('black', board.black, board.result === '0-1'),
  );

  const foot = document.createElement('div');
  foot.className = 'xqb-card-foot';
  // "2m ago" is a live signal and the right thing during a relay. Once a round
  // is over it falls through to a bare date, which reads as the date the game
  // was played and is in fact the date WE imported it: every board of a round
  // played Aug 16-18 said "Aug 29". A finished round shows the round's own date
  // instead, which is the fact a reader wanted from that slot.
  const fresh =
    board.status === 'live' ? 'live' : (playedOn ?? formatBroadcastFreshness(board.updatedAt));
  foot.textContent = [`${plyCount(board)} plies`, fresh].filter(Boolean).join(' / ');

  card.append(top, boardEl, players, foot);
  return card;
}

function cardPlayer(
  color: XiangqiColor,
  player: XiangqiBroadcastPlayerTag,
  won: boolean,
): HTMLElement {
  const row = document.createElement('span');
  row.className = `xqb-card-player xqb-card-player-${color}${won ? ' xqb-card-player-winner' : ''}`;
  // Name and team as separate elements, not one concatenated string. As one
  // string the ellipsis lands wherever the width runs out, which on a card this
  // wide was inside the team: "Wang Jiarui (Zhejian...". Split, the team gives
  // up its characters first and the player's name survives, which is the half a
  // reader is scanning for.
  const name = document.createElement('span');
  name.className = 'xqb-card-player-name';
  name.textContent = `${player.title ? `${player.title} ` : ''}${primaryName(player)}`;
  row.append(name);
  const federation = primaryFederation(player);
  if (federation) {
    const team = document.createElement('span');
    team.className = 'xqb-card-player-team';
    team.textContent = federation;
    team.title = federation;
    row.append(team);
  }
  const zh = zhSubline(playerNameZh(player), 'xqb-name-zh xqb-name-zh-inline');
  if (zh) row.append(zh);
  return row;
}

// The relay-games analog: every board in the same round, current pairing
// highlighted, so users hop between games without going back to the round
// page. Rebuilt from the mount-time round context on each render, so it is
// idempotent across SSE re-renders.
function sideRail(context: BroadcastRoundResponse, currentBoardId: string): HTMLElement | null {
  const boards = [...context.boards].sort((a, b) => a.boardNumber - b.boardNumber);
  if (boards.length === 0) return null;
  const rail = document.createElement('aside');
  rail.className = 'xqb-side-rail';
  const heading = document.createElement('h2');
  heading.textContent = primaryName(context.round);
  const list = document.createElement('div');
  list.className = 'xqb-rail-list';
  let currentRow: HTMLElement | null = null;
  for (const board of boards) {
    const current = board.id === currentBoardId;
    const row = document.createElement('a');
    row.className = current ? 'xqb-rail-row xqb-rail-row-current' : 'xqb-rail-row';
    row.href = `/broadcast/xiangqi/board/${encodeURIComponent(board.id)}`;
    if (current) row.setAttribute('aria-current', 'page');

    const players = document.createElement('span');
    players.className = 'xqb-rail-players';
    players.textContent = `${primaryName(board.red)} vs ${primaryName(board.black)}`;

    const marker = document.createElement('span');
    marker.className = `xqb-rail-marker xqb-status-${board.status}`;
    marker.textContent = railMarker(board);

    row.append(players, marker);
    list.append(row);
    if (current) currentRow = row;
  }
  rail.append(heading, list);
  scheduleRailScroll(list, currentRow);
  return rail;
}

function railMarker(board: Pick<BroadcastBoardSummary, 'status' | 'result'>): string {
  if (board.status === 'live') return t('broadcast.live');
  if (board.result === '1/2-1/2') return '½-½';
  if (board.result !== '*') return board.result;
  return '';
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
      button.textContent = moveLabel(entry.move);
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

function chevron(): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'xqb-chevron';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '>';
  return mark;
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

function boardVersion(data: BroadcastBoardResponse): string {
  return streamVersion([
    data.board.id,
    data.board.updatedAt,
    data.board.plyCount,
    data.board.status,
    data.board.result,
    data.state.status.type,
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

function plyCount(board: BroadcastBoardSummary): number {
  return board.plyCount ?? board.moves?.length ?? 0;
}

function moveLabel(move: XiangqiMove): string {
  return `${move.from}-${move.to}`;
}

function dateRange(startsAt: string | undefined, endsAt: string | undefined): string | null {
  const start = formatDate(startsAt);
  const end = formatDate(endsAt);
  if (start && end && start !== end) return `${start} to ${end}`;
  return start ?? end;
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: value.includes('T') ? 'numeric' : undefined,
    minute: value.includes('T') ? '2-digit' : undefined,
  }).format(date);
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
