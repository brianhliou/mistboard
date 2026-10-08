// /correspondence: the correspondence inbox.
//
// Signed in, two columns (stacked on a phone):
//   main  "Your move" cards (board, seats, time left on the seat to move, a
//         deadline bar, Play your move) and "Waiting on opponent" cards.
//   side  "Start a game" (variant, days per move, opponent: anyone / a link,
//         your side). A challenge to one player starts on their profile.
//   main  also leads with "Waiting for an opponent" (your own seeks, Copy link
//         / Cancel) and ends with "Open seeks" (other players', with Accept).
// Every list is a grid of the site's game cards (current-games.css).
// Signed out: one line on what correspondence is, the open seeks read-only
// (Accept goes through sign-in to the seek's /challenge page), and sign in /
// create an account. Correspondence needs an account; that stays.
//
// Data: GET /api/correspondence/games (the inbox), GET /api/correspondence/seeks
// (the public board), GET /api/correspondence/seeks/mine (your challenges), and
// GET /api/games/current for the boards. That feed is public and already lists
// every correspondence game in play; it carries a board payload only for games
// it calls 'open', so this page draws exactly what any spectator of an
// open-information game already sees (for xiangqi, the same position either
// seat sees) and never a hidden position: Fog Chess keeps the misty tile here
// for its whole life (inboxTileKind fails closed). No new board payload exists
// for this page.
//
// Pure logic (grouping, urgency, tiles, seek filter, request body) lives in
// correspondence-model.ts. Browsing seeks also stays on the homepage lobby's
// Correspondence tab; this page shows the same feed.

import './current-games.css';
import './correspondence.css';
import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  createInitialXiangqiState,
  DAYS_PER_MOVE_OPTIONS,
  getStandardXiangqiPlayerView,
} from '@mistboard/game';
import { trackCorrespondenceSeekAccepted, trackCorrespondenceSeekPosted } from './analytics.js';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import {
  type CorrespondenceGame,
  type CorrespondenceGamesResponse,
  correspondenceInProgress,
  correspondenceRatedAvailable,
  deadlineFraction,
  deadlineRemainingMs,
  deadlineUrgency,
  heroBoardGame,
  inboxTileKind,
  indexByRoom,
  type OpenSeek,
  type OutgoingSeek,
  othersSeeks,
  parseStartFormPrefill,
  type SeatBoardView,
  type SeekPreferredColor,
  START_FORM_SEEK_KINDS,
  type StartFormPrefill,
  type StartFormSeekKind,
  seatBoardView,
  seekRequestBody,
  splitInbox,
  variantFact,
} from './correspondence-model.js';
import {
  type CurrentGame,
  type CurrentGamesResponse,
  liveCardShowsHands,
} from './current-games-model.js';
import type { DarkChessBoardView } from './dark-chess-render.js';
import {
  displayLiveName,
  firstMoverColorName,
  namesMatchupLabel,
  secondMoverColorName,
  variantDisplayLabel,
} from './game-display.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, localizedHref } from './i18n/locale.js';
import type { DarkXiangqiWireView } from './live-dark-xiangqi.js';
import { appendWithNameNode, playerNameEl, profileTargetFor } from './profile-link.js';
import { isCorrespondenceRatedModeEnabled, onRatedModeChange } from './rated-flag.js';
import type { ReplayHandle } from './replay.js';
import { buildSeekCard } from './seek-card.js';
import { buildLoadingState, buildNav, buildNotice } from './site-shell.js';
import { formatDayClock } from './web-utils.js';

const TICK_MS = 30_000;

type OpenSeeksFeed = { status: 'ok'; seeks: OpenSeek[] } | { status: 'disabled' | 'error' };

export type PageContext = {
  signedIn: boolean;
  isConnected: () => boolean;
  handles: ReplayHandle[];
  tickers: Array<(now: number) => void>;
};

export async function mountCorrespondence(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('landing-page', 'correspondence-page');
  root.append(buildNav(), buildLoadingState(t('correspondence.loadingGames')));

  const [gamesResp, seeksFeed] = await Promise.all([
    fetch('/api/correspondence/games').catch(() => null),
    fetchOpenSeeks(),
  ]);

  const ctx: PageContext = {
    signedIn: gamesResp?.status !== 401,
    isConnected: () => root.isConnected,
    handles: [],
    tickers: [],
  };

  if (gamesResp?.status === 401) {
    const inPlay = correspondenceInProgress(await fetchCurrentList());
    root.replaceChildren(buildNav(), buildSignedOut(ctx, seeksFeed, inPlay));
    startTicking(ctx);
    return;
  }
  if (!gamesResp?.ok) {
    root.replaceChildren(
      buildNav(),
      buildNotice(t('correspondence.gamesUnavailable'), t('correspondence.gamesUnavailableBody')),
    );
    return;
  }
  const data = (await gamesResp.json()) as CorrespondenceGamesResponse;
  // Boards come from the public current-games feed; only fetched when there is
  // a game to draw, and a failure just leaves the variant placeholder.
  const current = data.games.length > 0 ? await fetchCurrentGames() : new Map();

  root.replaceChildren(buildNav(), buildSignedIn(ctx, data, current, seeksFeed));
  startTicking(ctx);
}

// ---------------------------------------------------------------------------
// Signed in
// ---------------------------------------------------------------------------

