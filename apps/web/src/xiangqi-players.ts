// Player pages over the broadcast archive (docs-private/players/
// players-surface-spec.md): /players, the index, and /players/<slug>, one
// player with every board they sat at. Both read the derived index the server
// builds from finished A-level boards; nothing here is authored.
//
// Styled with the broadcast surface's own classes (xqb-*): a player page is the
// same kind of page as an event page, and the reader crosses between them.
import './xiangqi-broadcast.css';
import './xiangqi-players.css';
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

/** Authored profiles, by slug: the article that is this player's story. The
 *  profile becomes a section of this page in the next step of the spec; until
 *  then the page links out to it. */
const PROFILE_HREF: Readonly<Record<string, string>> = {
  'yin-sheng': '/blog/yin-sheng',
};

export async function mountXiangqiPlayersIndex(root: HTMLElement): Promise<void> {
  setRoot(root, 'Loading players');
  try {
    const data = await fetchJson<PlayersIndexResponse>('/api/xiangqi/players');
    root.replaceChildren(buildNav(), renderIndex(data.players));
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
    root.replaceChildren(buildNav(), renderPlayer(data.player, data.boards));
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

/** Wins count 1, draws ½: score per game, as a percentage for a sortable column. */
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

// ---------------------------------------------------------------------------
// The index: one row per player, sortable by the column headers.

function renderIndex(players: PlayerRecord[]): HTMLElement {
  const main = shell();
  const events = new Set(players.flatMap((p) => p.events.map((e) => e.tourSlug)));
  main.append(
    hero({
      eyebrow: 'Players',
      title: 'Xiangqi players',
      meta: [
        `${players.length} players`,
        `${events.size} events`,
        'From the broadcast archive: everyone with a finished game in a top-level event',
      ],
    }),
  );

  const section = document.createElement('section');
  section.className = 'xqb-section';
  const table = document.createElement('table');
  table.className = 'xqb-standings xqp-index';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const columns: Array<{ label: string; sort?: IndexSort }> = [
    { label: '#' },
    { label: 'Player', sort: 'name' },
    { label: 'Team' },
    { label: 'Games', sort: 'games' },
    { label: 'W-D-L' },
    { label: 'Score', sort: 'score' },
    { label: 'Events' },
    { label: 'Last seen' },
  ];
  let sort: IndexSort = 'games';
  for (const column of columns) {
    const th = document.createElement('th');
    if (column.sort) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'xqp-sort';
      button.textContent = column.label;
      button.addEventListener('click', () => {
        sort = column.sort!;
        paintRows();
      });
      th.append(button);
    } else {
      th.textContent = column.label;
    }
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);

  function paintRows(): void {
    tbody.replaceChildren();
    for (const th of headRow.querySelectorAll<HTMLElement>('th')) {
      th.classList.toggle('xqp-sorted', th.textContent === columnLabel(sort));
    }
    sortPlayers(players, sort).forEach((player, i) => {
      const tr = document.createElement('tr');
      tr.append(
        cell(String(i + 1), 'xqb-standings-rank'),
        playerCell(player),
        cell(player.federationEn ?? player.federation ?? ''),
        cell(String(player.games)),
        cell(recordText(player)),
        cell(`${scorePercent(player)}%`),
        cell(String(player.events.length)),
        cell(player.lastPlayedOn ?? ''),
      );
      tbody.append(tr);
    });
  }
  paintRows();
  section.append(table);
  main.append(section);
  return main;
}

function columnLabel(sort: IndexSort): string {
  return sort === 'name' ? 'Player' : sort === 'score' ? 'Score' : 'Games';
}

function playerCell(player: PlayerRecord): HTMLTableCellElement {
  const td = document.createElement('td');
  const link = document.createElement('a');
  link.className = 'xqb-link';
  link.href = `/players/${encodeURIComponent(player.slug)}`;
  link.textContent = displayName(player);
  td.append(link);
  return td;
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

// ---------------------------------------------------------------------------
// One player: header, record by event, every board.

function renderPlayer(player: PlayerRecord, boards: PlayerBoardRecord[]): HTMLElement {
  const main = shell();
  const span =
    player.firstPlayedOn && player.lastPlayedOn
      ? `${player.firstPlayedOn} to ${player.lastPlayedOn}`
      : null;
  main.append(
    hero({
      eyebrow: 'Player',
      title: player.nameEn ?? player.name,
      subtitle: player.nameEn ? player.name : null,
      meta: [
        player.federationEn ?? player.federation ?? '',
        `${player.games} games in the archive, ${recordText(player)}`,
        span,
      ].filter((x): x is string => Boolean(x)),
      backHref: '/players',
      backLabel: 'All players',
      profileHref: PROFILE_HREF[player.slug],
    }),
  );

  const byEvent = document.createElement('section');
  byEvent.className = 'xqb-section';
  const h2 = document.createElement('h2');
  h2.textContent = 'By event';
  const table = document.createElement('table');
  table.className = 'xqb-standings';
  table.innerHTML =
    '<thead><tr><th>Event</th><th>Dates</th><th>Games</th><th>W-D-L</th><th>Score</th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const event of player.events) {
    const tr = document.createElement('tr');
    const eventTd = document.createElement('td');
    const link = document.createElement('a');
    link.className = 'xqb-link';
    link.href = `/broadcast/xiangqi/${encodeURIComponent(event.tourSlug)}`;
    link.textContent = event.tourNameEn ?? event.tourName;
    eventTd.append(link);
    const dates =
      event.firstPlayedOn && event.lastPlayedOn
        ? event.firstPlayedOn === event.lastPlayedOn
          ? event.firstPlayedOn
          : `${event.firstPlayedOn} to ${event.lastPlayedOn}`
        : '';
    tr.append(
      eventTd,
      cell(dates),
      cell(String(event.games)),
      cell(recordText(event)),
      cell(`${scorePercent(event)}%`),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  byEvent.append(h2, table);

  const games = document.createElement('section');
  games.className = 'xqb-section';
  const h2b = document.createElement('h2');
  h2b.textContent = `Games (${boards.length})`;
  const list = document.createElement('div');
  list.className = 'xqp-games';
  for (const board of boards) list.append(boardRow(board, player));
  games.append(h2b, list);

  main.append(byEvent, games);
  return main;
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
  vs.textContent = board.colour === 'red' ? ' vs ' : ' vs ';
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

function shell(): HTMLElement {
  const main = document.createElement('main');
  main.className = 'xqb-shell';
  return main;
}

function hero(input: {
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  meta: string[];
  backHref?: string;
  backLabel?: string;
  profileHref?: string;
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
  if (input.backHref && input.backLabel) {
    const back = document.createElement('a');
    back.className = 'xqb-link';
    back.href = input.backHref;
    back.textContent = input.backLabel;
    actions.append(back);
  }
  if (input.profileHref) {
    const profile = document.createElement('a');
    profile.className = 'xqb-link xqb-link-primary';
    profile.href = input.profileHref;
    profile.textContent = 'Read the profile';
    actions.append(profile);
  }
  section.append(copy, actions);
  return section;
}
