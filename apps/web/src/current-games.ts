// /games — current games (lichess's "Current games"): every game in progress
// right now, live and correspondence, across every variant, as a grid of cards.
//
// Data: GET /api/games/current (see apps/server/src/current-games.ts). Open
// specs arrive with a board payload and mount the same live tenant renderer
// the homepage TV uses (mountShowcaseBoard in live mode, payload override);
// masked and sealed specs arrive as cards only, so nothing about a hidden
// position is ever on this page. Clocks tick client-side from the server
// snapshot; correspondence cards count down to the seat-on-move's deadline.
//
// At Mistboard's liquidity the empty state IS the page most of the day, so it
// is designed: open correspondence seeks (the way to make a game exist) and the
// most recent finished games, with a link to the database.

import './current-games.css';
import './account-profile.css';
import { displayLiveName, type FeaturedGame, variantDisplayLabel } from './game-display.js';
import { timeControlLabelForGame } from './game-meta.js';
import { t } from './i18n/catalog.js';
import { playerNameEl, profileTargetFor } from './profile-link.js';
import { buildProfileGameRow } from './profile-ui.js';
import type { ReplayHandle } from './replay.js';
import { buildNav, buildNotice } from './site-shell.js';
import { buildUiIcon } from './ui-icon.js';
import { renderVariantMarker } from './variant-markers.js';
import type { VariantMiniId } from './variant-mini-boards.js';
import { formatClock, formatDayClock } from './web-utils.js';

const POLL_MS = 5_000;
const HIDDEN_POLL_MS = 30_000;
const CLOCK_TICK_MS = 250;
const RECENT_GAMES_LIMIT = 10;
const CHANNEL_ALL = 'all';

type CurrentGamePlayer = {
  color: string;
  name: string | null;
  // Linkable seat identity, at most one set: `handle` for a signed-in account,
  // `botId` for a first-party bot. Both null for guests and for raw engine
  // versions, neither of which has a public page.
  handle: string | null;
  botId?: string | null;
  isEngine: boolean;
};

type CurrentGameClock = {
  activeColor: string | null;
  remainingMs: Record<string, number>;
  asOf: number;
  running: boolean;
};

type CurrentGame = {
  roomId: string;
  gameSpecId: string;
  channelId: string | null;
  composition: 'pvp' | 'pve';
  observe: 'open' | 'masked' | 'sealed';
  players: CurrentGamePlayer[];
  ply: number;
  rated: boolean;
  startedAt: number | null;
  lastActivityAt: number | null;
  timeControl: { initialMs: number; incrementMs: number; daysPerMove?: number } | null;
  timeClass: 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence' | null;
  clock: CurrentGameClock | null;
  deadline: { seat: string; dueAt: string } | null;
  url: string;
  payload?: Record<string, unknown>;
};

type CurrentGamesChannel = {
  id: string;
  label: string;
  family: string;
  gameSpecIds: string[];
  count: number;
};

type CurrentGamesResponse = {
  channel: string;
  channels: CurrentGamesChannel[];
  games: CurrentGame[];
  now: string;
  total: number;
};

type CorrespondenceSeek = {
  id: string;
  gameSpecId: string;
  daysPerMove: number;
  creatorName: string | null;
};

// Same marker map the /watch rail uses (watch-route.ts); duplicated rather than
// imported so this page does not pull the 2,000-line watch module into its chunk.
const CHANNEL_MINI_BY_ID: Record<string, VariantMiniId> = {
  'dark-chess': 'dark-chess',
  xiangqi: 'xiangqi',
  'dark-xiangqi': 'dark-xiangqi',
  'fortress-xiangqi': 'fortress-xiangqi',
  jieqi: 'jieqi',
  banqi: 'banqi',
  'dark-crazyhouse': 'dark-crazyhouse',
  kriegspiel: 'kriegspiel',
  jungle: 'jungle',
  'jungle-flip': 'jungle-flip',
  // Duck Xiangqi. Present in watch-route.ts's copy of this map since the
  // channel was added; missing here, which would have rendered an empty marker
  // slot for duck rows the moment the server flag turned on. The two maps are
  // duplicated deliberately (see above) and so drift exactly like this.
  'duck-xiangqi': 'duck-xiangqi',
};

