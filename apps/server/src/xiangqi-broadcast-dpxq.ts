// Adapter: normalize a raw dpxq.com (东萍象棋) game page into the
// [DhtmlXQiFrame] envelope the WXF/DhtmlXQ converter already consumes. dpxq is
// the de-facto Chinese-web relay format but never emits our frame wrapper, and
// its two page shapes differ:
//
//   - live room per-board feed (view.asp?owner=u&id=N): full [DhtmlXQ_*] tag
//     block inline, [DhtmlXQiFrame] wrapper absent, empty [DhtmlXQ_binit] means
//     the standard start position.
//   - archive game page (view_m_N.html): the movelist lives inside a JS string
//     (var DhtmlXQ_movelist = '[DhtmlXQ_movelist]...[/DhtmlXQ_movelist]') and the
//     players / event / result appear only in the <title>.
//
// One scrape handles both: collect every [DhtmlXQ_key]value[/DhtmlXQ_key] pair
// found anywhere in the text (the archive's movelist tag lives literally inside
// the JS var, so the same regex catches it), then backfill missing player/result
// fields from the <title>. Everything downstream (binit gate, per-move replay,
// fail-closed rejection) stays with the existing converter.

import { STANDARD_DHTMLXQ_BINIT } from './xiangqi-broadcast-wxf-dhtmlxq.js';

export type DpxqNormalizeResult = { ok: true; html: string } | { ok: false; reason: string };

// A raw dpxq page carries a [DhtmlXQ_movelist] tag (bare or inside a JS var) but
// never the [DhtmlXQiFrame] wrapper that marks an already-normalized WXF page.
export function looksLikeDpxqPage(text: string): boolean {
  return text.includes('[DhtmlXQ_movelist]') && !text.includes('[DhtmlXQiFrame]');
}

function collectDhtmlxqTags(text: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const match of text.matchAll(/\[DhtmlXQ_([a-z0-9]+)\]([\s\S]*?)\[\/DhtmlXQ_\1\]/gi)) {
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    // First NON-EMPTY occurrence wins. dpxq archive pages carry an empty
    // [DhtmlXQ_movelist][/DhtmlXQ_movelist] placeholder before the real
    // movelist (which lives inside a JS var), so a plain first-wins would
    // capture the empty one and drop every move.
    const existing = tags.get(key);
    if (existing === undefined || (existing.length === 0 && value.length > 0)) {
      tags.set(key, value);
    }
  }
  return tags;
}

function extractTitle(text: string): string | undefined {
  const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const value = match?.[1]?.replace(/\s+/g, ' ').trim();
  return value && value.length > 0 ? value : undefined;
}

type TitleParts = {
  red?: string;
  black?: string;
  redTeam?: string;
  blackTeam?: string;
  result?: string;
  event?: string;
  round?: string;
};

// "浙江民泰银行象棋队 王家瑞" -> team "浙江民泰银行象棋队", player "王家瑞".
// Team competitions are the norm at the top of Chinese xiangqi (甲级联赛 is a
// team league), and individual events still prefix the player's province, so
// the leading segment is worth keeping in both cases. A bare name yields no
// team rather than a wrong one.
function splitTeamAndPlayer(raw: string | undefined): { team?: string; player?: string } {
  const value = raw?.trim();
  if (!value) return {};
  const tokens = value.split(/\s+/);
  const player = tokens.pop();
  const team = tokens.join(' ').trim();
  return { ...(team ? { team } : {}), ...(player ? { player } : {}) };
}

// dpxq archive titles read
//   "RedTeam RedName <和|胜|负> BlackTeam BlackName - Event - Round - Opening - Site".
// The middle marker between the two players encodes the result relative to red.
function parseDpxqTitle(title: string): TitleParts {
  const segments = title.split(/\s+-\s+/).map((part) => part.trim());
  const head = segments[0] ?? '';
  const parts: TitleParts = {
    event: segments[1] || undefined,
    round: segments[2] || undefined,
  };

  const markerMatch = head.match(/\s(和|胜|负|先和|先胜|先负)\s/);
  if (markerMatch) {
    const marker = markerMatch[1]!;
    const [leftRaw, rightRaw] = head.split(markerMatch[0]);
    const left = splitTeamAndPlayer(leftRaw);
    const right = splitTeamAndPlayer(rightRaw);
    parts.red = left.player ?? leftRaw?.trim() ?? undefined;
    parts.black = right.player ?? rightRaw?.trim() ?? undefined;
    parts.redTeam = left.team;
    parts.blackTeam = right.team;
    // Map red-relative marker to the 红胜/黑胜/和 tokens resultFromWxf understands.
    parts.result = marker.includes('和') ? '和' : marker.includes('胜') ? '红胜' : '黑胜';
  }
  return parts;
}

// dpxq game tags carried through to board.details (see XiangqiBroadcastGameDetails).
const GAME_DETAIL_TAGS = [
  'event',
  'group',
  'table',
  'other',
  'gametype',
  'timerule',
  'date',
  'open',
];