function buildSignedIn(
  ctx: PageContext,
  data: CorrespondenceGamesResponse,
  current: Map<string, CurrentGame>,
  seeksFeed: OpenSeeksFeed,
): HTMLElement {
  const shell = buildShell(t('correspondence.subtitle'));
  const layout = document.createElement('div');
  layout.className = 'correspondence-layout';
  const main = document.createElement('div');
  main.className = 'correspondence-main';
  const side = document.createElement('aside');
  side.className = 'correspondence-side';

  // Your own open seeks and challenges lead the main column: right after the
  // homepage button posts one, it is the only thing on the page that is yours,
  // and in the side column under the form it read as a footnote (Brian,
  // 2026-10-03). Hidden while you have none.
  const challenges = document.createElement('section');
  challenges.className = 'correspondence-section correspondence-own-seeks';
  challenges.hidden = true;
  main.append(challenges);

  const { yourMove, waiting } = splitInbox(data.games);
  let empty: HTMLElement | null = null;
  if (data.games.length === 0) {
    empty = document.createElement('section');
    empty.className = 'correspondence-panel correspondence-empty';
    const line = document.createElement('p');
    line.textContent = t('correspondence.noGamesYet');
    empty.append(line);
    main.append(empty);
  } else {
    const moveSection = buildSection(t('correspondence.yourMove'), yourMove.length);
    if (yourMove.length === 0) {
      const line = document.createElement('p');
      line.className = 'correspondence-quiet';
      line.textContent = t('correspondence.allCaughtUp');
      moveSection.append(line);
    } else {
      const grid = buildGrid('correspondence-move-grid');
      for (const game of yourMove) {
        grid.append(buildInboxCard(ctx, game, current.get(game.roomId), true));
      }
      moveSection.append(grid);
    }
    main.append(moveSection);
    if (waiting.length > 0) {
      const waitSection = buildSection(t('correspondence.waitingOnOpponent'), waiting.length);
      const grid = buildGrid('correspondence-waiting-grid');
      for (const game of waiting) {
        grid.append(buildInboxCard(ctx, game, current.get(game.roomId), false));
      }
      waitSection.append(grid);
      main.append(waitSection);
    }
  }

  const refreshChallenges = (): void => {
    void renderChallenges(challenges, (count) => {
      // "No games yet" says nothing new under a seek that is waiting.
      if (empty) empty.hidden = count > 0;
    });
  };
  const seekHost = document.createElement('section');
  seekHost.className = 'correspondence-section';
  renderOpenSeeks(ctx, seekHost, seeksFeed);

  if (seeksFeed.status === 'disabled') {
    const soon = document.createElement('p');
    soon.className = 'correspondence-panel correspondence-quiet-panel';
    soon.textContent = t('lobby.corrComingSoon');
    side.append(soon);
  } else {
    // A link can carry the form's terms (the bell's "post it again" row for a
    // lapsed seek); the form opens set to them and scrolls into view.
    const prefill = parseStartFormPrefill(location.search);
    const startForm = buildStartForm(refreshChallenges, prefill);
    side.append(startForm);
    // Open seeks are board cards now, too wide for the side column: they
    // follow your own games in the main one.
    main.append(seekHost);
    refreshChallenges();
    if (prefill) {
      requestAnimationFrame(() => {
        if (startForm.isConnected) startForm.scrollIntoView({ block: 'start' });
      });
    }
  }

  layout.append(main, side);
  shell.append(layout);
  return shell;
}

function buildShell(subtitle: string): HTMLElement {
  const shell = document.createElement('main');
  shell.className = 'correspondence-shell';
  const header = document.createElement('header');
  header.className = 'correspondence-header';
  const title = document.createElement('h1');
  title.textContent = t('correspondence.heading');
  const sub = document.createElement('p');
  sub.className = 'correspondence-subtitle';
  sub.textContent = subtitle;
  header.append(title, sub);
  shell.append(header);
  return shell;
}

function buildSection(label: string, count: number | null): HTMLElement {
  const section = document.createElement('section');
  section.className = 'correspondence-section';
  const head = document.createElement('div');
  head.className = 'correspondence-section-head';
  const heading = document.createElement('h2');
  heading.textContent = label;
  head.append(heading);
  if (count !== null) {
    const n = document.createElement('span');
    n.className = 'correspondence-count';
    n.textContent = String(count);
    head.append(n);
  }
  section.append(head);
  return section;
}

// ---- Your move / Waiting on opponent ------------------------------------------------

// Every list on the page is a grid of the site's game cards (current-games.css
// .current-game-card, the /games wall and the homepage), so a correspondence
// game looks the same here as everywhere else.
function buildGrid(modifier: string): HTMLElement {
  const grid = document.createElement('div');
  grid.className = `current-games-grid correspondence-grid ${modifier}`;
  return grid;
}

// One of your games as a /games card: opponent and you in the seat rows (first
// mover at the bottom, matching the board), the time left on the seat that is
// to move, the share of the move's allowance left as the bar, and the variant
// and cadence in the meta. A "Your move" card adds Play your move. The whole
// card opens the game through the stretched .current-game-open; the
// opponent's profile link sits above it, a sibling, so anchors never nest.
export function buildInboxCard(
  ctx: PageContext,
  game: CorrespondenceGame,
  current: CurrentGame | undefined,
  yourMove: boolean,
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'current-game-card correspondence-game-card';
  card.classList.toggle('is-your-move', yourMove);
  card.dataset.kind = 'correspondence';
  card.dataset.roomId = game.roomId;

  const opponentName = game.opponentName ?? t('correspondence.opponentFallback');
  const variant = variantDisplayLabel(game.gameSpecId);
  const open = document.createElement('a');
  open.className = 'current-game-open';
  open.href = game.url;
  open.setAttribute(
    'aria-label',
    `${variant}, ${t('correspondence.vsOpponent', { name: opponentName })}`,
  );

  const opponentSeat = buildInboxSeat(
    playerNameEl(
      opponentName,
      profileTargetFor({ handle: game.opponentHandle }),
      'current-game-seat-name',
    ),
  );
  const you = document.createElement('span');
  you.className = 'current-game-seat-name';
  you.textContent = t('live.you');
  const mySeat = buildInboxSeat(you);
  const onMove = yourMove ? mySeat : opponentSeat;
  onMove.clock.hidden = false;

  const board = buildBoardHost(ctx, game, current);
  const youAtBottom = seatBoardView(game) !== null || isFirstMoverSeat(game, current);
  const [top, bottom] = youAtBottom ? [opponentSeat, mySeat] : [mySeat, opponentSeat];
  card.append(open, top.row, board, bottom.row);

  const days = current?.timeControl?.daysPerMove ?? null;
  let fill: HTMLElement | null = null;
  if (days) {
    const track = document.createElement('div');
    track.className = 'current-game-bar';
    track.setAttribute('aria-hidden', 'true');
    fill = document.createElement('span');
    track.append(fill);
    card.append(track);
  }

  const meta = document.createElement('div');
  meta.className = 'current-game-meta';
  const chip = document.createElement('span');
  chip.className = 'current-game-chip';
  chip.textContent = variant;
  const parts: string[] = [];
  if (days) parts.push(cadenceLabel(days));
  parts.push(game.rated === true ? t('games.rated') : t('games.casual'));
  if (current && current.ply > 0) parts.push(t('games.moveCount', { count: current.ply }));
  const text = document.createElement('span');
  text.textContent = parts.join(' · ');
  meta.append(chip, text);
  card.append(meta);

  // The badge and its bar are the card's one clock. The exact due time rides on
  // the badge as a tooltip rather than a second line under the meta: a dated
  // "due" line plus an "Updated" time (any event, not the last move) read as
  // three competing clocks (Brian, 2026-10-08).
  const due = formatDue(game.dueAt);
  if (due) onMove.clock.title = t('correspondence.dueAt', { when: due });

  if (yourMove) {
    const play = document.createElement('a');
    play.className = 'correspondence-btn correspondence-card-play';
    play.href = game.url;
    play.textContent = t('correspondence.playYourMove');
    card.append(play);
  }

  const tick = (now: number): void => {
    const urgency = deadlineUrgency(game.dueAt, now);
    card.dataset.urgency = urgency;
    onMove.clock.textContent = timeLeftLabel(game.dueAt, now);
    if (fill) {
      const fraction = deadlineFraction(game.dueAt, days, now) ?? 0;
      fill.style.width = `${Math.round(fraction * 1000) / 10}%`;
    }
  };
  tick(Date.now());
  ctx.tickers.push(tick);
  return card;
}

