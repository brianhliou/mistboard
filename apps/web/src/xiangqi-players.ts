// Player pages over the broadcast archive (docs-private/players/
// players-surface-spec.md): /players, the index, and /players/<slug>, one
// player with every board they sat at. Both read the derived index the server
// builds from finished A-level boards; nothing here is authored.
//
// Styled with the broadcast surface's own classes (xqb-*): a player page is the
// same kind of page as an event page, and the reader crosses between them.
import './seat-disc-ink.css';
import './xiangqi-broadcast.css';
import './xiangqi-players.css';
import { t } from './i18n/catalog.js';
import { currentLocale } from './i18n/locale.js';
import {
  cxaGroupFor,
  cxaPointsFor,
  cxaRatingsFor,
  type PlayerGroup,
} from './players/cxa-coverage.js';
import { CXA_POINTS_LISTS } from './players/cxa-points.js';
import { CXA_LISTS } from './players/cxa-ratings.js';
import { eccoEnglish } from './players/ecco-english.js';
import {
  type BoardFilter,
  type Colour,
  ECCO_FAMILY_KEYS,
  filterBoards,
  filterFromSearch,
  type Opening,
  type OpeningRow,
  openingsOf,
  opponentsOf,
  type Record3,
  recordByColour,
  recordOf,
  searchFromFilter,
} from './players/player-stats.js';
import { playerTitleFor } from './players/player-title.js';
import { PLAYER_PROFILES, PLAYER_TITLE_LABEL, type PlayerTitle } from './players/profiles.js';
import { ratingHistoryFigure } from './players/rating-history-chart.js';
import { buildLoadingState, buildNav, buildNotice } from './site-shell.js';
import { type BroadcastRailItem, broadcastSectionLayout } from './xiangqi-broadcast-pages.js';

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
  /** On a CXA list with no game in the archive, listed by the server
   *  (cxa-listed-players.ts): the page is the list's facts and an empty games
   *  state. Absent on every player with games. */
  cxaOnly?: boolean;
};

