// /games — current games (lichess's "Current games"), laid out as a board wall:
// every game in progress right now, live and correspondence, across every
// variant, as board cards in two sections, with the most recent finished games
// below so the page never reads as dead.
//
// Data: GET /api/games/current (see apps/server/src/current-games.ts). Open
// specs arrive with a board payload and mount the same live tenant renderer
// the homepage TV uses (mountShowcaseBoard in live mode, payload override);
// masked and sealed specs arrive as cards only and get the misty tile, so
// nothing about a hidden position is ever on this page. Clocks tick
// client-side from the server snapshot; correspondence cards count down to the
// seat-on-move's deadline with a thin bar of the move's allowance left.
//
// Filters: the variant chips are the server's `channel` param (only channels
// with a game right now, plus a URL-selected one at zero); Everyone / People
// only / Bots is client-side over the list, on the `players` param.
//
// Just finished: /api/watch's public replay pool (the same games /watch plays),
// final positions drawn by the same showcase renderer /watch's queue preview
// uses, in its default compact view. Open-information variants plus jieqi and
// banqi (whose finished boards /watch already shows publicly, face-down pieces
// face-down) draw a board (finishedTileKind); fog and every other hidden variant
// keep the misty tile.
//
// Pure logic (chips, filter, sections, empty state, urgency) lives in
// current-games-model.ts.

import './current-games.css';
import type { GameEvent } from '@mistboard/game';
import {
  CHANNEL_ALL,
  type CurrentGame,
  type CurrentGamePlayer,
  type CurrentGamesResponse,
  deadlineFractionLeft,
  type EmptyHeadline,
  emptyHeadline,
  filterByPlayers,
  finishedMatchesFilter,
  finishedTileKind,
  isLowClock,
  liveTileKind,
  PLAYER_FILTER_PARAM,
  PLAYER_FILTERS,
  type PlayerFilter,
  parsePlayerFilter,
  splitSections,
  variantChips,
} from './current-games-model.js';
import { watchQueueResultLabel } from './finished-result-label.js';
import {
  displayLiveName,
  displayParticipantName,
  type FeaturedGame,
  matchupSeats,
  namesMatchupLabel,
  terminationLabel,
  variantDisplayLabel,
  watchChannelLabel,
} from './game-display.js';
import { gameMetaForGame, timeControlLabelForGame } from './game-meta.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale } from './i18n/locale.js';
import { playerNameEl, profileTargetFor } from './profile-link.js';
import { formatGameTime, profileGameHref } from './profile-ui.js';
import type { ReplayHandle } from './replay.js';
import { specIdForShowcaseVariant } from './showcase-dispatch.js';
import { buildNav, buildNotice } from './site-shell.js';
import { renderVariantMarker } from './variant-markers.js';
import { WATCH_CHANNEL_MINI_IDS } from './watch-channel-markers.js';
import { formatClock, formatDayClock } from './web-utils.js';

const POLL_MS = 5_000;
const HIDDEN_POLL_MS = 30_000;
const CLOCK_TICK_MS = 250;
// One row of final positions at desktop width; "Search all games" has the rest.
const FINISHED_LIMIT = 6;
// The finished feed is re-read at most this often; the 5 s poll re-renders from cache.
const FINISHED_TTL_MS = 60_000;

type CorrespondenceSeek = {
  id: string;
  gameSpecId: string;
  daysPerMove: number;
  creatorName: string | null;
};

type CardState = {
  game: CurrentGame;
  root: HTMLElement;
  boardRoot: HTMLElement;
  clockEls: Record<string, HTMLElement>;
  bar: HTMLElement | null;
  meta: HTMLElement;
  // Client time the clock snapshot arrived; the tick drains from here.
  clockReceivedAt: number;
  handle: ReplayHandle | null;
  mounting: Promise<void> | null;
  payload: Record<string, unknown> | null;
  shownPly: number;
};