type CardState = {
  game: CurrentGame;
  root: HTMLElement;
  boardRoot: HTMLElement;
  clockEls: Record<string, HTMLElement>;
  // Client time the clock snapshot arrived; the tick drains from here.
  clockReceivedAt: number;
  handle: ReplayHandle | null;
  mounting: Promise<void> | null;
  payload: Record<string, unknown> | null;
  shownPly: number;
};

export async function mountCurrentGames(root: HTMLElement): Promise<void> {
  root.classList.add('landing-page', 'current-games-page');
  root.replaceChildren(buildNav());

  const shell = document.createElement('main');
  shell.className = 'site-section current-games-shell';

  const header = document.createElement('header');
  header.className = 'current-games-header';
  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('games.heading');
  const subtitle = document.createElement('p');
  subtitle.className = 'current-games-subtitle';
  subtitle.textContent = t('games.subtitle');
  const countLine = document.createElement('p');
  countLine.className = 'current-games-count';
  countLine.setAttribute('aria-live', 'polite');
  header.append(heading, subtitle, countLine);

  const layout = document.createElement('div');
  layout.className = 'current-games-layout';
  const rail = document.createElement('nav');
  rail.className = 'current-games-rail';
  rail.setAttribute('aria-label', t('games.allChannels'));
  const mainCol = document.createElement('div');
  mainCol.className = 'current-games-main';
  const gridHost = document.createElement('section');
  gridHost.className = 'current-games-grid-host';
  const emptyHost = document.createElement('section');
  emptyHost.className = 'current-games-empty-host';
  emptyHost.hidden = true;
  const recentHost = document.createElement('section');
  recentHost.className = 'current-games-recent';
  mainCol.append(gridHost, emptyHost, recentHost);
  layout.append(rail, mainCol);
  shell.append(header, layout);
  root.append(shell);

  const grid = document.createElement('div');
  grid.className = 'current-games-grid';
  gridHost.append(grid);

  const cards = new Map<string, CardState>();
  let channel = readChannel();
  let destroyed = false;
  let pollTimer: number | null = null;
  let lastResponse: CurrentGamesResponse | null = null;
  let emptyRendered = false;

  const abort = new AbortController();
  const isConnected = (): boolean => !destroyed && root.isConnected;

  // ---- data -------------------------------------------------------------

  const knownParam = (): string =>
    [...cards.values()]
      .filter((card) => card.payload !== null)
      .map((card) => `${card.game.roomId}:${card.shownPly}`)
      .join(',');

  async function fetchCurrent(): Promise<CurrentGamesResponse | null> {
    const params = new URLSearchParams();
    if (channel !== CHANNEL_ALL) params.set('channel', channel);
    const known = knownParam();
    if (known) params.set('known', known);
    const query = params.toString();
    const response = await fetch(`/api/games/current${query ? `?${query}` : ''}`).catch(() => null);
    if (!response?.ok) return null;
    return (await response.json().catch(() => null)) as CurrentGamesResponse | null;
  }

  async function refresh(): Promise<void> {
    if (!isConnected()) return;
    const data = await fetchCurrent();
    if (!isConnected()) return;
    if (!data) {
      if (!lastResponse) {
        gridHost.replaceChildren(buildNotice(t('games.feedUnavailable'), t('games.subtitle')));
      }
      schedulePoll();
      return;
    }
    lastResponse = data;
    renderRail(rail, data, channel);
    renderCount(countLine, data.total);
    await reconcile(data.games);
    schedulePoll();
  }

  function schedulePoll(): void {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    if (!isConnected()) return;
    pollTimer = window.setTimeout(() => void refresh(), document.hidden ? HIDDEN_POLL_MS : POLL_MS);
  }

  // ---- cards ------------------------------------------------------------

  async function reconcile(games: CurrentGame[]): Promise<void> {
    const seen = new Set<string>();
    for (const game of games) {
      seen.add(game.roomId);
      const existing = cards.get(game.roomId);
      if (existing) {
        updateCard(existing, game);
      } else {
        const card = createCard(game);
        cards.set(game.roomId, card);
      }
    }
    for (const [roomId, card] of cards) {
      if (seen.has(roomId)) continue;
      card.handle?.destroy();
      card.root.remove();
      cards.delete(roomId);
    }
    // Keep server order: rebuild the grid's child order from the response.
    const ordered = games.map((game) => cards.get(game.roomId)!.root);
    grid.replaceChildren(...ordered);
    if (games.length === 0) {
      if (!emptyRendered) {
        emptyRendered = true;
        await renderEmptyState(emptyHost);
      }
      // The seeks and CTAs are channel-independent; only the headline says
      // whether it is this channel or the whole site that is quiet.
      const label =
        channel === CHANNEL_ALL
          ? null
          : (lastResponse?.channels.find((entry) => entry.id === channel)?.label ?? null);
      const title = emptyHost.querySelector<HTMLElement>('.current-games-empty h2');
      if (title) title.textContent = label ? t('games.noneInChannel', { label }) : t('games.none');
      emptyHost.hidden = false;
      gridHost.hidden = true;
    } else {
      emptyHost.hidden = true;
      gridHost.hidden = false;
    }
    // Board mounts happen after the grid is on screen so a slow renderer
    // import never blocks the cards' text from appearing.
    for (const game of games) {
      const card = cards.get(game.roomId);
      if (card && game.payload) void showBoard(card, game.payload);
    }
  }

  function createCard(game: CurrentGame): CardState {
    const article = document.createElement('article');
    article.className = 'current-game-card';
    article.dataset.roomId = game.roomId;
    article.dataset.observe = game.observe;

    const link = document.createElement('a');
    link.className = 'current-game-link';
    link.href = game.url;
    link.setAttribute('aria-label', t('games.watchGame', { matchup: matchupLabel(game) }));

    const [top, bottom] = seatOrder(game);
    const clockEls: Record<string, HTMLElement> = {};
    const topRow = buildSeatRow(game, top, clockEls);
    const boardRoot = document.createElement('div');
    boardRoot.className = 'current-game-board';
    renderBoardPlaceholder(boardRoot, game);
    const bottomRow = buildSeatRow(game, bottom, clockEls);
    link.append(topRow, boardRoot, bottomRow);

    const meta = document.createElement('div');
    meta.className = 'current-game-meta';
    meta.textContent = metaLine(game);
    article.append(link, meta);

    const card: CardState = {
      boardRoot,
      clockEls,
      clockReceivedAt: Date.now(),
      game,
      handle: null,
      mounting: null,
      payload: null,
      root: article,
      shownPly: -1,
    };
    tickCard(card, Date.now());
    return card;
  }

  function updateCard(card: CardState, game: CurrentGame): void {
    card.game = game;
    card.clockReceivedAt = Date.now();
    card.root.dataset.observe = game.observe;
    const meta = card.root.querySelector<HTMLElement>('.current-game-meta');
    if (meta) meta.textContent = metaLine(game);
    tickCard(card, Date.now());
  }

  // Mount the live renderer once per card, then reload it on every new payload.
  // Serialized per card so a slow mount and a fast poll cannot interleave.
  function showBoard(card: CardState, payload: Record<string, unknown>): Promise<void> {
    card.payload = payload;
    const run = async (): Promise<void> => {
      if (!isConnected() || !cards.has(card.game.roomId)) return;
      const { mountShowcaseBoard } = await import('./showcase-board.js');
      if (!isConnected() || !cards.has(card.game.roomId)) return;
      const names = namesFor(card.game);
      if (!card.handle) {
        card.boardRoot.replaceChildren();
        card.handle = await mountShowcaseBoard(
          card.boardRoot,
          card.game.gameSpecId,
          card.game.roomId,
          {
            autoplay: false,
            hideReserve: true,
            live: true,
            loadPostgameOverride: async (roomId) =>
              card.payload && roomId === card.game.roomId
                ? { ok: true, postgame: card.payload }
                : { ok: false },
            loaderForId: async () => [],
            metadataByRoomId: {},
            namesByRoomId: { [card.game.roomId]: names },
            onLoadError: () => true,
            pov: 'white',
          },
        );
      } else {
        await card.handle.loadGame(card.game.roomId);
      }
      const end = card.handle.plyCount?.() ?? 0;
      card.handle.jumpToPly?.(end);
      card.shownPly = card.game.ply;
    };
    card.mounting = (card.mounting ?? Promise.resolve()).then(run).catch((err) => {
      console.warn('[current-games] board mount failed', err);
      card.payload = null;
      renderBoardPlaceholder(card.boardRoot, card.game);
    });
    return card.mounting;
  }

  // ---- clocks -----------------------------------------------------------

  const clockTimer = window.setInterval(() => {
    const now = Date.now();
    for (const card of cards.values()) tickCard(card, now);
  }, CLOCK_TICK_MS);

  // ---- lifecycle --------------------------------------------------------

  rail.addEventListener(
    'click',
    (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-channel]');
      if (!link) return;
      event.preventDefault();
      channel = link.dataset.channel ?? CHANNEL_ALL;
      writeChannel(channel);
      if (lastResponse) renderRail(rail, lastResponse, channel);
      void refresh();
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    'popstate',
    () => {
      channel = readChannel();
      void refresh();
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (!document.hidden) void refresh();
    },
    { signal: abort.signal },
  );

  const observer = new MutationObserver(() => {
    if (root.isConnected) return;
    destroyed = true;
    abort.abort();
    window.clearInterval(clockTimer);
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    for (const card of cards.values()) card.handle?.destroy();
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  void renderRecentGames(recentHost);
  await refresh();
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function readChannel(): string {
  return new URLSearchParams(window.location.search).get('channel') ?? CHANNEL_ALL;
}

function writeChannel(channel: string): void {
  const url = new URL(window.location.href);
  if (channel === CHANNEL_ALL) url.searchParams.delete('channel');
  else url.searchParams.set('channel', channel);
  window.history.pushState(null, '', url);
}

function renderCount(el: HTMLElement, total: number): void {
  el.textContent =
    total === 1 ? t('games.countOne', { count: total }) : t('games.countMany', { count: total });
}

function renderRail(root: HTMLElement, data: CurrentGamesResponse, active: string): void {
  root.replaceChildren();
  const all = railLink(CHANNEL_ALL, t('games.allChannels'), data.total, active === CHANNEL_ALL);
  all
    .querySelector('.current-games-rail-thumb')
    ?.append(buildUiIcon('featured-channel', 'current-games-rail-crown'));
  root.append(all);
  for (const channel of data.channels) {
    const link = railLink(channel.id, channel.label, channel.count, active === channel.id);
    const miniId = CHANNEL_MINI_BY_ID[channel.id];
    const thumb = link.querySelector<HTMLElement>('.current-games-rail-thumb');
    if (thumb && miniId) {
      thumb.classList.add('notranslate');
      thumb.setAttribute('translate', 'no');
      thumb.innerHTML = renderVariantMarker(miniId, {
        size: 112,
        label: `${channel.label} marker`,
      });
    }
    if (channel.count === 0) link.classList.add('is-quiet');
    root.append(link);
  }
}

function railLink(channelId: string, label: string, count: number, active: boolean): HTMLElement {
  const link = document.createElement('a');
  link.className = 'current-games-rail-link';
  link.dataset.channel = channelId;
  link.href =
    channelId === CHANNEL_ALL ? '/games' : `/games?channel=${encodeURIComponent(channelId)}`;
  const text = document.createElement('span');
  text.className = 'current-games-rail-text';
  const name = document.createElement('span');
  name.className = 'current-games-rail-name';
  name.textContent = label;
  const countEl = document.createElement('span');
  countEl.className = 'current-games-rail-count';
  countEl.textContent = String(count);
  text.append(name, countEl);
  const thumb = document.createElement('span');
  thumb.className = 'current-games-rail-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  link.append(text, thumb);
  if (active) {
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
  }
  return link;
}

// First mover (red / white) sits at the bottom, the way the player's own room
// and the TV board orient; the other seat is on top.
function seatOrder(game: CurrentGame): [CurrentGamePlayer | null, CurrentGamePlayer | null] {
  const first =
    game.players.find((player) => player.color === 'red' || player.color === 'white') ??
    game.players[0] ??
    null;
  const second = game.players.find((player) => player !== first) ?? null;
  return [second, first];
}

function buildSeatRow(
  game: CurrentGame,
  player: CurrentGamePlayer | null,
  clockEls: Record<string, HTMLElement>,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'current-game-seat';
  if (player) row.dataset.color = player.color;
  row.append(
    playerNameEl(
      displayLiveName(player?.name, t('games.guest')),
      profileTargetFor(player),
      'current-game-seat-name',
    ),
  );
  if (player?.isEngine) {
    const badge = document.createElement('span');
    badge.className = 'current-game-bot';
    badge.textContent = t('games.bot');
    row.append(badge);
  }
  const clock = document.createElement('span');
  clock.className = 'current-game-seat-clock';
  row.append(clock);
  if (player) clockEls[player.color] = clock;
  void game;
  return row;
}

function tickCard(card: CardState, now: number): void {
  const { game } = card;
  for (const [color, el] of Object.entries(card.clockEls)) {
    el.textContent = clockText(game, color, card.clockReceivedAt, now);
    el.classList.toggle(
      'is-active',
      game.timeClass === 'correspondence'
        ? game.deadline?.seat === color
        : game.clock?.activeColor === color && game.clock.running,
    );
  }
}

function clockText(game: CurrentGame, color: string, receivedAt: number, now: number): string {
  if (game.timeClass === 'correspondence') {
    if (!game.deadline || game.deadline.seat !== color) return '';
    return formatDayClock(Date.parse(game.deadline.dueAt) - now);
  }
  const clock = game.clock;
  if (!clock) return '';
  const base = clock.remainingMs[color];
  if (base === undefined) return '';
  const drained = clock.running && clock.activeColor === color ? base - (now - receivedAt) : base;
  return formatClock(drained);
}

function renderBoardPlaceholder(root: HTMLElement, game: CurrentGame): void {
  root.replaceChildren();
  const tile = document.createElement('div');
  tile.className = 'current-game-hidden';
  const miniId = game.channelId ? CHANNEL_MINI_BY_ID[game.channelId] : undefined;
  if (miniId) {
    const marker = document.createElement('span');
    marker.className = 'current-game-hidden-marker notranslate';
    marker.setAttribute('translate', 'no');
    marker.setAttribute('aria-hidden', 'true');
    marker.innerHTML = renderVariantMarker(miniId, { size: 160, label: '' });
    tile.append(marker);
  }
  const label = document.createElement('span');
  label.className = 'current-game-hidden-label';
  label.textContent =
    game.observe === 'open' ? variantDisplayLabel(game.gameSpecId) : t('games.hiddenWhileLive');
  tile.append(label);
  root.append(tile);
}

function matchupLabel(game: CurrentGame): string {
  const [top, bottom] = seatOrder(game);
  const a = displayLiveName(bottom?.name, t('games.guest'));
  const b = displayLiveName(top?.name, t('games.guest'));
  return `${a} vs ${b}`;
}

function namesFor(game: CurrentGame): { first: string; second: string } {
  const [top, bottom] = seatOrder(game);
  return {
    first: displayLiveName(bottom?.name, t('games.guest')),
    second: displayLiveName(top?.name, t('games.guest')),
  };
}

function metaLine(game: CurrentGame): string {
  const parts: string[] = [variantDisplayLabel(game.gameSpecId)];
  if (game.timeClass === 'correspondence') {
    const days = game.timeControl?.daysPerMove ?? 0;
    parts.push(days === 1 ? t('games.oneDayPerMove') : t('games.daysPerMove', { count: days }));
    parts.push(t('games.correspondence'));
  } else {
    const label = game.timeControl ? timeControlLabelForGame(asFeaturedGame(game)) : null;
    if (label) parts.push(label);
    parts.push(t('games.live'));
  }
  parts.push(game.rated ? t('games.rated') : t('games.casual'));
  parts.push(t('games.moveCount', { count: game.ply }));
  return parts.join(' · ');
}

function asFeaturedGame(game: CurrentGame): FeaturedGame {
  return {
    blackName: null,
    corpusId: null,
    incrementMs: game.timeControl?.incrementMs ?? null,
    initialMs: game.timeControl?.initialMs ?? null,
    plyCount: game.ply,
    result: '',
    roomId: game.roomId,
    termination: '',
    variant: game.gameSpecId,
    whiteName: null,
  };
}

// ---------------------------------------------------------------------------
// Empty state + recent games
// ---------------------------------------------------------------------------

async function renderEmptyState(host: HTMLElement): Promise<void> {
  host.replaceChildren();
  const notice = document.createElement('section');
  notice.className = 'current-games-empty';
  const title = document.createElement('h2');
  title.textContent = t('games.none');
  const body = document.createElement('p');
  body.textContent = t('games.noneBody');
  const actions = document.createElement('div');
  actions.className = 'current-games-actions';
  const play = document.createElement('a');
  play.className = 'current-games-cta';
  play.href = '/play';
  play.textContent = t('games.playNow');
  const post = document.createElement('a');
  post.className = 'current-games-cta is-secondary';
  post.href = '/correspondence';
  post.textContent = t('games.postAGame');
  actions.append(play, post);
  notice.append(title, body, actions);
  host.append(notice);

  const seeks = await fetchSeeks();
  if (seeks === null) return;
  const section = document.createElement('section');
  section.className = 'current-games-seeks';
  const heading = document.createElement('h2');
  heading.textContent = t('games.openSeeks');
  section.append(heading);
  if (seeks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'current-games-muted';
    empty.textContent = t('games.noOpenSeeks');
    section.append(empty);
  } else {
    const list = document.createElement('ol');
    list.className = 'current-games-seek-list';
    for (const seek of seeks) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'current-games-seek';
      link.href = '/correspondence';
      const who = document.createElement('span');
      who.className = 'current-games-seek-name';
      who.textContent = displayLiveName(seek.creatorName, t('games.anonymous'));
      const what = document.createElement('span');
      what.className = 'current-games-seek-detail';
      what.textContent = `${variantDisplayLabel(seek.gameSpecId)} · ${
        seek.daysPerMove === 1
          ? t('games.oneDayPerMove')
          : t('games.daysPerMove', { count: seek.daysPerMove })
      }`;
      link.append(who, what);
      item.append(link);
      list.append(item);
    }
    section.append(list);
  }
  host.append(section);
}

// null = the seek board is unavailable (correspondence disabled, or an error):
// render nothing rather than a broken section.
async function fetchSeeks(): Promise<CorrespondenceSeek[] | null> {
  const response = await fetch('/api/correspondence/seeks').catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { seeks?: CorrespondenceSeek[] } | null;
  return body?.seeks ?? null;
}

async function renderRecentGames(host: HTMLElement): Promise<void> {
  const response = await fetch('/api/watch?channel=top').catch(() => null);
  if (!response?.ok) return;
  const body = (await response.json().catch(() => null)) as { unlocked?: FeaturedGame[] } | null;
  const games = (body?.unlocked ?? []).slice(0, RECENT_GAMES_LIMIT);
  if (games.length === 0) return;
  host.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = t('games.recentGames');
  const list = document.createElement('ol');
  list.className = 'profile-game-list current-games-recent-list';
  for (const game of games) list.append(buildProfileGameRow(game, { neutral: true }));
  const more = document.createElement('a');
  more.className = 'current-games-search-link';
  more.href = '/games/search';
  more.textContent = t('games.searchAll');
  host.append(heading, list, more);
}
