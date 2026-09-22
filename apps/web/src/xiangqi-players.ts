// Player pages over the broadcast archive (docs-private/players/
// players-surface-spec.md): /players, the index, and /players/<slug>, one
// player with every board they sat at. Both read the derived index the server
// builds from finished A-level boards; nothing here is authored.
//
// Styled with the broadcast surface's own classes (xqb-*): a player page is the
// same kind of page as an event page, and the reader crosses between them.
import './xiangqi-broadcast.css';
import './xiangqi-players.css';
import { buildCommunityLayout } from './community-rail.js';
import { CXA_POINTS, CXA_POINTS_LISTS } from './players/cxa-points.js';
import { CXA_LISTS, CXA_RATINGS } from './players/cxa-ratings.js';
import { PLAYER_PROFILES, PLAYER_TITLE_LABEL, type PlayerTitle } from './players/profiles.js';
import { buildLoadingState, buildNav, buildNotice } from './site-shell.js';

export type PlayerEventRecord = {
  tourSlug: string;
  tourName: string;
  tourNameEn: string | null;
  level: 'A' | 'B' | 'C' | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  firstPlayedOn: string | null;
  lastPlayedOn: string | null;
};

export type PlayerRecord = {
  slug: string;
  name: string;
  nameEn: string | null;
  federation: string | null;
  federationEn: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  events: PlayerEventRecord[];
  firstPlayedOn: string | null;
  lastPlayedOn: string | null;
};

export type PlayerBoardRecord = {
  boardId: string;
  tourSlug: string;
  tourName: string;
  tourNameEn: string | null;
  roundId: string;
  roundName: string;
  playedOn: string | null;
  colour: 'red' | 'black';
  opponent: { name: string; nameEn: string | null; slug: string | null };
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  outcome: 'win' | 'draw' | 'loss';
  plyCount: number;
  sourceUrl: string | null;
};

type PlayersIndexResponse = { players: PlayerRecord[] };
type PlayerResponse = { player: PlayerRecord; boards: PlayerBoardRecord[] };

export async function mountXiangqiPlayersIndex(root: HTMLElement): Promise<void> {
  setRoot(root, 'Loading players');
  try {
    const data = await fetchJson<PlayersIndexResponse>('/api/xiangqi/players');
    root.replaceChildren(buildNav(), renderIndex(data.players).main);
  } catch (err) {
    renderError(root, err);
  }
}

export async function mountXiangqiPlayer(root: HTMLElement, slug: string): Promise<void> {
  setRoot(root, 'Loading player');
  try {
    const data = await fetchJson<PlayerResponse>(
      `/api/xiangqi/players/${encodeURIComponent(slug)}`,
    );
    document.title = `${displayName(data.player)} · Mistboard`;
    root.replaceChildren(buildNav(), renderPlayer(data.player, data.boards).main);
  } catch (err) {
    renderError(root, err);
  }
}