type SectionEls = { root: HTMLElement; grid: HTMLElement; aside: HTMLElement };

export async function mountCurrentGames(root: HTMLElement): Promise<void> {
  root.classList.add('landing-page', 'current-games-page');
  root.replaceChildren(buildNav());

  const shell = document.createElement('main');
  shell.className = 'site-section current-games-shell';

  // ---- header -------------------------------------------------------------
  const header = document.createElement('header');
  header.className = 'current-games-header current-games-hero';
  const titleBlock = document.createElement('div');
  titleBlock.className = 'current-games-titleblock';
  const titleRow = document.createElement('div');
  titleRow.className = 'current-games-titlerow';
  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('games.heading');
  const pill = document.createElement('span');
  pill.className = 'current-games-pill';
  pill.setAttribute('aria-live', 'polite');
  pill.hidden = true;
  titleRow.append(heading, pill);
  const subtitle = document.createElement('p');
  subtitle.className = 'current-games-subtitle';
  subtitle.textContent = t('games.subtitle');
  titleBlock.append(titleRow, subtitle);
  header.append(titleBlock, buildActions());

  // ---- toolbar: variant chips + who is playing --------------------------------
  const toolbar = document.createElement('div');
  toolbar.className = 'current-games-toolbar';
  const chipRow = document.createElement('nav');
  chipRow.className = 'current-games-chips';
  chipRow.setAttribute('aria-label', t('games.variantFilter'));
  const segmented = document.createElement('div');
  segmented.className = 'current-games-segmented';
  segmented.setAttribute('role', 'group');
  segmented.setAttribute('aria-label', t('games.playerFilter'));
  const filterLabels: Record<PlayerFilter, I18nKey> = {
    bots: 'games.filterBots',
    everyone: 'games.filterEveryone',
    people: 'games.filterPeople',
  };
  for (const value of PLAYER_FILTERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'current-games-segment';
    button.dataset.players = value;
    button.textContent = t(filterLabels[value]);
    segmented.append(button);
  }
  toolbar.append(chipRow, segmented);

  // ---- sections -------------------------------------------------------------
  const emptyHost = document.createElement('section');
  emptyHost.className = 'current-games-empty-host';
  emptyHost.hidden = true;
  const live = buildSection('live', t('games.liveNow'));
  const sortNote = document.createElement('span');
  sortNote.className = 'current-games-section-note';
  sortNote.textContent = t('games.sortedPeopleFirst');
  live.aside.append(sortNote);
  const corr = buildSection('correspondence', t('games.byCorrespondence'));
  const finished = buildSection('finished', t('games.justFinished'));
  finished.root.hidden = true;
  finished.grid.className = 'current-games-finished-grid';
  finished.aside.append(
    moreLink('/games/search', t('games.searchAll')),
    moreLink('/data', t('games.downloadData')),
  );

  shell.append(header, toolbar, emptyHost, live.root, corr.root, finished.root);
  root.append(shell);

  const cards = new Map<string, CardState>();
  let channel = readChannel();
  let players = readPlayers();
  let destroyed = false;
  let pollTimer: number | null = null;
  let lastResponse: CurrentGamesResponse | null = null;
  let seeks: CorrespondenceSeek[] | null = null;
  const finishedByChannel = new Map<
    string,
    { at: number; games: FeaturedGame[]; pending: Promise<FeaturedGame[]> | null }
  >();
  let finishedHandles: ReplayHandle[] = [];
  let finishedKey = '';

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
        live.root.hidden = false;
        live.grid.replaceChildren(buildNotice(t('games.feedUnavailable'), t('games.subtitle')));
      }
      schedulePoll();
      return;
    }
    lastResponse = data;
    render();
    schedulePoll();
  }

  function schedulePoll(): void {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    if (!isConnected()) return;
    pollTimer = window.setTimeout(() => void refresh(), document.hidden ? HIDDEN_POLL_MS : POLL_MS);
  }

  // Everything that depends on the response, the channel or the players filter.
  function render(): void {
    const data = lastResponse;
    if (!data) return;
    renderPill(pill, data.total);
    renderChips(chipRow, data, channel);
    renderSegmented(segmented, players);
    const shown = filterByPlayers(data.games, players);
    reconcile(shown);
    renderEmpty(emptyHeadline(shown.length, channel, players));
    renderSeeksLink();
    void renderFinished();
  }

  // ---- cards ------------------------------------------------------------

  function reconcile(games: CurrentGame[]): void {
    const seen = new Set<string>();
    for (const game of games) {
      seen.add(game.roomId);
      const existing = cards.get(game.roomId);
      if (existing) updateCard(existing, game);
      else cards.set(game.roomId, createCard(game));
    }
    for (const [roomId, card] of cards) {
      if (seen.has(roomId)) continue;
      card.handle?.destroy();
      card.root.remove();
      cards.delete(roomId);
    }
    // Keep server order inside each section.
    const sections = splitSections(games);
    live.grid.replaceChildren(...sections.live.map((game) => cards.get(game.roomId)!.root));
    corr.grid.replaceChildren(
      ...sections.correspondence.map((game) => cards.get(game.roomId)!.root),
    );
    live.root.hidden = sections.live.length === 0;
    corr.root.hidden = sections.correspondence.length === 0;
    // Board mounts happen after the cards are on screen so a slow renderer
    // import never blocks the cards' text from appearing.
    for (const game of games) {
      const card = cards.get(game.roomId);
      if (card && game.payload && liveTileKind(game) === 'board') {
        void showBoard(card, game.payload);
      }
    }
  }

  function createCard(game: CurrentGame): CardState {
    const correspondence = game.timeClass === 'correspondence';
    const article = document.createElement('article');
    article.className = 'current-game-card';
    article.dataset.roomId = game.roomId;
    article.dataset.observe = game.observe;

    // The card is a box with a stretched overlay link rather than one big <a>:
    // the player names inside are profile links, and an <a> inside an <a> is
    // invalid (same pattern as the profile game rows).
    const open = document.createElement('a');
    open.className = 'current-game-open';
    open.href = game.url;
    open.setAttribute('aria-label', t('games.watchGame', { matchup: matchupLabel(game) }));

    const [top, bottom] = seatOrder(game);
    const clockEls: Record<string, HTMLElement> = {};
    const topRow = buildSeatRow(top, clockEls);
    const boardRoot = document.createElement('div');
    boardRoot.className = 'current-game-board';
    renderBoardPlaceholder(boardRoot, game);
    const bottomRow = buildSeatRow(bottom, clockEls);
    article.append(open, topRow, boardRoot, bottomRow);

    let bar: HTMLElement | null = null;
    if (correspondence) {
      const track = document.createElement('div');
      track.className = 'current-game-bar';
      track.setAttribute('aria-hidden', 'true');
      bar = document.createElement('span');
      track.append(bar);
      article.append(track);
    }

    const meta = document.createElement('div');
    meta.className = 'current-game-meta';
    renderMeta(meta, game);
    article.append(meta);

    const card: CardState = {
      bar,
      boardRoot,
      clockEls,
      clockReceivedAt: Date.now(),
      game,
      handle: null,
      meta,
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
    renderMeta(card.meta, game);
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

  // ---- empty state ---------------------------------------------------------

  function renderEmpty(headline: EmptyHeadline | null): void {
    if (!headline) {
      emptyHost.hidden = true;
      return;
    }
    emptyHost.replaceChildren();
    const notice = document.createElement('div');
    notice.className = 'current-games-empty';
    const title = document.createElement('h2');
    title.textContent = emptyHeadlineText(headline, lastResponse);
    const body = document.createElement('p');
    body.textContent = t('games.noneBody');
    notice.append(title, body);
    emptyHost.append(notice);
    // Open seeks are how a correspondence game comes to exist; shown only when
    // there are some, so the quiet state stays quiet.
    if (seeks && seeks.length > 0) emptyHost.append(buildSeekList(seeks));
    emptyHost.hidden = false;
  }

  function renderSeeksLink(): void {
    corr.aside.replaceChildren();
    if (!seeks || seeks.length === 0) return;
    corr.aside.append(
      moreLink('/correspondence', t('games.openSeeksCount', { count: seeks.length })),
    );
  }

  // ---- just finished -------------------------------------------------------

  async function renderFinished(): Promise<void> {
    const feedChannel = channel === CHANNEL_ALL ? 'top' : channel;
    let cached = finishedByChannel.get(feedChannel);
    if (!cached || Date.now() - cached.at > FINISHED_TTL_MS) {
      const at = Date.now();
      const pending = cached?.pending ?? fetchFinished(feedChannel);
      finishedByChannel.set(feedChannel, {
        at: cached?.at ?? 0,
        games: cached?.games ?? [],
        pending,
      });
      const fetched = await pending;
      if (!isConnected()) return;
      cached = { at, games: fetched, pending: null };
      finishedByChannel.set(feedChannel, cached);
      // A channel switch while this fetch was in flight renders its own feed.
      if (feedChannel !== (channel === CHANNEL_ALL ? 'top' : channel)) return;
    }
    const games = cached.games;
    const shown = games
      .filter((game) => finishedMatchesFilter(game.mode, players))
      .slice(0, FINISHED_LIMIT);
    const key = `${feedChannel}|${players}|${shown.map((game) => game.roomId).join(',')}`;
    if (key === finishedKey) return;
    finishedKey = key;
    for (const handle of finishedHandles) handle.destroy();
    finishedHandles = [];
    finished.root.hidden = shown.length === 0;
    finished.grid.replaceChildren(...shown.map((game) => buildFinishedTile(game)));
    for (const game of shown) {
      if (finishedTileKind(game.variant) !== 'board') continue;
      const host = finished.grid.querySelector<HTMLElement>(
        `[data-room-id="${CSS.escape(game.roomId)}"] .current-game-board`,
      );
      if (host) void mountFinishedBoard(host, game, key);
    }
  }

  async function mountFinishedBoard(
    host: HTMLElement,
    game: FeaturedGame,
    key: string,
  ): Promise<void> {
    try {
      const { mountShowcaseBoard } = await import('./showcase-board.js');
      if (!isConnected() || key !== finishedKey) return;
      const [first, second] = matchupSeats(game);
      host.replaceChildren();
      const handle = await mountShowcaseBoard(
        host,
        specIdForShowcaseVariant(game.variant),
        game.roomId,
        {
          autoplay: false,
          hideReserve: true,
          loaderForId: apiEventLoader,
          metadataByRoomId: { [game.roomId]: gameMetaForGame(game) },
          namesByRoomId: {
            [game.roomId]: {
              first: displayParticipantName(game, first),
              second: displayParticipantName(game, second),
            },
          },
          onLoadError: () => true,
          pov: 'white',
          revealOnFinish: true,
        },
      );
      if (!isConnected() || key !== finishedKey) {
        handle.destroy();
        return;
      }
      finishedHandles.push(handle);
      handle.jumpToPly?.(handle.plyCount?.() ?? game.plyCount);
    } catch (err) {
      console.warn('[current-games] finished board failed', err);
      host.replaceChildren(buildFogTile(variantDisplayLabel(game.variant), null));
    }
  }

  // ---- clocks -----------------------------------------------------------

  const clockTimer = window.setInterval(() => {
    const now = Date.now();
    for (const card of cards.values()) tickCard(card, now);
  }, CLOCK_TICK_MS);

  // ---- lifecycle --------------------------------------------------------

  chipRow.addEventListener(
    'click',
    (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-channel]');
      if (!link) return;
      event.preventDefault();
      const next = link.dataset.channel ?? CHANNEL_ALL;
      if (next === channel) return;
      channel = next;
      writeParams(channel, players);
      if (lastResponse) renderChips(chipRow, lastResponse, channel);
      void refresh();
    },
    { signal: abort.signal },
  );
  segmented.addEventListener(
    'click',
    (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        'button[data-players]',
      );
      if (!button) return;
      const next = parsePlayerFilter(button.dataset.players ?? null);
      if (next === players) return;
      players = next;
      writeParams(channel, players);
      render();
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    'popstate',
    () => {
      const nextChannel = readChannel();
      players = readPlayers();
      if (nextChannel !== channel) {
        channel = nextChannel;
        void refresh();
      } else {
        render();
      }
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
    for (const handle of finishedHandles) handle.destroy();
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  seeks = await fetchSeeks();
  await refresh();
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function readChannel(): string {
  return new URLSearchParams(window.location.search).get('channel') ?? CHANNEL_ALL;
}

function readPlayers(): PlayerFilter {
  return parsePlayerFilter(new URLSearchParams(window.location.search).get(PLAYER_FILTER_PARAM));
}

function writeParams(channel: string, players: PlayerFilter): void {
  const url = new URL(window.location.href);
  if (channel === CHANNEL_ALL) url.searchParams.delete('channel');
  else url.searchParams.set('channel', channel);
  if (players === 'everyone') url.searchParams.delete(PLAYER_FILTER_PARAM);
  else url.searchParams.set(PLAYER_FILTER_PARAM, players);
  window.history.pushState(null, '', url);
}

function buildActions(): HTMLElement {
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
  return actions;
}

function buildSection(kind: string, title: string): SectionEls {
  const root = document.createElement('section');
  root.className = 'current-games-section';
  root.dataset.section = kind;
  const head = document.createElement('div');
  head.className = 'current-games-section-head';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  const aside = document.createElement('div');
  aside.className = 'current-games-section-aside';
  head.append(h2, aside);
  const grid = document.createElement('div');
  grid.className = 'current-games-grid';
  root.append(head, grid);
  return { aside, grid, root };
}

function moreLink(href: string, label: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'current-games-more-link';
  link.href = href;
  link.textContent = label;
  return link;
}

function renderPill(el: HTMLElement, total: number): void {
  el.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'current-games-pill-dot';
  dot.setAttribute('aria-hidden', 'true');
  el.append(dot, document.createTextNode(t('games.inPlay', { count: total })));
  el.classList.toggle('is-quiet', total === 0);
  el.hidden = false;
}

function renderChips(root: HTMLElement, data: CurrentGamesResponse, active: string): void {
  const byId = new Map(data.channels.map((entry) => [entry.id, entry]));
  root.replaceChildren();
  for (const chip of variantChips(data.channels, data.total, active)) {
    const entry = byId.get(chip.id);
    const label =
      chip.id === CHANNEL_ALL ? t('games.allChip') : entry ? watchChannelLabel(entry) : chip.id;
    const link = document.createElement('a');
    link.className = 'current-games-chip';
    link.dataset.channel = chip.id;
    link.href =
      chip.id === CHANNEL_ALL ? '/games' : `/games?channel=${encodeURIComponent(chip.id)}`;
    const name = document.createElement('span');
    name.className = 'current-games-chip-name';
    name.textContent = label;
    const count = document.createElement('span');
    count.className = 'current-games-chip-count';
    count.textContent = String(chip.count);
    link.append(name, count);
    if (chip.selected) {
      link.classList.add('is-selected');
      link.setAttribute('aria-current', 'page');
    }
    root.append(link);
  }
}

function renderSegmented(root: HTMLElement, active: PlayerFilter): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-players]')) {
    const on = button.dataset.players === active;
    button.classList.toggle('is-selected', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function emptyHeadlineText(headline: EmptyHeadline, data: CurrentGamesResponse | null): string {
  if (headline.kind === 'people') return t('games.nonePeople');
  if (headline.kind === 'bots') return t('games.noneBots');
  if (headline.kind === 'channel') {
    const entry = data?.channels.find((candidate) => candidate.id === headline.channelId);
    if (entry) return t('games.noneInChannel', { label: watchChannelLabel(entry) });
  }
  return t('games.none');
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
  player: CurrentGamePlayer | null,
  clockEls: Record<string, HTMLElement>,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'current-game-seat';
  if (player) row.dataset.color = player.color;
  const who = document.createElement('span');
  who.className = 'current-game-seat-who';
  who.append(
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
    who.append(badge);
  }
  const clock = document.createElement('span');
  clock.className = 'current-game-seat-clock';
  row.append(who, clock);
  if (player) clockEls[player.color] = clock;
  return row;
}

function tickCard(card: CardState, now: number): void {
  const { game } = card;
  const correspondence = game.timeClass === 'correspondence';
  for (const [color, el] of Object.entries(card.clockEls)) {
    if (correspondence) {
      const onMove = game.deadline?.seat === color;
      el.textContent = onMove
        ? t('games.deadline', { time: formatDayClock(Date.parse(game.deadline!.dueAt) - now) })
        : '';
      el.classList.toggle('is-deadline', onMove);
      el.hidden = !onMove;
      continue;
    }
    const remaining = clockRemaining(game, color, card.clockReceivedAt, now);
    el.hidden = remaining === null;
    if (remaining === null) continue;
    el.textContent = formatClock(remaining);
    el.classList.toggle('is-active', game.clock?.activeColor === color && !!game.clock?.running);
    el.classList.toggle('is-low', isLowClock(remaining, game.timeControl?.initialMs));
  }
  if (card.bar) {
    const fraction = deadlineFractionLeft(game, now);
    card.bar.style.width = `${Math.round((fraction ?? 0) * 1000) / 10}%`;
  }
}

function clockRemaining(
  game: CurrentGame,
  color: string,
  receivedAt: number,
  now: number,
): number | null {
  const clock = game.clock;
  if (!clock) return null;
  const base = clock.remainingMs[color];
  if (base === undefined) return null;
  return clock.running && clock.activeColor === color
    ? Math.max(0, base - (now - receivedAt))
    : base;
}

// The tile shown where a board is not (yet) drawn. A hidden-information game
// gets the misty tile for its whole life on this page; an open game shows its
// variant marker until the live renderer mounts.
function renderBoardPlaceholder(root: HTMLElement, game: CurrentGame): void {
  if (liveTileKind(game) === 'fog') {
    root.replaceChildren(buildFogTile(variantDisplayLabel(game.gameSpecId), t('games.inTheFog')));
    return;
  }
  root.replaceChildren();
  const tile = document.createElement('div');
  tile.className = 'current-game-hidden';
  const miniId = game.channelId ? WATCH_CHANNEL_MINI_IDS[game.channelId] : undefined;
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
  label.textContent = variantDisplayLabel(game.gameSpecId);
  tile.append(label);
  root.append(tile);
}

const FOG_WAVES =
  '<svg viewBox="0 0 44 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 8c6-5 12 5 19 0s13-5 19 0M3 16c6-5 12 5 19 0s13-5 19 0M3 24c6-5 12 5 19 0s13-5 19 0"/></svg>';

function buildFogTile(variant: string, note: string | null): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'current-game-fog';
  const waves = document.createElement('span');
  waves.className = 'current-game-fog-waves';
  waves.innerHTML = FOG_WAVES;
  const name = document.createElement('span');
  name.className = 'current-game-fog-variant';
  name.textContent = variant;
  tile.append(waves, name);
  if (note) {
    const text = document.createElement('span');
    text.className = 'current-game-fog-note';
    text.textContent = note;
    tile.append(text);
  }
  return tile;
}

function renderMeta(root: HTMLElement, game: CurrentGame): void {
  const chip = document.createElement('span');
  chip.className = 'current-game-chip';
  chip.textContent = variantDisplayLabel(game.gameSpecId);
  const parts: string[] = [];
  if (game.timeClass === 'correspondence') {
    const days = game.timeControl?.daysPerMove ?? 0;
    parts.push(days === 1 ? t('games.oneDayPerMove') : t('games.daysPerMove', { count: days }));
  } else {
    const label = game.timeControl ? timeControlLabelForGame(asFeaturedGame(game)) : null;
    parts.push(
      [label, game.rated ? t('games.rated') : t('games.casual')].filter(Boolean).join(' '),
    );
  }
  parts.push(t('games.moveCount', { count: game.ply }));
  const text = document.createElement('span');
  text.textContent = parts.join(' · ');
  root.replaceChildren(chip, text);
}

function matchupLabel(game: CurrentGame): string {
  const { first, second } = namesFor(game);
  return namesMatchupLabel(first, second);
}

function namesFor(game: CurrentGame): { first: string; second: string } {
  const [top, bottom] = seatOrder(game);
  return {
    first: displayLiveName(bottom?.name, t('games.guest')),
    second: displayLiveName(top?.name, t('games.guest')),
  };
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
// Seeks + finished games
// ---------------------------------------------------------------------------

function buildSeekList(seeks: CorrespondenceSeek[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'current-games-seeks';
  const heading = document.createElement('h2');
  heading.textContent = t('games.openSeeks');
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
  section.append(heading, list);
  return section;
}

// null = the seek board is unavailable (correspondence disabled, or an error).
async function fetchSeeks(): Promise<CorrespondenceSeek[] | null> {
  const response = await fetch('/api/correspondence/seeks').catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { seeks?: CorrespondenceSeek[] } | null;
  return body?.seeks ?? null;
}

async function fetchFinished(channel: string): Promise<FeaturedGame[]> {
  const response = await fetch(`/api/watch?channel=${encodeURIComponent(channel)}`).catch(
    () => null,
  );
  if (!response?.ok) return [];
  const body = (await response.json().catch(() => null)) as { unlocked?: FeaturedGame[] } | null;
  return body?.unlocked ?? [];
}

async function apiEventLoader(roomId: string): Promise<GameEvent[]> {
  const resp = await fetch(`/api/games/${encodeURIComponent(roomId)}/events`);
  if (!resp.ok) throw new Error(`failed to load events for ${roomId}: ${resp.status}`);
  const data = (await resp.json()) as { events: GameEvent[] };
  return data.events;
}

function buildFinishedTile(game: FeaturedGame): HTMLElement {
  const locale = currentLocale();
  const [first, second] = matchupSeats(game);
  const matchup = namesMatchupLabel(
    displayParticipantName(game, first),
    displayParticipantName(game, second),
  );
  const tile = document.createElement('a');
  tile.className = 'current-game-finished';
  tile.dataset.roomId = game.roomId;
  tile.href = profileGameHref(game);
  tile.setAttribute('aria-label', t('games.finishedGame', { matchup }));
  const board = document.createElement('div');
  board.className = 'current-game-board';
  if (finishedTileKind(game.variant) === 'fog') {
    board.append(buildFogTile(variantDisplayLabel(game.variant), null));
  } else {
    board.classList.add('is-loading');
  }
  const names = document.createElement('span');
  names.className = 'current-game-finished-players';
  names.textContent = matchup;
  names.title = matchup;
  const line = document.createElement('span');
  line.className = 'current-game-finished-line';
  const result = document.createElement('span');
  result.className = 'current-game-result';
  result.textContent = watchQueueResultLabel(game);
  const reason = terminationLabel(game.termination);
  if (reason) result.title = reason;
  const when = document.createElement('span');
  when.className = 'current-game-finished-when';
  when.textContent = formatGameTime(game.endedAt, locale);
  line.append(result, when);
  tile.append(board, names, line);
  return tile;
}
