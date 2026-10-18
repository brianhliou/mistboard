// Server-side SEO for the xiangqi broadcast pages, the way player-pages.ts
// does it for the players: /broadcast/xiangqi, /broadcast/xiangqi/<tour>,
// /broadcast/xiangqi/<tour>/round/<round> and /broadcast/xiangqi/board/<id>
// are client routes (apps/web/src/xiangqi-broadcast.ts), so a crawler that
// does not run the bundle saw an empty #app with no canonical link and no
// heading on all 195 URLs of sitemap-broadcasts.xml. Search Console folded
// them as duplicates of one another (2026-10-17: 377 "Duplicate without
// user-selected canonical"). This module gives each a canonical link with no
// query string, its own title and description, and a text body: the event,
// its dates and place, the rounds as links, and a round's pairings and
// results with links to the games and the players.
//
// Everything here is what the public broadcast API already hands a signed-out
// viewer (routes/xiangqi-broadcasts.ts): names, dates, places, results and
// move counts. Xiangqi is open information, and the body carries no source
// URLs, poll state or sync logs. The client clears the root on mount, so the
// body never shows beside the rendered page.

import { broadcastPageMeta } from './og-broadcast.js';
import * as persistence from './persistence.js';
import type {
  StoredXiangqiBroadcastBoard,
  StoredXiangqiBroadcastRound,
  StoredXiangqiBroadcastTour,
} from './persistence-xiangqi-broadcasts.js';
import { cachedPlayers, playerHref } from './player-pages.js';
import { escapeHtml } from './study-page-body.js';
import { roundNumberFromRoundId } from './xiangqi-broadcast-discovery.js';

export type BroadcastPageMeta = {
  title: string;
  description: string;
  /** Canonical path (no host, no query). */
  urlPath: string;
  /** Card path (no host); absent keeps the site card. */
  imagePath?: string;
};

export type BroadcastPage = {
  /** Absent for a slug or id nothing is stored under: the shell keeps the
   *  generic meta, and `noindex` keeps the unknown URL out of the index. */
  meta?: BroadcastPageMeta;
  body?: string;
  noindex?: boolean;
};

export type BroadcastRoute =
  | { kind: 'index' }
  | { kind: 'tour'; slug: string }
  | { kind: 'round'; slug: string; roundId: string }
  | { kind: 'board'; boardId: string };

// The section's own pages, which the tour shape would read as tour slugs
// (og-broadcast.ts keeps the same list).
const SECTION_PAGES = new Set(['board', 'calendar', 'about', 'ops']);

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Which broadcast page a path names, or null when it is not one. A trailing
 *  slash reads as the bare path. */
export function parseBroadcastRoute(pathname: string): BroadcastRoute | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/broadcast/xiangqi') return { kind: 'index' };
  const board = /^\/broadcast\/xiangqi\/board\/([^/]+)$/.exec(normalized);
  if (board) {
    const boardId = decode(board[1]!);
    return boardId ? { kind: 'board', boardId } : null;
  }
  const round = /^\/broadcast\/xiangqi\/([^/]+)\/round\/([^/]+)$/.exec(normalized);
  if (round) {
    const slug = decode(round[1]!);
    const roundId = decode(round[2]!);
    return slug && roundId ? { kind: 'round', slug, roundId } : null;
  }
  const tour = /^\/broadcast\/xiangqi\/([^/]+)$/.exec(normalized);
  if (tour) {
    const slug = decode(tour[1]!);
    return slug && !SECTION_PAGES.has(slug) ? { kind: 'tour', slug } : null;
  }
  return null;
}

export const broadcastIndexHref = '/broadcast/xiangqi';
export const tourHref = (slug: string): string => `/broadcast/xiangqi/${encodeURIComponent(slug)}`;
export const roundHref = (slug: string, roundId: string): string =>
  `${tourHref(slug)}/round/${encodeURIComponent(roundId)}`;
export const boardHref = (boardId: string): string =>
  `/broadcast/xiangqi/board/${encodeURIComponent(boardId)}`;

// ── Text ──────────────────────────────────────────────────────────────────────

