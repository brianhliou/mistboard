// Public archive readers for the offline, reviewed broadcast preparation CLI.
// No account, database write, script evaluation or guessed round assignment.
import { createHash } from 'node:crypto';
import {
  replayXiangqiBroadcastBoard,
  type XiangqiBroadcastBoard,
  type XiangqiBroadcastResult,
  type XiangqiBroadcastTour,
  type XiangqiMove,
  type XiangqiSquare,
} from '@mistboard/game';
import {
  convertWxfDhtmlXqPageToSnapshot,
  STANDARD_DHTMLXQ_BINIT,
} from './xiangqi-broadcast-wxf-dhtmlxq.js';

export type ArchiveCatalogEntry = {
  provider: 'iqipu' | 'elephantchess';
  url: string;
  name: string;
  games: number;
  rounds?: number;
  date?: string;
};
export type ArchivePairing = {
  id: string;
  url: string;
  round: number;
  date: string;
  red: string;
  black: string;
  result: XiangqiBroadcastResult;
};
export type IqipuArchiveGame = {
  code: string;
  sourceUrl: string;
  event: string;
  red_name: string;
  black_name: string;
  red_team: string;
  black_team: string;
  binit: string;
  movelist: string;
  result: string;
  open: string;
  time_rule: string;
};

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function hrefs(html: string): Array<{ url: string; label: string }> {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
    url: text(m[1]!),
    label: text(m[2]!),
  }));
}

export function archiveSourceUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !['www.iqipu.com', 'elephantchess.io'].includes(url.hostname)
  )
    throw new Error(`Unsupported archive URL: ${raw}`);
  if (
    url.hostname === 'www.iqipu.com' &&
    !/^\/(?:events(?:\/|$)|game\/games\/)/.test(url.pathname)
  ) {
    throw new Error(`Unsupported iqipu path: ${url.pathname}`);
  }
  if (
    url.hostname === 'elephantchess.io' &&
    !/^\/(?:database\/(?:events|event|game)$|api\/game-data\/game-moves$)/.test(url.pathname)
  ) {
    throw new Error(`Unsupported ElephantChess path: ${url.pathname}`);
  }
  return url;
}

export function parseIqipuCatalog(html: string): ArchiveCatalogEntry[] {
  const entries = new Map<string, ArchiveCatalogEntry>();
  for (const m of html.matchAll(
    /<a\b[^>]*href=["']([^"']*\/events\/\d+)["'][^>]*>([\s\S]*?)<\/a>\s*[（(]\s*(\d+)\s*局\s*[）)]/gi,
  )) {
    const url = new URL(text(m[1]!), 'https://www.iqipu.com').href;
    archiveSourceUrl(url);
    entries.set(url, { provider: 'iqipu', url, name: text(m[2]!), games: Number(m[3]) });
  }
  return [...entries.values()];
}

export function parseElephantChessCatalog(html: string): ArchiveCatalogEntry[] {
  const entries: ArchiveCatalogEntry[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]!);
    if (cells.length !== 4) continue;
    const link = hrefs(cells[0]!).find((a) => /^\/database\/event\?id=[\w-]+$/.test(a.url));
    if (!link || !/^\d+$/.test(text(cells[2]!)) || !/^\d+$/.test(text(cells[3]!))) continue;
    entries.push({
      provider: 'elephantchess',
      url: new URL(link.url, 'https://elephantchess.io').href,
      name: link.label,
      date: text(cells[1]!),
      rounds: Number(text(cells[2]!)),
      games: Number(text(cells[3]!)),
    });
  }
  return entries;
}

export function parseIqipuGameLinks(html: string): string[] {
  return [
    ...new Set(
      hrefs(html)
        .filter((a) => /^(?:https:\/\/www\.iqipu\.com)?\/game\/games\/[\w-]+$/.test(a.url))
        .map((a) => new URL(a.url, 'https://www.iqipu.com').href),
    ),
  ];
}

