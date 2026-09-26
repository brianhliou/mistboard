// Server-side SEO for the player pages (#458): /players, /players/<slug>,
// /players/teams and /players/teams/<key> are client routes
// (apps/web/src/xiangqi-players.ts), so a crawler that does not run the bundle
// saw the homepage's title and an empty #app on every one of them. This module
// gives each its own title, description, canonical link and share card, a
// text body a crawler can read (name in both scripts, team, the official-list
// line, the games as links), and the sitemap section that lists them.
//
// The data is the same the page reads: the archive's derived player index
// (persistence-xiangqi-players.ts) and the CXA lists the web app bakes into
// dist/players-reference.json (player-reference.ts). The client clears the
// root on boot, so the body never shows beside the rendered page.

import { createHash } from 'node:crypto';
import * as persistence from './persistence.js';
import type {
  XiangqiPlayerBoardRecord,
  XiangqiPlayerRecord,
} from './persistence-xiangqi-players.js';
import {
  type PlayerReference,
  readPlayerReference,
  referenceTitle,
  TITLE_WORDS,
} from './player-reference.js';
import { escapeHtml } from './study-page-body.js';

export const PLAYER_OG_IMAGE_VERSION = 1;

/** Games listed in a player's crawler body, newest first. */
const BODY_GAME_CAP = 60;

export type PlayerRoute =
  | { kind: 'index' }
  | { kind: 'teams' }
  | { kind: 'team'; key: string }
  | { kind: 'player'; slug: string };

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Which player page a path names, or null when it is not one. The same
 *  shapes isClientRoute accepts; a trailing slash reads as the bare path. */
export function parsePlayerRoute(pathname: string): PlayerRoute | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/players') return { kind: 'index' };
  if (normalized === '/players/teams') return { kind: 'teams' };
  const team = /^\/players\/teams\/([^/]+)$/.exec(normalized);
  if (team) {
    const key = decode(team[1]!);
    return key ? { kind: 'team', key } : null;
  }
  const player = /^\/players\/([^/]+)$/.exec(normalized);
  if (player) {
    const slug = decode(player[1]!);
    return slug ? { kind: 'player', slug } : null;
  }
  return null;
}

export const playerHref = (slug: string): string => `/players/${encodeURIComponent(slug)}`;
export const teamHref = (key: string): string => `/players/teams/${encodeURIComponent(key)}`;

// ── Teams ─────────────────────────────────────────────────────────────────────
// Mirrors teamKey/teamsOf in apps/web/src/xiangqi-players.ts (the server cannot
// import web code): a team is the players' latest federation, keyed by its
// English name slugged, else the Chinese.

export type PlayerTeam = {
  key: string;
  name: string;
  nameEn: string | null;
  players: XiangqiPlayerRecord[];
  games: number;
  wins: number;
  draws: number;
  losses: number;
};