function buildInboxSeat(name: HTMLElement): { row: HTMLElement; clock: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'current-game-seat';
  const who = document.createElement('span');
  who.className = 'current-game-seat-who';
  who.append(name);
  const clock = document.createElement('span');
  clock.className = 'current-game-seat-clock is-deadline';
  clock.hidden = true;
  row.append(who, clock);
  return { row, clock };
}

// Whether your seat moves first, which the board draws at the bottom (the
// compact renderer's white point of view; /games orders its seats the same
// way). The feed's players say which colour moves first; without the feed,
// red and white do.
function isFirstMoverSeat(game: CorrespondenceGame, current: CurrentGame | undefined): boolean {
  const players = current?.players ?? [];
  const first =
    players.find((player) => player.color === 'red' || player.color === 'white') ?? players[0];
  if (first) return first.color === game.mySeat;
  return game.mySeat === 'red' || game.mySeat === 'white';
}

// ---- Boards -------------------------------------------------------------------------

// The board, the mist, or the variant placeholder. Your own Fog Chess or Fog
// Xiangqi game draws your seat's fog view (the server's seatBoard, the same
// PlayerView the game room gives your seat) on that variant's board. Otherwise an
// open game mounts the same compact live renderer the /games wall uses, fed
// the public feed's payload, and anything hidden keeps the misty tile.
function buildBoardHost(
  ctx: PageContext,
  game: CorrespondenceGame,
  current: CurrentGame | undefined,
): HTMLElement {
  const host = document.createElement('div');
  host.className = 'current-game-board correspondence-board';
  const seatView = seatBoardView(game);
  if (seatView) {
    host.append(buildFogTile(game.gameSpecId));
    void mountSeatBoard(ctx, host, seatView);
    return host;
  }
  const kind = inboxTileKind(game.gameSpecId, current);
  if (kind === 'fog') {
    host.append(buildFogTile(game.gameSpecId));
    return host;
  }
  host.append(buildPlaceholderTile(game.gameSpecId));
  if (kind === 'board' && current?.payload) {
    void mountBoard(ctx, host, game.gameSpecId, game.roomId, current, current.payload);
  }
  return host;
}

async function mountSeatBoard(
  ctx: PageContext,
  host: HTMLElement,
  seat: SeatBoardView,
): Promise<void> {
  try {
    let svg: string;
    if (seat.kind === 'dark-chess') {
      const { renderDarkChessBoardSvg } = await import('./dark-chess-render.js');
      svg = renderDarkChessBoardSvg(seat.view as unknown as DarkChessBoardView, {
        perspective: seat.view.perspective,
      });
    } else {
      const { renderDarkXiangqiBoardSvg } = await import('./live-dark-xiangqi.js');
      svg = renderDarkXiangqiBoardSvg(
        seat.view as unknown as DarkXiangqiWireView,
        seat.view.perspective,
      );
    }
    if (!ctx.isConnected()) return;
    const board = document.createElement('div');
    board.className = `correspondence-seat-board correspondence-seat-board-${seat.kind}`;
    board.innerHTML = svg;
    board.querySelector('svg')?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    host.replaceChildren(board);
  } catch (err) {
    console.warn('[correspondence] seat board render failed', err);
  }
}

async function mountBoard(
  ctx: PageContext,
  host: HTMLElement,
  gameSpecId: string,
  roomId: string,
  current: CurrentGame,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { mountShowcaseBoard } = await import('./showcase-board.js');
    if (!ctx.isConnected()) return;
    host.replaceChildren();
    const handle = await mountShowcaseBoard(host, gameSpecId, roomId, {
      autoplay: false,
      hideReserve: !liveCardShowsHands(gameSpecId),
      live: true,
      loadPostgameOverride: async (id) =>
        id === roomId ? { ok: true, postgame: payload } : { ok: false },
      loaderForId: async () => [],
      metadataByRoomId: {},
      namesByRoomId: { [roomId]: seatNames(current) },
      onLoadError: () => true,
      pov: 'white',
    });
    if (!ctx.isConnected()) {
      handle.destroy();
      return;
    }
    ctx.handles.push(handle);
    handle.jumpToPly?.(handle.plyCount?.() ?? 0);
  } catch (err) {
    console.warn('[correspondence] board mount failed', err);
    host.replaceChildren(buildPlaceholderTile(gameSpecId));
  }
}

function seatNames(current: CurrentGame): { first: string; second: string } {
  const [first, second] = current.players;
  return { first: first?.name ?? '', second: second?.name ?? '' };
}

