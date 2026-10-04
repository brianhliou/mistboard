// /games — current games (lichess's "Current games"), laid out as a board wall:
// every game in progress right now, live and correspondence, across every
// variant, plus the open correspondence seeks, as board cards in one "Playing
// now" wall, with the most recent finished games below so the page never reads
// as dead. Built for low liquidity: no variant or player filters, since a
// handful of games needs no narrowing; each card's kind (live, correspondence,
// open seek) is its coloured top edge and tag (current-games.css [data-kind]).
//
// Data: GET /api/games/current (see apps/server/src/current-games.ts). Open
// specs arrive with a board payload and mount the same live tenant renderer
// the homepage TV uses (mountShowcaseBoard in live mode, payload override);
// masked and sealed specs arrive as cards only and get the misty tile, so
// nothing about a hidden position is ever on this page. Clocks tick
// client-side from the server snapshot; correspondence cards count down to the
// seat-on-move's deadline with a thin bar of the move's allowance left. Open
// seeks draw the variant's starting position (seek-card.ts).
//
// Just finished: /api/watch's public replay pool (the same games /watch plays),
// final positions drawn by the same showcase renderer /watch's queue preview
// uses, in its default compact view. Open-information variants, the fog
// variants (a finished room is open to spectators, so the final board is
// revealed) and jieqi and banqi (face-down pieces face-down) draw a board
// (finishedTileKind); concealed hands keep the misty tile. Two rows first, "Show more" adds rows from the pool
// already loaded, and a board mounts only when its tile nears the viewport.
//
// Load order: the seeks, the current games, the finished pool and the board
// renderer's code are all requested at once; none waits on another.
//
// Pure logic (sections, urgency, tile kinds) lives in current-games-model.ts.

import './current-games.css';
import { type GameEvent, maybeGameSpecForId } from '@mistboard/game';
import {
  type CurrentGame,
  type CurrentGamePlayer,
  type CurrentGamesResponse,
  deadlineFractionLeft,
  finishedTileKind,
  isLowClock,
  liveCardShowsHands,
  liveTileKind,
  splitSections,
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
} from './game-display.js';
import { gameMetaForGame, timeControlLabelForGame } from './game-meta.js';
import { t } from './i18n/catalog.js';
import { currentLocale } from './i18n/locale.js';
import { playerNameEl, profileTargetFor } from './profile-link.js';
import { formatGameTime, profileGameHref } from './profile-ui.js';
import type { ReplayHandle } from './replay.js';
import { buildKindBadge, buildSeekCard } from './seek-card.js';
import { specIdForShowcaseVariant } from './showcase-dispatch.js';
import { buildNav, buildNotice } from './site-shell.js';
import { renderVariantMarker } from './variant-markers.js';
import { WATCH_CHANNEL_MINI_IDS } from './watch-channel-markers.js';
import { formatClock, formatDayClock } from './web-utils.js';

const POLL_MS = 5_000;
const HIDDEN_POLL_MS = 30_000;
const CLOCK_TICK_MS = 250;
// Two rows of final positions at desktop width; "Show more" adds this many again.
const FINISHED_PAGE = 12;
// The finished feed is re-read at most this often; the 5 s poll re-renders from cache.
const FINISHED_TTL_MS = 60_000;
// Start a finished board's fetch a little before its tile scrolls into view.
const FINISHED_MOUNT_MARGIN = '300px';

