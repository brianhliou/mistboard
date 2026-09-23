// dpxq's tournament index (/hldcg/, 象棋赛事追踪): one page listing every event
// dpxq tracks, sectioned 正在进行 / 即将进行 / 已经结束, each row carrying the
// tour id, name, venue, start and end dates, and links to whichever sub-pages
// exist (对阵 pairings, 棋谱 the game list).
//
// Two jobs read it. The scheduler keeps a relayed tour's end date in step
// with dpxq's, because dpxq edits a league's row as stages are announced (the
// 2025 men's league row grew from August to December) and polling is bounded
// by the end date. The daily readout lists top events dpxq is tracking that we
// are not, because the 2026 women's league was on dpxq while our calendar said
// it had no 2026 edition. Seeding one stays a reviewed step: the event's grade
// in xiangqi-broadcast-levels.ts decides who gets a player page.

import type { XiangqiBroadcastSourceFetch } from './xiangqi-broadcast-fetch.js';

export const DPXQ_TOUR_INDEX_URL = 'http://www.dpxq.com/hldcg/';

export type DpxqIndexSection = 'live' | 'upcoming' | 'ended';

export type DpxqIndexRow = {
  tourId: string;
  name: string;
  location: string;
  /** YYYY-MM-DD in the event's own clock (dpxq lists China dates). */
  startsOn: string;
  endsOn: string;
  section: DpxqIndexSection;
  /** A 棋谱 link: dpxq holds game records the dpxq-tour provider can read. */
  hasGameList: boolean;
  /** A 对阵 link: pairings are up, which comes before records. */
  hasPairings: boolean;
};

const SECTION_MARKERS: ReadonlyArray<[string, DpxqIndexSection]> = [
  ['正在进行', 'live'],
  ['即将进行', 'upcoming'],
  ['已经结束', 'ended'],
];

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\s　]+/g, ' ')
    .trim();
}

/** Parse the index page. Rows before the first section header are the column
 *  header and are skipped; a row without a tour link or two dates is not a
 *  tour and is skipped rather than guessed. */
export function parseDpxqTourIndex(html: string): DpxqIndexRow[] {
  const rows: DpxqIndexRow[] = [];
  let section: DpxqIndexSection | null = null;
  for (const block of html.matchAll(/<div>([\s\S]*?)<\/div>/gi)) {
    const body = block[1] ?? '';
    if (/class="tcomm"/.test(body)) {
      const text = stripTags(body);
      section = SECTION_MARKERS.find(([marker]) => text.includes(marker))?.[1] ?? section;
      continue;
    }
    if (!section) continue;
    const link = body.match(
      /<p class="tname">[\s\S]*?href="\/hldcg\/tour_(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!link) continue;
    const dates = [...body.matchAll(/<p class="tdate">\s*(\d{4}-\d{2}-\d{2})\s*<\/p>/gi)].map(
      (match) => match[1] as string,
    );
    if (dates.length < 2) continue;
    const location = body.match(/<p class="tplace">([\s\S]*?)<\/p>/i)?.[1] ?? '';
    const tourId = link[1] as string;
    rows.push({
      tourId,
      name: stripTags(link[2] ?? ''),
      location: stripTags(location),
      startsOn: dates[0] as string,
      endsOn: dates[1] as string,
      section,
      hasGameList: body.includes(`movelist_${tourId}.html`),
      hasPairings: body.includes(`round_${tourId}.html`),
    });
  }
  return rows;
}

// Which untracked events are worth a line in the readout. dpxq tracks
// everything from the national league to a neighbourhood seniors' afternoon,
// and ~100 rows a year are the latter. Inclusion names the professional and
// international series; exclusion drops the amateur, youth and community
// events that share their vocabulary (全国业余…棋王, 全国大学生…锦标赛).
const TOP_EVENT_PATTERN =
  /甲级联赛|全国象棋个人赛|全国象棋团体赛|全国象棋锦标赛|世界象棋|世界快棋|亚洲象棋|大师|五羊杯|上海杯|天元赛|王位赛|楚河汉界|碧桂园杯|等级赛/;
const MINOR_EVENT_PATTERN =
  /业余|少年|少儿|青少年|儿童|幼儿|中小学|大学生|学生|老年|银龄|社区|街道|月月赛|全民健身|职工|机关|企业|残疾人/;

export function isTopDpxqEvent(name: string): boolean {
  return TOP_EVENT_PATTERN.test(name) && !MINOR_EVENT_PATTERN.test(name);
}

/** The dpxq tour id a relayed tour polls, from its discovery source URL. */
export function dpxqTourIdFromSourceUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl?.startsWith('mistboard-discover://dpxq-tour')) return null;
  try {
    const tour = new URL(sourceUrl).searchParams.get('tour');
    return tour && /^\d+$/.test(tour) ? tour : null;
  } catch {
    return null;
  }
}

