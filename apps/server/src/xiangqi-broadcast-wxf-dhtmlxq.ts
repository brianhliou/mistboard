import {
  replayXiangqiBroadcastBoard,
  squareOf,
  XIANGQI_BROADCAST_SCHEMA,
  type XiangqiBroadcastBoard,
  type XiangqiBroadcastGameDetails,
  type XiangqiBroadcastResult,
  type XiangqiBroadcastRound,
  type XiangqiBroadcastTour,
  type XiangqiMove,
  type XiangqiSquare,
} from '@mistboard/game';

export type WxfDhtmlXqIssueKind =
  | 'no_dhtmlxq_frames'
  | 'missing_required_tag'
  | 'unsupported_initial_position'
  | 'malformed_movelist'
  | 'illegal_movelist';

export type WxfDhtmlXqIssue = {
  kind: WxfDhtmlXqIssueKind;
  message: string;
  sourceBoardId?: string;
};

export type WxfDhtmlXqSnapshot = {
  tour: XiangqiBroadcastTour;
  rounds: XiangqiBroadcastRound[];
  boards: XiangqiBroadcastBoard[];
};

export type WxfDhtmlXqConversionResult =
  | { ok: true; snapshot: WxfDhtmlXqSnapshot; issues: WxfDhtmlXqIssue[] }
  | { ok: false; issues: WxfDhtmlXqIssue[] };

export type WxfDhtmlXqConversionOptions = {
  tourSlug?: string;
  tourName?: string;
  roundId?: string;
  roundName?: string;
  sourceUrl?: string;
  /**
   * Board number for the first board on this page. Pages that carry one game
   * each cannot be numbered from their position, because every conversion
   * sees index 0; the caller knows the ordering and passes it here.
   */
  boardNumber?: number;
};

export const STANDARD_DHTMLXQ_BINIT =
  '0919293949596979891777062646668600102030405060708012720323436383';