type CorrespondenceSeek = {
  id: string;
  gameSpecId: string;
  daysPerMove: number;
  creatorName: string | null;
  creatorHandle?: string | null;
  rated?: boolean;
  isMine?: boolean;
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

  // Everything the page needs, requested together: the seeks and the finished
  // pool used to wait on the current-games fetch, and the board code on all three.
  const seeksRequest = fetchSeeks();
  const finishedRequest = fetchFinished();
  void import('./showcase-board.js').catch(() => undefined);

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

  // ---- sections -------------------------------------------------------------
  const emptyHost = document.createElement('section');
  emptyHost.className = 'current-games-empty-host';
  emptyHost.hidden = true;
  const playing = buildSection('playing', t('games.playingNow'));
  playing.root.hidden = true;
  const finished = buildSection('finished', t('games.justFinished'));
  finished.root.hidden = true;
  finished.grid.className = 'current-games-finished-grid';
  finished.aside.append(
    moreLink('/games/search', t('games.searchAll')),
    moreLink('/data', t('games.downloadData')),
  );
  const showMore = document.createElement('button');
  showMore.type = 'button';
  showMore.className = 'current-games-show-more';
  showMore.textContent = t('games.showMore');
  showMore.hidden = true;
  finished.root.append(showMore);

  shell.append(header, emptyHost, playing.root, finished.root);
  root.append(shell);

  const cards = new Map<string, CardState>();
  const seekCards = new Map<string, HTMLElement>();
  let destroyed = false;
  let pollTimer: number | null = null;
  let lastResponse: CurrentGamesResponse | null = null;
  let seeks: CorrespondenceSeek[] | null = null;
  let finishedCache: {
    at: number;
    games: FeaturedGame[];
    pending: Promise<FeaturedGame[]> | null;
  } = { at: Date.now(), games: [], pending: finishedRequest };
  let finishedShown = FINISHED_PAGE;
  let finishedHandles: ReplayHandle[] = [];
  let finishedKey = '';
  const boardObserver =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              boardObserver?.unobserve(entry.target);
              const host = entry.target as HTMLElement;
              const game = pendingBoards.get(host);
              pendingBoards.delete(host);
              if (game) void mountFinishedBoard(host, game);
            }
          },
          { rootMargin: FINISHED_MOUNT_MARGIN },
        )
      : null;
  const pendingBoards = new Map<HTMLElement, FeaturedGame>();

  const abort = new AbortController();
  const isConnected = (): boolean => !destroyed && root.isConnected;

  // ---- data -------------------------------------------------------------

  const knownParam = (): string =>
    [...cards.values()]
      .filter((card) => card.payload !== null)
      .map((card) => `${card.game.roomId}:${card.shownPly}`)
      .join(',');

  async function fetchCurrent(): Promise<CurrentGamesResponse | null> {
    const known = knownParam();
    const query = known ? `?${new URLSearchParams({ known }).toString()}` : '';
    const response = await fetch(`/api/games/current${query}`).catch(() => null);
    if (!response?.ok) return null;
    return (await response.json().catch(() => null)) as CurrentGamesResponse | null;
  }

  async function refresh(): Promise<void> {
    if (!isConnected()) return;
    const data = await fetchCurrent();
    if (!isConnected()) return;
    if (!data) {
      if (!lastResponse) {
        playing.root.hidden = false;
        playing.grid.replaceChildren(buildNotice(t('games.feedUnavailable'), t('games.subtitle')));
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

  function render(): void {
    const data = lastResponse;
    if (!data) return;
    renderPill(pill, data.total);
    reconcile(data.games);
    renderEmpty(data.games.length === 0);
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
    // Live first (people, then bots), then correspondence by deadline, then the
    // seeks waiting for a second player. A card already in place is moved only
    // when the order changed, so a live board is not detached on every poll.
    const sections = splitSections(games);
    const order = [
      ...sections.live.map((game) => cards.get(game.roomId)!.root),
      ...sections.correspondence.map((game) => cards.get(game.roomId)!.root),
      ...seekCardList(),
    ];
    const current = [...playing.grid.children];
    if (current.length !== order.length || current.some((el, i) => el !== order[i])) {
      playing.grid.replaceChildren(...order);
    }
    playing.root.hidden = order.length === 0;
    // Board mounts happen after the cards are on screen so a slow renderer
    // import never blocks the cards' text from appearing.
    for (const game of games) {
      const card = cards.get(game.roomId);
      if (card && game.payload && liveTileKind(game) === 'board') {
        void showBoard(card, game.payload);
      }
    }
  }

  // One card per open seek, built once: its start board is drawn on creation
  // and must not be redrawn on every poll.
  function seekCardList(): HTMLElement[] {
    const list = seeks ?? [];
    const live = new Set(list.map((seek) => seek.id));
    for (const id of [...seekCards.keys()]) if (!live.has(id)) seekCards.delete(id);
    return list.map((seek) => {
      let card = seekCards.get(seek.id);
      if (!card) {
        card = buildSeekCard(seek, {
          href: seek.isMine ? '/correspondence' : `/challenge/${encodeURIComponent(seek.id)}`,
        });
        seekCards.set(seek.id, card);
      }
      return card;
    });
  }

  function createCard(game: CurrentGame): CardState {
    const correspondence = game.timeClass === 'correspondence';
    const article = document.createElement('article');
    article.className = 'current-game-card';
    article.dataset.roomId = game.roomId;
    article.dataset.observe = game.observe;
    article.dataset.kind = correspondence ? 'correspondence' : 'live';

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
            hideReserve: !liveCardShowsHands(card.game.gameSpecId),
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

  // A quiet line when nothing is in play; open seeks still fill the wall below.
  function renderEmpty(nothingInPlay: boolean): void {
    if (!nothingInPlay) {
      emptyHost.hidden = true;
      return;
    }
    const notice = document.createElement('div');
    notice.className = 'current-games-empty';
    const title = document.createElement('h2');
    title.textContent = t('games.none');
    const body = document.createElement('p');
    body.textContent = t('games.noneBody');
    notice.append(title, body);
    emptyHost.replaceChildren(notice);
    emptyHost.hidden = false;
  }

  // ---- just finished -------------------------------------------------------

  async function renderFinished(): Promise<void> {
    if (finishedCache.pending) {
      const fetched = await finishedCache.pending;
      if (!isConnected()) return;
      finishedCache = { at: Date.now(), games: fetched, pending: null };
    } else if (Date.now() - finishedCache.at > FINISHED_TTL_MS) {
      // Re-read in the background; this render keeps the cached pool.
      const pending = fetchFinished();
      finishedCache = { ...finishedCache, pending };
      void pending.then((games) => {
        finishedCache = { at: Date.now(), games, pending: null };
        if (isConnected()) void renderFinished();
      });
    }
    const pool = finishedCache.games;
    const shown = pool.slice(0, finishedShown);
    showMore.hidden = shown.length >= pool.length;
    const key = shown.map((game) => game.roomId).join(',');
    if (key === finishedKey) return;
    const previous = new Set(finishedKey ? finishedKey.split(',') : []);
    const appendOnly = previous.size > 0 && [...previous].every((id, i) => shown[i]?.roomId === id);
    finishedKey = key;
    finished.root.hidden = shown.length === 0;
    if (!appendOnly) {
      for (const handle of finishedHandles) handle.destroy();
      finishedHandles = [];
      for (const host of pendingBoards.keys()) boardObserver?.unobserve(host);
      pendingBoards.clear();
      finished.grid.replaceChildren();
    }
    // "Show more" only appends: the tiles already drawn keep their boards.
    for (const game of appendOnly ? shown.slice(previous.size) : shown) {
      const tile = buildFinishedTile(game);
      finished.grid.append(tile);
      if (finishedTileKind(game.variant) !== 'board') continue;
      const host = tile.querySelector<HTMLElement>('.current-game-board');
      if (!host) continue;
      if (boardObserver) {
        pendingBoards.set(host, game);
        boardObserver.observe(host);
      } else {
        void mountFinishedBoard(host, game);
      }
    }
  }

  showMore.addEventListener(
    'click',
    () => {
      finishedShown += FINISHED_PAGE;
      void renderFinished();
    },
    { signal: abort.signal },
  );

  // A tile replaced while its board loaded (a pool refresh) is off the page by
  // the time the mount resolves; its handle is destroyed rather than kept.
  async function mountFinishedBoard(host: HTMLElement, game: FeaturedGame): Promise<void> {
    try {
      const { mountShowcaseBoard } = await import('./showcase-board.js');
      if (!isConnected() || !host.isConnected) return;
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
          // A finished fog game is open to spectators: draw it with the fog off
          // (Fog Xiangqi; Fog Chess reveals through revealOnFinish).
          ...(isFogSpec(game.variant) ? { tenantPov: 'truth' as const } : {}),
        },
      );
      if (!isConnected() || !host.isConnected) {
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
    boardObserver?.disconnect();
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // The current games render as soon as they land; the seeks join the wall when
  // theirs does (usually first: it is the smaller read).
  void seeksRequest.then((list) => {
    seeks = list;
    if (isConnected() && lastResponse) render();
  });
  await refresh();
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

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
    const cadence = days === 1 ? t('games.oneDayPerMove') : t('games.daysPerMove', { count: days });
    // Marked exactly like a live game since correspondence can be rated (2026-10-02).
    parts.push(cadence, game.rated ? t('games.rated') : t('games.casual'));
  } else {
    const label = game.timeControl ? timeControlLabelForGame(asFeaturedGame(game)) : null;
    parts.push(
      [label, game.rated ? t('games.rated') : t('games.casual')].filter(Boolean).join(' '),
    );
  }
  parts.push(t('games.moveCount', { count: game.ply }));
  const text = document.createElement('span');
  text.textContent = parts.join(' · ');
  root.replaceChildren(
    buildKindBadge(game.timeClass === 'correspondence' ? 'correspondence' : 'live'),
    chip,
    text,
  );
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

// null = the seek board is unavailable (correspondence disabled, or an error).
async function fetchSeeks(): Promise<CorrespondenceSeek[] | null> {
  const response = await fetch('/api/correspondence/seeks').catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { seeks?: CorrespondenceSeek[] } | null;
  return body?.seeks ?? null;
}

async function fetchFinished(): Promise<FeaturedGame[]> {
  const response = await fetch('/api/watch?channel=top').catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json().catch(() => null)) as { unlocked?: FeaturedGame[] } | null;
  return body?.unlocked ?? [];
}

function isFogSpec(variant: string): boolean {
  return maybeGameSpecForId(variant === 'fog' ? 'dark-chess' : variant)?.visibility === 'dark';
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