const FOG_WAVES =
  '<svg viewBox="0 0 44 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 8c6-5 12 5 19 0s13-5 19 0M3 16c6-5 12 5 19 0s13-5 19 0M3 24c6-5 12 5 19 0s13-5 19 0"/></svg>';

// The /games misty tile (same classes, same tokens), with a note for the seat:
// the game page is where your own side of the fog is.
function buildFogTile(gameSpecId: string): HTMLElement {
  return buildFogTileWithNote(gameSpecId, t('correspondence.fogNote'));
}

function buildFogTileWithNote(gameSpecId: string, noteText: string): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'current-game-fog';
  const waves = document.createElement('span');
  waves.className = 'current-game-fog-waves';
  waves.innerHTML = FOG_WAVES;
  const name = document.createElement('span');
  name.className = 'current-game-fog-variant';
  name.textContent = variantDisplayLabel(gameSpecId);
  const note = document.createElement('span');
  note.className = 'current-game-fog-note';
  note.textContent = noteText;
  tile.append(waves, name, note);
  return tile;
}

function buildPlaceholderTile(gameSpecId: string): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'current-game-hidden';
  const label = document.createElement('span');
  label.className = 'current-game-hidden-label';
  label.textContent = variantDisplayLabel(gameSpecId);
  tile.append(label);
  return tile;
}

// ---- Shared labels ------------------------------------------------------------------

function cadenceLabel(days: number): string {
  return days === 1 ? t('games.oneDayPerMove') : t('games.daysPerMove', { count: days });
}

function timeLeftLabel(dueAt: string, now: number): string {
  const remaining = deadlineRemainingMs(dueAt, now);
  if (remaining === null || remaining <= 0) return t('correspondence.dueNow');
  return t('correspondence.timeLeft', { time: formatDayClock(remaining) });
}

// "Sat 1:30 AM" inside the coming week, else "Oct 8", in the site's locale.
function formatDue(dueAt: string): string {
  const date = new Date(dueAt);
  if (!Number.isFinite(date.getTime())) return '';
  const locale = LOCALE_META[currentLocale()].dateLocale;
  const withinWeek = date.getTime() - Date.now() < 6 * 86_400_000;
  return withinWeek
    ? date.toLocaleString(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

function startTicking(ctx: PageContext): void {
  if (ctx.tickers.length === 0) return;
  const timer = window.setInterval(() => {
    if (!ctx.isConnected()) {
      window.clearInterval(timer);
      for (const handle of ctx.handles) handle.destroy();
      return;
    }
    const now = Date.now();
    for (const tick of ctx.tickers) tick(now);
  }, TICK_MS);
}

// ---------------------------------------------------------------------------
// Start a game
// ---------------------------------------------------------------------------

type Segmented<T extends string> = {
  root: HTMLElement;
  value: () => T;
  relabel: (labels: Partial<Record<T, string>>) => void;
  // Select a value programmatically (no onChange), and disable one option.
  select: (value: T) => void;
  setDisabled: (value: T, disabled: boolean) => void;
};

function buildSegmented<T extends string>(
  label: string,
  options: readonly { value: T; label: string }[],
  initial: T,
  onChange?: (value: T) => void,
): Segmented<T> {
  const field = document.createElement('div');
  field.className = 'correspondence-field';
  const caption = document.createElement('span');
  caption.className = 'correspondence-field-label';
  caption.textContent = label;
  const group = document.createElement('div');
  group.className = 'correspondence-seg';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  let current = initial;
  const buttons = new Map<T, HTMLButtonElement>();
  const paint = (): void => {
    for (const [value, button] of buttons) {
      const on = value === current;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', String(on));
    }
  };
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.value = option.value;
    button.textContent = option.label;
    button.addEventListener('click', () => {
      if (current === option.value) return;
      current = option.value;
      paint();
      onChange?.(current);
    });
    buttons.set(option.value, button);
    group.append(button);
  }
  paint();
  field.append(caption, group);
  return {
    root: field,
    value: () => current,
    relabel: (labels) => {
      for (const [value, text] of Object.entries(labels) as [T, string][]) {
        const button = buttons.get(value);
        if (button) button.textContent = text;
      }
    },
    select: (value) => {
      if (!buttons.has(value)) return;
      current = value;
      paint();
    },
    setDisabled: (value, disabled) => {
      const button = buttons.get(value);
      if (button) button.disabled = disabled;
    },
  };
}

// A labelled native select, for a choice too long for a segmented row (the
// variant list). Native on purpose: a phone gets its own picker sheet.
function buildSelect(
  label: string,
  options: readonly { value: string; label: string }[],
  initial: string,
  onChange?: (value: string) => void,
): { root: HTMLElement; value: () => string } {
  const field = document.createElement('label');
  field.className = 'correspondence-field';
  const caption = document.createElement('span');
  caption.className = 'correspondence-field-label';
  caption.textContent = label;
  const wrap = document.createElement('span');
  wrap.className = 'correspondence-select-wrap';
  const select = document.createElement('select');
  select.className = 'correspondence-input correspondence-select';
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  }
  select.value = initial;
  select.addEventListener('change', () => onChange?.(select.value));
  wrap.append(select);
  field.append(caption, wrap);
  return { root: field, value: () => select.value };
}