function escapeFrameValue(value: string): string {
  // Guard the frame delimiters; a stray "[/DhtmlXQ_x]" inside a name would
  // otherwise truncate a tag when the converter re-parses the synthesized page.
  return value.replaceAll('[', '(').replaceAll(']', ')');
}

export function normalizeDpxqPageToFrameHtml(text: string): DpxqNormalizeResult {
  if (!looksLikeDpxqPage(text)) {
    return { ok: false, reason: 'not a raw dpxq page' };
  }

  const tags = collectDhtmlxqTags(text);
  const movelist = tags.get('movelist') ?? '';
  const title = extractTitle(text);
  const titleParts = title ? parseDpxqTitle(title) : {};

  // Prefer the clean player name (redname/blackname) over the team+name form
  // (red/black); fall back to the <title> for archive pages that omit the tags.
  // Three surfaces, in order of how clean they are: the dedicated name tag,
  // the combined "team name" tag, then the <title>. The combined form has to be
  // split rather than used whole, or the team ends up inside the player's name.
  // Losing the team entirely turns a team league (which 甲级联赛 is) into a
  // list of anonymous pairings, so it is kept beside the name, not discarded.
  const side = (
    nameTag: string,
    combinedTag: string,
    titleName: string | undefined,
    titleTeam: string | undefined,
  ): { player: string; team?: string } => {
    const combined = splitTeamAndPlayer(tags.get(combinedTag));
    const clean = tags.get(nameTag)?.trim();
    const player = clean || combined.player || titleName || '';
    // Only trust the combined tag's team when it agrees on the player, so a
    // mismatched pair of tags yields no affiliation rather than a wrong one.
    const team = combined.team && (!clean || clean === combined.player) ? combined.team : titleTeam;
    return { player, ...(team ? { team } : {}) };
  };

  const redSide = side('redname', 'red', titleParts.red, titleParts.redTeam);
  const blackSide = side('blackname', 'black', titleParts.black, titleParts.blackTeam);
  const red = redSide.player;
  const black = blackSide.player;
  if (!red || !black) {
    return { ok: false, reason: 'dpxq page is missing both tag and title player names' };
  }
  const redTeam = redSide.team;
  const blackTeam = blackSide.team;

  // Preserve a real non-standard start if the page carries one; an empty/absent
  // binit is dpxq's shorthand for the standard opening position.
  const binit = tags.get('binit') || STANDARD_DHTMLXQ_BINIT;
  const result = tags.get('result') || titleParts.result || '';
  // The round (第NN轮) lives in a live-room tag or the archive <title>; carry it
  // through so distinct rounds become distinct rounds/boards downstream.
  const round = tags.get('round') || titleParts.round || '';
  const frameTitle = tags.get('title') || `${red} - ${black}`;
  // The event name is the tour identity; every board in one event must resolve
  // to the same tour, so prefer the authoritative [DhtmlXQ_event] tag over the
  // page <title> (which on the live room is a generic "象棋直播室").
  const pageTitle = tags.get('event') || titleParts.event || title || frameTitle;

  const html = [
    `<title>${escapeFrameValue(pageTitle)}</title>`,
    '[DhtmlXQiFrame]',
    `[DhtmlXQ_title]${escapeFrameValue(frameTitle)}[/DhtmlXQ_title]`,
    `[DhtmlXQ_binit]${binit}[/DhtmlXQ_binit]`,
    `[DhtmlXQ_round]${escapeFrameValue(round)}[/DhtmlXQ_round]`,
    `[DhtmlXQ_red]${escapeFrameValue(red)}[/DhtmlXQ_red]`,
    `[DhtmlXQ_black]${escapeFrameValue(black)}[/DhtmlXQ_black]`,
    ...(redTeam ? [`[DhtmlXQ_redteam]${escapeFrameValue(redTeam)}[/DhtmlXQ_redteam]`] : []),
    ...(blackTeam ? [`[DhtmlXQ_blackteam]${escapeFrameValue(blackTeam)}[/DhtmlXQ_blackteam]`] : []),
    `[DhtmlXQ_result]${escapeFrameValue(result)}[/DhtmlXQ_result]`,
    // What the game was, beyond its moves: the team match, table, which game
    // of the pair, how it was played, when, and the opening. The converter
    // reads them into board.details; a page without them carries none.
    ...GAME_DETAIL_TAGS.flatMap((tag) => {
      const value = tags.get(tag)?.trim();
      return value ? [`[DhtmlXQ_${tag}]${escapeFrameValue(value)}[/DhtmlXQ_${tag}]`] : [];
    }),
    `[DhtmlXQ_movelist]${movelist}[/DhtmlXQ_movelist]`,
    '[/DhtmlXQiFrame]',
  ].join('\n');

  return { ok: true, html };
}