function setRoot(root: HTMLElement, loadingLabel: string): void {
  root.classList.add('landing-page', 'xiangqi-broadcast-route');
  root.replaceChildren(buildNav(), buildLoadingState(loadingLabel));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) throw new Error('No such player');
    throw new Error(`Players API failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function renderError(root: HTMLElement, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  root.replaceChildren(buildNav(), buildNotice('Players unavailable', message));
}

export function displayName(player: Pick<PlayerRecord, 'name' | 'nameEn'>): string {
  return player.nameEn && player.nameEn !== player.name
    ? `${player.nameEn} ${player.name}`
    : player.name;
}

export function recordText(r: { wins: number; draws: number; losses: number }): string {
  return `${r.wins}-${r.draws}-${r.losses}`;
}

export function scorePercent(r: { games: number; wins: number; draws: number }): number {
  return r.games === 0 ? 0 : Math.round(((r.wins + r.draws / 2) / r.games) * 100);
}

export type IndexSort = 'games' | 'score' | 'name';

export function sortPlayers(players: readonly PlayerRecord[], sort: IndexSort): PlayerRecord[] {
  const out = [...players];
  if (sort === 'name') out.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  else if (sort === 'score')
    out.sort((a, b) => scorePercent(b) - scorePercent(a) || b.games - a.games);
  else out.sort((a, b) => b.games - a.games || displayName(a).localeCompare(displayName(b)));
  return out;
}

/** Does the query match the player, in either script or by team? */
export function matchesQuery(player: PlayerRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [player.name, player.nameEn, player.federation, player.federationEn].some((s) =>
    s?.toLowerCase().includes(q),
  );
}

/** The title tag for a player: authored first, else the last official list. */
export function playerTitle(player: Pick<PlayerRecord, 'slug' | 'name'>): PlayerTitle | null {
  const authored = PLAYER_PROFILES[player.slug]?.title;
  if (authored) return authored;
  const entries = CXA_RATINGS[player.name];
  const last = entries?.[entries.length - 1];
  return last?.title === '特' ? 'GM' : last?.title === '大' ? 'NM' : null;
}

// ---------------------------------------------------------------------------
// The index: one row per player, a search box, sortable by the column headers.

function renderIndex(players: PlayerRecord[]): HTMLElement & { main: HTMLElement } {
  const main = shell();
  const events = new Set(players.flatMap((p) => p.events.map((e) => e.tourSlug)));

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'xqp-search';
  search.placeholder = 'Search';
  search.setAttribute('aria-label', 'Search players');
  main.append(
    hero({
      eyebrow: 'Players',
      title: 'Xiangqi players',
      meta: [
        `${players.length} players`,
        `${events.size} events`,
        'Everyone with a finished game in a top-level relayed event',
      ],
      actions: [search],
    }),
  );

  const section = document.createElement('section');
  section.className = 'xqb-section';
  const table = document.createElement('table');
  table.className = 'xqp-index';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const columns: Array<{ label: string; sort?: IndexSort; className?: string }> = [
    { label: 'Name', sort: 'name', className: 'xqp-col-name' },
    { label: 'Games', sort: 'games' },
    { label: 'Score', sort: 'score' },
    { label: 'W-D-L' },
    { label: 'Events' },
    { label: 'Last seen' },
  ];
  let sort: IndexSort = 'games';
  let query = '';
  const sortHeaders = new Map<IndexSort, HTMLElement>();
  for (const column of columns) {
    const th = document.createElement('th');
    if (column.className) th.className = column.className;
    if (column.sort) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'xqp-sort';
      button.textContent = column.label;
      const key = column.sort;
      button.addEventListener('click', () => {
        sort = key;
        paintRows();
      });
      th.append(button);
      sortHeaders.set(key, th);
    } else {
      th.textContent = column.label;
    }
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);

  const empty = document.createElement('p');
  empty.className = 'xqp-empty';
  empty.hidden = true;

  function paintRows(): void {
    tbody.replaceChildren();
    for (const [key, th] of sortHeaders) th.classList.toggle('xqp-sorted', key === sort);
    const shown = sortPlayers(players, sort).filter((p) => matchesQuery(p, query));
    for (const player of shown) {
      const tr = document.createElement('tr');
      tr.className = 'xqp-row';
      tr.append(
        nameCell(player),
        cell(String(player.games)),
        cell(`${scorePercent(player)}%`),
        cell(recordText(player)),
        cell(String(player.events.length)),
        cell(player.lastPlayedOn ?? ''),
      );
      tr.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('a')) return;
        window.location.href = playerHref(player);
      });
      tbody.append(tr);
    }
    empty.hidden = shown.length > 0;
    empty.textContent = shown.length > 0 ? '' : `No player matches “${query.trim()}”.`;
  }
  search.addEventListener('input', () => {
    query = search.value;
    paintRows();
  });
  paintRows();
  section.append(table, empty);
  main.append(section);
  return main;
}

function playerHref(player: Pick<PlayerRecord, 'slug'>): string {
  return `/players/${encodeURIComponent(player.slug)}`;
}

/** Photo when we have one, else a tile with the surname character. */
function avatar(player: Pick<PlayerRecord, 'slug' | 'name'>, size: 'row' | 'page'): HTMLElement {
  const profile = PLAYER_PROFILES[player.slug];
  if (profile?.photo) {
    const img = document.createElement('img');
    img.className = `xqp-avatar xqp-avatar-${size}`;
    img.src = profile.photo;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }
  const tile = document.createElement('span');
  tile.className = `xqp-avatar xqp-avatar-${size} xqp-avatar-tile`;
  tile.textContent = Array.from(player.name)[0] ?? '';
  tile.setAttribute('aria-hidden', 'true');
  return tile;
}

function titleTag(title: PlayerTitle | null): HTMLElement | null {
  if (!title) return null;
  const tag = document.createElement('span');
  tag.className = 'xqp-title';
  tag.textContent = title;
  tag.title = PLAYER_TITLE_LABEL[title];
  return tag;
}

function nameCell(player: PlayerRecord): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'xqp-col-name';
  const wrap = document.createElement('span');
  wrap.className = 'xqp-name';
  const link = document.createElement('a');
  link.className = 'xqp-name-link';
  link.href = playerHref(player);
  const tag = titleTag(playerTitle(player));
  if (tag) link.append(tag, ' ');
  link.append(displayName(player));
  const team = document.createElement('span');
  team.className = 'xqp-team';
  team.textContent = player.federationEn ?? player.federation ?? '';
  wrap.append(link, team);
  td.append(avatar(player, 'row'), wrap);
  return td;
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

// ---------------------------------------------------------------------------
// One player: photo and facts, the official rating, events, every board.

function renderPlayer(
  player: PlayerRecord,
  boards: PlayerBoardRecord[],
): HTMLElement & { main: HTMLElement } {
  const main = shell();
  const profile = PLAYER_PROFILES[player.slug];

  const header = document.createElement('section');
  header.className = 'xqp-header';
  const figure = document.createElement('figure');
  figure.className = 'xqp-portrait';
  figure.append(avatar(player, 'page'));
  if (profile?.photoCredit) {
    const cap = document.createElement('figcaption');
    cap.textContent = `Credit: ${profile.photoCredit}`;
    figure.append(cap);
  }
  const copy = document.createElement('div');
  copy.className = 'xqp-header-copy';
  const h1 = document.createElement('h1');
  h1.className = 'xqp-h1';
  const tag = titleTag(playerTitle(player));
  if (tag) h1.append(tag, ' ');
  h1.append(player.nameEn ?? player.name);
  if (player.nameEn && player.nameEn !== player.name) {
    const zh = document.createElement('span');
    zh.className = 'xqp-h1-zh';
    zh.textContent = player.name;
    h1.append(' ', zh);
  }
  const facts = document.createElement('dl');
  facts.className = 'xqp-facts';
  const fact = (label: string, value: string | Node | null | undefined): void => {
    if (!value) return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.append(value);
    facts.append(dt, dd);
  };
  fact('Team', player.federationEn ?? player.federation);
  fact('Born', profile?.born);
  fact('Archive', `${player.games} games, ${recordText(player)}, ${scorePercent(player)}%`);
  fact(
    'Seen',
    player.firstPlayedOn && player.lastPlayedOn
      ? `${player.firstPlayedOn} to ${player.lastPlayedOn}`
      : null,
  );
  const actions = document.createElement('div');
  actions.className = 'xqb-hero-actions xqp-header-actions';
  const back = document.createElement('a');
  back.className = 'xqb-link';
  back.href = '/players';
  back.textContent = 'All players';
  actions.append(back);
  if (profile?.profileHref) {
    const link = document.createElement('a');
    link.className = 'xqb-link xqb-link-primary';
    link.href = profile.profileHref;
    link.textContent = 'Read the profile';
    actions.append(link);
  }
  copy.append(h1, facts, actions);
  header.append(figure, copy);
  main.append(header);

  const officialRating = [pointsCard(player), ratingCard(player)].filter(
    (x): x is HTMLElement => x !== null,
  );
  if (officialRating.length > 0) {
    const section = document.createElement('section');
    section.className = 'xqb-section';
    const h2 = document.createElement('h2');
    h2.textContent = 'Official rating';
    const cards = document.createElement('div');
    cards.className = 'xqp-rating-row';
    cards.append(...officialRating);
    section.append(h2, cards);
    main.append(section);
  }

  const events = document.createElement('section');
  events.className = 'xqb-section';
  const h2 = document.createElement('h2');
  h2.textContent = 'Events';
  const grid = document.createElement('div');
  grid.className = 'xqp-events';
  for (const event of player.events) grid.append(eventCard(event));
  events.append(h2, grid);

  const games = document.createElement('section');
  games.className = 'xqb-section';
  const h2b = document.createElement('h2');
  h2b.textContent = `Games (${boards.length})`;
  const list = document.createElement('div');
  list.className = 'xqp-games';
  for (const board of boards) list.append(boardRow(board, player));
  games.append(h2b, list);

  main.append(events, games);
  return main;
}

function eventCard(event: PlayerEventRecord): HTMLElement {
  const card = document.createElement('a');
  card.className = 'xqp-event';
  card.href = `/broadcast/xiangqi/${encodeURIComponent(event.tourSlug)}`;
  const dates = document.createElement('span');
  dates.className = 'xqp-event-dates';
  dates.textContent =
    event.firstPlayedOn && event.lastPlayedOn
      ? event.firstPlayedOn === event.lastPlayedOn
        ? event.firstPlayedOn
        : `${event.firstPlayedOn} to ${event.lastPlayedOn}`
      : '';
  const name = document.createElement('span');
  name.className = 'xqp-event-name';
  name.textContent = event.tourNameEn ?? event.tourName;
  const record = document.createElement('span');
  record.className = 'xqp-event-record';
  record.textContent = `${event.games} games · ${recordText(event)} · ${scorePercent(event)}%`;
  card.append(dates, name, record);
  return card;
}

/** The current CXA 竞赛积分排名: tournament points over a rolling window,
 *  replacing 等级分 since January 2026. One list published so far, so no
 *  sparkline yet — the series grows every time the CXA posts a new one. */
function pointsCard(player: Pick<PlayerRecord, 'name'>): HTMLElement | null {
  const entries = CXA_POINTS[player.name];
  if (!entries || entries.length === 0) return null;
  const last = entries[entries.length - 1];
  const list = CXA_POINTS_LISTS.find((l) => l.id === last.list);
  const size = list ? (last.group === 'men' ? list.men : list.women) : null;
  const card = document.createElement('div');
  card.className = 'xqp-rating';
  const head = document.createElement('div');
  head.className = 'xqp-rating-head';
  const label = document.createElement('span');
  label.className = 'xqp-rating-label';
  label.textContent = 'CXA 竞赛积分';
  const value = document.createElement('span');
  value.className = 'xqp-rating-value';
  value.textContent = String(last.points);
  head.append(label, value);
  const sub = document.createElement('p');
  sub.className = 'xqp-rating-sub';
  sub.textContent = [
    size !== null ? `#${last.rank} of ${size}` : `#${last.rank}`,
    `${last.events} events, best ${last.best}`,
    list?.window ? `rolling window since ${list.window[0]}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  card.append(head, sub);
  return card;
}

/** The CXA 等级分 series, when the player was on the lists: the last value,
 *  the last rank, and the shape of the series behind it. Closed history —
 *  the CXA replaced it with tournament points in January 2026. */
function ratingCard(player: Pick<PlayerRecord, 'name'>): HTMLElement | null {
  const entries = CXA_RATINGS[player.name];
  if (!entries || entries.length === 0) return null;
  const last = entries[entries.length - 1];
  const lastList = CXA_LISTS.find((l) => l.id === last.list);
  const card = document.createElement('div');
  card.className = 'xqp-rating';
  const head = document.createElement('div');
  head.className = 'xqp-rating-head';
  const label = document.createElement('span');
  label.className = 'xqp-rating-label';
  label.textContent = 'CXA 等级分 (closed)';
  const value = document.createElement('span');
  value.className = 'xqp-rating-value';
  value.textContent = String(last.rating);
  head.append(label, value);
  const sub = document.createElement('p');
  sub.className = 'xqp-rating-sub';
  sub.textContent = [
    last.rank !== null && lastList ? `#${last.rank} of ${lastList.size}` : null,
    lastList ? `last list ${lastList.label}` : null,
    'replaced by tournament points in January 2026',
  ]
    .filter(Boolean)
    .join(' · ');
  card.append(
    head,
    sparkline(
      entries.map((e) => e.rating),
      entries.map((e) => CXA_LISTS.find((l) => l.id === e.list)?.label ?? e.list),
    ),
    sub,
  );
  return card;
}