/** dpxq dates are China dates; an end date means the end of that day there. */
export function dpxqEndOfDay(date: string): string {
  return `${date}T23:59:59+08:00`;
}

export type DpxqTrackedTour = { slug: string; sourceUrl: string | null; endsAt: string | null };

export type DpxqEndDateMove = { slug: string; tourId: string; from: string | null; to: string };

export type DpxqIndexPlan = {
  /** Tours whose dpxq row now ends later than ours. Only ever later: a row
   *  edited shorter by mistake must not cut polling short. */
  endDateMoves: DpxqEndDateMove[];
  /** Top events no tour of ours polls: live or upcoming, or finished in the
   *  last month with records up (a backfill waiting to be seeded). */
  untracked: DpxqIndexRow[];
};

export const DPXQ_RECENTLY_ENDED_MS = 30 * 24 * 60 * 60_000;

export function planDpxqIndexSync(input: {
  rows: readonly DpxqIndexRow[];
  tours: readonly DpxqTrackedTour[];
  now: number;
}): DpxqIndexPlan {
  const rowsById = new Map(input.rows.map((row) => [row.tourId, row]));
  const trackedIds = new Set<string>();
  const endDateMoves: DpxqEndDateMove[] = [];
  for (const tour of input.tours) {
    const tourId = dpxqTourIdFromSourceUrl(tour.sourceUrl);
    if (!tourId) continue;
    trackedIds.add(tourId);
    const row = rowsById.get(tourId);
    if (!row) continue;
    const to = dpxqEndOfDay(row.endsOn);
    const current = tour.endsAt ? Date.parse(tour.endsAt) : Number.NaN;
    if (Number.isFinite(current) && Date.parse(to) <= current) continue;
    endDateMoves.push({ slug: tour.slug, tourId, from: tour.endsAt, to });
  }
  const untracked = input.rows.filter((row) => {
    if (trackedIds.has(row.tourId) || !isTopDpxqEvent(row.name)) return false;
    if (row.section !== 'ended') return true;
    return (
      row.hasGameList && input.now - Date.parse(dpxqEndOfDay(row.endsOn)) <= DPXQ_RECENTLY_ENDED_MS
    );
  });
  return { endDateMoves, untracked };
}

export async function fetchDpxqTourIndex(input: {
  fetchImpl: XiangqiBroadcastSourceFetch;
  timeoutMs: number;
  url?: string;
}): Promise<{ ok: true; rows: DpxqIndexRow[] } | { ok: false; message: string }> {
  const url = input.url ?? DPXQ_TOUR_INDEX_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, message: `${url} responded ${response.status}` };
    const rows = parseDpxqTourIndex(await response.text());
    // An index with no rows is a changed page, not a quiet week: dpxq lists
    // the year's finished events too, so a real index is never empty.
    if (rows.length === 0) return { ok: false, message: `${url} parsed to no tour rows` };
    return { ok: true, rows };
  } catch (error) {
    return {
      ok: false,
      message: `${url}: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