export function teamKey(
  player: Pick<XiangqiPlayerRecord, 'federation' | 'federationEn'>,
): string | null {
  const slug = (player.federationEn ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || player.federation || null;
}

export function teamsOf(players: readonly XiangqiPlayerRecord[]): PlayerTeam[] {
  const teams = new Map<string, PlayerTeam>();
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

// ── Copy helpers ──────────────────────────────────────────────────────────────

const count = (n: number): string => new Intl.NumberFormat('en-US').format(n);
const plural = (n: number, one: string, many = `${one}s`): string =>
  `${count(n)} ${n === 1 ? one : many}`;

type Named = { name: string; nameEn: string | null };

/** "Meng Fanrui (孟繁睿)", or the one spelling when there is only one. */
export function bothScripts(entity: Named): string {
  return entity.nameEn && entity.nameEn !== entity.name
    ? `${entity.nameEn} (${entity.name})`
    : entity.name;
}

const english = (entity: Named): string => entity.nameEn?.trim() || entity.name;

const teamLabel = (team: Pick<PlayerTeam, 'name' | 'nameEn'>): string => team.nameEn ?? team.name;

function recordLine(r: { wins: number; draws: number; losses: number }): string {
  return `${plural(r.wins, 'win')}, ${plural(r.draws, 'draw')}, ${plural(r.losses, 'loss', 'losses')}`;
}

function scorePercent(r: { games: number; wins: number; draws: number }): number {
  return r.games === 0 ? 0 : Math.round(((r.wins + r.draws / 2) / r.games) * 100);
}

/** "CXA points 3,105, #1 of 50 men (2025-12-28 list)", when the player is on
 *  the current list. */
export function pointsLine(reference: PlayerReference, name: string): string | null {
  const entry = reference.points[name];
  if (!entry) return null;
  const rank =
    entry.of !== null ? `#${entry.rank} of ${entry.of} ${entry.group}` : `#${entry.rank}`;
  const list = entry.listDate ? ` (${entry.listDate} list)` : '';
  return `CXA points ${count(entry.points)}, ${rank}${list}`;
}

/** "Last CXA rating 2,650 (#5 of 151, 2023-09-30 list)": the closed series. */
export function ratingLine(reference: PlayerReference, name: string): string | null {
  const entry = reference.ratings[name];
  if (!entry) return null;
  const rank = entry.rank !== null ? `#${entry.rank}${entry.of ? ` of ${entry.of}` : ''}, ` : '';
  return `Last CXA rating ${count(entry.rating)} (${rank}${entry.listLabel} list)`;
}

function pointsOf(reference: PlayerReference, player: XiangqiPlayerRecord): number | null {
  return reference.points[player.name]?.points ?? null;
}

/** The index's default order (sortPlayers 'points' on the page): points, then
 *  the closed rating, then games. */
export function byStanding(
  reference: PlayerReference,
): (a: XiangqiPlayerRecord, b: XiangqiPlayerRecord) => number {
  const desc = (a: number | null, b: number | null) =>
    a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : b - a;
  return (a, b) =>
    desc(pointsOf(reference, a), pointsOf(reference, b)) ||
    desc(reference.ratings[a.name]?.rating ?? null, reference.ratings[b.name]?.rating ?? null) ||
    b.games - a.games ||
    english(a).localeCompare(english(b));
}

// ── Meta ──────────────────────────────────────────────────────────────────────

export type PlayerPageMeta = {
  title: string;
  description: string;
  /** Canonical path (no host). */
  urlPath: string;
  /** Card path + content key (no host); absent keeps the site card. */
  imagePath?: string;
};

export type PlayerPage = {
  /** Absent for a name the archive does not know: the shell keeps the generic
   *  meta, and `noindex` keeps the unknown URL out of the index. */
  meta?: PlayerPageMeta;
  body?: string;
  noindex?: boolean;
};

export function playerDescription(player: XiangqiPlayerRecord, reference: PlayerReference): string {
  const title = referenceTitle(reference, player);
  const who = title ? `Xiangqi ${TITLE_WORDS[title].toLowerCase()}` : 'Xiangqi player';
  const team = player.federation
    ? ` for ${english({ name: player.federation, nameEn: player.federationEn })}`
    : '';
  const official = pointsLine(reference, player.name) ?? ratingLine(reference, player.name);
  return [
    `${who}${team}.`,
    official ? `${official}.` : null,
    // A CXA-listed player we have not relayed yet: say so rather than print a
    // zero record. No engine claim: the sweep is still filling the archive.
    player.games > 0
      ? `${plural(player.games, 'game')} in the Mistboard archive (${recordLine(player)}).`
      : 'No games in the Mistboard archive yet.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** What the player's card shows, and the key its immutable URL carries: the
 *  card changes when any of it does (a new game, a new points list). */
export type PlayerCardContent = {
  title: string[];
  subtitle: string;
  /** The game whose final position is drawn: the player's latest. */
  boardId: string | null;
  plies: number;
};

export function playerCardContent(
  player: XiangqiPlayerRecord,
  boards: readonly XiangqiPlayerBoardRecord[],
  reference: PlayerReference,
): PlayerCardContent {
  // English only: the card rasterizer bundles Noto Sans and no CJK face
  // (og-raster.ts), so a Chinese line draws as empty boxes. The page's title
  // and description carry the Chinese name. A name with no romanisation gets
  // a generic headline rather than boxes.
  const title = [player.nameEn?.trim() || 'Xiangqi player'];
  const points = reference.points[player.name];
  const rating = reference.ratings[player.name];
  // The strongest fact first; a player we have not relayed never leads with
  // "0 games".
  const subtitle = points
    ? `CXA #${points.rank} · ${count(points.points)} points`
    : player.federation
      ? english({ name: player.federation, nameEn: player.federationEn })
      : rating
        ? `CXA rating ${count(rating.rating)}${rating.rank ? ` · #${rating.rank}` : ''} (${rating.listLabel.slice(0, 4)})`
        : player.games > 0
          ? plural(player.games, 'game')
          : 'Xiangqi player';
  const latest = boards[0];
  return { title, subtitle, boardId: latest?.boardId ?? null, plies: latest?.plyCount ?? 0 };
}

export function playerCardKey(content: PlayerCardContent): string {
  return createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 12);
}

export function playerCardPath(slug: string, content: PlayerCardContent): string {
  return `/og/player/${encodeURIComponent(slug)}.png?v=${PLAYER_OG_IMAGE_VERSION}&k=${playerCardKey(content)}`;
}

// ── Bodies ────────────────────────────────────────────────────────────────────

function nameHtml(entity: Named): string {
  const en = english(entity);
  return entity.nameEn && entity.nameEn !== entity.name
    ? `${escapeHtml(en)} <span lang="zh">${escapeHtml(entity.name)}</span>`
    : `<span lang="zh">${escapeHtml(entity.name)}</span>`;
}

function playerLink(player: XiangqiPlayerRecord): string {
  return `<a href="${escapeHtml(playerHref(player.slug))}">${nameHtml(player)}</a>`;
}

const SECTION_LINKS =
  '<p><a href="/players">All players</a> · <a href="/players/teams">All teams</a> · <a href="/broadcast/xiangqi">Broadcasts</a></p>';

function gameLine(board: XiangqiPlayerBoardRecord, player: XiangqiPlayerRecord): string {
  const me = escapeHtml(english(player));
  const them = board.opponent.slug
    ? `<a href="${escapeHtml(playerHref(board.opponent.slug))}">${escapeHtml(english(board.opponent))}</a>`
    : escapeHtml(english(board.opponent));
  const pairing = board.colour === 'red' ? `${me} (red) vs ${them}` : `${them} vs ${me} (black)`;
  const outcome = board.outcome === 'win' ? 'won' : board.outcome === 'loss' ? 'lost' : 'drawn';
  const meta = [
    english({ name: board.tourName, nameEn: board.tourNameEn }),
    board.roundNameEn ?? board.roundName,
    board.playedOn,
    plural(Math.ceil(board.plyCount / 2), 'move'),
  ]
    .filter(Boolean)
    .map((part) => escapeHtml(String(part)))
    .join(' · ');
  const href = `/broadcast/xiangqi/board/${encodeURIComponent(board.boardId)}`;
  return `<li><a href="${escapeHtml(href)}">${escapeHtml(board.result)}, ${outcome}</a> ${pairing} · ${meta}</li>`;
}

export function renderPlayerBody(
  player: XiangqiPlayerRecord,
  boards: readonly XiangqiPlayerBoardRecord[],
  reference: PlayerReference,
): string {
  const title = referenceTitle(reference, player);
  const parts = [
    `<h1>${title ? `<abbr title="${escapeHtml(TITLE_WORDS[title])}">${title}</abbr> ` : ''}${nameHtml(player)}</h1>`,
  ];
  const key = teamKey(player);
  if (key && player.federation) {
    parts.push(
      `<p>Team: <a href="${escapeHtml(teamHref(key))}">${nameHtml({ name: player.federation, nameEn: player.federationEn })}</a></p>`,
    );
  }
  const points = pointsLine(reference, player.name);
  const rating = ratingLine(reference, player.name);
  if (points) parts.push(`<p>${escapeHtml(points)}.</p>`);
  if (rating) parts.push(`<p>${escapeHtml(rating)}.</p>`);
  parts.push(
    `<p>Archive: ${escapeHtml(plural(player.games, 'game'))}, ${escapeHtml(recordLine(player))}, score ${scorePercent(player)}%${
      player.firstPlayedOn && player.lastPlayedOn
        ? `, ${escapeHtml(player.firstPlayedOn)} to ${escapeHtml(player.lastPlayedOn)}`
        : ''
    }.</p>`,
  );
  if (player.events.length > 0) {
    const events = player.events.map((event) => {
      const href = `/broadcast/xiangqi/${encodeURIComponent(event.tourSlug)}`;
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(english({ name: event.tourName, nameEn: event.tourNameEn }))}</a> · ${escapeHtml(plural(event.games, 'game'))}, ${event.wins}-${event.draws}-${event.losses}</li>`;
    });
    parts.push(`<h2>Events</h2><ul>${events.join('')}</ul>`);
  }
  if (boards.length > 0) {
    const shown = boards.slice(0, BODY_GAME_CAP);
    const heading =
      shown.length < boards.length
        ? `Latest ${shown.length} of ${plural(boards.length, 'game')}`
        : `Games (${boards.length})`;
    parts.push(
      `<h2>${escapeHtml(heading)}</h2><ul>${shown.map((b) => gameLine(b, player)).join('')}</ul>`,
    );
  }
  parts.push(SECTION_LINKS);
  return `<main>${parts.join('')}</main>`;
}

function playerRow(player: XiangqiPlayerRecord, reference: PlayerReference, showTeam: boolean) {
  const title = referenceTitle(reference, player);
  const bits = [
    showTeam && player.federation
      ? english({ name: player.federation, nameEn: player.federationEn })
      : null,
    reference.points[player.name]
      ? `CXA points ${count(reference.points[player.name]!.points)}`
      : null,
    plural(player.games, 'game'),
  ].filter((bit): bit is string => bit !== null);
  return `<li>${title ? `${title} ` : ''}${playerLink(player)} · ${escapeHtml(bits.join(' · '))}</li>`;
}

export function renderIndexBody(
  players: readonly XiangqiPlayerRecord[],
  reference: PlayerReference,
): string {
  const ordered = [...players].sort(byStanding(reference));
  return `<main><h1>Xiangqi players</h1><p>${escapeHtml(indexDescription(players.length))}</p><ol>${ordered
    .map((p) => playerRow(p, reference, true))
    .join('')}</ol>${SECTION_LINKS}</main>`;
}

function teamStrength(team: PlayerTeam, reference: PlayerReference): number | null {
  const best = team.players
    .map((p) => pointsOf(reference, p))
    .filter((x): x is number => x !== null)
    .sort((a, b) => b - a)
    .slice(0, 5);
  return best.length === 0 ? null : best.reduce((a, b) => a + b, 0);
}

export function renderTeamsBody(
  players: readonly XiangqiPlayerRecord[],
  reference: PlayerReference,
): string {
  const teams = teamsOf(players).sort(
    (a, b) =>
      (teamStrength(b, reference) ?? -1) - (teamStrength(a, reference) ?? -1) ||
      b.players.length - a.players.length,
  );
  const rows = teams.map(
    (team) =>
      `<li><a href="${escapeHtml(teamHref(team.key))}">${nameHtml(team)}</a> · ${escapeHtml(
        `${plural(team.players.length, 'player')} · ${plural(team.games, 'game')}`,
      )}</li>`,
  );
  return `<main><h1>Xiangqi teams</h1><p>${escapeHtml(teamsDescription(teams.length))}</p><ol>${rows.join('')}</ol>${SECTION_LINKS}</main>`;
}

export function renderTeamBody(team: PlayerTeam, reference: PlayerReference): string {
  const players = [...team.players].sort(byStanding(reference));
  return `<main><h1>${nameHtml(team)}</h1><p>${escapeHtml(
    `${plural(team.players.length, 'player')}, ${plural(team.games, 'game')}: ${recordLine(team)}.`,
  )}</p><ol>${players.map((p) => playerRow(p, reference, false)).join('')}</ol>${SECTION_LINKS}</main>`;
}

function indexDescription(players: number): string {
  return `The top xiangqi (Chinese chess) players in English and Chinese: ${plural(players, 'player')} with their current CXA tournament points, their teams, and every game of theirs in the Mistboard archive with an engine eval.`;
}

function teamsDescription(teams: number): string {
  return `The clubs and provinces the top xiangqi (Chinese chess) players play for: ${plural(teams, 'team')}, each with its players, their CXA points and their games in the Mistboard archive.`;
}

export function teamDescription(team: PlayerTeam, reference: PlayerReference): string {
  const top = [...team.players]
    .sort(byStanding(reference))
    .slice(0, 3)
    .map((p) => english(p));
  const names =
    top.length <= 1 ? (top[0] ?? '') : `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}`;
  return [
    `Xiangqi team: ${plural(team.players.length, 'player')} and ${plural(team.games, 'game')} in the Mistboard archive (${recordLine(team)}).`,
    names ? `Players include ${names}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

// ── Loading ───────────────────────────────────────────────────────────────────

export type PlayerPageSources = {
  listPlayers(): Promise<XiangqiPlayerRecord[]>;
  listBoards(
    player: XiangqiPlayerRecord,
    players: readonly XiangqiPlayerRecord[],
  ): Promise<XiangqiPlayerBoardRecord[]>;
  reference(): Promise<PlayerReference>;
};

// The index folds every stored board; a page view (meta and body are one
// fold) and a crawler walking the sitemap should not each rebuild it. A
// minute's staleness only delays a new player's page, as on the API.
const PLAYERS_TTL_MS = 60_000;
let playersCache: { at: number; players: Promise<XiangqiPlayerRecord[]> } | null = null;

export function cachedPlayers(): Promise<XiangqiPlayerRecord[]> {
  const now = Date.now();
  if (!playersCache || now - playersCache.at > PLAYERS_TTL_MS) {
    const players = persistence.listXiangqiPlayers();
    players.catch(() => {
      if (playersCache?.players === players) playersCache = null;
    });
    playersCache = { at: now, players };
  }
  return playersCache.players;
}

export function livePlayerSources(staticDir: string): PlayerPageSources {
  return {
    listPlayers: cachedPlayers,
    listBoards: (player, players) =>
      persistence.listXiangqiPlayerBoards(
        player,
        (name) => players.find((p) => p.name === name)?.slug ?? null,
      ),
    reference: () => readPlayerReference(staticDir),
  };
}

/** Meta and body for a player page, or null when the path is not one (or
 *  there is no archive to read). */
export async function playerPageFor(
  pathname: string,
  sources: PlayerPageSources,
): Promise<PlayerPage | null> {
  const route = parsePlayerRoute(pathname);
  if (!route) return null;
  const [players, reference] = await Promise.all([sources.listPlayers(), sources.reference()]);
  switch (route.kind) {
    case 'index':
      return {
        meta: {
          title: 'Xiangqi players · CXA points and games · Mistboard',
          description: indexDescription(players.length),
          urlPath: '/players',
        },
        body: renderIndexBody(players, reference),
      };
    case 'teams': {
      const teams = teamsOf(players);
      return {
        meta: {
          title: 'Xiangqi teams · Mistboard',
          description: teamsDescription(teams.length),
          urlPath: '/players/teams',
        },
        body: renderTeamsBody(players, reference),
      };
    }
    case 'team': {
      const team = teamsOf(players).find((entry) => entry.key === route.key);
      if (!team) return { noindex: true };
      const label = teamLabel(team);
      return {
        meta: {
          title: `${team.nameEn && team.nameEn !== team.name ? `${label} (${team.name})` : label} · Xiangqi team · Mistboard`,
          description: teamDescription(team, reference),
          urlPath: teamHref(team.key),
        },
        body: renderTeamBody(team, reference),
      };
    }
    case 'player': {
      const player = players.find((entry) => entry.slug === route.slug);
      if (!player) return { noindex: true };
      const boards = await sources.listBoards(player, players);
      return {
        meta: {
          title: `${bothScripts(player)} · Xiangqi player · Mistboard`,
          description: playerDescription(player, reference),
          urlPath: playerHref(player.slug),
          imagePath: playerCardPath(player.slug, playerCardContent(player, boards, reference)),
        },
        body: renderPlayerBody(player, boards, reference),
      };
    }
  }
}

/** The live lookup: null without persistence (in-memory dev has no archive). */
export async function livePlayerPage(
  pathname: string,
  staticDir: string,
): Promise<PlayerPage | null> {
  if (!parsePlayerRoute(pathname) || !persistence.isInitialized()) return null;
  return playerPageFor(pathname, livePlayerSources(staticDir));
}

// ── Sitemap ───────────────────────────────────────────────────────────────────

export type PlayerSitemapEntry = { path: string; lastmod?: string };

const latest = (dates: readonly (string | null | undefined)[]): string | undefined =>
  dates
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);

/** sitemap-players.xml: the index, the teams index, every player and every
 *  team, each dated from its latest game (a player's last round start). */
export function playerSitemapEntries(
  players: readonly XiangqiPlayerRecord[],
): PlayerSitemapEntry[] {
  const newest = latest(players.map((p) => p.lastPlayedOn));
  const entries: PlayerSitemapEntry[] = [
    { path: '/players', lastmod: newest },
    { path: '/players/teams', lastmod: newest },
  ];
  for (const player of players) {
    entries.push({ path: playerHref(player.slug), lastmod: player.lastPlayedOn ?? undefined });
  }
  for (const team of teamsOf(players)) {
    entries.push({
      path: teamHref(team.key),
      lastmod: latest(team.players.map((p) => p.lastPlayedOn)),
    });
  }
  return entries;
}