export type PlayerBoardRecord = {
  boardId: string;
  tourSlug: string;
  tourName: string;
  tourNameEn: string | null;
  roundId: string;
  roundName: string;
  roundNameEn?: string | null;
  playedOn: string | null;
  colour: 'red' | 'black';
  opponent: { name: string; nameEn: string | null; slug: string | null };
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  outcome: 'win' | 'draw' | 'loss';
  plyCount: number;
  sourceUrl: string | null;
  /** "C70 五七炮对屏风马进３卒"; absent from responses that predate the field. */
  opening?: string | null;
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

export async function mountXiangqiTeamsIndex(root: HTMLElement): Promise<void> {
  setRoot(root, 'Loading teams');
  try {
    const data = await fetchJson<PlayersIndexResponse>('/api/xiangqi/players');
    root.replaceChildren(buildNav(), renderTeams(data.players).main);
  } catch (err) {
    renderError(root, err);
  }
}

export async function mountXiangqiTeam(root: HTMLElement, key: string): Promise<void> {
  setRoot(root, 'Loading team');
  try {
    const data = await fetchJson<PlayersIndexResponse>('/api/xiangqi/players');
    const team = teamsOf(data.players).find((entry) => entry.key === key);
    if (!team) throw new Error('No team by that name');
    document.title = `${teamLabel(team)} · Mistboard`;
    root.replaceChildren(buildNav(), renderTeam(team).main);
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

// ---------------------------------------------------------------------------
// The index, lichess's FIDE players page: one panel with the title and a
// search, then one row per player, sortable by the column headers. The CXA's
// current points list leads, the way lichess leads with classical rating.

/** The player's entry on the latest CXA points list they appear on. */
export function latestPoints(name: string): { points: number; rank: number } | null {
  const entries = cxaPointsFor(name);
  const last = entries[entries.length - 1];
  return last ? { points: last.points, rank: last.rank } : null;
}

/** The player's last CXA rating (the series closed in 2026). */
export function latestRating(name: string): number | null {
  const entries = cxaRatingsFor(name);
  return entries[entries.length - 1]?.rating ?? null;
}

function byNullableDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export type IndexSort = 'points' | 'rating' | 'games' | 'score' | 'name';

function listOrder(player: PlayerRecord): number {
  const entries = cxaPointsFor(player.name);
  const group = entries[entries.length - 1]?.group;
  return group === 'men' ? 0 : group === 'women' ? 1 : 2;
}

export function sortPlayers(players: readonly PlayerRecord[], sort: IndexSort): PlayerRecord[] {
  const out = [...players];
  const byGames = (a: PlayerRecord, b: PlayerRecord) =>
    b.games - a.games || displayName(a).localeCompare(displayName(b));
  if (sort === 'name') out.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  else if (sort === 'score')
    out.sort(
      (a, b) =>
        byNullableDesc(
          a.games > 0 ? scorePercent(a) : null,
          b.games > 0 ? scorePercent(b) : null,
        ) || b.games - a.games,
    );
  else if (sort === 'points')
    // The men's and women's lists are separate rankings on their own scales,
    // so the men's list comes first and the women's after it, never interleaved.
    out.sort(
      (a, b) =>
        listOrder(a) - listOrder(b) ||
        byNullableDesc(
          latestPoints(a.name)?.points ?? null,
          latestPoints(b.name)?.points ?? null,
        ) ||
        byNullableDesc(latestRating(a.name), latestRating(b.name)) ||
        byGames(a, b),
    );
  else if (sort === 'rating')
    out.sort((a, b) => byNullableDesc(latestRating(a.name), latestRating(b.name)) || byGames(a, b));
  else out.sort(byGames);
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

/** Men's or women's: the CXA list the player is on, else the events they
 *  played (a 女子 event, or one whose slug says women; a 男子 event).
 *  Null when neither says, rather than a guess. */
export function playerGroup(
  player: Pick<PlayerRecord, 'name'> & {
    events: readonly Pick<PlayerEventRecord, 'tourSlug' | 'tourName'>[];
  },
): PlayerGroup | null {
  const listed = cxaGroupFor(player.name);
  if (listed) return listed;
  if (
    player.events.some((e) => e.tourName.includes('女子') || /(^|-)womens?(-|$)/.test(e.tourSlug))
  )
    return 'women';
  if (player.events.some((e) => e.tourName.includes('男子') || /(^|-)men(-|$)/.test(e.tourSlug)))
    return 'men';
  return null;
}

/** The season the index calls current: the latest year any player played in.
 *  From the data, not the clock, so the filter never empties on New Year's Day. */
export function currentSeason(
  players: readonly Pick<PlayerRecord, 'lastPlayedOn'>[],
): string | null {
  let latest: string | null = null;
  for (const p of players)
    if (p.lastPlayedOn && (!latest || p.lastPlayedOn > latest)) latest = p.lastPlayedOn;
  return latest ? latest.slice(0, 4) : null;
}

export type IndexFilter = {
  title?: PlayerTitle | 'none';
  group?: PlayerGroup;
  /** Only players with a game in this season (a year, "2026"). */
  season?: string;
};

export function matchesFilter(player: PlayerRecord, filter: IndexFilter): boolean {
  if (filter.title) {
    const title = playerTitle(player);
    if (filter.title === 'none' ? title !== null : title !== filter.title) return false;
  }
  if (filter.group && playerGroup(player) !== filter.group) return false;
  if (filter.season && !player.lastPlayedOn?.startsWith(filter.season)) return false;
  return true;
}

/** ?title=GM&list=women&active=2026, keeping only values that mean something. */
export function indexFilterFromSearch(search: string): IndexFilter {
  const params = new URLSearchParams(search);
  const filter: IndexFilter = {};
  const title = params.get('title');
  if (title === 'GM' || title === 'NM' || title === 'none') filter.title = title;
  const group = params.get('list');
  if (group === 'men' || group === 'women') filter.group = group;
  const season = params.get('active');
  if (season && /^\d{4}$/.test(season)) filter.season = season;
  return filter;
}

export function indexSearchFromFilter(filter: IndexFilter): string {
  const params = new URLSearchParams();
  if (filter.title) params.set('title', filter.title);
  if (filter.group) params.set('list', filter.group);
  if (filter.season) params.set('active', filter.season);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The title tag for a player: authored first, else the last official list. */
export function playerTitle(player: Pick<PlayerRecord, 'slug' | 'name'>): PlayerTitle | null {
  return playerTitleFor(player);
}

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

/** The panel's head: a light title on the left, lichess's search on the right. */
function boardHead(title: HTMLElement, search?: HTMLInputElement): HTMLElement {
  const head = document.createElement('header');
  head.className = 'xqp-board-head';
  head.append(title);
  if (search) {
    const form = document.createElement('form');
    form.className = 'xqp-search-form';
    form.setAttribute('role', 'search');
    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'xqp-search-button';
    button.setAttribute('aria-label', 'Search');
    button.innerHTML = SEARCH_ICON;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      search.dispatchEvent(new Event('input'));
    });
    form.append(search, button);
    head.append(form);
  }
  return head;
}

function searchInput(label: string): HTMLInputElement {
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'xqp-search';
  search.placeholder = 'Search';
  search.setAttribute('aria-label', label);
  return search;
}

type Column<T, K extends string> = {
  label: string;
  sort?: K;
  className?: string;
  hint?: string;
  value: (row: T) => HTMLTableCellElement;
};

/** A sortable, searchable table in the panel; returns the table and a repaint. */
function sortableTable<T, K extends string>(input: {
  rows: readonly T[];
  columns: Column<T, K>[];
  sort: K;
  order: (rows: readonly T[], sort: K) => T[];
  matches: (row: T, query: string) => boolean;
  href: (row: T) => string;
  search?: HTMLInputElement;
  /** Filters beyond the search box; call `repaint` after changing them. */
  filter?: (row: T) => boolean;
  onPaint?: (shown: number) => void;
}): HTMLElement & { repaint: () => void } {
  const wrap = document.createElement('div');
  wrap.className = 'xqp-table-wrap';
  const table = document.createElement('table');
  table.className = 'xqp-index';
  const headRow = document.createElement('tr');
  let sort = input.sort;
  const sortHeaders = new Map<K, HTMLElement>();
  for (const column of input.columns) {
    const th = document.createElement('th');
    if (column.className) th.className = column.className;
    if (column.hint) th.title = column.hint;
    if (column.sort) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'xqp-sort';
      button.textContent = column.label;
      const key = column.sort;
      button.addEventListener('click', () => {
        sort = key;
        paint();
      });
      th.append(button);
      sortHeaders.set(key, th);
    } else {
      th.textContent = column.label;
    }
    headRow.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  const empty = document.createElement('p');
  empty.className = 'xqp-empty';
  empty.hidden = true;

  function paint(): void {
    const query = input.search?.value ?? '';
    tbody.replaceChildren();
    for (const [key, th] of sortHeaders) th.classList.toggle('xqp-sorted', key === sort);
    const shown = input
      .order(input.rows, sort)
      .filter((row) => input.matches(row, query) && (input.filter?.(row) ?? true));
    for (const row of shown) {
      const tr = document.createElement('tr');
      tr.className = 'xqp-row';
      for (const column of input.columns) {
        const td = column.value(row);
        if (column.sort === sort) td.classList.add('xqp-sorted-cell');
        tr.append(td);
      }
      tr.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('a')) return;
        window.location.href = input.href(row);
      });
      tbody.append(tr);
    }
    empty.hidden = shown.length > 0;
    empty.textContent =
      shown.length > 0
        ? ''
        : query.trim()
          ? `Nothing matches “${query.trim()}”.`
          : 'Nothing matches.';
    input.onPaint?.(shown.length);
  }
  input.search?.addEventListener('input', paint);
  paint();
  wrap.append(table, empty);
  return Object.assign(wrap, { repaint: paint });
}