type Named = { name: string; nameEn?: string };

function english(entity: Named): string {
  return entity.nameEn?.trim() || entity.name;
}

function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** The English name, with the source's own name beside it when they differ. */
function nameHtml(entity: Named): string {
  const en = english(entity);
  return en !== entity.name
    ? `${escapeHtml(en)} <span lang="zh">${escapeHtml(entity.name)}</span>`
    : `<span lang="zh">${escapeHtml(entity.name)}</span>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar day an ISO instant names in its own offset ("2 Oct 2026"). */
function dayOf(iso?: string | null): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** "2-8 Oct 2026", "30 Sep - 2 Oct 2026", or one day; null without a start. */
function dateRange(startsAt?: string, endsAt?: string): string | null {
  const parse = (iso?: string) => {
    const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { y: m[1]!, mo: Number(m[2]) - 1, d: Number(m[3]) } : null;
  };
  const start = parse(startsAt);
  if (!start) return null;
  const end = parse(endsAt) ?? start;
  const month = (mo: number) => MONTHS[mo]!;
  if (start.y === end.y && start.mo === end.mo && start.d === end.d) {
    return `${start.d} ${month(start.mo)} ${start.y}`;
  }
  if (start.y === end.y && start.mo === end.mo) {
    return `${start.d}-${end.d} ${month(start.mo)} ${start.y}`;
  }
  if (start.y === end.y)
    return `${start.d} ${month(start.mo)} - ${end.d} ${month(end.mo)} ${end.y}`;
  return `${start.d} ${month(start.mo)} ${start.y} - ${end.d} ${month(end.mo)} ${end.y}`;
}

function whenAndWhere(tour: StoredXiangqiBroadcastTour): string {
  return [dateRange(tour.startsAt, tour.endsAt), tour.location?.trim() || null]
    .filter(Boolean)
    .join(', ');
}

/** A started board: one a crawler can open as a game (the sitemap's rule). */
const started = (board: StoredXiangqiBroadcastBoard): boolean => board.status !== 'scheduled';

function resultText(board: StoredXiangqiBroadcastBoard): string {
  const red = english(board.red);
  const black = english(board.black);
  const moves = Math.ceil(board.plyCount / 2);
  const count = moves > 0 ? ` in ${plural(moves, 'move')}` : '';
  if (board.result === '1-0') return `1-0, ${red} won with Red${count}`;
  if (board.result === '0-1') return `0-1, ${black} won with Black${count}`;
  if (board.result === '1/2-1/2') return `½-½, drawn${count}`;
  if (board.status === 'live') return `in play${count ? `, ${plural(moves, 'move')} so far` : ''}`;
  return board.status === 'scheduled' ? 'not started' : 'no result yet';
}

type SlugOf = (name: string) => string | null;

function playerHtml(player: Named, slugOf: SlugOf): string {
  const slug = slugOf(player.name);
  const label = escapeHtml(english(player));
  return slug ? `<a href="${escapeHtml(playerHref(slug))}">${label}</a>` : label;
}

/** Rounds in playing order: by the number in the id (`<slug>-rNN`), since a
 *  round the source named but nobody dated has no start to sort by. */
function orderedRounds(
  rounds: readonly StoredXiangqiBroadcastRound[],
): StoredXiangqiBroadcastRound[] {
  return rounds
    .map((round, index) => ({ round, index }))
    .sort(
      (a, b) =>
        (roundNumberFromRoundId(a.round.id) ?? a.index) -
          (roundNumberFromRoundId(b.round.id) ?? b.index) || a.index - b.index,
    )
    .map((entry) => entry.round);
}

function roundDay(
  round: StoredXiangqiBroadcastRound,
  boards: readonly StoredXiangqiBroadcastBoard[],
): string | null {
  const stated = boards
    .map((board) => board.details?.playedAt)
    .filter((at): at is string => typeof at === 'string')
    .sort()[0];
  return dayOf(round.startsAt ?? stated);
}

function boardLabel(board: StoredXiangqiBroadcastBoard): string {
  const d = board.details;
  const match = d?.matchEn?.trim() || d?.match?.trim();
  const parts = [
    match ? match : null,
    d?.table ? `table ${d.table}` : `board ${board.boardNumber}`,
    d?.game ? `game ${d.game}` : null,
    d?.kind && d.kind !== 'standard' ? d.kind : null,
  ].filter(Boolean);
  const label = parts.join(', ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function boardLine(board: StoredXiangqiBroadcastBoard, slugOf: SlugOf): string {
  const pairing = `${playerHtml(board.red, slugOf)} (Red) vs ${playerHtml(board.black, slugOf)} (Black)`;
  const result = escapeHtml(resultText(board));
  const outcome = started(board)
    ? `<a href="${escapeHtml(boardHref(board.id))}">${result}</a>`
    : result;
  return `<li>${escapeHtml(boardLabel(board))}: ${pairing}, ${outcome}</li>`;
}

const SECTION_LINKS =
  '<p><a href="/broadcast/xiangqi">All broadcasts</a> · <a href="/broadcast/xiangqi/calendar">Calendar</a> · <a href="/players">Players</a> · <a href="/games/search">Game database</a></p>';

// ── Bodies ────────────────────────────────────────────────────────────────────

export type TourSummary = {
  tour: StoredXiangqiBroadcastTour;
  rounds: number;
  games: number;
};

export function indexDescription(tours: number): string {
  return `Xiangqi (Chinese chess) tournaments relayed in English: ${plural(tours, 'event')}, each with its rounds, pairings and results, and every game to replay with an engine eval.`;
}

export function renderIndexBody(tours: readonly TourSummary[]): string {
  const rows = tours.map(({ tour, rounds, games }) => {
    const facts = [whenAndWhere(tour) || null, plural(rounds, 'round'), plural(games, 'game')]
      .filter(Boolean)
      .join(' · ');
    return `<li><a href="${escapeHtml(tourHref(tour.slug))}">${nameHtml(tour)}</a> · ${escapeHtml(facts)}</li>`;
  });
  return `<main><h1>Xiangqi broadcasts</h1><p>${escapeHtml(indexDescription(tours.length))}</p><ul>${rows.join('')}</ul>${SECTION_LINKS}</main>`;
}

export function tourDescription(tour: StoredXiangqiBroadcastTour, games: number): string {
  const when = whenAndWhere(tour);
  return `${english(tour)}${when ? `, ${when}` : ''}. ${games > 0 ? `${plural(games, 'game')} in English` : 'Every round in English'}, with results, pairings and an engine eval on every board, on Mistboard.`;
}

const TOUR_PLAYER_CAP = 96;

export function renderTourBody(
  tour: StoredXiangqiBroadcastTour,
  rounds: readonly StoredXiangqiBroadcastRound[],
  boardsByRound: ReadonlyMap<string, readonly StoredXiangqiBroadcastBoard[]>,
  slugOf: SlugOf,
): string {
  const parts = [
    `<p><a href="/broadcast/xiangqi">Xiangqi broadcasts</a></p>`,
    `<h1>${nameHtml(tour)}</h1>`,
  ];
  const when = whenAndWhere(tour);
  if (when) parts.push(`<p>${escapeHtml(when)}.</p>`);
  const all = [...boardsByRound.values()].flat();
  const finished = all.filter((board) => board.result !== '*').length;
  parts.push(
    `<p>${escapeHtml(`${plural(rounds.length, 'round')}, ${plural(all.length, 'game')}, ${finished} with a result.`)}</p>`,
  );
  const rows = orderedRounds(rounds).map((round) => {
    const boards = boardsByRound.get(round.id) ?? [];
    const facts = [
      roundDay(round, boards),
      boards.length > 0 ? plural(boards.length, 'game') : 'pairings not published yet',
      boards.some((board) => board.status === 'live') ? 'live now' : null,
    ]
      .filter(Boolean)
      .join(' · ');
    // Only a round with a started game is a page worth a crawler's visit
    // (the sitemap lists the same set).
    const name = boards.some(started)
      ? `<a href="${escapeHtml(roundHref(tour.slug, round.id))}">${nameHtml(round)}</a>`
      : nameHtml(round);
    return `<li>${name} · ${escapeHtml(facts)}</li>`;
  });
  if (rows.length > 0) parts.push(`<h2>Rounds</h2><ol>${rows.join('')}</ol>`);
  const players = new Map<string, Named>();
  for (const board of all) {
    for (const player of [board.red, board.black]) {
      if (players.size >= TOUR_PLAYER_CAP) break;
      if (!players.has(player.name)) players.set(player.name, player);
    }
  }
  if (players.size > 0) {
    parts.push(
      `<h2>Players</h2><ul>${[...players.values()].map((p) => `<li>${playerHtml(p, slugOf)}</li>`).join('')}</ul>`,
    );
  }
  parts.push(SECTION_LINKS);
  return `<main>${parts.join('')}</main>`;
}

export function roundDescription(
  tour: StoredXiangqiBroadcastTour,
  round: StoredXiangqiBroadcastRound,
  boards: readonly StoredXiangqiBroadcastBoard[],
): string {
  const day = roundDay(round, boards);
  return `${english(round)} of ${english(tour)}${day ? `, ${day}` : ''}: ${plural(boards.length, 'game')} in English with pairings, results and an engine eval on every board, on Mistboard.`;
}

export function renderRoundBody(
  tour: StoredXiangqiBroadcastTour,
  round: StoredXiangqiBroadcastRound,
  rounds: readonly StoredXiangqiBroadcastRound[],
  boards: readonly StoredXiangqiBroadcastBoard[],
  slugOf: SlugOf,
): string {
  const parts = [
    `<p><a href="/broadcast/xiangqi">Xiangqi broadcasts</a> · <a href="${escapeHtml(tourHref(tour.slug))}">${escapeHtml(english(tour))}</a></p>`,
    `<h1>${nameHtml(round)} · ${nameHtml(tour)}</h1>`,
  ];
  const facts = [roundDay(round, boards), tour.location?.trim() || null].filter(Boolean).join(', ');
  if (facts) parts.push(`<p>${escapeHtml(facts)}.</p>`);
  if (boards.length > 0) {
    parts.push(
      `<h2>${escapeHtml(`Games (${boards.length})`)}</h2><ol>${boards.map((b) => boardLine(b, slugOf)).join('')}</ol>`,
    );
  } else {
    parts.push('<p>The pairings for this round are not published yet.</p>');
  }
  const ordered = orderedRounds(rounds);
  if (ordered.length > 1) {
    parts.push(
      `<h2>Rounds</h2><ol>${ordered
        .map((entry) =>
          entry.id === round.id
            ? `<li>${nameHtml(entry)}</li>`
            : `<li><a href="${escapeHtml(roundHref(tour.slug, entry.id))}">${nameHtml(entry)}</a></li>`,
        )
        .join('')}</ol>`,
    );
  }
  parts.push(SECTION_LINKS);
  return `<main>${parts.join('')}</main>`;
}

export function boardDescription(
  board: StoredXiangqiBroadcastBoard,
  tour: StoredXiangqiBroadcastTour | null,
  round: StoredXiangqiBroadcastRound | null,
): string {
  const where = [round ? english(round) : null, tour ? english(tour) : null].filter(Boolean);
  return `${english(board.red)} vs ${english(board.black)}${where.length > 0 ? `, ${where.join(' of ')}` : ''}: ${resultText(board)}. Replay it move by move with an engine eval, in English, on Mistboard.`;
}

export function renderBoardBody(
  board: StoredXiangqiBroadcastBoard,
  tour: StoredXiangqiBroadcastTour | null,
  round: StoredXiangqiBroadcastRound | null,
  slugOf: SlugOf,
): string {
  const crumbs = ['<a href="/broadcast/xiangqi">Xiangqi broadcasts</a>'];
  if (tour) {
    crumbs.push(`<a href="${escapeHtml(tourHref(tour.slug))}">${escapeHtml(english(tour))}</a>`);
    if (round) {
      crumbs.push(
        `<a href="${escapeHtml(roundHref(tour.slug, round.id))}">${escapeHtml(english(round))}</a>`,
      );
    }
  }
  const parts = [
    `<p>${crumbs.join(' · ')}</p>`,
    `<h1>${escapeHtml([`${english(board.red)} vs ${english(board.black)}`, round ? english(round) : null, tour ? english(tour) : null].filter(Boolean).join(', '))}</h1>`,
    `<p>${playerHtml(board.red, slugOf)} played Red and ${playerHtml(board.black, slugOf)} played Black. ${escapeHtml(boardLabel(board))}${round ? `, ${escapeHtml(english(round))}` : ''}${tour ? ` of ${escapeHtml(english(tour))}` : ''}.</p>`,
    `<p>Result: ${escapeHtml(resultText(board))}.</p>`,
  ];
  const day = dayOf(board.details?.playedAt ?? round?.startsAt);
  if (day) parts.push(`<p>Played ${escapeHtml(day)}.</p>`);
  if (board.details?.timeControl) {
    parts.push(`<p>Time control: ${escapeHtml(board.details.timeControl)}.</p>`);
  }
  parts.push(SECTION_LINKS);
  return `<main>${parts.join('')}</main>`;
}

// ── Loading ───────────────────────────────────────────────────────────────────

export type BroadcastPageSources = {
  listTours(): Promise<StoredXiangqiBroadcastTour[]>;
  getTour(slug: string): Promise<StoredXiangqiBroadcastTour | null>;
  listRounds(slug: string): Promise<StoredXiangqiBroadcastRound[]>;
  listBoards(roundId: string): Promise<StoredXiangqiBroadcastBoard[]>;
  getBoard(boardId: string): Promise<StoredXiangqiBroadcastBoard | null>;
  /** Archive name -> player-page slug; a name without a page stays plain text. */
  playerSlugs(): Promise<ReadonlyMap<string, string>>;
  /** The share meta og-broadcast.ts already builds (title, description, card),
   *  or null when it has none for the path. */
  shareMeta(pathname: string): Promise<{
    title: string;
    description: string;
    imagePath?: string;
  } | null>;
};

async function boardsOf(
  rounds: readonly StoredXiangqiBroadcastRound[],
  sources: BroadcastPageSources,
): Promise<Map<string, StoredXiangqiBroadcastBoard[]>> {
  const lists = await Promise.all(rounds.map((round) => sources.listBoards(round.id)));
  return new Map(rounds.map((round, index) => [round.id, lists[index] ?? []]));
}

/** Meta and body for a broadcast page, or null when the path is not one. */
export async function broadcastPageFor(
  pathname: string,
  sources: BroadcastPageSources,
): Promise<BroadcastPage | null> {
  const route = parseBroadcastRoute(pathname);
  if (!route) return null;
  const slugs = sources.playerSlugs().catch(() => new Map<string, string>());
  const slugOf =
    (map: ReadonlyMap<string, string>): SlugOf =>
    (name) =>
      map.get(name) ?? null;
  switch (route.kind) {
    case 'index': {
      const tours = await sources.listTours();
      const summaries = await Promise.all(
        tours.map(async (tour): Promise<TourSummary> => {
          const rounds = await sources.listRounds(tour.slug);
          const boards = await boardsOf(rounds, sources);
          const games = [...boards.values()].reduce((sum, list) => sum + list.length, 0);
          return { tour, rounds: rounds.length, games };
        }),
      );
      return {
        meta: {
          title: 'Xiangqi broadcasts · Live tournaments in English | Mistboard',
          description: indexDescription(tours.length),
          urlPath: broadcastIndexHref,
        },
        body: renderIndexBody(summaries),
      };
    }
    case 'tour': {
      const tour = await sources.getTour(route.slug);
      if (!tour) return { noindex: true };
      const rounds = await sources.listRounds(tour.slug);
      const boards = await boardsOf(rounds, sources);
      const urlPath = tourHref(tour.slug);
      const games = [...boards.values()].reduce((sum, list) => sum + list.length, 0);
      const share = await sources.shareMeta(urlPath).catch(() => null);
      return {
        meta: {
          title: share?.title ?? `${english(tour)} | Mistboard broadcast`,
          description: share?.description ?? tourDescription(tour, games),
          urlPath,
          ...(share?.imagePath ? { imagePath: share.imagePath } : {}),
        },
        body: renderTourBody(tour, rounds, boards, slugOf(await slugs)),
      };
    }
    case 'round': {
      const tour = await sources.getTour(route.slug);
      if (!tour) return { noindex: true };
      const rounds = await sources.listRounds(tour.slug);
      const round = rounds.find((entry) => entry.id === route.roundId);
      if (!round) return { noindex: true };
      const boards = await sources.listBoards(round.id);
      const urlPath = roundHref(tour.slug, round.id);
      const share = await sources.shareMeta(urlPath).catch(() => null);
      return {
        meta: {
          title: share?.title ?? `${english(round)} · ${english(tour)} | Mistboard`,
          description: share?.description ?? roundDescription(tour, round, boards),
          urlPath,
          ...(share?.imagePath ? { imagePath: share.imagePath } : {}),
        },
        body: renderRoundBody(tour, round, rounds, boards, slugOf(await slugs)),
      };
    }
    case 'board': {
      const board = await sources.getBoard(route.boardId);
      if (!board) return { noindex: true };
      const tour = await sources.getTour(board.tourSlug);
      const rounds = tour ? await sources.listRounds(tour.slug) : [];
      const round = rounds.find((entry) => entry.id === board.roundId) ?? null;
      const urlPath = boardHref(board.id);
      const share = await sources.shareMeta(urlPath).catch(() => null);
      return {
        meta: {
          title: share?.title ?? `${english(board.red)} vs ${english(board.black)} | Mistboard`,
          description: share?.description ?? boardDescription(board, tour, round),
          urlPath,
          ...(share?.imagePath ? { imagePath: share.imagePath } : {}),
        },
        body: renderBoardBody(board, tour, round, slugOf(await slugs)),
      };
    }
  }
}

// ── Live wiring ───────────────────────────────────────────────────────────────

/** Archive name -> player-page slug, for names only one player page carries
 *  (two players who share a name are told apart by federation, which a
 *  pairing line does not always know; those stay plain text). */
async function livePlayerSlugs(): Promise<ReadonlyMap<string, string>> {
  const players = await cachedPlayers();
  const slugs = new Map<string, string>();
  const shared = new Set<string>();
  for (const player of players) {
    if (!player.slug) continue;
    if (slugs.has(player.name)) shared.add(player.name);
    slugs.set(player.name, player.slug);
  }
  for (const name of shared) slugs.delete(name);
  return slugs;
}

export const liveBroadcastSources: BroadcastPageSources = {
  listTours: () => persistence.listXiangqiBroadcastTours(),
  getTour: (slug) => persistence.getXiangqiBroadcastTour(slug),
  listRounds: (slug) => persistence.listXiangqiBroadcastRounds(slug),
  listBoards: (roundId) => persistence.listXiangqiBroadcastBoards(roundId),
  getBoard: (boardId) => persistence.getXiangqiBroadcastBoard(boardId),
  playerSlugs: livePlayerSlugs,
  shareMeta: (pathname) => broadcastPageMeta(pathname),
};

// The index reads every round's boards; a crawler walking the sitemap should
// not rebuild it per URL. A minute's staleness matches the players index.
const INDEX_TTL_MS = 60_000;
let indexCache: { at: number; page: Promise<BroadcastPage | null> } | null = null;

/** The live lookup: null without persistence (the shell stays as it was). */
export async function liveBroadcastPage(pathname: string): Promise<BroadcastPage | null> {
  if (!persistence.isInitialized()) return null;
  const route = parseBroadcastRoute(pathname);
  if (!route) return null;
  if (route.kind !== 'index') return broadcastPageFor(pathname, liveBroadcastSources);
  const now = Date.now();
  if (!indexCache || now - indexCache.at > INDEX_TTL_MS) {
    const page = broadcastPageFor(pathname, liveBroadcastSources);
    page.catch(() => {
      if (indexCache?.page === page) indexCache = null;
    });
    indexCache = { at: now, page };
  }
  return indexCache.page;
}