export function buildStartForm(
  onChanged: () => void,
  prefill: StartFormPrefill | null = null,
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'correspondence-panel correspondence-start';
  panel.id = 'start';
  const heading = document.createElement('h2');
  heading.textContent = t('correspondence.startGame');
  const form = document.createElement('form');
  form.className = 'correspondence-start-form';
  form.noValidate = true;

  const defaultVariant = prefill?.gameSpecId ?? CORRESPONDENCE_ELIGIBLE_SPEC_IDS[0] ?? 'xiangqi';
  const variant = buildSelect(
    t('correspondence.variantLabel'),
    CORRESPONDENCE_ELIGIBLE_SPEC_IDS.map((specId) => ({
      value: specId,
      label: variantDisplayLabel(specId),
    })),
    defaultVariant,
    () => {
      relabelSides();
      syncRated();
    },
  );
  variant.root.hidden = CORRESPONDENCE_ELIGIBLE_SPEC_IDS.length < 2;

  const days = buildSegmented<string>(
    t('correspondence.daysPerMoveLabel'),
    DAYS_PER_MOVE_OPTIONS.map((option) => ({ value: String(option), label: String(option) })),
    String(prefill?.daysPerMove ?? DAYS_PER_MOVE_OPTIONS[1] ?? DAYS_PER_MOVE_OPTIONS[0]),
  );

  // Casual or Rated (2026-10-02). Rated writes the variant's own correspondence rating,
  // never a live one. Offered only where correspondenceRatedAvailable says so; anywhere
  // else Rated is shown disabled and the seek posts casual.
  const rated = buildSegmented<'casual' | 'rated'>(
    t('setup.gameType'),
    [
      { value: 'casual', label: t('play.casual') },
      { value: 'rated', label: t('play.rated') },
    ],
    prefill?.rated === true ? 'rated' : 'casual',
  );
  const syncRated = (): void => {
    // The whole control is absent while rated correspondence is held (flag off).
    rated.root.hidden = !isCorrespondenceRatedModeEnabled();
    const available = correspondenceRatedAvailable(
      variant.value(),
      isCorrespondenceRatedModeEnabled(),
    );
    rated.setDisabled('rated', !available);
    if (!available) rated.select('casual');
  };
  syncRated();
  onRatedModeChange(syncRated);

  // Anyone or A link. A challenge to one player starts from that player's
  // profile (its Challenge button, challenge-dialog.ts), not from a typed
  // handle here: typing a handle was a dead end (Brian, 2026-10-04).
  const kindLabels: Record<StartFormSeekKind, I18nKey> = {
    link: 'correspondence.opponentLink',
    public: 'correspondence.opponentAnyone',
  };
  const kind = buildSegmented<StartFormSeekKind>(
    t('correspondence.opponentLabel'),
    START_FORM_SEEK_KINDS.map((value) => ({ value, label: t(kindLabels[value]) })),
    'public',
    () => syncKind(),
  );

  const side = buildSegmented<SeekPreferredColor>(
    t('correspondence.yourSideLabel'),
    [
      { value: 'random', label: t('correspondence.sideRandom') },
      { value: 'first', label: firstMoverColorName(defaultVariant) },
      { value: 'second', label: secondMoverColorName(defaultVariant) },
    ],
    prefill?.preferredColor ?? 'random',
  );
  const relabelSides = (): void => {
    side.relabel({
      first: firstMoverColorName(variant.value()),
      second: secondMoverColorName(variant.value()),
    });
  };

  const hint = document.createElement('p');
  hint.className = 'correspondence-hint';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'correspondence-btn';
  const status = document.createElement('p');
  status.className = 'correspondence-form-status';
  status.setAttribute('role', 'status');
  status.hidden = true;

  const hints: Record<StartFormSeekKind, I18nKey> = {
    link: 'correspondence.kindHintLink',
    public: 'correspondence.kindHintPublic',
  };
  const submits: Record<StartFormSeekKind, I18nKey> = {
    link: 'correspondence.createLink',
    public: 'correspondence.postSeek',
  };
  const syncKind = (): void => {
    const value = kind.value();
    hint.textContent = t(hints[value]);
    submit.textContent = t(submits[value]);
    status.hidden = true;
  };
  syncKind();

  const showStatus = (text: string, isError: boolean): void => {
    status.textContent = text;
    status.classList.toggle('is-error', isError);
    status.hidden = false;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const seekKind = kind.value();
    const request = seekRequestBody({
      daysPerMove: Number(days.value()),
      gameSpecId: variant.value(),
      kind: seekKind,
      preferredColor: side.value(),
      rated:
        rated.value() === 'rated' &&
        correspondenceRatedAvailable(variant.value(), isCorrespondenceRatedModeEnabled()),
    });
    if (!request.ok) return;
    submit.disabled = true;
    status.hidden = true;
    void fetch('/api/correspondence/seeks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request.body),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          challengeUrl?: string | null;
          error?: string;
          limit?: number;
        } | null;
        submit.disabled = false;
        if (!res.ok) {
          showStatus(postErrorText(body?.error, body?.limit), true);
          return;
        }
        if (res.status === 201) {
          trackCorrespondenceSeekPosted({
            daysPerMove: Number(days.value()),
            gameSpecId: variant.value(),
            kind: seekKind,
            surface: 'correspondence',
          });
        }
        // A link lands on its challenge page, where the share link and copy
        // button live (the flow this form had before).
        if (seekKind === 'link' && body?.challengeUrl) {
          location.href = body.challengeUrl;
          return;
        }
        showStatus(t('correspondence.seekPosted'), false);
        onChanged();
      })
      .catch(() => {
        submit.disabled = false;
        showStatus(t('correspondence.couldNotPostGame'), true);
      });
  });

  form.append(variant.root, days.root, rated.root, kind.root, side.root, hint, submit, status);
  panel.append(heading, form);
  return panel;
}

function postErrorText(code: string | undefined, limit: number | undefined): string {
  switch (code) {
    case 'seek_limit_reached':
      return t('correspondence.seekLimitReached', { limit: limit ?? 6 });
    case 'server_draining':
      return t('setup.serverRestartTimeout');
    default:
      return t('correspondence.couldNotPostGame');
  }
}

// ---------------------------------------------------------------------------
// Open seeks
// ---------------------------------------------------------------------------

async function fetchOpenSeeks(): Promise<OpenSeeksFeed> {
  const response = await fetch('/api/correspondence/seeks').catch(() => null);
  if (!response) return { status: 'error' };
  if (response.status === 404) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'correspondence_disabled') return { status: 'disabled' };
    return { status: 'error' };
  }
  if (!response.ok) return { status: 'error' };
  const body = (await response.json().catch(() => null)) as { seeks?: OpenSeek[] } | null;
  return { status: 'ok', seeks: Array.isArray(body?.seeks) ? body.seeks : [] };
}

async function fetchCurrentList(): Promise<CurrentGame[]> {
  const response = await fetch('/api/games/current').catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json().catch(() => null)) as CurrentGamesResponse | null;
  return body?.games ?? [];
}