function numberCell(value: number | null | undefined, suffix = ''): HTMLTableCellElement {
  return cell(value === null || value === undefined ? '' : `${value}${suffix}`);
}

function playerColumns(showTeam: boolean): Column<PlayerRecord, IndexSort>[] {
  return [
    {
      label: 'Name',
      sort: 'name',
      className: 'xqp-col-name',
      value: (p) => nameCell(p, showTeam),
    },
    {
      label: 'Points',
      sort: 'points',
      hint: 'CXA tournament points, the latest list the player is on',
      value: (p) => numberCell(latestPoints(p.name)?.points),
    },
    {
      label: 'Rating',
      sort: 'rating',
      hint: 'Last CXA rating (the rating lists ended in 2026)',
      value: (p) => numberCell(latestRating(p.name)),
    },
    // A CXA-only player has no games to count, which is not the same as none won.
    { label: 'Games', sort: 'games', value: (p) => numberCell(p.cxaOnly ? null : p.games) },
    {
      label: 'Score',
      sort: 'score',
      value: (p) => numberCell(p.games > 0 ? scorePercent(p) : null, '%'),
    },
  ];
}

function playersTable(
  players: readonly PlayerRecord[],
  search: HTMLInputElement | undefined,
  showTeam: boolean,
  extra?: Pick<Parameters<typeof sortableTable<PlayerRecord, IndexSort>>[0], 'filter' | 'onPaint'>,
): HTMLElement & { repaint: () => void } {
  return sortableTable<PlayerRecord, IndexSort>({
    rows: players,
    columns: playerColumns(showTeam),
    sort: 'points',
    order: sortPlayers,
    matches: matchesQuery,
    href: playerHref,
    search,
    ...extra,
  });
}

