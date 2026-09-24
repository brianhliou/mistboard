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
import { CXA_POINTS, CXA_POINTS_LISTS } from './players/cxa-points.js';
import { CXA_LISTS, CXA_RATINGS } from './players/cxa-ratings.js';
import { playerTitleFor } from './players/player-title.js';
import { PLAYER_PROFILES, PLAYER_TITLE_LABEL, type PlayerTitle } from './players/profiles.js';
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
  const entries = CXA_POINTS[name];
  const last = entries?.[entries.length - 1];
  return last ? { points: last.points, rank: last.rank } : null;
}

/** The player's last CXA rating (the series closed in 2026). */
export function latestRating(name: string): number | null {
  const entries = CXA_RATINGS[name];
  return entries?.[entries.length - 1]?.rating ?? null;
}

function byNullableDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export type IndexSort = 'points' | 'rating' | 'games' | 'score' | 'name';

export function sortPlayers(players: readonly PlayerRecord[], sort: IndexSort): PlayerRecord[] {
  const out = [...players];
  const byGames = (a: PlayerRecord, b: PlayerRecord) =>
    b.games - a.games || displayName(a).localeCompare(displayName(b));
  if (sort === 'name') out.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  else if (sort === 'score')
    out.sort((a, b) => scorePercent(b) - scorePercent(a) || b.games - a.games);
  else if (sort === 'points')
    out.sort(
      (a, b) =>
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
}): HTMLElement {
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
    const shown = input.order(input.rows, sort).filter((row) => input.matches(row, query));
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
    empty.textContent = shown.length > 0 ? '' : `Nothing matches “${query.trim()}”.`;
  }
  input.search?.addEventListener('input', paint);
  paint();
  wrap.append(table, empty);
  return wrap;
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
    { label: 'Games', sort: 'games', value: (p) => numberCell(p.games) },
    { label: 'Score', sort: 'score', value: (p) => numberCell(scorePercent(p), '%') },
  ];
}

function playersTable(
  players: readonly PlayerRecord[],
  search: HTMLInputElement | undefined,
  showTeam: boolean,
): HTMLElement {
  return sortableTable<PlayerRecord, IndexSort>({
    rows: players,
    columns: playerColumns(showTeam),
    sort: 'points',
    order: sortPlayers,
    matches: matchesQuery,
    href: playerHref,
    search,
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
  panel.append(boardHead(title, search), playersTable(players, search, true));
  main.append(panel);
  return main;
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
// One player: photo and facts, the official rating, events, every board.

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