/** An area sparkline, lichess-style: no axes, the series is the shape. */
export function sparkline(values: readonly number[], labels: readonly string[]): SVGSVGElement {
  const width = 300;
  const height = 80;
  const pad = 4;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'xqp-spark');
  svg.setAttribute('role', 'img');
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (i: number): number =>
    values.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (values.length - 1);
  const y = (v: number): number => height - pad - ((v - min) / span) * (height - 2 * pad);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute(
    'd',
    `M${x(0).toFixed(1)},${height} L${points.join(' L')} L${x(values.length - 1).toFixed(1)},${height} Z`,
  );
  area.setAttribute('class', 'xqp-spark-area');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', `M${points.join(' L')}`);
  line.setAttribute('class', 'xqp-spark-line');
  svg.append(area, line);
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = values.map((v, i) => `${labels[i] ?? ''}: ${v}`).join(', ');
  svg.append(title);
  return svg;
}

function boardRow(board: PlayerBoardRecord, player: PlayerRecord): HTMLElement {
  const row = document.createElement('a');
  row.className = `xqp-game xqp-game-${board.outcome}`;
  row.href = `/broadcast/xiangqi/board/${encodeURIComponent(board.boardId)}`;

  const outcome = document.createElement('span');
  outcome.className = 'xqp-outcome';
  outcome.textContent = board.outcome === 'win' ? 'W' : board.outcome === 'loss' ? 'L' : 'D';

  const who = document.createElement('span');
  who.className = 'xqp-who';
  const me = document.createElement('span');
  me.textContent = player.nameEn ?? player.name;
  const vs = document.createElement('span');
  vs.className = 'xqp-vs';
  vs.textContent = ' vs ';
  const them = document.createElement('span');
  them.textContent = board.opponent.nameEn ?? board.opponent.name;
  // Red is listed first on every board on the site; keep that order here.
  if (board.colour === 'red') who.append(me, vs, them);
  else who.append(them, vs, me);

  const colour = document.createElement('span');
  colour.className = `xqp-colour xqp-colour-${board.colour}`;
  colour.textContent = board.colour === 'red' ? 'red' : 'black';

  const meta = document.createElement('span');
  meta.className = 'xqp-game-meta';
  meta.textContent = [
    board.tourNameEn ?? board.tourName,
    board.roundName,
    board.playedOn ?? '',
    `${Math.ceil(board.plyCount / 2)} moves`,
    board.result,
  ]
    .filter(Boolean)
    .join(' · ');

  row.append(outcome, who, colour, meta);
  return row;
}

// ---------------------------------------------------------------------------

/** The community shell with its rail (Leaderboard / … / Pro players), the
 *  page content in the column beside it. Returns the column; callers append
 *  sections to it and mount `main` on the root. */
function shell(): HTMLElement & { main: HTMLElement } {
  const main = document.createElement('main');
  main.className = 'site-section community-shell';
  const column = Object.assign(document.createElement('div'), { main });
  column.className = 'xqb-shell xqp-column';
  main.append(buildCommunityLayout('/players', column));
  return column;
}

function hero(input: {
  eyebrow: string;
  title: string;
  meta: string[];
  actions?: HTMLElement[];
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
  if (input.meta.length > 0) {
    const meta = document.createElement('p');
    meta.className = 'xqb-hero-meta';
    meta.textContent = input.meta.join(' / ');
    copy.append(meta);
  }
  const actions = document.createElement('div');
  actions.className = 'xqb-hero-actions';
  for (const el of input.actions ?? []) actions.append(el);
  section.append(copy, actions);
  return section;
}