function renderIndex(players: PlayerRecord[]): HTMLElement & { main: HTMLElement } {
  const main = shell('players');
  const title = document.createElement('h1');
  title.className = 'xqp-board-title';
  title.textContent = 'Xiangqi players';
  const search = searchInput('Search players');
  const panel = document.createElement('section');
  panel.className = 'xqp-board';
  const season = currentSeason(players);
  const state: { filter: IndexFilter } = { filter: indexFilterFromSearch(window.location.search) };
  const count = document.createElement('span');
  count.className = 'xqp-filter-count';
  const table = playersTable(players, search, true, {
    filter: (p) => matchesFilter(p, state.filter),
    onPaint: (shown) => {
      count.textContent = t('broadcast.playersCount', { n: shown });
    },
  });
  const apply = (next: IndexFilter): void => {
    state.filter = next;
    const url = `${window.location.pathname}${indexSearchFromFilter(next)}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
    table.repaint();
  };
  const bar = document.createElement('div');
  bar.className = 'xqp-filters';
  bar.append(
    filterSelect(
      t('broadcast.playersFilterTitle'),
      [
        ['', t('broadcast.playersAnyTitle')],
        ['GM', 'GM'],
        ['NM', 'NM'],
        ['none', t('broadcast.playersUntitled')],
      ],
      state.filter.title ?? '',
      (value) => apply({ ...state.filter, title: (value || undefined) as IndexFilter['title'] }),
    ),
    filterSelect(
      t('broadcast.playersFilterGroup'),
      [
        ['', t('broadcast.playersMenAndWomen')],
        ['men', t('broadcast.playersMen')],
        ['women', t('broadcast.playersWomen')],
      ],
      state.filter.group ?? '',
      (value) => apply({ ...state.filter, group: (value || undefined) as IndexFilter['group'] }),
    ),
  );
  if (season) {
    const label = document.createElement('label');
    label.className = 'xqp-filter xqp-filter-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = state.filter.season === season;
    box.addEventListener('change', () =>
      apply({ ...state.filter, season: box.checked ? season : undefined }),
    );
    label.append(box, t('broadcast.playersActive', { year: season }));
    bar.append(label);
  }
  bar.append(count);
  panel.append(boardHead(title, search), bar, table);
  main.append(panel);
  return main;
}

/** One labelled select in a filter bar. */
function filterSelect(
  label: string,
  options: readonly (readonly [string, string])[],
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'xqp-filter';
  const caption = document.createElement('span');
  caption.className = 'xqp-filter-label';
  caption.textContent = label;
  const select = document.createElement('select');
  select.className = 'xqp-filter-select';
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    select.append(option);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  wrap.append(caption, select);
  return wrap;
}

// ---------------------------------------------------------------------------
// Teams, lichess's FIDE federations: the clubs and provinces the players sit
// for, each from the players' latest team. The badge stands in for a flag.

export type TeamRecord = {
  key: string;
  name: string;
  nameEn: string | null;
  players: PlayerRecord[];
  games: number;
  wins: number;
  draws: number;
  losses: number;
};

/** A URL-safe key for a team: its English name slugged, else the Chinese. */
export function teamKey(player: Pick<PlayerRecord, 'federation' | 'federationEn'>): string | null {
  const slug = (player.federationEn ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || player.federation || null;
}

export function teamsOf(players: readonly PlayerRecord[]): TeamRecord[] {
  const teams = new Map<string, TeamRecord>();
  for (const player of players) {
    const key = teamKey(player);
    if (!key || !player.federation) continue;
    let team = teams.get(key);
    if (!team) {
      team = {
        key,
        name: player.federation,
        nameEn: player.federationEn,
        players: [],
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
      };
      teams.set(key, team);
    }
    team.players.push(player);
    team.games += player.games;
    team.wins += player.wins;
    team.draws += player.draws;
    team.losses += player.losses;
  }
  return [...teams.values()];
}

/** The points of the team's five best players added up, lichess's "top 10
 *  average" for a list where most players have no points: a mean over the
 *  ranked few would put a team with one ranked player first. */
export function teamStrength(team: Pick<TeamRecord, 'players'>): number | null {
  const best = team.players
    .map((p) => latestPoints(p.name)?.points)
    .filter((x): x is number => x !== undefined)
    .sort((a, b) => b - a)
    .slice(0, 5);
  if (best.length === 0) return null;
  return best.reduce((a, b) => a + b, 0);
}

export type TeamSort = 'name' | 'players' | 'strength' | 'games' | 'score';

export function sortTeams(teams: readonly TeamRecord[], sort: TeamSort): TeamRecord[] {
  const out = [...teams];
  const byPlayers = (a: TeamRecord, b: TeamRecord) =>
    b.players.length - a.players.length || b.games - a.games;
  if (sort === 'name') out.sort((a, b) => teamLabel(a).localeCompare(teamLabel(b)));
  else if (sort === 'players') out.sort(byPlayers);
  else if (sort === 'games') out.sort((a, b) => b.games - a.games);
  else if (sort === 'score')
    out.sort((a, b) => scorePercent(b) - scorePercent(a) || byPlayers(a, b));
  else out.sort((a, b) => byNullableDesc(teamStrength(a), teamStrength(b)) || byPlayers(a, b));
  return out;
}

function teamLabel(team: Pick<TeamRecord, 'name' | 'nameEn'>): string {
  return team.nameEn ?? team.name;
}

function teamHref(key: string): string {
  return `/players/teams/${encodeURIComponent(key)}`;
}

const TEAM_INKS = ['#a63328', '#237960', '#3b4f8f', '#9a6419', '#7a3b69'] as const;

/** The team's badge: its first character on an ink hashed from the key. */
function teamBadge(
  team: { key: string; name: string },
  size: 'row' | 'mini' | 'page',
): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `xqp-team-badge xqp-team-badge-${size}`;
  badge.setAttribute('aria-hidden', 'true');
  let hash = 0;
  for (const char of team.key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  badge.style.setProperty('--xqp-team-ink', TEAM_INKS[hash % TEAM_INKS.length]!);
  badge.textContent = Array.from(team.name)[0] ?? '';
  return badge;
}

function teamNameCell(team: TeamRecord): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'xqp-col-name';
  const wrap = document.createElement('span');
  wrap.className = 'xqp-name';
  const link = document.createElement('a');
  link.className = 'xqp-name-link';
  link.href = teamHref(team.key);
  link.textContent = teamLabel(team);
  wrap.append(link);
  if (team.nameEn && team.nameEn !== team.name) {
    const zh = document.createElement('span');
    zh.className = 'xqp-team';
    zh.textContent = team.name;
    wrap.append(zh);
  }
  td.append(teamBadge(team, 'row'), wrap);
  return td;
}

function renderTeams(players: PlayerRecord[]): HTMLElement & { main: HTMLElement } {
  const main = shell('teams');
  const title = document.createElement('h1');
  title.className = 'xqp-board-title';
  title.textContent = 'Xiangqi teams';
  const search = searchInput('Search teams');
  const panel = document.createElement('section');
  panel.className = 'xqp-board';
  panel.append(
    boardHead(title, search),
    sortableTable<TeamRecord, TeamSort>({
      rows: teamsOf(players),
      columns: [
        { label: 'Team', sort: 'name', className: 'xqp-col-name', value: teamNameCell },
        { label: 'Players', sort: 'players', value: (t) => numberCell(t.players.length) },
        {
          label: 'Top 5 points',
          sort: 'strength',
          hint: 'The CXA points of the team’s five best players, added up',
          value: (t) => numberCell(teamStrength(t)),
        },
        { label: 'Games', sort: 'games', value: (t) => numberCell(t.games) },
        { label: 'Score', sort: 'score', value: (t) => numberCell(scorePercent(t), '%') },
      ],
      sort: 'strength',
      order: sortTeams,
      matches: (team, query) => {
        const q = query.trim().toLowerCase();
        return !q || [team.name, team.nameEn].some((s) => s?.toLowerCase().includes(q));
      },
      href: (team) => teamHref(team.key),
      search,
    }),
  );
  main.append(panel);
  return main;
}

function renderTeam(team: TeamRecord): HTMLElement & { main: HTMLElement } {
  const main = shell('teams');
  const title = document.createElement('div');
  title.className = 'xqp-team-head';
  const copy = document.createElement('div');
  const h1 = document.createElement('h1');
  h1.className = 'xqp-board-title';
  h1.textContent = teamLabel(team);
  copy.append(h1);
  const meta = document.createElement('p');
  meta.className = 'xqp-team-meta';
  meta.textContent = [
    team.nameEn && team.nameEn !== team.name ? team.name : null,
    `${team.players.length} ${team.players.length === 1 ? 'player' : 'players'}`,
    `${team.games} games, ${recordText(team)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  copy.append(meta);
  title.append(teamBadge(team, 'page'), copy);
  const panel = document.createElement('section');
  panel.className = 'xqp-board';
  panel.append(boardHead(title), playersTable(team.players, undefined, false));
  main.append(panel);
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

function nameCell(player: PlayerRecord, showTeam = true): HTMLTableCellElement {
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
  wrap.append(link);
  const key = teamKey(player);
  if (showTeam && key && player.federation) {
    // The team under the name, lichess's flag and country.
    const team = document.createElement('a');
    team.className = 'xqp-team';
    team.href = teamHref(key);
    team.append(
      teamBadge({ key, name: player.federation }, 'mini'),
      player.federationEn ?? player.federation,
    );
    wrap.append(team);
  } else if (showTeam && player.cxaOnly) {
    // No team to show: the list the player is on stands in, and says why the
    // row has no games.
    const group = cxaGroupFor(player.name);
    if (group) {
      const line = document.createElement('span');
      line.className = 'xqp-team';
      line.textContent = t(
        group === 'women' ? 'broadcast.playerListWomen' : 'broadcast.playerListMen',
      );
      wrap.append(line);
    }
  }
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
// One player: photo and facts, the official rating and its history, the
// record cut by colour, opponent and opening, events, every board.

function renderPlayer(
  player: PlayerRecord,
  boards: PlayerBoardRecord[],
): HTMLElement & { main: HTMLElement } {
  const main = shell('players');
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
  const key = teamKey(player);
  if (key && player.federation) {
    const team = document.createElement('a');
    team.className = 'xqp-fact-link';
    team.href = teamHref(key);
    team.textContent = player.federationEn ?? player.federation;
    fact('Team', team);
  }
  const group = cxaGroupFor(player.name);
  if (player.cxaOnly && group) {
    fact(
      t('broadcast.playerListLabel'),
      t(group === 'women' ? 'broadcast.playerListWomen' : 'broadcast.playerListMen'),
    );
  }
  fact('Born', profile?.born);
  if (player.games > 0) {
    fact('Archive', `${player.games} games, ${recordText(player)}, ${scorePercent(player)}%`);
  }
  fact(
    'Seen',
    player.firstPlayedOn && player.lastPlayedOn
      ? `${player.firstPlayedOn} to ${player.lastPlayedOn}`
      : null,
  );
  // No "All players" link: the rail's Pro players entry is the way back.
  copy.append(h1, facts);
  if (profile?.profileHref) {
    const actions = document.createElement('div');
    actions.className = 'xqb-hero-actions xqp-header-actions';
    const link = document.createElement('a');
    link.className = 'xqb-link xqb-link-primary';
    link.href = profile.profileHref;
    link.textContent = 'Read the profile';
    actions.append(link);
    copy.append(actions);
  }
  header.append(figure, copy);
  main.append(header);

  const officialRating = [pointsCard(player), ratingCard(player)].filter(
    (x): x is HTMLElement => x !== null,
  );
  if (officialRating.length > 0) {
    const cards = document.createElement('div');
    cards.className = 'xqp-rating-row';
    cards.append(...officialRating);
    main.append(section('Official rating', cards));
  }

  const history = ratingHistoryFigure(cxaRatingsFor(player.name), cxaPointsFor(player.name));
  if (history) main.append(section(t('broadcast.playerRatingHistory'), history));

  if (boards.length === 0) {
    // A CXA-listed player the archive has not seen play: say so plainly
    // rather than show an empty record.
    const empty = document.createElement('div');
    empty.className = 'xqp-no-games';
    const title = document.createElement('p');
    title.className = 'xqp-no-games-title';
    title.textContent = t('broadcast.playerNoGames');
    const body = document.createElement('p');
    body.textContent = t('broadcast.playerNoGamesBody', { name: player.nameEn ?? player.name });
    empty.append(title, body);
    main.append(section(`Games (0)`, empty));
    return main;
  }

  const view = gamesView(player, boards);
  main.append(recordSection(boards, view));
  const openings = openingsSection(boards, view);
  if (openings) main.append(openings);

  if (player.events.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'xqp-events';
    for (const event of player.events) grid.append(eventCard(event));
    main.append(section('Events', grid));
  }
  main.append(view.section);
  return main;
}

function section(title: string, ...body: Node[]): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'xqb-section';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  wrap.append(h2, ...body);
  return wrap;
}

/** The games list and the one filter every control on the page drives: the
 *  record rows, the head-to-head picker, the opening rows and the bar above
 *  the list. Kept in the URL (?colour=red&vs=<opponent>&opening=C70) so a
 *  filtered list is a link. */
type GamesView = {
  section: HTMLElement;
  filter: () => BoardFilter;
  set: (next: BoardFilter, scroll?: boolean) => void;
  subscribe: (paint: (filter: BoardFilter) => void) => void;
  href: (filter: BoardFilter) => string;
};

function gamesView(player: PlayerRecord, boards: readonly PlayerBoardRecord[]): GamesView {
  let filter = filterFromSearch(window.location.search, boards);
  const listeners: ((filter: BoardFilter) => void)[] = [];
  const wrap = section(`Games (${boards.length})`);
  wrap.id = 'games';
  const href = (next: BoardFilter): string =>
    `${window.location.pathname}${searchFromFilter(next)}#games`;
  const view: GamesView = {
    section: wrap,
    filter: () => filter,
    set: (next, scroll = false) => {
      filter = next;
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${searchFromFilter(next)}${window.location.hash}`,
      );
      for (const paint of listeners) paint(filter);
      if (scroll) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    subscribe: (paint) => {
      listeners.push(paint);
      paint(filter);
    },
    href,
  };

  const bar = document.createElement('div');
  bar.className = 'xqp-filters xqp-games-filters';
  const colours = document.createElement('div');
  colours.className = 'xqp-segmented';
  colours.setAttribute('role', 'group');
  colours.setAttribute('aria-label', t('broadcast.playerFilterColour'));
  const colourButtons = (
    [
      [undefined, t('broadcast.playerFilterAll')],
      ['red', t('broadcast.playerFilterRed')],
      ['black', t('broadcast.playerFilterBlack')],
    ] as const
  ).map(([colour, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'xqp-segment';
    button.textContent = label;
    button.addEventListener('click', () => view.set({ ...filter, colour }));
    colours.append(button);
    return { colour, button };
  });

  const opponents = opponentsOf(boards);
  const opponentSelect = filterSelect(
    t('broadcast.playerFilterOpponent'),
    [
      ['', t('broadcast.playerFilterAnyOpponent')],
      ...opponents.map(
        (o) => [o.key, `${o.nameEn ?? o.name} (${o.record.games})`] as [string, string],
      ),
    ],
    filter.opponent ?? '',
    (value) => view.set({ ...filter, opponent: value || undefined }),
  );
  const openingOptions = openingChoices(boards);
  const openingSelect =
    openingOptions.length > 0
      ? filterSelect(
          t('broadcast.playerFilterOpening'),
          [
            ['', t('broadcast.playerFilterAnyOpening')],
            ...openingOptions.map(
              (o) =>
                [
                  o.key,
                  `${o.code ? `${o.code} ` : ''}${openingLabel(o).name} (${o.record.games})`,
                ] as [string, string],
            ),
          ],
          filter.opening ?? '',
          (value) => view.set({ ...filter, opening: value || undefined }),
        )
      : null;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'xqp-filter-clear';
  clear.textContent = t('broadcast.playerFilterClear');
  clear.addEventListener('click', () => view.set({}));
  bar.append(colours, opponentSelect, ...(openingSelect ? [openingSelect] : []), clear);

  const summary = document.createElement('p');
  summary.className = 'xqp-games-summary';
  const list = document.createElement('div');
  list.className = 'xqp-games';
  wrap.append(bar, summary, list);

  view.subscribe((current) => {
    for (const { colour, button } of colourButtons) {
      const on = current.colour === colour;
      button.classList.toggle('xqp-segment-on', on);
      button.setAttribute('aria-pressed', String(on));
    }
    const opponentInput = opponentSelect.querySelector('select')!;
    opponentInput.value = current.opponent ?? '';
    const openingInput = openingSelect?.querySelector('select');
    if (openingInput) openingInput.value = current.opening ?? '';
    const active = Boolean(current.colour || current.opponent || current.opening);
    clear.hidden = !active;
    const shown = filterBoards(boards, current);
    const r = recordOf(shown);
    summary.textContent = [
      active ? t('broadcast.playerGamesShown', { n: shown.length, total: boards.length }) : null,
      active && shown.length > 0 ? `${recordText(r)} · ${scorePercent(r)}%` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    summary.hidden = !active;
    list.replaceChildren(...shown.map((board) => boardRow(board, player)));
  });
  return view;
}

/** Every opening in the games, both colours together, for the bar's select. */
function openingChoices(boards: readonly PlayerBoardRecord[]): OpeningRow[] {
  const byKey = new Map<string, OpeningRow>();
  for (const row of [...openingsOf(boards, 'red'), ...openingsOf(boards, 'black')]) {
    const seen = byKey.get(row.key);
    if (!seen) byKey.set(row.key, { ...row, record: { ...row.record } });
    else {
      seen.record.games += row.record.games;
      seen.record.wins += row.record.wins;
      seen.record.draws += row.record.draws;
      seen.record.losses += row.record.losses;
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** A W/D/L bar: the shares of the record, lichess's result strip. */
function resultBar(r: Record3): HTMLElement {
  const bar = document.createElement('span');
  bar.className = 'xqp-result-bar';
  bar.setAttribute('aria-hidden', 'true');
  for (const [kind, n] of [
    ['win', r.wins],
    ['draw', r.draws],
    ['loss', r.losses],
  ] as const) {
    if (n === 0) continue;
    const part = document.createElement('span');
    part.className = `xqp-result-${kind}`;
    part.style.flexGrow = String(n);
    bar.append(part);
  }
  return bar;
}

/** Overall, as red, as black, each row a link to those games. A single
 *  opponent's games are the games list's opponent filter. */
function recordSection(boards: readonly PlayerBoardRecord[], view: GamesView): HTMLElement {
  const byColour = recordByColour(boards);
  const table = document.createElement('table');
  table.className = 'xqp-stats';
  const head = document.createElement('tr');
  for (const label of [
    '',
    'Games',
    t('broadcast.playerWon'),
    t('broadcast.playerDrawn'),
    t('broadcast.playerLost'),
    'Score',
    '',
  ]) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  const tbody = document.createElement('tbody');
  const rows: [Colour | undefined, string, Record3][] = [
    [undefined, t('broadcast.playerOverall'), byColour.all],
    ['red', t('broadcast.playerAsRed'), byColour.red],
    ['black', t('broadcast.playerAsBlack'), byColour.black],
  ];
  for (const [colour, label, r] of rows) {
    const tr = document.createElement('tr');
    tr.className = 'xqp-stats-row';
    const name = document.createElement('th');
    name.scope = 'row';
    const link = document.createElement('a');
    link.href = view.href({ colour });
    link.className = colour ? `xqp-stats-link xqp-colour-dot-${colour}` : 'xqp-stats-link';
    link.textContent = label;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      view.set({ colour }, true);
    });
    name.append(link);
    tr.append(
      name,
      cell(String(r.games)),
      cell(String(r.wins)),
      cell(String(r.draws)),
      cell(String(r.losses)),
      cell(r.games > 0 ? `${scorePercent(r)}%` : ''),
    );
    const barCell = document.createElement('td');
    barCell.className = 'xqp-stats-bar';
    if (r.games > 0) barCell.append(resultBar(r));
    tr.append(barCell);
    if (r.games > 0) {
      tr.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('a')) return;
        view.set({ colour }, true);
      });
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const wrap = document.createElement('div');
  wrap.className = 'xqp-stats-wrap';
  wrap.append(table);
  return section(t('broadcast.playerRecord'), wrap);
}

const OPENINGS_SHOWN = 6;

/** An opening's name as the page shows it: English on an English page when
 *  the glossary names every term, else the source's Chinese. The title is
 *  always the source's full string (code and Chinese), for a tooltip. */
function openingLabel(opening: Opening): { name: string; title: string } {
  const title = opening.code ? `${opening.code} ${opening.name}` : opening.name;
  if (currentLocale() !== 'en') return { name: opening.name, title };
  return { name: eccoEnglish(title).en ?? opening.name, title };
}

/** Openings by colour, as the source classifies each game, each row a link
 *  to those games. Null when no game names an opening. */
function openingsSection(
  boards: readonly PlayerBoardRecord[],
  view: GamesView,
): HTMLElement | null {
  const columns = (['red', 'black'] as const).map((colour) => ({
    colour,
    rows: openingsOf(boards, colour),
  }));
  if (columns.every((c) => c.rows.length === 0)) return null;
  const grid = document.createElement('div');
  grid.className = 'xqp-openings';
  for (const { colour, rows } of columns) {
    const column = document.createElement('div');
    column.className = 'xqp-openings-col';
    const h3 = document.createElement('h3');
    h3.className = `xqp-openings-head xqp-colour-dot-${colour}`;
    h3.textContent = t(colour === 'red' ? 'broadcast.playerAsRed' : 'broadcast.playerAsBlack');
    column.append(h3);
    const list = document.createElement('ol');
    list.className = 'xqp-opening-list';
    rows.forEach((row, index) => {
      const item = document.createElement('li');
      item.className = 'xqp-opening';
      if (index >= OPENINGS_SHOWN) item.hidden = true;
      const link = document.createElement('a');
      link.className = 'xqp-opening-link';
      link.href = view.href({ colour, opening: row.key });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        view.set({ colour, opening: row.key }, true);
      });
      const name = document.createElement('span');
      name.className = 'xqp-opening-name';
      if (row.code) {
        const code = document.createElement('span');
        code.className = 'xqp-opening-code';
        code.textContent = row.code;
        const family = ECCO_FAMILY_KEYS[row.code[0] as keyof typeof ECCO_FAMILY_KEYS];
        if (family) code.title = t(family);
        name.append(code, ' ');
      }
      const shown = openingLabel(row);
      name.append(shown.name);
      link.title = shown.title;
      const numbers = document.createElement('span');
      numbers.className = 'xqp-opening-numbers';
      numbers.textContent = `${row.record.games} · ${scorePercent(row.record)}%`;
      link.append(name, numbers, resultBar(row.record));
      item.append(link);
      list.append(item);
    });
    column.append(list);
    if (rows.length > OPENINGS_SHOWN) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'xqp-more';
      let open = false;
      const label = (): void => {
        more.textContent = open
          ? t('broadcast.playerShowFewer')
          : t('broadcast.playerShowAll', { n: rows.length });
      };
      label();
      more.addEventListener('click', () => {
        open = !open;
        list.querySelectorAll<HTMLElement>('.xqp-opening').forEach((item, index) => {
          item.hidden = !open && index >= OPENINGS_SHOWN;
        });
        label();
      });
      column.append(more);
    }
    grid.append(column);
  }
  const note = document.createElement('p');
  note.className = 'xqp-section-note';
  note.textContent = t('broadcast.playerOpeningsNote');
  return section(t('broadcast.playerOpenings'), note, grid);
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
  const entries = cxaPointsFor(player.name);
  if (entries.length === 0) return null;
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
  const entries = cxaRatingsFor(player.name);
  if (entries.length === 0) return null;
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
    board.roundNameEn ?? board.roundName,
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

/** The broadcast section's frame: its rail (Broadcasts … Pro players, Pro
 *  teams) and the page in the panel beside it. Returns the column; callers
 *  append sections to it and mount `main` on the root. */
function shell(active: BroadcastRailItem): HTMLElement & { main: HTMLElement } {
  const column = document.createElement('div');
  column.className = 'xqp-column';
  const main = broadcastSectionLayout(active, column);
  main.classList.add('xqp-page');
  return Object.assign(column, { main });
}