async function fetchCurrentGames(): Promise<Map<string, CurrentGame>> {
  return indexByRoom(await fetchCurrentList());
}

function renderOpenSeeks(ctx: PageContext, host: HTMLElement, feed: OpenSeeksFeed): void {
  const seeks = feed.status === 'ok' ? othersSeeks(feed.seeks) : [];
  const section = buildSection(
    t('correspondence.openSeeks'),
    feed.status === 'ok' ? seeks.length : null,
  );
  host.replaceChildren(...section.childNodes);
  if (feed.status !== 'ok') {
    const line = document.createElement('p');
    line.className = 'correspondence-quiet';
    line.textContent = t('correspondence.openGamesUnavailableBody');
    host.append(line);
    return;
  }
  if (seeks.length === 0) {
    const line = document.createElement('p');
    line.className = 'correspondence-panel correspondence-quiet-panel';
    line.textContent = ctx.signedIn
      ? t('correspondence.noOpenSeeks')
      : t('correspondence.noOpenSeeksSignedOut');
    host.append(line);
    return;
  }
  // Each seek is a game card at its starting position (seek-card.ts), the
  // same frame as the games in progress, rather than a text row.
  const grid = buildGrid('correspondence-seek-grid');
  for (const seek of seeks) grid.append(buildOpenSeekCard(ctx, host, seek));
  host.append(grid);
}

function buildOpenSeekCard(ctx: PageContext, host: HTMLElement, seek: OpenSeek): HTMLElement {
  const error = document.createElement('p');
  error.className = 'correspondence-row-error correspondence-seek-error';
  error.hidden = true;
  const challengePath = `/challenge/${encodeURIComponent(seek.id)}`;
  if (!ctx.signedIn) {
    // Correspondence needs an account: Accept signs in, then lands on this
    // seek's challenge page with its own Accept.
    const accept = document.createElement('a');
    accept.className = 'correspondence-ghost';
    const params = new URLSearchParams({ tab: 'login', referrer: challengePath });
    accept.href = localizedHref(`/account?${params.toString()}`);
    accept.title = t('correspondence.signInToAccept');
    accept.textContent = t('correspondence.accept');
    return buildSeekCard(seek, { action: accept, href: challengePath, status: error });
  }

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'correspondence-ghost';
  accept.textContent = t('correspondence.accept');
  accept.addEventListener('click', () => {
    accept.disabled = true;
    error.hidden = true;
    void fetch(`/api/correspondence/seeks/${encodeURIComponent(seek.id)}/accept`, {
      method: 'POST',
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          url?: string;
          error?: string;
        } | null;
        if (res.ok && body?.url) {
          trackCorrespondenceSeekAccepted({
            daysPerMove: seek.daysPerMove,
            gameSpecId: seek.gameSpecId,
            surface: 'correspondence',
          });
          location.href = body.url;
          return;
        }
        error.textContent =
          body?.error === 'seek_taken' || body?.error === 'seek_not_found'
            ? t('challenge.alreadyAccepted')
            : body?.error === 'challenge_expired'
              ? t('challenge.expired')
              : t('challenge.couldNotAccept');
        error.hidden = false;
        accept.disabled = false;
        // A seek someone else took is gone; re-read the board.
        if (body?.error === 'seek_taken' || body?.error === 'seek_not_found') {
          void fetchOpenSeeks().then((feed) => {
            if (ctx.isConnected()) renderOpenSeeks(ctx, host, feed);
          });
        }
      })
      .catch(() => {
        error.textContent = t('challenge.couldNotAccept');
        error.hidden = false;
        accept.disabled = false;
      });
  });
  return buildSeekCard(seek, { action: accept, href: challengePath, status: error });
}

// ---------------------------------------------------------------------------
// Your challenges
// ---------------------------------------------------------------------------

export async function renderChallenges(
  host: HTMLElement,
  onCount?: (count: number) => void,
): Promise<void> {
  const resp = await fetch('/api/correspondence/seeks/mine').catch(() => null);
  if (!resp?.ok) {
    const section = buildSection(t('correspondence.yourChallenges'), null);
    const line = document.createElement('p');
    line.className = 'correspondence-quiet';
    line.textContent = t('correspondence.openGamesUnavailableBody');
    host.replaceChildren(...section.childNodes, line);
    host.hidden = false;
    return;
  }
  const { seeks, limit } = (await resp.json()) as { limit: number; seeks: OutgoingSeek[] };
  onCount?.(seeks.length);
  // Nothing out: the section disappears rather than saying so, since it now
  // sits at the top of the page.
  host.hidden = seeks.length === 0;
  if (seeks.length === 0) {
    host.replaceChildren();
    return;
  }
  const section = buildSection(t('correspondence.waitingForOpponent'), seeks.length);
  const children: Node[] = [...section.childNodes];
  {
    const grid = buildGrid('correspondence-own-grid');
    const refresh = (): void => {
      void renderChallenges(host, onCount);
    };
    for (const seek of seeks) grid.append(buildOwnSeekCard(seek, refresh));
    children.push(grid);
    // Standing invitations are capped, and hitting it refuses every new game
    // with a 409. Say so before that happens rather than after.
    if (seeks.length >= limit) {
      const note = document.createElement('p');
      note.className = 'correspondence-quiet';
      note.textContent = t('correspondence.seekLimitReached', { limit });
      children.push(note);
    }
  }
  host.replaceChildren(...children);
}