export function parseIqipuGame(html: string, sourceUrl: string): IqipuArchiveGame {
  const url = archiveSourceUrl(sourceUrl);
  if (!/^\/game\/games\/[\w-]+$/.test(url.pathname)) throw new Error('Expected an iqipu game page');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const boot = scripts
    .map((m) => m[1]!.match(/^\s*window\.__IQIPU_GAME_BOOT__\s*=\s*(\{[\s\S]*\});?\s*$/))
    .find(Boolean);
  if (!boot) throw new Error('No public iqipu game payload (login notice or changed page)');
  const payload = JSON.parse(boot[1]!) as { success?: boolean; game?: Record<string, unknown> };
  const game = payload.game;
  if (payload.success !== true || !game || typeof game !== 'object' || Array.isArray(game))
    throw new Error('Invalid iqipu payload');
  for (const key of ['code', 'event', 'red_name', 'black_name', 'binit', 'movelist', 'result']) {
    if (typeof game[key] !== 'string' || !(game[key] as string).trim())
      throw new Error(`Missing iqipu ${key}`);
  }
  if (game.code !== url.pathname.split('/').at(-1))
    throw new Error('iqipu game identity differs from its URL');
  const value = (key: string) => (typeof game[key] === 'string' ? (game[key] as string) : '');
  return {
    code: value('code'),
    sourceUrl,
    event: value('event'),
    red_name: value('red_name'),
    black_name: value('black_name'),
    red_team: value('red_team'),
    black_team: value('black_team'),
    binit: value('binit'),
    movelist: value('movelist'),
    result: value('result'),
    open: value('open'),
    time_rule: value('time_rule'),
  };
}

function positionKey(binit: string): string {
  if (!/^(?:[0-8][0-9]){32}$/.test(binit)) throw new Error('Invalid archive initial position');
  // Identical pieces may be listed in reverse order. Compare actual role/square
  // multisets, never replace a non-standard starting position with the default.
  return [...'RHEAKAEHRCCPPPPPrheakaehrccppppp']
    .map((role, i) => `${role}:${binit.slice(i * 2, i * 2 + 2)}`)
    .sort()
    .join('|');
}

export function iqipuArchiveBoard(
  game: IqipuArchiveGame,
  tour: XiangqiBroadcastTour,
): XiangqiBroadcastBoard {
  if (positionKey(game.binit) !== positionKey(STANDARD_DHTMLXQ_BINIT))
    throw new Error('Non-standard initial position');
  const mainline = /^\d+$/.test(game.movelist)
    ? game.movelist
    : game.movelist.match(/\[0_1_0\](\d+)\[\/0_1_0\]/)?.[1];
  if (!mainline) throw new Error('No game mainline in archive record');
  const tags = {
    binit: STANDARD_DHTMLXQ_BINIT,
    red: game.red_name,
    black: game.black_name,
    redteam: game.red_team,
    blackteam: game.black_team,
    movelist: mainline,
    result: game.result,
    event: game.event,
    open: game.open,
    timerule: game.time_rule,
  };
  const frame =
    '[DhtmlXQiFrame]' +
    Object.entries(tags)
      .map(
        ([k, v]) => `[DhtmlXQ_${k}]${v.replaceAll('[', '(').replaceAll(']', ')')}[/DhtmlXQ_${k}]`,
      )
      .join('\n') +
    '[/DhtmlXQiFrame]';
  const result = convertWxfDhtmlXqPageToSnapshot(frame, {
    tourSlug: tour.slug,
    tourName: tour.name,
    roundId: `${tour.slug}-unassigned`,
    sourceBoardId: `iqipu-${game.code}`,
    sourceUrl: game.sourceUrl,
  });
  if (!result.ok || result.issues.length || result.snapshot.boards.length !== 1)
    throw new Error(JSON.stringify(result.issues));
  const board = result.snapshot.boards[0]!;
  if (board.status !== 'complete') throw new Error('Archive game has no final result');
  return board;
}