function decodeHtmlText(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

function cleanTagValue(value: string | undefined): string | undefined {
  const cleaned = decodeHtmlText(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function slugPart(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// FNV-1a over the raw value -> stable base36 token. Used as a slug fallback so a
// CJK-only title (e.g. a Chinese event name with no Latin chars, which slugPart
// reduces to '') still yields a deterministic, non-empty tour slug that stays
// identical across re-polls of the same source.
function hashToken(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// slugPart keeps only [a-z0-9], so a CJK title collapses to whatever Latin/digit
// fragment it happens to contain (e.g. "2004年将军杯...甲级联赛" -> "2004").
// Distinct events in the same year then collide on one slug. Detect that the
// slug dropped meaningful characters: after NFKD (which folds accents like é->e,
// so those are NOT lost) and stripping combining marks and ASCII alphanumerics,
// any remaining Unicode letter/number is content slugPart threw away.
function slugLosesInformation(value: string): boolean {
  const residue = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[a-z0-9]/gi, '');
  return /[\p{L}\p{N}]/u.test(residue);
}

// A round label like "第03轮" -> "r03" (stable across imports so same-round
// games group). Non-numeric labels fall back to a slug or a deterministic hash.
function roundToken(round: string): string {
  const num = round.match(/\d+/)?.[0];
  if (num) return `r${num.padStart(2, '0')}`;
  return slugPart(round) || `r-${hashToken(round)}`;
}

function stableTourSlug(value: string): string {
  const base = slugPart(value);
  if (!base) return `tour-${hashToken(value)}`;
  // Append a deterministic title hash when slugification was lossy, so two
  // different CJK event names sharing an ASCII fragment stay distinct tours.
  if (slugLosesInformation(value)) return `${base}-${hashToken(value)}`;
  return base;
}

function extractArticleTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanTagValue(match?.[1]?.replace(/ - World Xiangqi Federation[\s\S]*$/i, ''));
}

function extractFrameBodies(html: string): string[] {
  return [...html.matchAll(/\[DhtmlXQiFrame\]([\s\S]*?)\[\/DhtmlXQiFrame\]/g)].map(
    (match) => match[1] ?? '',
  );
}

function parseFrameTags(frame: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const match of frame.matchAll(/\[DhtmlXQ_([a-z0-9]+)\]([\s\S]*?)\[\/DhtmlXQ_\1\]/gi)) {
    const key = match[1]?.toLowerCase();
    const value = cleanTagValue(match[2]);
    if (key && value !== undefined) tags.set(key, value);
  }
  return tags;
}

function requireTag(
  tags: Map<string, string>,
  key: string,
  fallbackSourceBoardId: string | undefined,
): { ok: true; value: string } | { ok: false; issue: WxfDhtmlXqIssue } {
  const value = tags.get(key);
  if (value) return { ok: true, value };
  return {
    ok: false,
    issue: {
      kind: 'missing_required_tag',
      message: `DhtmlXQ frame is missing ${key}`,
      ...(fallbackSourceBoardId ? { sourceBoardId: fallbackSourceBoardId } : {}),
    },
  };
}

function sourceBoardIdFromTitle(title: string | undefined, index: number): string {
  const token = title?.match(/^([a-z0-9]+(?:t\d+)?)/i)?.[1];
  return slugPart(token ?? `board-${index + 1}`) || `board-${index + 1}`;
}

// The game id a single-record page URL carries, if it carries one. dpxq files
// every record as /hldcg/search/view_m_<id>.html, so the id is the page's own
// name for the game and survives anything the players or round tags might share
// with another record.
export function sourceGameId(sourceUrl: string | undefined): string | undefined {
  return sourceUrl?.match(/view_m_(\d+)\.html/i)?.[1];
}

function boardNumberFromSourceId(
  sourceBoardId: string,
  index: number,
  explicitFirstBoardNumber: number | undefined,
): number {
  const table = sourceBoardId.match(/t0*(\d+)$/i)?.[1];
  const parsed = Number(table);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  // An explicit number applies to the first board and increments across any
  // further boards on the same page, so a single-game source is numbered by
  // the caller while a multi-board page still numbers its own boards.
  if (explicitFirstBoardNumber !== undefined) return explicitFirstBoardNumber + index;
  return index + 1;
}

function playerTeam(tags: Map<string, string>, key: string): string | undefined {
  const value = tags.get(key)?.trim();
  return value && value.length > 0 ? value : undefined;
}

/**
 * A game's details from its frame tags (dpxq names them; see
 * XiangqiBroadcastGameDetails). Always an object: an empty one records that
 * the page was read and stated none, which is what lets a complete board stop
 * being re-read (the poller skips complete boards that carry details).
 *
 * The date is the one field that needs a guard: 2026 league game pages carry
 * `2029-09-16 19:00`, a typo in the year. The event tag leads with its year
 * (2026年…), so a date whose year disagrees takes the event's.
 */
export function gameDetailsFromFrameTags(tags: Map<string, string>): XiangqiBroadcastGameDetails {
  const details: XiangqiBroadcastGameDetails = {};
  const match = tags.get('group')?.trim();
  if (match) details.match = match;
  const table = Number(tags.get('table')?.match(/(\d+)/)?.[1]);
  if (Number.isInteger(table) && table > 0) details.table = table;
  const game = Number(tags.get('other')?.match(/第\s*(\d+)\s*局/)?.[1]);
  if (Number.isInteger(game) && game > 0) details.game = game;
  const kind = tags.get('gametype') ?? '';
  // 超快棋 contains 快棋, so the longer name is tested first.
  if (kind.includes('超快')) details.kind = 'blitz';
  else if (kind.includes('快棋')) details.kind = 'rapid';
  else if (kind.includes('慢棋')) details.kind = 'standard';
  const timeControl = tags.get('timerule')?.trim();
  if (timeControl) details.timeControl = timeControl;
  const playedAt = playedAtFromTags(tags.get('date'), tags.get('event'));
  if (playedAt) details.playedAt = playedAt;
  const opening = tags.get('open')?.trim();
  if (opening) details.opening = opening;
  return details;
}

function playedAtFromTags(date: string | undefined, event: string | undefined): string | undefined {
  const parts = date?.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!parts) return undefined;
  const eventYear = event?.match(/^\s*(\d{4})\s*年/)?.[1];
  const year = eventYear && eventYear !== parts[1] ? eventYear : parts[1];
  const pad = (value: string | undefined) => (value ?? '0').padStart(2, '0');
  const iso = `${year}-${pad(parts[2])}-${pad(parts[3])}T${pad(parts[4])}:${pad(parts[5])}:00+08:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : undefined;
}

function cleanPlayerName(name: string): string {
  return name.replace(/\*+$/g, '').trim();
}

function resultFromWxf(value: string | undefined): {
  result: XiangqiBroadcastResult;
  status: XiangqiBroadcastBoard['status'];
} {
  if (!value || /未知|\*/.test(value)) return { result: '*', status: 'live' };
  if (/红胜|red win|red wins|1-0/i.test(value)) return { result: '1-0', status: 'complete' };
  if (/黑胜|black win|black wins|0-1/i.test(value)) return { result: '0-1', status: 'complete' };
  if (/和|draw|1\/2/i.test(value)) return { result: '1/2-1/2', status: 'complete' };
  return { result: '*', status: 'live' };
}

function dhtmlCoordToSquare(coord: string): XiangqiSquare | null {
  if (!/^[0-8][0-9]$/.test(coord)) return null;
  const file = Number(coord[0]);
  const dhtmlRank = Number(coord[1]);
  return squareOf(file, 10 - dhtmlRank);
}

function movesFromDhtmlMovelist(
  sourceBoardId: string,
  movelist: string,
): { ok: true; moves: XiangqiMove[] } | { ok: false; issue: WxfDhtmlXqIssue } {
  const compact = movelist.replace(/\s+/g, '');
  if (!/^\d*$/.test(compact) || compact.length === 0 || compact.length % 4 !== 0) {
    return {
      ok: false,
      issue: {
        kind: 'malformed_movelist',
        message: 'DhtmlXQ movelist must be non-empty digits grouped as four digits per ply',
        sourceBoardId,
      },
    };
  }
  const moves: XiangqiMove[] = [];
  for (let i = 0; i < compact.length; i += 4) {
    const from = dhtmlCoordToSquare(compact.slice(i, i + 2));
    const to = dhtmlCoordToSquare(compact.slice(i + 2, i + 4));
    if (!from || !to) {
      return {
        ok: false,
        issue: {
          kind: 'malformed_movelist',
          message: `DhtmlXQ movelist has an out-of-range coordinate at ply ${i / 4 + 1}`,
          sourceBoardId,
        },
      };
    }
    moves.push({ from, to });
  }
  return { ok: true, moves };
}

// Ingestion replays with continuePastAdjudicatedDraw: a tournament game runs
// through repetitions and past the progress clock because an arbiter, not an
// engine, decides those. Without it our own auto-draw made the rest of the game
// read as illegal and the board was DROPPED from the snapshot entirely -- 15 of
// 90 national-championship games in a 2026-08-27 sample, i.e. roughly one live
// board in six would silently never appear. Live play still auto-draws; only
// this replay-for-validation path relaxes it.
function issueForReplayFailure(board: XiangqiBroadcastBoard): WxfDhtmlXqIssue | null {
  const replay = replayXiangqiBroadcastBoard(board, { continuePastAdjudicatedDraw: true });
  if (replay.ok) return null;
  return {
    kind: 'illegal_movelist',
    message: replay.reason,
    sourceBoardId: board.sourceBoardId,
  };
}

export function convertWxfDhtmlXqPageToSnapshot(
  html: string,
  options: WxfDhtmlXqConversionOptions = {},
): WxfDhtmlXqConversionResult {
  const articleTitle = extractArticleTitle(html);
  const tourSlug = options.tourSlug ?? stableTourSlug(articleTitle ?? 'wxf-xiangqi-broadcast');

  const frames = extractFrameBodies(html);
  if (frames.length === 0) {
    return {
      ok: false,
      issues: [{ kind: 'no_dhtmlxq_frames', message: 'no DhtmlXQ iframe payloads found' }],
    };
  }

  // A dpxq archive page is one game carrying its own round (第NN轮); derive a
  // distinct round id/name from it so games from different rounds don't merge
  // into one default round. WXF pages pass an explicit roundId option and are
  // unaffected.
  const pageRoundTag = cleanTagValue(parseFrameTags(frames[0]!).get('round'));
  const roundId =
    options.roundId ??
    (pageRoundTag ? `${tourSlug}-${roundToken(pageRoundTag)}` : `${tourSlug}-round`);
  const roundName = options.roundName ?? pageRoundTag ?? articleTitle ?? 'WXF Round';
  const tour: XiangqiBroadcastTour = {
    schema: XIANGQI_BROADCAST_SCHEMA,
    slug: tourSlug,
    name: options.tourName ?? articleTitle ?? 'WXF Xiangqi Broadcast',
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
  };
  const round: XiangqiBroadcastRound = {
    schema: XIANGQI_BROADCAST_SCHEMA,
    id: roundId,
    tourSlug,
    name: roundName,
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
  };

  const issues: WxfDhtmlXqIssue[] = [];
  const boards: XiangqiBroadcastBoard[] = [];

  frames.forEach((frame, index) => {
    const tags = parseFrameTags(frame);
    const title = cleanTagValue(tags.get('title'));
    let sourceBoardId = sourceBoardIdFromTitle(title, index);
    const binit = requireTag(tags, 'binit', sourceBoardId);
    if (!binit.ok) {
      issues.push(binit.issue);
      return;
    }
    if (binit.value !== STANDARD_DHTMLXQ_BINIT) {
      issues.push({
        kind: 'unsupported_initial_position',
        message: 'only the standard DhtmlXQ xiangqi initial position is supported',
        sourceBoardId,
      });
      return;
    }

    const red = requireTag(tags, 'red', sourceBoardId);
    const black = requireTag(tags, 'black', sourceBoardId);
    const movelist = requireTag(tags, 'movelist', sourceBoardId);
    if (!red.ok || !black.ok || !movelist.ok) {
      if (!red.ok) issues.push(red.issue);
      if (!black.ok) issues.push(black.issue);
      if (!movelist.ok) issues.push(movelist.issue);
      return;
    }

    // A CJK-only frame title yields no board token (falls back to "board-<n>"),
    // so independent single-game pages would all collide on board-1. Derive a
    // stable per-game id from the pairing + round instead. Stable across live
    // re-polls of the same game (red/black/round don't change as moves grow).
    //
    // The pairing is not the game. A tiebreak replays the same two players with
    // the same colours in the same round -- the 2026 Shanghai Cup semi
    // 陈绍博–杨世哲 went eight games, four per colour ordering -- and a key of
    // pairing + round filed one board per colour ordering and rejected the
    // other six as incompatible updates (#416). When the page URL names the
    // game (dpxq's view_m_<id>.html is one record), that id is the identity and
    // goes into the hash; a page that names no game keeps the pairing key.
    if (/^board-\d+$/.test(sourceBoardId)) {
      const gameId = sourceGameId(options.sourceUrl);
      sourceBoardId = `b${hashToken(
        `${red.value}|${black.value}|${pageRoundTag ?? ''}${gameId ? `|${gameId}` : ''}`,
      )}`;
    }

    const moves = movesFromDhtmlMovelist(sourceBoardId, movelist.value);
    if (!moves.ok) {
      issues.push(moves.issue);
      return;
    }

    const { result, status } = resultFromWxf(tags.get('result'));
    const board: XiangqiBroadcastBoard = {
      schema: XIANGQI_BROADCAST_SCHEMA,
      id: `${tourSlug}-${roundId}-${sourceBoardId}`,
      tourSlug,
      roundId,
      sourceBoardId,
      boardNumber: boardNumberFromSourceId(sourceBoardId, index, options.boardNumber),
      // The optional team tags are what the dpxq adapter recovers for team
      // events; `federation` is the schema's existing slot for the affiliation
      // shown beside a player.
      red: {
        name: cleanPlayerName(red.value),
        ...(playerTeam(tags, 'redteam') ? { federation: playerTeam(tags, 'redteam') } : {}),
      },
      black: {
        name: cleanPlayerName(black.value),
        ...(playerTeam(tags, 'blackteam') ? { federation: playerTeam(tags, 'blackteam') } : {}),
      },
      status,
      result,
      moves: moves.moves,
      ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    };
    board.details = gameDetailsFromFrameTags(tags);
    const replayIssue = issueForReplayFailure(board);
    if (replayIssue) {
      issues.push(replayIssue);
      return;
    }
    boards.push(board);
  });

  if (boards.length === 0) return { ok: false, issues };
  return { ok: true, snapshot: { tour, rounds: [round], boards }, issues };
}