// Your own seek as a seek card (seek-card.ts, the same card as Open seeks):
// the empty seat says who it is waiting for (a directed challenge links its
// recipient by handle, fail-closed), your seat carries Copy link and Cancel.
export function buildOwnSeekCard(seek: OutgoingSeek, onChange: () => void): HTMLElement {
  const variant = variantDisplayLabel(seek.gameSpecId);
  let waiting: Node;
  let ariaLabel: string;
  if (seek.targetName) {
    const who = document.createElement('span');
    who.className = 'correspondence-own-target';
    appendWithNameNode(
      who,
      (token) => t('correspondence.challengeTo', { name: token }),
      playerNameEl(
        seek.targetName,
        profileTargetFor({ handle: seek.targetHandle }),
        'correspondence-own-target-name',
      ),
    );
    waiting = who;
    ariaLabel = `${variant}, ${t('correspondence.challengeTo', { name: seek.targetName })}`;
  } else {
    const label =
      seek.visibility === 'private' ? t('correspondence.linkChallenge') : t('games.seekWaiting');
    waiting = document.createTextNode(label);
    ariaLabel = `${variant}, ${label}`;
  }
  const details = [seekColorLabel(seek.gameSpecId, seek.preferredColor)];
  const remaining = seek.expiresAt ? deadlineRemainingMs(seek.expiresAt, Date.now()) : null;
  if (remaining !== null && remaining > 0) {
    details.push(t('correspondence.expiresIn', { time: formatDayClock(remaining) }));
  }

  const actions = document.createElement('div');
  actions.className = 'correspondence-own-actions';
  // A link challenge is useless without its link, and the creator may well have
  // lost the tab they copied it from.
  if (seek.challengeUrl) {
    const url = seek.challengeUrl;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'correspondence-ghost';
    copy.textContent = t('correspondence.copyLink');
    copy.addEventListener('click', () => {
      void navigator.clipboard
        ?.writeText(`${window.location.origin}${url}`)
        .then(() => {
          copy.textContent = t('correspondence.linkCopied');
          window.setTimeout(() => {
            copy.textContent = t('correspondence.copyLink');
          }, 2000);
        })
        .catch(() => {});
    });
    actions.append(copy);
  }
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'correspondence-ghost is-quiet';
  cancel.textContent = t('correspondence.cancel');
  cancel.addEventListener('click', () => {
    cancel.disabled = true;
    void fetch(`/api/correspondence/seeks/${encodeURIComponent(seek.id)}`, { method: 'DELETE' })
      .then(() => onChange())
      .catch(() => {
        cancel.disabled = false;
      });
  });
  actions.append(cancel);
  return buildSeekCard(
    {
      creatorHandle: null,
      creatorName: t('live.you'),
      daysPerMove: seek.daysPerMove,
      gameSpecId: seek.gameSpecId,
      id: seek.id,
      rated: seek.rated === true,
    },
    {
      action: actions,
      ariaLabel,
      badge: false,
      details,
      // A link or directed challenge opens its /challenge page (where the share
      // link lives); a public seek has no page of its own.
      href: seek.challengeUrl,
      waiting,
    },
  );
}

function seekColorLabel(gameSpecId: string, color: SeekPreferredColor): string {
  if (color === 'first')
    return t('correspondence.playsColor', { color: firstMoverColorName(gameSpecId) });
  if (color === 'second')
    return t('correspondence.playsColor', { color: secondMoverColorName(gameSpecId) });
  return t('correspondence.eitherColor');
}

// ---------------------------------------------------------------------------
// Signed out
// ---------------------------------------------------------------------------

// Built to sell correspondence: a hero (headline, pitch, Create an account /
// Sign in, a board), then everything in play right now (every correspondence
// game from the public current-games feed, fog games as misty tiles, then the
// open seeks with Accept through sign-in), then how it works. With nothing in
// play the page leads with how it works and an invitation to start the first
// game, never an empty box.
function buildSignedOut(
  ctx: PageContext,
  seeksFeed: OpenSeeksFeed,
  inPlay: CurrentGame[],
): HTMLElement {
  const shell = document.createElement('main');
  shell.className = 'correspondence-shell is-signed-out';
  shell.append(buildHero(ctx, inPlay));

  const seeks = seeksFeed.status === 'ok' ? othersSeeks(seeksFeed.seeks) : [];
  if (inPlay.length > 0) shell.append(buildInPlaySection(ctx, inPlay));
  if (seeksFeed.status === 'disabled') {
    const soon = document.createElement('p');
    soon.className = 'correspondence-panel correspondence-quiet-panel';
    soon.textContent = t('lobby.corrComingSoon');
    shell.append(soon);
  } else if (seeks.length > 0) {
    const seekHost = document.createElement('section');
    seekHost.className = 'correspondence-section correspondence-showcase-seeks';
    renderOpenSeeks(ctx, seekHost, seeksFeed);
    shell.append(seekHost);
  }
  shell.append(buildHowItWorks());
  if (inPlay.length === 0 && seeks.length === 0 && seeksFeed.status !== 'disabled') {
    shell.append(buildFirstGameInvite());
  }
  return shell;
}

function registerHref(): string {
  const params = new URLSearchParams({ tab: 'register', referrer: '/correspondence' });
  return localizedHref(`/account?${params.toString()}`);
}

function buildAccountActions(): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'correspondence-signedout-actions';
  const register = document.createElement('a');
  register.className = 'correspondence-btn';
  register.href = registerHref();
  register.textContent = t('correspondence.register');
  const signIn = document.createElement('a');
  signIn.className = 'correspondence-ghost';
  signIn.href = loginHrefForCurrentPage();
  signIn.textContent = t('correspondence.signIn');
  actions.append(register, signIn);
  return actions;
}

function variantFactText(labels: readonly string[]): string {
  const fact = variantFact(labels);
  return fact.kind === 'all'
    ? fact.text
    : t('correspondence.factVariantsMore', { list: fact.shown, count: fact.more });
}