function sourceDate(raw: string): string {
  const m = raw.match(
    /\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/,
  );
  if (!m) throw new Error(`No stated round date: ${raw}`);
  const month =
    [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ].indexOf(m[2]!) + 1;
  const date = `${m[3]}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  if (new Date(date).toISOString().slice(0, 10) !== date) throw new Error(`Invalid date: ${raw}`);
  return date;
}

export function parseElephantChessEvent(html: string): {
  name: string;
  pairings: ArchivePairing[];
} {
  const name = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  if (!name) throw new Error('No archive event title');
  const pairings: ArchivePairing[] = [];
  for (const section of html.matchAll(
    /<h2\b[^>]*>\s*Round (\d+)\s*<\/h2>([\s\S]*?)(?=<h[23]\b|$)/gi,
  )) {
    const round = Number(section[1]);
    if (!Number.isSafeInteger(round) || round < 1) throw new Error('Invalid archive round');
    const body = section[2]!;
    const date = sourceDate(
      text(body.match(/<span\b[^>]*class="round-date"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ''),
    );
    for (const row of body.matchAll(/<tr\b[^>]*data-game-id="([\w-]+)"[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[2]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => text(m[1]!));
      const result = new Map<string, XiangqiBroadcastResult>([
        ['2-0', '1-0'],
        ['0-2', '0-1'],
        ['1-1', '1/2-1/2'],
      ]).get(cells[1] ?? '');
      if (cells.length !== 3 || !cells[0] || !cells[2] || !result)
        throw new Error('Invalid archive pairing');
      pairings.push({
        id: row[1]!,
        url: `https://elephantchess.io/database/game?id=${row[1]}`,
        round,
        date,
        red: cells[0],
        black: cells[2],
        result,
      });
    }
  }
  if (!pairings.length || new Set(pairings.map((p) => p.id)).size !== pairings.length)
    throw new Error('Empty or duplicate archive pairings');
  return { name, pairings };
}

export function parseElephantChessMoves(body: string): XiangqiMove[] {
  const value = JSON.parse(body) as { moves?: unknown };
  if (!Array.isArray(value.moves) || !value.moves.length)
    throw new Error('No public archive moves');
  return value.moves.map((raw: unknown) => {
    if (typeof raw !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(raw))
      throw new Error('Invalid archive UCI move');
    return {
      from: `${raw[0]}${Number(raw[1]) + 1}` as XiangqiSquare,
      to: `${raw[2]}${Number(raw[3]) + 1}` as XiangqiSquare,
    };
  });
}

/** Names and URLs differ across mirrors; identical played moves are the join. */
export function archiveMovesKey(moves: readonly XiangqiMove[]): string {
  const mirror = (s: string) => `${String.fromCharCode(202 - s.charCodeAt(0))}${s.slice(1)}`;
  const original = moves.map((m) => `${m.from}:${m.to}`).join('|');
  const reflected = moves.map((m) => `${mirror(m.from)}:${mirror(m.to)}`).join('|');
  return createHash('sha256')
    .update(original < reflected ? original : reflected)
    .digest('hex');
}

export function elephantChessArchiveBoard(
  pairing: ArchivePairing,
  moves: XiangqiMove[],
  tour: XiangqiBroadcastTour,
): XiangqiBroadcastBoard {
  const board: XiangqiBroadcastBoard = {
    schema: tour.schema,
    tourSlug: tour.slug,
    id: `${tour.slug}-ec-${pairing.id}`,
    sourceBoardId: `ec-${pairing.id}`,
    roundId: `${tour.slug}-unassigned`,
    boardNumber: 1,
    red: { name: pairing.red },
    black: { name: pairing.black },
    status: 'complete',
    result: pairing.result,
    moves,
    sourceUrl: pairing.url,
  };
  const replay = replayXiangqiBroadcastBoard(board, { continuePastAdjudicatedDraw: true });
  if (!replay.ok) throw new Error(`Illegal archive record ${pairing.id}: ${replay.reason}`);
  return board;
}