function buildHero(ctx: PageContext, inPlay: CurrentGame[]): HTMLElement {
  const hero = document.createElement('section');
  hero.className = 'correspondence-hero';

  const copy = document.createElement('div');
  copy.className = 'correspondence-hero-copy';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'correspondence-eyebrow';
  eyebrow.textContent = t('correspondence.heading');
  const title = document.createElement('h1');
  title.className = 'correspondence-hero-title';
  title.textContent = t('correspondence.heroTitle');
  const pitch = document.createElement('p');
  pitch.className = 'correspondence-hero-pitch';
  pitch.textContent = t('correspondence.heroPitch');
  const facts = document.createElement('ul');
  facts.className = 'correspondence-hero-facts';
  for (const text of [
    t('correspondence.factDays', { list: DAYS_PER_MOVE_OPTIONS.join(' / ') }),
    variantFactText(CORRESPONDENCE_ELIGIBLE_SPEC_IDS.map((specId) => variantDisplayLabel(specId))),
    t('correspondence.factReminders'),
  ]) {
    const item = document.createElement('li');
    item.textContent = text;
    facts.append(item);
  }
  const note = document.createElement('p');
  note.className = 'correspondence-hero-note';
  note.textContent = t('correspondence.heroNote');
  copy.append(eyebrow, title, pitch, buildAccountActions(), facts, note);

  const figure = document.createElement('figure');
  figure.className = 'correspondence-hero-board';
  const host = document.createElement('div');
  host.className = 'current-game-board correspondence-hero-board-host';
  const caption = document.createElement('figcaption');
  caption.className = 'correspondence-hero-caption';
  const live = heroBoardGame(inPlay);
  if (live?.payload) {
    host.append(buildPlaceholderTile(live.gameSpecId));
    void mountBoard(ctx, host, live.gameSpecId, live.roomId, live, live.payload);
    const link = document.createElement('a');
    link.href = live.url;
    link.textContent = t('correspondence.heroLive', { matchup: showcaseMatchup(live) });
    caption.append(link);
  } else {
    host.append(buildStartingBoard());
    caption.textContent = t('correspondence.heroStart');
  }
  figure.append(host, caption);

  hero.append(copy, figure);
  return hero;
}

// A static xiangqi starting position, drawn by the site's own xiangqi board
// renderer from the kernel's initial state, for when nothing is in play.
function buildStartingBoard(): HTMLElement {
  const board = document.createElement('div');
  board.className = 'correspondence-static-board';
  void Promise.all([import('./xiangqi-board.js'), import('./live-xiangqi.css')])
    .then(([{ renderXiangqiBoardSvg }]) => {
      const view = getStandardXiangqiPlayerView(createInitialXiangqiState('hero'), 'red');
      board.innerHTML = renderXiangqiBoardSvg(view, 'red', { coordinates: false });
      board.querySelector('svg')?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    })
    .catch((err) => console.warn('[correspondence] hero board failed', err));
  return board;
}

function showcaseMatchup(game: CurrentGame): string {
  const [first, second] = game.players;
  return namesMatchupLabel(
    displayLiveName(first?.name, t('games.guest')),
    displayLiveName(second?.name, t('games.guest')),
  );
}

function buildInPlaySection(ctx: PageContext, games: CurrentGame[]): HTMLElement {
  const section = buildSection(t('correspondence.gamesInProgress'), games.length);
  section.classList.add('correspondence-showcase');
  const grid = document.createElement('div');
  grid.className = 'correspondence-showcase-grid';
  for (const game of games) grid.append(buildShowcaseCard(ctx, game));
  section.append(grid);
  return section;
}

function buildShowcaseCard(ctx: PageContext, game: CurrentGame): HTMLElement {
  const card = document.createElement('a');
  card.className = 'correspondence-showcase-card';
  card.href = game.url;
  card.dataset.roomId = game.roomId;
  const host = document.createElement('div');
  host.className = 'current-game-board';
  const kind = inboxTileKind(game.gameSpecId, game);
  if (kind === 'fog') {
    host.append(buildFogTileWithNote(game.gameSpecId, t('games.inTheFog')));
  } else {
    host.append(buildPlaceholderTile(game.gameSpecId));
    if (kind === 'board' && game.payload) {
      void mountBoard(ctx, host, game.gameSpecId, game.roomId, game, game.payload);
    }
  }
  const names = document.createElement('span');
  names.className = 'correspondence-showcase-names';
  names.textContent = showcaseMatchup(game);
  const meta = document.createElement('span');
  meta.className = 'correspondence-card-meta';
  const chip = document.createElement('span');
  chip.className = 'current-game-chip';
  chip.textContent = variantDisplayLabel(game.gameSpecId);
  meta.append(chip);
  const days = game.timeControl?.daysPerMove;
  if (days) meta.append(document.createTextNode(cadenceLabel(days)));
  const due = document.createElement('span');
  due.className = 'correspondence-showcase-due';
  const deadline = game.deadline;
  if (deadline) {
    const onMove = game.players.find((player) => player.color === deadline.seat);
    const name = displayLiveName(onMove?.name, t('games.guest'));
    const tick = (now: number): void => {
      const remaining = deadlineRemainingMs(deadline.dueAt, now);
      due.textContent =
        remaining === null || remaining <= 0
          ? t('correspondence.dueNow')
          : t('correspondence.toMoveLeft', { name, time: formatDayClock(remaining) });
    };
    tick(Date.now());
    ctx.tickers.push(tick);
  }
  card.append(host, names, meta, due);
  return card;
}

function buildHowItWorks(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'correspondence-how';
  const heading = document.createElement('h2');
  heading.textContent = t('correspondence.howHeading');
  const list = document.createElement('ol');
  list.className = 'correspondence-steps';
  const steps: Array<[I18nKey, I18nKey]> = [
    ['correspondence.step1Title', 'correspondence.step1Body'],
    ['correspondence.step2Title', 'correspondence.step2Body'],
    ['correspondence.step3Title', 'correspondence.step3Body'],
  ];
  steps.forEach(([titleKey, bodyKey], index) => {
    const item = document.createElement('li');
    item.className = 'correspondence-step';
    const number = document.createElement('span');
    number.className = 'correspondence-step-number';
    number.setAttribute('aria-hidden', 'true');
    number.textContent = String(index + 1);
    const title = document.createElement('h3');
    title.textContent = t(titleKey);
    const body = document.createElement('p');
    body.textContent = t(bodyKey);
    item.append(number, title, body);
    list.append(item);
  });
  section.append(heading, list);
  return section;
}

function buildFirstGameInvite(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'correspondence-panel correspondence-first';
  const copy = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = t('correspondence.firstTitle');
  const body = document.createElement('p');
  body.textContent = t('correspondence.firstBody');
  copy.append(title, body);
  const register = document.createElement('a');
  register.className = 'correspondence-btn';
  register.href = registerHref();
  register.textContent = t('correspondence.register');
  section.append(copy, register);
  return section;
}