export type ArchiveSourceException = { sourceBoardId: string; pairingId: string; reason: string };

export function assignArchiveRounds(input: {
  tour: XiangqiBroadcastTour;
  games: XiangqiBroadcastBoard[];
  pairings: Array<ArchivePairing & { moves: XiangqiMove[] }>;
  /** Explicitly reviewed discrepancies; no automatic fuzzy matching. */
  exceptions?: ArchiveSourceException[];
}) {
  const byMoves = new Map<string, XiangqiBroadcastBoard>();
  for (const board of input.games) {
    const key = archiveMovesKey(board.moves);
    if (byMoves.has(key))
      throw new Error('Duplicate game moves in source; round assignment is ambiguous');
    byMoves.set(key, board);
  }
  if (input.games.length !== input.pairings.length) throw new Error('Source game counts disagree');
  const boards: XiangqiBroadcastBoard[] = [];
  const seen = new Set<string>();
  const roundCounts = new Map<number, number>();
  for (const pairing of input.pairings) {
    const exception = input.exceptions?.find((e) => e.pairingId === pairing.id);
    const game = exception
      ? input.games.find((b) => b.sourceBoardId === exception.sourceBoardId)
      : byMoves.get(archiveMovesKey(pairing.moves));
    if (!game) throw new Error(`No unique exact move match for ${pairing.id}`);
    const key = archiveMovesKey(game.moves);
    if (seen.has(key)) throw new Error(`Repeated source game for ${pairing.id}`);
    if (exception) {
      if (!exception.reason.trim()) throw new Error('Source exception needs a review reason');
      // A reviewed exception must still identify the same played game. Allow
      // a secondary record's bad last move / early end only after a long,
      // unique matching prefix. Retain every move from the legal primary.
      const prefixLength = Math.min(game.moves.length, pairing.moves.length) - 1;
      if (
        prefixLength < 32 ||
        archiveMovesKey(game.moves.slice(0, prefixLength)) !==
          archiveMovesKey(pairing.moves.slice(0, prefixLength))
      ) {
        throw new Error(`Reviewed source exception does not identify the same game: ${pairing.id}`);
      }
    } else if (pairing.result !== game.result)
      throw new Error(`Result disagreement for ${pairing.id}`);
    const replay = replayXiangqiBroadcastBoard(game, { continuePastAdjudicatedDraw: true });
    if (!replay.ok) throw new Error(`Illegal source game: ${replay.reason}`);
    seen.add(key);
    const roundId = `${input.tour.slug}-r${String(pairing.round).padStart(2, '0')}`;
    const ordinal = (roundCounts.get(pairing.round) ?? 0) + 1;
    roundCounts.set(pairing.round, ordinal);
    boards.push({
      ...game,
      id: `${input.tour.slug}-${game.sourceBoardId}`,
      roundId,
      boardNumber: ordinal,
    });
  }
  const numbers = [...roundCounts.keys()].sort((a, b) => a - b);
  if (
    input.exceptions?.some(
      (e) =>
        !input.pairings.some((p) => p.id === e.pairingId) ||
        !input.games.some((b) => b.sourceBoardId === e.sourceBoardId),
    )
  )
    throw new Error('Unused source exception');
  if (numbers.some((n, i) => n !== i + 1)) throw new Error('Round sequence is incomplete');
  return {
    tour: input.tour,
    rounds: numbers.map((n) => ({
      schema: input.tour.schema,
      id: `${input.tour.slug}-r${String(n).padStart(2, '0')}`,
      tourSlug: input.tour.slug,
      name: `Round ${n}`,
      sourceUrl: input.pairings.find((p) => p.round === n)!.url,
    })),
    boards,
  };
}
